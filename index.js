import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send("ok"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));
