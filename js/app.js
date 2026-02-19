// eSAFE CSV Tool – Updated Full Logic with Renaming Engine & id_path removal option

const $ = (id) => document.getElementById(id);

// State
const state = {
  fileNameBase: null,
  delimiter: ",",
  data: null,
  fields: null,
  // outputs
  fixedCsv: null,
  longCsv: null,
  statsCsv: null,
  filesCsv: null,
  foldersCsv: null,
  // stats
  changedCount: 0,
  longCount: 0,
  typeCounts: {}
};

// ---------------- UI helpers
function log(msg, cls = "") {
  const el = $("log");
  const line = cls ? `[${cls.toUpperCase()}] ${msg}` : msg;
  el.textContent += (el.textContent ? "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}
function setStatus(text){ $("status").textContent = text; }
function enableMainButtons(ok){ $("run").disabled = !ok; $("reset").disabled = !ok; }
function disableDownloads(){
  $("dlFixed").disabled = true; $("dlLong").disabled = true; $("dlStats").disabled = true;
  $("dlFiles").disabled = true; $("dlFolders").disabled = true; $("dlAll").disabled = true;
}
function safeGet(row, key){ return (row && Object.prototype.hasOwnProperty.call(row, key)) ? row[key] : ""; }
function inferBaseName(fileName){ const i = fileName.toLowerCase().lastIndexOf(".csv"); return i > 0 ? fileName.slice(0, i) : fileName; }

// ---------------- CSV helpers
function stripTrailingZ(value){
  return (typeof value === "string" && value.endsWith("Z")) ? value.slice(0, -1) : value;
}

// ---------------- Renaming engine
function cleanEmailPrefixes(name) {
  if (!name) return "";
  // FIXED: remove multiple prefixes; supports :, -, _, spaces, en dash
  return name.replace(/^((fw|fwd|re|from|to)[\s:_\-–]*)+/i, "").trim();
}
function extractEmailSubject(name) {
  const parts = name.split(":");
  return parts.length > 1 ? parts.slice(1).join(":").trim() : name;
}
function normalizeSpaces(name) { return name.trim().replace(/\s+/g, " "); }
function removeSpecialChars(name) { return name.replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ _-]+/g, ""); }

function shortenSmart(name, ext, maxLen) {
  const ell = "…";
  const full = name + ext;
  if (full.length <= maxLen) return full;

  const maxBase = maxLen - ext.length - ell.length;
  if (maxBase <= 0) return full.slice(0, maxLen);

  let short = name.slice(0, maxBase);
  const lastSpace = short.lastIndexOf(" ");
  if (lastSpace > maxBase * 0.6) short = short.slice(0, lastSpace);
  short = short.replace(/[\s._-]+$/, "");
  return short + ell + ext;
}

function smartRename(original, opts) {
  if (!opts.enabled) return original || "";
  if (!original) return "";

  let name = String(original).normalize("NFC");

  if (opts.stripEmail) name = cleanEmailPrefixes(name);
  if (opts.subjectOnly) name = extractEmailSubject(name);
  if (opts.cleanSpaces) name = normalizeSpaces(name);
  if (opts.noSpecial)   name = removeSpecialChars(name);

  // Safe extension handling: last dot, not first or last char
  const dot = name.lastIndexOf(".");
  let base = name, ext = "";
  if (dot > 0 && dot < name.length - 1) {
    base = name.slice(0, dot);
    ext  = name.slice(dot);
  }

  // Max length applies to full "base + ext"
  const maxLen = parseInt(opts.maxLen || "50", 10);
  return shortenSmart(base, ext, maxLen);
}

function correctedTitle(val) {
  const opts = {
    enabled: $("optRename").checked,
    maxLen: $("renameMaxLen").value,
    stripEmail: $("renameStripEmail").checked,
    subjectOnly: $("renameSubjectOnly").checked,
    cleanSpaces: $("renameCleanSpaces").checked,
    noSpecial: $("renameNoSpecial").checked
  };
  return smartRename(String(val ?? ""), opts);
}

// ---------------- Download
function downloadText(filename, text){
  const bom = "\uFEFF";
  const blob = new Blob([bom + text], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- Stats
function computeTypeCounts(rows){
  const counts = {};
  for (const r of rows){
    const t = String(safeGet(r,"type") || "");
    counts[t] = (counts[t] || 0) + 1;
  }
  state.typeCounts = counts;
}
function renderKPIs(){
  $("kRows").textContent = state.data ? state.data.length : "—";
  $("kCols").textContent = state.fields ? state.fields.length : "—";
  $("kChanged").textContent = (state.changedCount ?? "—");
  $("kLong").textContent = (state.longCount ?? "—");

  const tbody = $("typeCounts");
  tbody.innerHTML = "";
  const entries = Object.entries(state.typeCounts || {}).sort((a,b)=>b[1]-a[1]);
  if (!entries.length){
    tbody.innerHTML = `<tr><td colspan="2" style="color:var(--muted)">—</td></tr>`;
    return;
  }
  for (const [t,c] of entries){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t || "(empty)"}</td><td>${c}</td>`;
    tbody.appendChild(tr);
  }
}
function buildStatsReport(){
  const rows = [
    {metric:"rows", value: state.data.length},
    {metric:"columns", value: state.fields.length},
    {metric:"changes_applied", value: state.changedCount},
    {metric:"long_titles_report_count", value: state.longCount}
  ];
  for (const [t,c] of Object.entries(state.typeCounts)){
    rows.push({metric:`type_${t || "empty"}_count`, value:c});
  }
  return Papa.unparse(rows, {delimiter: state.delimiter});
}

// ---------------- Core fix rules (for Fixed CSV logic base)
function applyRules(rows){
  state.changedCount = 0;

  const optTypeCtoO = $("optTypeCtoO").checked;
  const optStripZ   = $("optStripZ").checked;
  const optDupFields= $("optDupFields").checked;

  const ensureField = (name) => {
    if (!state.fields.includes(name)) state.fields.push(name);
  };

  if (optDupFields){
    ensureField("id_display_name");
    ensureField("dc.title");
    ensureField("dc.id");
    ensureField("dc.date");
  }

  const dateCols = ["isadg.eventStartDates", "isadg.eventEndDates"];

  for (const r of rows){
    if (optTypeCtoO && safeGet(r,"type") === "C"){
      r["type"] = "O";
      state.changedCount++;
    }

    if (optStripZ){
      for (const col of dateCols){
        if (Object.prototype.hasOwnProperty.call(r, col)){
          const before = r[col];
          const after  = stripTrailingZ(before);
          if (after !== before){
            r[col] = after;
            state.changedCount++;
          }
        }
      }
    }

    if (optDupFields){
      const title = safeGet(r,"isadg.title");
      const ident = safeGet(r,"isadg.identifier");
      const start = safeGet(r,"isadg.eventStartDates");

      if (r["id_display_name"] !== title){ r["id_display_name"] = title; state.changedCount++; }
      if (r["dc.title"] !== title){ r["dc.title"] = title; state.changedCount++; }
      if (r["dc.id"] !== ident){ r["dc.id"] = ident; state.changedCount++; }
      if (r["dc.date"] !== start){ r["dc.date"] = start; state.changedCount++; }
    }
  }
}

function toCsv(rows, columns){
  return Papa.unparse(rows, {
    delimiter: state.delimiter || ",",
    columns: columns || state.fields
  });
}

// ---------------- Long titles report
function buildLongNamesReport(rows){
  if (!$("optLongNames").checked){
    state.longCount = 0;
    return null;
  }
  const threshold = parseInt($("maxLen").value || "40", 10);
  const report = [];
  for (const r of rows){
    const original = String(safeGet(r,"isadg.title") ?? "").trim().replace(/\s+/g, " ");
    if (!original) continue;
    if (original.length > threshold){
      const suggestion = correctedTitle(original);
      report.push({
        id: safeGet(r,"id"),
        type: safeGet(r,"type"),
        parent_id: safeGet(r,"parent_id"),
        isadg_title: original,
        title_length: original.length,
        suggested: suggestion,
        suggested_length: suggestion.length,
        id_path: safeGet(r,"id_path"),
        isadg_identifier: safeGet(r,"isadg.identifier")
      });
    }
  }
  report.sort((a,b)=>b.title_length - a.title_length);
  state.longCount = report.length;
  return Papa.unparse(report, {delimiter: state.delimiter || ","});
}

// ---------------- Files.csv / Folders.csv (renaming applied)
function buildFilesCsv(rows){
  const out = [];
  for (const r of rows){
    if (String(safeGet(r,"type")) === "F"){
      out.push({ ID: safeGet(r,"id"), title: correctedTitle(safeGet(r,"isadg.title")) });
    }
  }
  return Papa.unparse(out, {delimiter: ","});
}

function buildFoldersCsvSorted(rows){
  const folders = [];
  const byId = new Map();

  for (const r of rows){
    if (String(safeGet(r,"type")) === "O"){
      const id = String(safeGet(r,"id") ?? "");
      const parent = String(safeGet(r,"parent_id") ?? "");
      const title = correctedTitle(safeGet(r,"isadg.title"));
      const node = { id, parent_id: parent, title };
      folders.push(node);
      if (id) byId.set(id, node);
    }
  }

  const roots = [];
  for (const n of folders){
    const p = (n.parent_id || "").trim();
    if (!p || !byId.has(p)) roots.push(n);
  }

  const depth = new Map();
  const q = [];

  for (const r of roots){
    depth.set(r.id, 0);
    q.push(r);
  }

  const children = new Map();
  for (const n of folders){
    const p = (n.parent_id || "").trim();
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }

  for (const [, arr] of children.entries()){
    arr.sort((a,b)=>{
      const ta = (a.title || "").localeCompare(b.title || "", "en", {sensitivity:"base"});
      if (ta !== 0) return ta;
      return (a.id || "").localeCompare(b.id || "");
    });
  }

  while (q.length){
    const cur = q.shift();
    const kids = children.get(cur.id) || [];
    for (const child of kids){
      if (!depth.has(child.id)){
        depth.set(child.id, (depth.get(cur.id) ?? 0) + 1);
        q.push(child);
      }
    }
  }

  for (const n of folders){
    if (!depth.has(n.id)) depth.set(n.id, 0);
  }

  folders.sort((a,b)=>{
    const da = depth.get(a.id) ?? 0;
    const db = depth.get(b.id) ?? 0;
    if (da !== db) return da - db;
    const t = (a.title || "").localeCompare(b.title || "", "en", {sensitivity:"base"});
    if (t !== 0) return t;
    return (a.id || "").localeCompare(b.id || "");
  });

  const out = folders.map(f => ({ID: f.id, title: f.title}));
  return Papa.unparse(out, {delimiter: ","});
}

// ---------------- Build Fixed CSV with optional id_path removal (without mutating rows used by reports)
function buildFixedCsv(rows) {
  const removeIdPath = $("optRemoveIdPath").checked;

  // Copy rows and fields for fixed output only
  const rowsForFixed = rows.map(r => {
    const o = { ...r };
    if (removeIdPath) delete o["id_path"];
    return o;
  });

  let fieldsForFixed = [...(state.fields || [])];
  if (removeIdPath) {
    fieldsForFixed = fieldsForFixed.filter(f => f !== "id_path");
    log("Removed column: id_path", "ok");
  }

  return Papa.unparse(rowsForFixed, {
    delimiter: state.delimiter || ",",
    columns: fieldsForFixed
  });
}

// ---------------- Reset
function resetAll(){
  state.fileNameBase = null;
  state.delimiter = ",";
  state.data = null;
  state.fields = null;
  state.fixedCsv = null;
  state.longCsv = null;
  state.statsCsv = null;
  state.filesCsv = null;
  state.foldersCsv = null;
  state.changedCount = 0;
  state.longCount = 0;
  state.typeCounts = {};
  $("log").textContent = "";
  disableDownloads();
  enableMainButtons(false);
  setStatus("Waiting for a file…");
  renderKPIs();
}

// ---------------- Events
$("file").addEventListener("change", (e) => {
  resetAll();
  const file = e.target.files?.[0];
  if (!file) return;

  state.fileNameBase = inferBaseName(file.name);
  setStatus(`Loaded: ${file.name}`);
  enableMainButtons(true);
  log(`Loaded: ${file.name}`, "ok");

  Papa.parse(file, {
    header: true, skipEmptyLines: true, dynamicTyping: false, worker: true,
    complete: (res) => {
      state.data = res.data || [];
      state.fields = res.meta?.fields ? [...res.meta.fields] : [];
      state.delimiter = res.meta?.delimiter || ",";
      log(`Rows: ${state.data.length}`, "ok");
      log(`Columns: ${state.fields.length}`, "ok");
      log(`Detected delimiter: "${state.delimiter}"`, "ok");
      computeTypeCounts(state.data);
      renderKPIs();
    },
    error: (err) => {
      setStatus("CSV parsing error");
      log(String(err), "bad");
    }
  });
});

$("run").addEventListener("click", async () => {
  if (!state.data) return;

  disableDownloads();
  setStatus("Processing…");
  log("Processing…", "ok");

  const rows = state.data.map(r => ({...r}));
  state.fields = [...(state.fields || [])];

  // Apply rules to rows (base for all outputs)
  applyRules(rows);

  // Recompute counts after any type changes
  computeTypeCounts(rows);

  // Build outputs
  state.fixedCsv   = buildFixedCsv(rows);       // ✅ uses optional id_path removal
  state.longCsv    = buildLongNamesReport(rows);
  state.statsCsv   = buildStatsReport();
  state.filesCsv   = buildFilesCsv(rows);       // renaming applied
  state.foldersCsv = buildFoldersCsvSorted(rows); // renaming applied

  log(`Changes applied (Fixed CSV): ${state.changedCount}`, "ok");
  log(`Long titles report: ${state.longCount}`, state.longCount ? "warn" : "ok");

  $("dlFixed").disabled = false;
  $("dlStats").disabled = false;
  $("dlFiles").disabled = false;
  $("dlFolders").disabled = false;
  $("dlLong").disabled = !state.longCsv;
  $("dlAll").disabled = false;

  setStatus("Done ✓");
  renderKPIs();
});

$("reset").addEventListener("click", () => {
  $("file").value = "";
  resetAll();
});

$("dlFixed").addEventListener("click", () => {
  if (!state.fixedCsv) return;
  downloadText(`${state.fileNameBase}_fixed.csv`, state.fixedCsv);
});
$("dlLong").addEventListener("click", () => {
  if (!state.longCsv) return;
  downloadText(`${state.fileNameBase}_long_titles.csv`, state.longCsv);
});
$("dlStats").addEventListener("click", () => {
  if (!state.statsCsv) return;
  downloadText(`${state.fileNameBase}_stats.csv`, state.statsCsv);
});
$("dlFiles").addEventListener("click", () => {
  if (!state.filesCsv) return;
  downloadText(`Files.csv`, state.filesCsv);
});
$("dlFolders").addEventListener("click", () => {
  if (!state.foldersCsv) return;
  downloadText(`Folders.csv`, state.foldersCsv);
});
$("dlAll").addEventListener("click", async () => {
  if (!state.fixedCsv && !state.longCsv && !state.statsCsv && !state.filesCsv && !state.foldersCsv) return;

  const zip = new JSZip();
  const base = state.fileNameBase || "export";

  zip.file(`${base}_fixed.csv`, state.fixedCsv || "");
  if (state.longCsv)  zip.file(`${base}_long_titles.csv`, state.longCsv);
  if (state.statsCsv) zip.file(`${base}_stats.csv`, state.statsCsv);
  if (state.filesCsv) zip.file(`Files.csv`, state.filesCsv);
  if (state.foldersCsv) zip.file(`Folders.csv`, state.foldersCsv);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${base}_exports.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Init
resetAll();
