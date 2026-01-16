import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- CORS ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server, curl, Postman
      if (!origin) return cb(null, true);

      // If not set, allow all (dev only)
      if (allowedOrigins.length === 0) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);

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
    console.error(e);
    res.status(500).json({ ok: false, error: "proxy_failed", message: e.message });
  }
});

// ---------- LODGIFY PROXY ----------
const LODGIFY_API_BASE = "https://api.lodgify.com";
const LODGIFY_API_KEY = process.env.LODGIFY_API_KEY || "";

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

async function lodgifyGet(path, query, res) {
  const url = new URL(LODGIFY_API_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && String(v).length > 0) url.searchParams.set(k, String(v));
  }

  const r = await fetch(url.toString(), {
    headers: {
      "X-ApiKey": LODGIFY_API_KEY,
      "Accept": "application/json",
    },
  });

  const text = await r.text();
  res.status(r.status);
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
    await lodgifyGet("/v2/reservations/bookings", req.query, res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "lodgify_bookings_failed", message: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
