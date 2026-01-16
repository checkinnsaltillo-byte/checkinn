import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 8080;

// CORS por lista blanca (GitHub Pages + localhost)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Permite curl/postman (sin Origin)
      if (!origin) return cb(null, true);

      // Si no configuraste ALLOWED_ORIGINS, permite todo (solo para pruebas)
      if (allowedOrigins.length === 0) return cb(null, true);

      // Permite solo los definidos
      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);


app.get("/", (req, res) => res.send("ok"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Proxy financiero: /api/data  -> Apps Script (tu endpoint viejo)
const FINANCE_DATA_ENDPOINT =
  process.env.FINANCE_DATA_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbwmlnws66Fz008rDTX9nWmvUEd6akvfT7e_ejgT85MGDAzx3c8iWNjHj05nS2W0qB8_cw/exec";

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

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
