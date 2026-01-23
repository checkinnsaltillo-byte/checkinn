import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- CORS ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Permite file:// (Origin: "null") si lo habilitas (útil en pruebas abriendo el HTML desde Finder)
const ALLOW_NULL_ORIGIN =
  (process.env.ALLOW_NULL_ORIGIN || "true").toLowerCase() === "true";

const corsOptions = {
  origin: (origin, cb) => {
    // Server-to-server, curl, Postman (sin header Origin)
    if (!origin) return cb(null, true);

    // file:// -> Origin: "null"
    if (ALLOW_NULL_ORIGIN && origin === "null") return cb(null, true);

    // Si no configuras ALLOWED_ORIGINS, permite todo (dev only)
    if (allowedOrigins.length === 0) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);

    // Rechaza limpio, sin lanzar error
    return cb(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization", "Cache-Control", "Pragma"],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// Health
app.get("/", (req, res) => res.send("ok"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- FINANCE DATA PROXY (Apps Script / Sheets) ----------
const FINANCE_DATA_ENDPOINT =
  process.env.FINANCE_DATA_ENDPOINT ||
  "https://script.google.com/macros/s/REPLACE_ME/exec";

app.get("/api/data", async (req, res) => {
  try {
    const url = new URL(FINANCE_DATA_ENDPOINT);
    for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);

    const r = await fetch(url.toString());
    const text = await r.text();

    res.status(r.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.type("text/plain").send(text);
    }
  } catch (e) {
    console.error("[/api/data] proxy_failed:", e);
    res.status(500).json({ ok: false, error: "proxy_failed", message: e.message });
  }
});

// ---------- LODGIFY PROXY ----------
const LODGIFY_API_BASE = "https://api.lodgify.com";
const LODGIFY_API_KEY = process.env.LODGIFY_API_KEY || "";
const LODGIFY_TIMEOUT_MS = Number(process.env.LODGIFY_TIMEOUT_MS || 20000);

// Algunas APIs se portan mejor con User-Agent explícito
const USER_AGENT = process.env.USER_AGENT || "checkinn-proxy/1.0";

function requireLodgifyKey(res) {
  if (!LODGIFY_API_KEY) {
    res.status(500).json({
      ok: false,
      error: "missing_lodgify_key",
      message:
        "Missing LODGIFY_API_KEY env var. Set it in Cloud Run (Variables & secrets) and redeploy.",
    });
    return false;
  }
  return true;
}

// fetch con timeout + abort
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Helper básico: proxy directo
async function lodgifyGet(path, query, res) {
  const url = new URL(LODGIFY_API_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      url.searchParams.set(k, String(v));
    }
  }

  // Anti-cache (muy importante para GH Pages)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const target = url.toString();
  const started = Date.now();
  console.log(`[lodgify] GET ${target}`);

  let r;
  try {
    r = await fetchWithTimeout(
      target,
      {
        headers: {
          "X-ApiKey": LODGIFY_API_KEY,
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
      },
      LODGIFY_TIMEOUT_MS
    );
  } catch (e) {
    const ms = Date.now() - started;
    const isAbort = e?.name === "AbortError";
    console.error(`[lodgify] FAILED ${path} in ${ms}ms`, e);
    return res.status(504).json({
      ok: false,
      error: isAbort ? "lodgify_timeout" : "lodgify_fetch_failed",
      message: isAbort
        ? `Lodgify request timed out after ${LODGIFY_TIMEOUT_MS}ms`
        : (e.message || "Fetch failed"),
      path,
    });
  }

  const ms = Date.now() - started;
  console.log(`[lodgify] ${r.status} ${path} in ${ms}ms`);

  const text = await r.text();
  res.status(r.status);

  try {
    res.json(JSON.parse(text));
  } catch {
    res.type("text/plain").send(text);
  }
}

// ---------- PROPERTIES ----------
app.get("/api/lodgify/properties", async (req, res) => {
  if (!requireLodgifyKey(res)) return;
  try {
    await lodgifyGet("/v2/properties", req.query, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "lodgify_properties_failed", message: e.message });
  }
});

// ---------- BOOKINGS (PAGINACIÓN ROBUSTA) ----------
/**
 * Objetivo:
 * - Si el cliente manda `page` => proxy de 1 sola página (debug / UI paginada server-side)
 * - Si el cliente NO manda `page` => agregamos todas las páginas (ideal para dashboards)
 *
 * Importante:
 * - Lodgify a veces usa page/size, pero en algunos endpoints usan offset/limit.
 * - Aquí implementamos:
 *   A) intentar con page/size
 *   B) si detectamos que no avanza (misma respuesta), probamos offset/limit
 */
app.get("/api/lodgify/bookings", async (req, res) => {
  if (!requireLodgifyKey(res)) return;

  try {
    const from = req.query.from;
    const to = req.query.to;

    // Controles
    const size = Math.min(500, Math.max(1, Number(req.query.size || 200)));
    const clientPage = req.query.page ? Number(req.query.page) : null;

    // anti-cache
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // 1) Si piden una página específica: proxy normal
    if (clientPage) {
      return await lodgifyGet("/v2/reservations/bookings", { ...req.query, page: clientPage, size }, res);
    }

    // 2) Si no piden page: agregamos TODO
    const headers = {
      "X-ApiKey": LODGIFY_API_KEY,
      "Accept": "application/json",
      "User-Agent": USER_AGENT,
    };

    // ----- A) Intento 1: page/size -----
    let page = 1;
    let all = [];
    let lastFirstId = null;
    let stagnationHits = 0;

    console.log(`[bookings] aggregate mode from=${from} to=${to} size=${size}`);

    while (true) {
      const url = new URL(LODGIFY_API_BASE + "/v2/reservations/bookings");
      if (from) url.searchParams.set("from", from);
      if (to) url.searchParams.set("to", to);
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", String(size));

      const target = url.toString();
      const r = await fetchWithTimeout(target, { headers }, LODGIFY_TIMEOUT_MS);
      const txt = await r.text();

      if (!r.ok) {
        console.error("[bookings] lodgify error:", r.status, txt?.slice?.(0, 200));
        return res.status(r.status).type("text/plain").send(txt);
      }

      const data = JSON.parse(txt);
      const items = Array.isArray(data.items) ? data.items : [];

      const firstId = items?.[0]?.id ?? null;
      console.log(`[bookings] page/size page=${page} got=${items.length} firstId=${firstId}`);

      // Si Lodgify ignora "page" y siempre regresa lo mismo, detectamos estancamiento
      if (firstId && lastFirstId && firstId === lastFirstId) {
        stagnationHits += 1;
      } else {
        stagnationHits = 0;
      }
      lastFirstId = firstId;

      all.push(...items);

      // Cortes normales
      if (items.length === 0) break;
      if (items.length < size) break;

      // Si se estanca 2 veces seguidas, saltamos a estrategia offset/limit
      if (stagnationHits >= 2) {
        console.warn("[bookings] page/size seems ignored -> switching to offset/limit fallback");
        all = []; // reseteamos y reintentamos con offset
        break;
      }

      page += 1;
      if (page > 5000) {
        console.warn("[bookings] safety break page>5000");
        break;
      }
    }

    // Si ya juntamos algo y no fue fallback, devolvemos
    if (all.length > 0) {
      return res.json({ ok: true, mode: "page/size", items: all, total: all.length });
    }

    // ----- B) Fallback: offset/limit -----
    let offset = 0;
    let limit = size;
    let all2 = [];
    let safety = 0;

    while (true) {
      const url = new URL(LODGIFY_API_BASE + "/v2/reservations/bookings");
      if (from) url.searchParams.set("from", from);
      if (to) url.searchParams.set("to", to);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(limit));

      const target = url.toString();
      const r = await fetchWithTimeout(target, { headers }, LODGIFY_TIMEOUT_MS);
      const txt = await r.text();

      if (!r.ok) {
        console.error("[bookings] lodgify error (offset):", r.status, txt?.slice?.(0, 200));
        return res.status(r.status).type("text/plain").send(txt);
      }

      const data = JSON.parse(txt);
      const items = Array.isArray(data.items) ? data.items : [];

      const firstId = items?.[0]?.id ?? null;
      console.log(`[bookings] offset/limit offset=${offset} got=${items.length} firstId=${firstId}`);

      all2.push(...items);

      if (items.length === 0) break;
      if (items.length < limit) break;

      offset += limit;

      safety += 1;
      if (safety > 20000) {
        console.warn("[bookings] safety break (offset)");
        break;
      }
    }

    return res.json({ ok: true, mode: "offset/limit", items: all2, total: all2.length });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "lodgify_bookings_failed", message: e.message });
  }
});

// ✅ Error handler (incluye errores de CORS)
app.use((err, req, res, next) => {
  console.error("[express error]", err);
  res.status(500).json({
    ok: false,
    error: "server_error",
    message: err?.message || "Unknown error",
  });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
