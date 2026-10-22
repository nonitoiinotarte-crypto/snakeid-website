const $ = (id) => document.getElementById(id);
const queryInput = $("speciesQuery");
const resultsEl = $("results");
const statusEl = $("status");
const detailEl = $("detail");
let lastResults = [];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function setStatus(message) { statusEl.textContent = message; }
function showResults(items) {
  lastResults = items;
  resultsEl.innerHTML = items.map((s, i) => `
    <article class="species-card" tabindex="0" role="button" data-index="${i}" aria-label="View ${escapeHtml(s.commonName || s.name)}">
      <img loading="lazy" src="${escapeHtml(s.image || "")}" alt="${escapeHtml(s.commonName || s.name)}" onerror="this.style.visibility='hidden'">
      <div class="card-body"><h3>${escapeHtml(s.commonName || s.name)}</h3><div class="latin">${escapeHtml(s.commonName ? s.name : "Scientific name")}</div><span class="rank">${escapeHtml(s.rank || "taxon")}</span></div>
    </article>`).join("");
  resultsEl.querySelectorAll(".species-card").forEach(card => {
    const open = () => showDetail(lastResults[Number(card.dataset.index)]);
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}
async function searchSpecies() {
  const q = queryInput.value.trim();
  detailEl.classList.add("hidden"); detailEl.innerHTML = ""; resultsEl.innerHTML = "";
  if (q.length < 2) { setStatus("Enter at least two characters."); return; }
  setStatus("Searching iNaturalist species data…");
  $("searchBtn").disabled = true;
  try {
    const response = await fetch(`/api/species/search?q=${encodeURIComponent(q)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed.");
    if (!data.results.length) { setStatus("No snake taxa found. Try another common or scientific name."); return; }
    showResults(data.results); setStatus(`${data.results.length} possible reference matches. Select a card to learn more.`);
    saveHistory(data.results[0]);
  } catch (e) { setStatus(e.message); }
  finally { $("searchBtn").disabled = false; }
}
async function showDetail(species) {
  detailEl.classList.remove("hidden");
  detailEl.innerHTML = `<p>Loading species details…</p>`;
  detailEl.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const [sr, or] = await Promise.all([
      fetch(`/api/species/${species.id}`), fetch(`/api/species/${species.id}/observations`)
    ]);
    const sd = await sr.json(), od = await or.json();
    if (!sr.ok) throw new Error(sd.error || "Could not load species.");
    const description = sd.description ? sd.description.replace(/<[^>]*>/g, "").slice(0, 900) : "No summary is available through this record. Follow the iNaturalist link for additional community observations and references.";
    const obs = od.results || [];
    detailEl.innerHTML = `
      <div class="detail-layout">
        <img src="${escapeHtml(sd.image || species.image || "")}" alt="${escapeHtml(sd.commonName || sd.name)}" onerror="this.style.display='none'">
        <div><span class="eyebrow dark">SPECIES REFERENCE</span><h3>${escapeHtml(sd.commonName || sd.name)}</h3><div class="latin">${escapeHtml(sd.name)} · ${escapeHtml(sd.rank)}</div>
          <p>${escapeHtml(description)}</p>
          <div class="rank">Venom status: Not verified by this website</div>
          <p><b>Habitat:</b> Habitat depends on the species and local environment. Consult the species references before drawing conclusions.</p>
          <p><b>Safety:</b> Do not approach or handle. Treat unidentified snakes as potentially dangerous.</p>
          <div class="detail-actions"><a href="${escapeHtml(sd.inatUrl)}" target="_blank" rel="noreferrer">iNaturalist taxon ↗</a><a href="${escapeHtml(sd.observationsUrl)}" target="_blank" rel="noreferrer">All observations ↗</a>${sd.wikipediaUrl ? `<a href="${escapeHtml(sd.wikipediaUrl)}" target="_blank" rel="noreferrer">Wikipedia ↗</a>` : ""}</div>
        </div>
      </div>
      <h3 style="font-size:18px;margin-top:25px">Community sightings</h3><p>Recent georeferenced research-grade observations from iNaturalist. Locations may be approximate or obscured.</p>
      <div class="observation-grid">${obs.length ? obs.map(o => `<a href="${escapeHtml(o.url)}" target="_blank" rel="noreferrer"><img loading="lazy" src="${escapeHtml(o.image || "")}" alt="Snake observation" onerror="this.style.display='none'"><b>${escapeHtml(o.place)}</b><br><span>${escapeHtml(o.observedOn || "Date unavailable")}</span></a>`).join("") : "<p>No matching georeferenced observations were returned.</p>"}</div>`;
    saveHistory(species);
  } catch (e) { detailEl.innerHTML = `<p>${escapeHtml(e.message)}</p>`; }
}
function getHistory() { try { return JSON.parse(localStorage.getItem("snakeid-history") || "[]"); } catch { return []; } }
function saveHistory(s) {
  const history = getHistory().filter(x => x.id !== s.id);
  history.unshift({ id: s.id, name: s.name, commonName: s.commonName, at: new Date().toISOString() });
  localStorage.setItem("snakeid-history", JSON.stringify(history.slice(0, 8))); renderHistory();
}
function renderHistory() {
  const history = getHistory();
  $("history").innerHTML = history.length ? history.map(h => `<button class="history-item" data-id="${h.id}"><b>${escapeHtml(h.commonName || h.name)}</b><span>${new Date(h.at).toLocaleString()}</span></button>`).join("") : '<p class="hint">Your searches will appear here on this device.</p>';
  $("history").querySelectorAll("button").forEach(b => b.addEventListener("click", async () => {
    try { const r = await fetch(`/api/species/${b.dataset.id}`); const s = await r.json(); if (r.ok) showDetail(s); } catch {}
  }));
}
$("searchBtn").addEventListener("click", searchSpecies);
queryInput.addEventListener("keydown", e => { if (e.key === "Enter") searchSpecies(); });
$("clearHistory").addEventListener("click", () => { localStorage.removeItem("snakeid-history"); renderHistory(); });
$("photo").addEventListener("change", () => {
  const file = $("photo").files[0];
  $("preview").classList.add("hidden"); $("uploadStatus").textContent = "";
  if (!file) return;
  if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 8*1024*1024) { $("uploadStatus").textContent = "Choose a JPG, PNG, or WebP image up to 8 MB."; $("photo").value = ""; return; }
  $("preview").src = URL.createObjectURL(file); $("preview").classList.remove("hidden");
});
$("photoForm").addEventListener("submit", async e => {
  e.preventDefault(); const file = $("photo").files[0]; if (!file) return;
  const form = new FormData(); form.append("photo", file);
  $("uploadStatus").textContent = "Validating photo…";
  try {
    const r = await fetch("/api/photo-check", { method: "POST", body: form }); const d = await r.json();
    $("uploadStatus").textContent = r.ok ? d.message : (d.error || "Photo validation failed.");
  } catch { $("uploadStatus").textContent = "Could not reach the server. Please try again."; }
});
renderHistory();

// Scan dashboard: counts events saved in SQLite by this server.
async function loadAdminDashboard() {
  const ids = ["statTotal", "statToday", "statIdentified", "statPhotos"];
  try {
    const [sr, lr] = await Promise.all([fetch("/api/admin/scan-stats"), fetch("/api/admin/scan-logs?limit=100")]);
    const stats = await sr.json(), data = await lr.json();
    if (!sr.ok || !lr.ok) throw new Error("Dashboard data could not be loaded.");
    $(ids[0]).textContent = stats.total;
    $(ids[1]).textContent = stats.today;
    $(ids[2]).textContent = stats.identified;
    $(ids[3]).textContent = stats.photoUploads;
    const daily = stats.daily || [];
    const max = Math.max(1, ...daily.map(d => d.count));
    $("dailyStats").innerHTML = daily.length ? daily.map(d => {
      const date = new Date(d.day + "T12:00:00");
      return `<div class="day-bar"><b>${d.count}</b><div class="bar-track"><div class="bar-fill" style="height:${Math.max(2, d.count/max*100)}%"></div></div><small>${date.toLocaleDateString(undefined,{weekday:"short"})}</small></div>`;
    }).join("") : '<p class="empty-admin">No events logged yet.</p>';
    $("topSpecies").innerHTML = (stats.topSpecies || []).length ? stats.topSpecies.map(s => `<div class="species-count"><span>${escapeHtml(s.species)}</span><b>${s.count}</b></div>`).join("") : '<p class="empty-admin">No species searches yet.</p>';
    $("scanLogRows").innerHTML = data.logs.length ? data.logs.map(log => {
      const eventName = log.scanType === "photo_upload" ? "Photo upload" : (log.commonName || log.speciesName || "Unknown snake");
      const label = log.status === "photo_validated" ? "Photo validated" : log.status === "uncertain" ? "Uncertain" : log.status === "identified" ? "Search result" : "Failed";
      return `<tr><td>${new Date(log.createdAt.replace(" ", "T") + "Z").toLocaleString()}</td><td>${escapeHtml(eventName)}</td><td>${escapeHtml(log.scanType.replace("_"," "))}</td><td><span class="status-pill ${escapeHtml(log.status)}">${label}</span></td></tr>`;
    }).join("") : '<tr><td colspan="4">No scan events logged yet.</td></tr>';
  } catch (e) {
    $("scanLogRows").innerHTML = `<tr><td colspan="4">${escapeHtml(e.message)}</td></tr>`;
  }
}
$("refreshAdmin")?.addEventListener("click", loadAdminDashboard);
loadAdminDashboard();
