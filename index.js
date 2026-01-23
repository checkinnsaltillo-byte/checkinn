import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- CORS ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

    // Importante: NO arrojar Error (eso causa 500). Rechaza limpio.
    return cb(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization", "Cache-Control", "Pragma"],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Preflight para cualquier ruta
app.options("*", cors(corsOptions));

// (Opcional pero útil) JSON bodies
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

// Timeout configurable
const LODGIFY_TIMEOUT_MS = Number(process.env.LODGIFY_TIMEOUT_MS || 15000);

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

// Helper: fetch con timeout + abort
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

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
          // Lodgify: header correcto es X-ApiKey :contentReference[oaicite:1]{index=1}
          "X-ApiKey": LODGIFY_API_KEY,
          "Accept": "application/json",
        },
      },
      LODGIFY_TIMEOUT_MS
    );
  } catch (e) {
    const ms = Date.now() - started;
    const isAbort = e?.name === "AbortError";
    console.error(`[lodgify] FAILED ${path} in ${ms}ms`, e);

    // 🔥 Esto evita "pending" en el navegador: siempre responde
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

  // Si Lodgify regresa HTML o texto (errores), lo pasamos tal cual.
  try {
    res.json(JSON.parse(text));
  } catch {
    res.type("text/plain").send(text);
  }
}

// GET https://api.lodgify.com/v2/properties
app.get("/api/lodgify/properties", async (req, res) => {
  if (!requireLodgifyKey(res)) return;
  try {
    await lodgifyGet("/v2/properties", req.query, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "lodgify_properties_failed", message: e.message });
  }
});

// GET https://api.lodgify.com/v2/reservations/bookings
app.get("/api/lodgify/bookings", async (req, res) => {
  if (!requireLodgifyKey(res)) return;

  try {
    // parámetros base
    const from = req.query.from;
    const to = req.query.to;

    // tamaño por página (200 suele ser buen balance)
    const size = Number(req.query.size || 200);

    // si el cliente manda page, le respetas; si no, traes todo
    const clientPage = req.query.page ? Number(req.query.page) : null;

    // headers anti-cache
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // si el cliente pidió una sola página, solo proxy normal
    if (clientPage) {
      return await lodgifyGet("/v2/reservations/bookings", { ...req.query, page: clientPage, size }, res);
    }

    // si NO pidió page, traemos todas las páginas y devolvemos un solo JSON agregado
    let page = 1;
    let all = [];
    while (true) {
      const url = new URL(LODGIFY_API_BASE + "/v2/reservations/bookings");
      if (from) url.searchParams.set("from", from);
      if (to) url.searchParams.set("to", to);
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", String(size));

      const r = await fetchWithTimeout(url.toString(), {
        headers: { "X-ApiKey": LODGIFY_API_KEY, "Accept": "application/json" },
      }, LODGIFY_TIMEOUT_MS);

      const txt = await r.text();
      if (!r.ok) {
        return res.status(r.status).type("text/plain").send(txt);
      }

      const data = JSON.parse(txt);
      const items = Array.isArray(data.items) ? data.items : [];
      all.push(...items);

      // corte
      if (items.length === 0) break;
      if (items.length < size) break;

      page += 1;

      // safety brake (evitar loops infinitos si algo raro pasa)
      if (page > 2000) break;
    }

    return res.json({ ok: true, items: all, total: all.length });
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
