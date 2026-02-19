// eSAFE CSV Tool – Final stable version with prefix fixes, extension preservation,
// id_path removal, Files/Folders with suggested+original, and full report integration.

const $ = (id) => document.getElementById(id);

// Global state
const state = {
  fileNameBase: null,
  delimiter: ",",
  data: null,
  fields: null,

  fixedCsv: null,
  longCsv: null,
  statsCsv: null,
  filesCsv: null,
  foldersCsv: null,

  changedCount: 0,
  longCount: 0,
  typeCounts: {}
};

// UI helpers
function log(msg, cls = "") {
  const el = $("log");
  const line = cls ? `[${cls.toUpperCase()}] ${msg}` : msg;
  el.textContent += (el.textContent ? "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}
function setStatus(t){ $("status").textContent = t; }
function enableMainButtons(v){ $("run").disabled = !v; $("reset").disabled = !v; }
function disableDownloads(){
  $("dlFixed").disabled = true;
  $("dlLong").disabled = true;
  $("dlStats").disabled = true;
  $("dlFiles").disabled = true;
  $("dlFolders").disabled = true;
  $("dlAll").disabled = true;
}
function safeGet(r,k){ return (r && Object.prototype.hasOwnProperty.call(r,k)) ? r[k] : ""; }
function inferBaseName(fn){ const i = fn.toLowerCase().lastIndexOf(".csv"); return i>0 ? fn.slice(0,i) : fn; }

// CSV helpers
function stripTrailingZ(x){
  return (typeof x==="string" && x.endsWith("Z")) ? x.slice(0,-1) : x;
}

// ------------------------------
//  RENAMING ENGINE (final)
// ------------------------------
function cleanEmailPrefixes(name) {
  if (!name) return "";

  // Remove bracket/quote/dash noise before prefixes
  let x = name.replace(/^[\s"'`«»\[\]\(\)\{\}>-]+/, "");

  // Longest tokens FIRST (fixes "d_" bug from "Fwd_")
  const re = /^(?:\s*(fwd|fw|re|from|to)\s*[:_\-–]*\s*)/i;

  // Remove repeated prefix chains
  while (re.test(x)) x = x.replace(re, "");

  // Remove leftover separators
  x = x.replace(/^[\s:_\-–]+/, "");

  return x.trimStart();
}

function extractEmailSubject(name){
  const parts = name.split(":");
  return parts.length > 1 ? parts.slice(1).join(":").trim() : name;
}

function normalizeSpaces(n){ return n.trim().replace(/\s+/g," "); }

function removeSpecialChars(n){
  // ONLY touches basename, extension handled separately
  return n.replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ _-]+/g,"");
}

function shortenSmart(base, ext, maxLen){
  const ell = "…";
  const full = base + ext;
  if (full.length <= maxLen) return full;

  const maxBase = maxLen - ext.length - ell.length;
  if (maxBase <= 0) return full.slice(0, maxLen);

  let short = base.slice(0, maxBase);
  const lastSpace = short.lastIndexOf(" ");
  if (lastSpace > maxBase*0.6) short = short.slice(0,lastSpace);

  short = short.replace(/[\s._-]+$/,"");
  return short + ell + ext;
}

function smartRename(original, opts){
  if (!opts.enabled) return original || "";
  if (!original) return "";

  let name = String(original).normalize("NFC");

  if (opts.stripEmail) name = cleanEmailPrefixes(name);
  if (opts.subjectOnly) name = extractEmailSubject(name);

  // EXTENSION PRESERVATION (before cleaning)
  let base = name;
  let ext = "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    base = name.slice(0, dot);
    ext  = name.slice(dot);   // keep ".txt"
  }

  // Clean base
  if (opts.cleanSpaces) base = normalizeSpaces(base);
  if (opts.noSpecial)   base = removeSpecialChars(base);

  const maxLen = parseInt(opts.maxLen || "50",10);
  return shortenSmart(base, ext, maxLen);
}

function correctedTitle(raw){
  const opts = {
    enabled: $("optRename").checked,
    maxLen: $("renameMaxLen").value,
    stripEmail: $("renameStripEmail").checked,
    subjectOnly: $("renameSubjectOnly").checked,
    cleanSpaces: $("renameCleanSpaces").checked,
    noSpecial: $("renameNoSpecial").checked
  };
  return smartRename(String(raw ?? ""), opts);
}

// Header for suggested title (dynamic)
function suggestedHeader() {
  const n = parseInt($("renameMaxLen").value || "50",10);
  return `suggested_title (${n})`;
}

// Downloads
function downloadText(filename, text){
  const bom = "\uFEFF";
  const blob = new Blob([bom+text],{type:"text/csv;charset=utf-8"});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Stats
function computeTypeCounts(rows){
  const c={};
  for (const r of rows){
    const t = String(safeGet(r,"type")||"");
    c[t] = (c[t]||0)+1;
  }
  state.typeCounts = c;
}

function renderKPIs(){
  $("kRows").textContent = state.data ? state.data.length : "—";
  $("kCols").textContent = state.fields ? state.fields.length : "—";
  $("kChanged").textContent = state.changedCount ?? "—";
  $("kLong").textContent = state.longCount ?? "—";

  const tb = $("typeCounts");
  tb.innerHTML = "";
  const ent = Object.entries(state.typeCounts).sort((a,b)=>b[1]-a[1]);
  if (!ent.length){
    tb.innerHTML = `<tr><td colspan="2" style="color:var(--muted)">—</td></tr>`;
    return;
  }
  for (const [t,c] of ent){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t||"(empty)"}<\/td><td>${c}<\/td>`;
    tb.appendChild(tr);
  }
}

function buildStatsReport(){
  const rows = [
    {metric:"rows",value:state.data.length},
    {metric:"columns",value:state.fields.length},
    {metric:"changes_applied",value:state.changedCount},
    {metric:"long_titles_report_count",value:state.longCount}
  ];
  for (const [t,c] of Object.entries(state.typeCounts)){
    rows.push({metric:`type_${t||"empty"}_count`,value:c});
  }
  return Papa.unparse(rows,{delimiter:state.delimiter});
}

// Core transformations (for fixed CSV)
function applyRules(rows){
  state.changedCount = 0;

  const optTypeCtoO = $("optTypeCtoO").checked;
  const optStripZ   = $("optStripZ").checked;
  const optDup      = $("optDupFields").checked;

  const ensure = n => { if (!state.fields.includes(n)) state.fields.push(n); };

  if (optDup){
    ensure("id_display_name");
    ensure("dc.title");
    ensure("dc.id");
    ensure("dc.date");
  }

  const dateCols = ["isadg.eventStartDates","isadg.eventEndDates"];

  for (const r of rows){
    if (optTypeCtoO && safeGet(r,"type")==="C"){
      r["type"]="O";
      state.changedCount++;
    }
    if (optStripZ){
      for (const col of dateCols){
        const b=r[col], a=stripTrailingZ(b);
        if (a!==b){ r[col]=a; state.changedCount++; }
      }
    }
    if (optDup){
      const t=safeGet(r,"isadg.title");
      const id=safeGet(r,"isadg.identifier");
      const dt=safeGet(r,"isadg.eventStartDates");

      if (r["id_display_name"]!==t){ r["id_display_name"]=t; state.changedCount++; }
      if (r["dc.title"]!==t){ r["dc.title"]=t; state.changedCount++; }
      if (r["dc.id"]!==id){ r["dc.id"]=id; state.changedCount++; }
      if (r["dc.date"]!==dt){ r["dc.date"]=dt; state.changedCount++; }
    }
  }
}

function toCsv(rows, columns){
  return Papa.unparse(rows,{
    delimiter:state.delimiter||",",
    columns:columns||state.fields
  });
}

// Long titles report (with suggested + original)
function buildLongNamesReport(rows){
  if (!$("optLongNames").checked){
    state.longCount=0;
    return null;
  }

  const threshold = parseInt($("maxLen").value||"80",10);
  const colSug = suggestedHeader();
  const out = [];

  for (const r of rows){
    const original = String(safeGet(r,"isadg.title")??"").trim().replace(/\s+/g," ");
    if (!original) continue;

    if (original.length > threshold){
      const suggested = correctedTitle(original);
      out.push({
        id: safeGet(r,"id"),
        type: safeGet(r,"type"),
        parent_id: safeGet(r,"parent_id"),

        original_title: original,
        title_length: original.length,

        [colSug]: suggested,
        suggested_length: suggested.length,

        id_path: safeGet(r,"id_path"),
        isadg_identifier: safeGet(r,"isadg.identifier")
      });
    }
  }

  out.sort((a,b)=>b.title_length-a.title_length);
  state.longCount = out.length;

  const cols = [
    "id","type","parent_id",
    "original_title","title_length",
    colSug,"suggested_length",
    "id_path","isadg_identifier"
  ];

  return Papa.unparse(out,{delimiter:state.delimiter,columns:cols});
}

// Files.csv
function buildFilesCsv(rows){
  const colSug = suggestedHeader();
  const out = [];

  for (const r of rows){
    if (String(safeGet(r,"type"))==="F"){
      const orig = String(safeGet(r,"isadg.title")??"");
      const sug  = correctedTitle(orig);
      out.push({
        ID: safeGet(r,"id"),
        [colSug]: sug,
        original_title: orig
      });
    }
  }

  return Papa.unparse(out,{
    delimiter:",",
    columns:["ID",colSug,"original_title"]
  });
}

// Folders.csv
function buildFoldersCsvSorted(rows){
  const colSug = suggestedHeader();
  const folders = [];
  const byId = new Map();

  // Collect
  for (const r of rows){
    if (String(safeGet(r,"type"))==="O"){
      const id = String(safeGet(r,"id")||"");
      const parent = String(safeGet(r,"parent_id")||"");
      const orig = String(safeGet(r,"isadg.title")||"");
      const sug  = correctedTitle(orig);
      const node = {id,parent_id:parent,suggested:sug,original:orig};
      folders.push(node);
      if (id) byId.set(id,node);
    }
  }

  // Roots
  const roots=[];
  for (const n of folders){
    const p=(n.parent_id||"").trim();
    if (!p || !byId.has(p)) roots.push(n);
  }

  // BFS depth
  const depth=new Map();
  const q=[];
  for (const r of roots){
    depth.set(r.id,0); q.push(r);
  }

  const children=new Map();
  for (const n of folders){
    const p=(n.parent_id||"").trim();
    if (!children.has(p)) children.set(p,[]);
    children.get(p).push(n);
  }

  // Sort siblings by suggested, then id
  for (const [,arr] of children){
    arr.sort((a,b)=>{
      const t = a.suggested.localeCompare(b.suggested,"en",{sensitivity:"base"});
      return t!==0 ? t : a.id.localeCompare(b.id);
    });
  }

  // BFS assign depths
  while(q.length){
    const cur=q.shift();
    const kids=children.get(cur.id)||[];
    for (const c of kids){
      if (!depth.has(c.id)){
        depth.set(c.id,(depth.get(cur.id)||0)+1);
        q.push(c);
      }
    }
  }

  for (const n of folders){
    if (!depth.has(n.id)) depth.set(n.id,0);
  }

  // Sort output by depth, then suggested, then id
  folders.sort((a,b)=>{
    const da=depth.get(a.id), db=depth.get(b.id);
    if (da!==db) return da-db;
    const t=a.suggested.localeCompare(b.suggested,"en",{sensitivity:"base"});
    if (t!==0) return t;
    return a.id.localeCompare(b.id);
  });

  const out = folders.map(f=>({
    ID:f.id,
    [colSug]:f.suggested,
    original_title:f.original
  }));

  return Papa.unparse(out,{
    delimiter:",",
    columns:["ID",colSug,"original_title"]
  });
}

// Build Fixed CSV
function buildFixedCsv(rows){
  const removeIdPath = $("optRemoveIdPath").checked;

  const rowsOut = rows.map(r=>{
    const o={...r};
    if (removeIdPath) delete o["id_path"];
    return o;
  });

  let fieldsOut=[...state.fields];
  if (removeIdPath){
    fieldsOut = fieldsOut.filter(f=>f!=="id_path");
    log("Removed id_path from Fixed CSV","ok");
  }

  return Papa.unparse(rowsOut,{
    delimiter:state.delimiter,
    columns:fieldsOut
  });
}

// Reset everything
function resetAll(){
  state.fileNameBase=null;
  state.delimiter=",";
  state.data=null;
  state.fields=null;

  state.fixedCsv=null;
  state.longCsv=null;
  state.statsCsv=null;
  state.filesCsv=null;
  state.foldersCsv=null;

  state.changedCount=0;
  state.longCount=0;
  state.typeCounts={};

  $("log").textContent="";
  disableDownloads();
  enableMainButtons(false);
  setStatus("Waiting for file…");
  renderKPIs();
}

// EVENTS

// Load CSV
$("file").addEventListener("change",(e)=>{
  resetAll();
  const file=e.target.files?.[0];
  if (!file) return;

  state.fileNameBase = inferBaseName(file.name);
  setStatus("Loaded: "+file.name);
  enableMainButtons(true);
  log("Loaded: "+file.name,"ok");

  Papa.parse(file,{
    header:true,skipEmptyLines:true,dynamicTyping:false,worker:true,
    complete:(res)=>{
      state.data = res.data||[];
      state.fields = res.meta?.fields ? [...res.meta.fields] : [];
      state.delimiter = res.meta?.delimiter || ",";

      log(`Rows: ${state.data.length}`,"ok");
      log(`Columns: ${state.fields.length}`,"ok");
      log(`Delimiter: "${state.delimiter}"`,"ok");

      computeTypeCounts(state.data);
      renderKPIs();
    },
    error:(err)=>{
      setStatus("Parse error");
      log(String(err),"bad");
    }
  });
});

// Process
$("run").addEventListener("click",()=>{
  if (!state.data) return;

  disableDownloads();
  setStatus("Processing…");
  log("Processing…","ok");

  const rows = state.data.map(r=>({...r}));
  state.fields=[...(state.fields||[])];

  applyRules(rows);
  computeTypeCounts(rows);

  state.fixedCsv   = buildFixedCsv(rows);
  state.longCsv    = buildLongNamesReport(rows);
  state.statsCsv   = buildStatsReport();
  state.filesCsv   = buildFilesCsv(rows);
  state.foldersCsv = buildFoldersCsvSorted(rows);

  log(`Changes applied: ${state.changedCount}`,"ok");
  log(`Long titles: ${state.longCount}`, state.longCount?"warn":"ok");

  $("dlFixed").disabled=false;
  $("dlStats").disabled=false;
  $("dlFiles").disabled=false;
  $("dlFolders").disabled=false;
  $("dlLong").disabled=!state.longCsv;
  $("dlAll").disabled=false;

  setStatus("Done ✓");
  renderKPIs();
});

// Reset
$("reset").addEventListener("click",()=>{
  $("file").value="";
  resetAll();
});

// Downloads
$("dlFixed").addEventListener("click",()=>{
  if (state.fixedCsv) downloadText(`${state.fileNameBase}_fixed.csv`,state.fixedCsv);
});
$("dlLong").addEventListener("click",()=>{
  if (state.longCsv) downloadText(`${state.fileNameBase}_long_titles.csv`,state.longCsv);
});
$("dlStats").addEventListener("click",()=>{
  if (state.statsCsv) downloadText(`${state.fileNameBase}_stats.csv`,state.statsCsv);
});
$("dlFiles").addEventListener("click",()=>{
  if (state.filesCsv) downloadText(`Files.csv`,state.filesCsv);
});
$("dlFolders").addEventListener("click",()=>{
  if (state.foldersCsv) downloadText(`Folders.csv`,state.foldersCsv);
});
$("dlAll").addEventListener("click",async()=>{
  const zip=new JSZip();
  const base=state.fileNameBase||"export";

  zip.file(`${base}_fixed.csv`,state.fixedCsv||"");
  if (state.longCsv)  zip.file(`${base}_long_titles.csv`,state.longCsv);
  if (state.statsCsv) zip.file(`${base}_stats.csv`,state.statsCsv);
  if (state.filesCsv) zip.file(`Files.csv`,state.filesCsv);
  if (state.foldersCsv) zip.file(`Folders.csv`,state.foldersCsv);

  const blob=await zip.generateAsync({type:"blob"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`${base}_exports.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Init
resetAll();
