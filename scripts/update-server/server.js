const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const PORT = parseInt(process.env.PORT, 10) || 3001;
const UPDATE_DIR = path.resolve(process.env.UPDATE_DIR || path.join(__dirname, "dist"));
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.json({
    service: "Thermaltrue WMS Update Server",
    version: "1.0.0",
    mode: "development",
    updateJson: "/update.json",
    files: "/files/:filename",
    updateDir: UPDATE_DIR,
  });
});

app.get("/update.json", (_req, res) => {
  const file = path.join(UPDATE_DIR, "update.json");
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "update.json not found. Run generate-update-json.ps1 first." });
  }
  res.sendFile(file);
});

app.get("/files/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const file = path.join(UPDATE_DIR, filename);

  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `File not found: ${filename}` });
  }

  const allowed = [".msi", ".exe", ".sig", ".zip", ".dmg", ".AppImage", ".deb", ".rpm"];
  const ext = path.extname(filename).toLowerCase();
  if (!allowed.includes(ext)) {
    return res.status(403).json({ error: `File type not allowed: ${ext}` });
  }

  res.download(file);
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`\n  Update server running at http://localhost:${PORT}`);
  console.log(`  Update JSON:  http://localhost:${PORT}/update.json`);
  console.log(`  File serving: http://localhost:${PORT}/files/:filename`);
  console.log(`  Update dir:   ${UPDATE_DIR}\n`);
});
