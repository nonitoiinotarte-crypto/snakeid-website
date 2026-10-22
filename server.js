import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const INAT = "https://api.inaturalist.org/v1";
const USER_AGENT = process.env.INAT_USER_AGENT || "SnakeID/1.0";

// Set DB_PATH=/data/snakeid.sqlite on hosts with a persistent volume.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "snakeid.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS scan_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    species_taxon_id INTEGER,
    species_name TEXT,
    common_name TEXT,
    scan_type TEXT NOT NULL CHECK(scan_type IN ('search','photo_upload')),
    status TEXT NOT NULL CHECK(status IN ('identified','uncertain','photo_validated','failed')),
    confidence REAL,
    location_label TEXT,
    latitude REAL,
    longitude REAL
  );
  CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_scan_logs_taxon_id ON scan_logs(species_taxon_id);
`);
const insertScan = db.prepare(`INSERT INTO scan_logs
  (species_taxon_id, species_name, common_name, scan_type, status, confidence, location_label, latitude, longitude)
  VALUES (@species_taxon_id, @species_name, @common_name, @scan_type, @status, @confidence, @location_label, @latitude, @longitude)`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

async function inat(pathname, params = {}) {
  const url = new URL(`${INAT}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error(`iNaturalist returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function apiError(res, error) {
  console.error("API error:", error.message);
  const status = error.name === "TimeoutError" ? 504 : 502;
  res.status(status).json({ error: "The species service is temporarily unavailable. Please try again shortly." });
}
function recordScan(data) {
  insertScan.run({
    species_taxon_id: data.species_taxon_id ?? null,
    species_name: data.species_name ?? null,
    common_name: data.common_name ?? null,
    scan_type: data.scan_type,
    status: data.status,
    confidence: data.confidence ?? null,
    location_label: data.location_label ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null
  });
}

// iNaturalist taxon ID for Serpentes.
app.get("/api/species/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 2) return res.status(400).json({ error: "Enter at least two characters." });
  try {
    const data = await inat("/taxa/autocomplete", { q, taxon_id: 85553, per_page: 12 });
    const results = (data.results || []).map(t => ({
      id: t.id, name: t.name, commonName: t.preferred_common_name || "",
      rank: t.rank || "", iconicTaxonName: t.iconic_taxon_name || "",
      wikipediaUrl: t.wikipedia_url || "",
      image: t.default_photo?.medium_url || t.default_photo?.square_url || null,
      inatUrl: `https://www.inaturalist.org/taxa/${t.id}`
    }));
    // Log a search event only when results exist, avoiding logging every keystroke.
    if (results[0]) recordScan({
      species_taxon_id: results[0].id, species_name: results[0].name,
      common_name: results[0].commonName, scan_type: "search", status: "identified"
    });
    res.json({ results });
  } catch (e) { apiError(res, e); }
});

app.get("/api/species/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid species ID." });
  try {
    const data = await inat(`/taxa/${req.params.id}`);
    const t = data.results?.[0];
    if (!t) return res.status(404).json({ error: "Species not found." });
    res.json({
      id: t.id, name: t.name, commonName: t.preferred_common_name || "",
      rank: t.rank || "", rankLevel: t.rank_level,
      wikipediaUrl: t.wikipedia_url || "",
      image: t.default_photo?.medium_url || t.default_photo?.square_url || null,
      description: t.wikipedia_summary || "",
      inatUrl: `https://www.inaturalist.org/taxa/${t.id}`,
      observationsUrl: `https://www.inaturalist.org/observations?taxon_id=${t.id}`
    });
  } catch (e) { apiError(res, e); }
});

app.get("/api/species/:id/observations", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "Invalid species ID." });
  try {
    const data = await inat("/observations", {
      taxon_id: req.params.id, photos: true, geo: true,
      quality_grade: "research", per_page: 12, order_by: "observed_on", order: "desc"
    });
    const results = (data.results || []).map(o => ({
      id: o.id, observedOn: o.observed_on || "",
      place: o.place_guess || "Location not provided",
      latitude: o.geojson?.coordinates?.[1] ?? null,
      longitude: o.geojson?.coordinates?.[0] ?? null,
      image: o.photos?.[0]?.url?.replace("square", "medium") || null,
      url: `https://www.inaturalist.org/observations/${o.id}`,
      observer: o.user?.login || "iNaturalist observer"
    }));
    res.json({ results });
  } catch (e) { apiError(res, e); }
});

// Log an explicit uncertain result when a visitor says the species is unknown.
app.post("/api/scan-log", (req, res) => {
  const { speciesTaxonId, speciesName, commonName, status, locationLabel } = req.body || {};
  const allowed = new Set(["identified", "uncertain"]);
  if (!allowed.has(status)) return res.status(400).json({ error: "Invalid scan status." });
  if (speciesTaxonId != null && !/^\d+$/.test(String(speciesTaxonId))) return res.status(400).json({ error: "Invalid taxon ID." });
  recordScan({
    species_taxon_id: speciesTaxonId == null ? null : Number(speciesTaxonId),
    species_name: typeof speciesName === "string" ? speciesName.slice(0, 150) : null,
    common_name: typeof commonName === "string" ? commonName.slice(0, 150) : null,
    scan_type: "search", status,
    location_label: typeof locationLabel === "string" ? locationLabel.slice(0, 150) : null
  });
  res.status(201).json({ saved: true });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Upload a JPG, PNG, or WebP image."));
  }
});
app.post("/api/photo-check", upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a photo first." });
  recordScan({ scan_type: "photo_upload", status: "photo_validated" });
  res.json({
    accepted: true, filename: req.file.originalname, size: req.file.size,
    message: "Photo validated and this upload event was logged. This version does not identify a snake from the image."
  });
});

// Admin dashboard data. Protect this route before exposing the site publicly.
app.get("/api/admin/scan-stats", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) AS n FROM scan_logs").get().n;
  const today = db.prepare("SELECT COUNT(*) AS n FROM scan_logs WHERE date(created_at) = date('now','localtime')").get().n;
  const identified = db.prepare("SELECT COUNT(*) AS n FROM scan_logs WHERE status = 'identified'").get().n;
  const uncertain = db.prepare("SELECT COUNT(*) AS n FROM scan_logs WHERE status = 'uncertain'").get().n;
  const photoUploads = db.prepare("SELECT COUNT(*) AS n FROM scan_logs WHERE scan_type = 'photo_upload'").get().n;
  const daily = db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS count FROM scan_logs
    WHERE created_at >= datetime('now','-6 days') GROUP BY date(created_at) ORDER BY day`).all();
  const topSpecies = db.prepare(`SELECT COALESCE(common_name, species_name, 'Unknown') AS species,
    COUNT(*) AS count FROM scan_logs WHERE species_taxon_id IS NOT NULL
    GROUP BY species_taxon_id ORDER BY count DESC LIMIT 8`).all();
  res.json({ total, today, identified, uncertain, photoUploads, daily, topSpecies });
});
app.get("/api/admin/scan-logs", (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10) || 100, 1), 500);
  const logs = db.prepare(`SELECT id, created_at AS createdAt, species_name AS speciesName,
    common_name AS commonName, scan_type AS scanType, status, confidence,
    location_label AS locationLabel FROM scan_logs ORDER BY id DESC LIMIT ?`).all(limit);
  res.json({ logs });
});
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Maximum photo size is 8 MB." : "Photo upload failed." });
  if (err) return res.status(400).json({ error: err.message || "Request failed." });
  res.status(500).json({ error: "Unexpected server error." });
});
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`SnakeID running at http://localhost:${PORT}`));
