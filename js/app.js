// ====================================================================
// eSAFE CSV TOOL — IMPROVED (2026-02-22)
//  • Meilleur nettoyage préfixes email (imbriqués, cas complexes)
//  • Raccourcissement intelligent amélioré
//  • Blacklist de mots à supprimer
//  • Règles regex personnalisées
//  • Prévisualisation du renommage (live)
//  • Aperçu CSV dans la page
// ====================================================================

const $ = (id) => document.getElementById(id);

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

/* ===================== UI HELPERS ===================== */

function log(msg, cls="") {
  const el = $("log");
  const line = cls ? `[${cls.toUpperCase()}] ${msg}` : msg;
  el.textContent += (el.textContent ? "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}
function setStatus(t){ $("status").textContent = t; }
function enableMainButtons(v){ $("run").disabled = !v; $("reset").disabled = !v; }
function disableDownloads(){
  $("dlFixed").disabled        = true;
  $("dlLong").disabled         = true;
  $("dlStats").disabled        = true;
  $("dlFiles").disabled        = true;
  $("dlFolders").disabled      = true;
  $("dlAll").disabled          = true;
  $("togglePreview").disabled  = true;
}
function safeGet(r,k){ return (r && Object.prototype.hasOwnProperty.call(r,k)) ? r[k] : ""; }
function inferBaseName(fn){
  const i=fn.toLowerCase().lastIndexOf(".csv");
  return i>0 ? fn.slice(0,i) : fn;
}

/* ===================== CSV HELPERS ===================== */

function stripTrailingZ(x){
  return (typeof x==="string" && x.endsWith("Z")) ? x.slice(0,-1) : x;
}

/* ========== EXTENSION RULES ========== */

function splitBaseExt(name){
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1){
    const candidate = name.slice(dot + 1);
    // Extension valide : 2 à 5 lettres uniquement (ex: .txt .docx .pdf)
    // Pas de chiffres, espaces, ou texte libre (ex: .Mazou, .2005)
    if (/^[A-Za-z]{2,5}$/.test(candidate)){
      return { base: name.slice(0, dot), ext: name.slice(dot) };
    }
  }
  return { base: name, ext: "" };
}

function extractExtFromIdPath(row){
  const idp = safeGet(row,"id_path");
  if (!idp) return "";
  const last = idp.split("/").pop() || "";
  return splitBaseExt(last).ext;
}

function determineFinalExt(row){
  const ext = extractExtFromIdPath(row);
  if (ext) return ext;
  return ".txt";
}

/* =================================================================
   RENAMING PIPELINE
   Ordre d'exécution sur chaque titre :
     1. Retirer l'expéditeur en tête   (From Firstname Lastname …)
     2. Retirer les préfixes email      (Re_ / RE: / Fwd_ / FW: / TR: / Rép: …)
     3. Normaliser les séparateurs      (-- → -   |  _ seul → espace)
     4. Normaliser les espaces          (espaces multiples → un seul)
     5. Couper à la longueur max        (coupure sur mot entier + …)
     6. Ajouter l'extension             (toujours depuis id_path)
   ================================================================= */

/* ── Étape 1 : expéditeur "From Firstname Lastname" en début de titre ──
   Règle : retire uniquement si le titre commence par "From ".
*/
function stripSenderPrefix(text){
  if (!text) return "";
  if (!/^from\s/i.test(text)) return text;

  let x = text;

  // Cas avec <email> : retirer From + tout ce qui précède + <email>
  if (/<[^>]+>/.test(x)) {
    x = x.replace(/^from\s+[^<]*<[^>]*>\s*/i, "");
    return x.trim();
  }

  // Format inversé : From Nom, Prénom [I.]
  x = x.replace(
    /^from\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*,\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*(?:\s+[A-Z]\.)?\s+/i,
    ""
  );

  // Format avec initiale au milieu : From Prénom I. Nom
  x = x.replace(
    /^from\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+[A-Z]\.\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+/i,
    ""
  );

  // Format 3 mots sans initiale : seulement si suivi d'un préfixe email
  x = x.replace(
    /^from\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+(?=(?:fwd?|re|r[ée]p?|tr)\s*[_:\-\u2013\s])/i,
    ""
  );

  // Format standard : From Prénom Nom (2 mots)
  x = x.replace(
    /^from\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+[A-Za-zÀ-ÖØ-öø-ÿ][a-zA-ZÀ-ÖØ-öø-ÿ'-]*\s+/i,
    ""
  );

  // Mot-résidu (Letter/Mail/Message/Note) suivi d'un préfixe email
  x = x.replace(
    /^(?:letter|mail|e-?mail|message|note|courriel)\s+(?=(?:fwd?|re|r[ée]p?|tr)\s*[_:\-\u2013\s])/i,
    ""
  );

  return x.trim();
}
/* ── Étape 2 : préfixes email imbriqués ── */
// Couvre : Re_ RE: Re: Fwd_ FW: FWD: TR: Rép: Rep: Ré: R:
// Boucle jusqu'à ce qu'il n'y en ait plus (cas imbriqués : Re: Fwd: Re: …)
const EMAIL_PREFIX_RE = /^\s*(?:fwd?|re|r[ée]p?|tr)\s*[_:\-–\s]\s*/i;

function stripEmailPrefixes(text){
  if (!text) return "";
  let x = text;
  let prev, safety = 0;
  do {
    prev = x;
    x = x.replace(EMAIL_PREFIX_RE, "");
    safety++;
  } while (x !== prev && safety < 30);
  return x.trim();
}

/* ── Étape 3 : normaliser les séparateurs ── */
function normalizeSeparators(text){
  return text
    .replace(/--+/g, "-")   // double tiret → simple (seule règle tiret)
    .replace(/_/g, " ")     // tous les _ → espace (normalizeSpaces gère les doubles)
    .trim();
}

/* ── Étape 4 : normaliser les espaces ── */
function normalizeSpaces(text){
  return text.replace(/\s+/g, " ").trim();
}

/* ── Étape 5 : couper à la longueur max sur un mot entier ── */
function shortenSmart(base, ext, maxLen){
  const ell = "…";
  const full = base + ext;
  if (full.length <= maxLen) return full;

  const maxBase = maxLen - ext.length - ell.length;
  if (maxBase <= 2) return base.slice(0, maxLen - ell.length) + ell;

  const candidate = base.slice(0, maxBase);

  // Chercher la meilleure coupure sur séparateur naturel
  const separators = [" ", "-", ",", ";", "("];
  let bestCut = -1;
  const minPos = Math.floor(maxBase * 0.45);
  for (const sep of separators){
    const pos = candidate.lastIndexOf(sep);
    if (pos > minPos && pos > bestCut) bestCut = pos;
  }

  let short = bestCut > 0 ? candidate.slice(0, bestCut) : candidate;
  short = short.replace(/[\s\-_,;]+$/, "");

  // Filet de sécurité : si trop court, couper brutalement
  if (short.length < maxBase * 0.35) short = candidate.trimEnd();

  return short + ell + ext;
}

/* ── Moteur principal ── */
function smartRename(original, opts, row){
  if (!opts.enabled) return original || "";
  if (!original)     return "";

  const maxLen = parseInt(opts.maxLen || "80", 10);

  // Si "only long" activé : ne traiter que les titres qui dépassent maxLen
  if (opts.onlyLong && String(original).trim().length <= maxLen) return String(original).trim();

  let x = String(original).normalize("NFC").trim();

  // 1) Expéditeur en tête
  if (opts.stripSender)   x = stripSenderPrefix(x);

  // 2) Préfixes email
  if (opts.stripPrefixes) x = stripEmailPrefixes(x);

  // 3) Séparateurs
  if (opts.normSeparators) x = normalizeSeparators(x);

  // 4) Espaces
  x = normalizeSpaces(x);

  // 5+6) Extension (depuis id_path) + longueur max
  const { base } = splitBaseExt(x);
  const ext      = determineFinalExt(row);
  return shortenSmart(base, ext, maxLen);
}

function getRenameOpts(){
  return {
    enabled:        $("optRename").checked,
    maxLen:         $("renameMaxLen").value,
    onlyLong:       $("optOnlyLong").checked,
    stripSender:    $("optStripSender").checked,
    stripPrefixes:  $("optStripPrefixes").checked,
    normSeparators: $("optNormSeparators").checked,
  };
}

function correctedTitle(original, row){
  return smartRename(original, getRenameOpts(), row);
}

function suggestedHeader(){
  const n = parseInt($("renameMaxLen").value||"80",10);
  return `suggested_title (${n})`;
}

/* ===================== PREVIEW PANEL ===================== */

let _previewDebounce = null;

function updateRenamePreview(){
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(_doUpdateRenamePreview, 300);
}

function _doUpdateRenamePreview(){
  const panel = $("previewPanel");
  const tbody = $("previewBody");
  if (!panel || !tbody) return;

  if (!state.data || !state.data.length){
    panel.style.display = "none";
    return;
  }

  const opts = getRenameOpts();
  if (!opts.enabled){
    panel.style.display = "none";
    return;
  }

  // Prendre un échantillon : 15 premières lignes avec isadg.title non vide
  const samples = state.data
    .filter(r => String(safeGet(r,"isadg.title")||"").trim())
    .slice(0, 15);

  if (!samples.length){
    panel.style.display = "none";
    return;
  }

  tbody.innerHTML = "";
  for (const r of samples){
    const orig = String(safeGet(r,"isadg.title")||"").trim();
    const sug  = smartRename(orig, opts, r);
    const type = safeGet(r,"type") || "?";
    const changed = orig !== sug;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="type-badge type-${type.toLowerCase()}">${type}</span></td>
      <td class="preview-orig" title="${escHtml(orig)}">${escHtml(truncDisplay(orig, 60))}</td>
      <td class="preview-arrow">${changed ? "→" : "="}</td>
      <td class="preview-sug ${changed ? "changed" : "same"}" title="${escHtml(sug)}">${escHtml(truncDisplay(sug, 60))}</td>
    `;
    tbody.appendChild(tr);
  }

  panel.style.display = "block";
}

function escHtml(s){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function truncDisplay(s, n){
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ===================== CSV APERÇU ===================== */

function showCsvPreview(csv, title, containerId){
  const container = $(containerId);
  if (!container || !csv) return;

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const rows   = parsed.data || [];
  const fields = parsed.meta?.fields || [];

  if (!rows.length){ container.innerHTML = "<em>Aucune donnée</em>"; return; }

  const preview = rows.slice(0, 10);

  let html = `<div class="csv-preview-header">
    <span class="csv-preview-title">${escHtml(title)}</span>
    <span class="pill">${rows.length} lignes · ${fields.length} col.</span>
  </div>
  <div class="tablewrap csv-scroll">
    <table>
      <thead><tr>${fields.map(f=>`<th>${escHtml(f)}</th>`).join("")}</tr></thead>
      <tbody>`;

  for (const row of preview){
    html += "<tr>";
    for (const f of fields){
      const val = String(row[f] ?? "");
      html += `<td title="${escHtml(val)}">${escHtml(truncDisplay(val, 40))}</td>`;
    }
    html += "</tr>";
  }

  html += `</tbody></table></div>`;
  if (rows.length > 10){
    html += `<div class="csv-preview-more">+ ${rows.length - 10} lignes non affichées</div>`;
  }

  container.innerHTML = html;
}

/* ===================== DOWNLOAD ===================== */

function downloadText(fn,txt){
  const bom="\uFEFF";
  const blob=new Blob([bom+txt],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=fn;
  document.body.appendChild(a);
  a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== STATS ===================== */

function computeTypeCounts(rows){
  const c={};
  for(const r of rows){
    const t=String(safeGet(r,"type")||"");
    c[t]=(c[t]||0)+1;
  }
  state.typeCounts=c;
}

function renderKPIs(){
  $("kRows").textContent=state.data ? state.data.length:"—";
  $("kCols").textContent=state.fields ? state.fields.length:"—";
  $("kChanged").textContent=state.changedCount ?? "—";
  $("kLong").textContent=state.longCount ?? "—";

  const tb=$("typeCounts");
  tb.innerHTML="";
  const ent=Object.entries(state.typeCounts).sort((a,b)=>b[1]-a[1]);
  if (!ent.length){
    tb.innerHTML=`<tr><td colspan="2" style="color:var(--muted)">—</td></tr>`;
    return;
  }
  for(const [t,c] of ent){
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${t||"(empty)"}<\/td><td>${c}<\/td>`;
    tb.appendChild(tr);
  }
}

function buildStatsReport(){
  const rows=[
    {metric:"rows", value:state.data.length},
    {metric:"columns", value:state.fields.length},
    {metric:"changes_applied", value:state.changedCount},
    {metric:"long_titles_report_count", value:state.longCount}
  ];
  for(const [t,c] of Object.entries(state.typeCounts)){
    rows.push({metric:`type_${t||"empty"}_count`,value:c});
  }
  return Papa.unparse(rows,{delimiter:state.delimiter});
}

/* ===================== FIXED CSV RULES ===================== */

function applyRules(rows){
  state.changedCount=0;

  const c2o  = $("optTypeCtoO").checked;
  const stZ  = $("optStripZ").checked;
  const dup  = $("optDupFields").checked;

  const ensure=f=>{ if(!state.fields.includes(f)) state.fields.push(f); };

  if(dup){
    ensure("id_display_name");
    ensure("dc.title");
    ensure("dc.id");
    ensure("dc.date");
  }

  const dateCols=["isadg.eventStartDates","isadg.eventEndDates"];

  for (const r of rows){

    if(c2o && safeGet(r,"type")==="C"){
      r["type"]="O";
      state.changedCount++;
    }

    if(stZ){
      for(const col of dateCols){
        const b=r[col], a=stripTrailingZ(b);
        if(a!==b){ r[col]=a; state.changedCount++; }
      }
    }

    if(dup){
      const t=safeGet(r,"isadg.title");
      const id=safeGet(r,"isadg.identifier");
      const dt=safeGet(r,"isadg.eventStartDates");

      if(r["id_display_name"]!==t){ r["id_display_name"]=t; state.changedCount++; }
      if(r["dc.title"]!==t){        r["dc.title"]=t;        state.changedCount++; }
      if(r["dc.id"]!==id){          r["dc.id"]=id;          state.changedCount++; }
      if(r["dc.date"]!==dt){        r["dc.date"]=dt;        state.changedCount++; }
    }
  }
}

/* ===================== LONG TITLES REPORT ===================== */

function buildLongNamesReport(rows){
  if (!$("optLongNames").checked){
    state.longCount=0;
    return null;
  }
  const threshold=parseInt($("maxLen").value||"80",10);
  const colSug=suggestedHeader();

  const out=[];
  for(const r of rows){
    const original=String(safeGet(r,"isadg.title")??"")
      .trim().replace(/\s+/g," ");
    if(!original) continue;

    if(original.length > threshold){
      const suggested=correctedTitle(original,r);
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
  state.longCount=out.length;

  const cols=[
    "id","type","parent_id",
    "original_title","title_length",
    colSug,"suggested_length",
    "id_path","isadg_identifier"
  ];
  return Papa.unparse(out,{delimiter:state.delimiter,columns:cols});
}

/* ===================== FILES.CSV ===================== */

function buildFilesCsv(rows, overrides={}){
  const colSug=suggestedHeader();
  const out=[];
  for(const r of rows){
    if(String(safeGet(r,"type"))==="F"){
      const orig = safeGet(r,"isadg.title") || "";
      const id   = safeGet(r,"id");
      const sug  = overrides[id] !== undefined ? overrides[id] : correctedTitle(orig, r);
      out.push({
        ID: id,
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

/* ===================== FOLDERS.CSV ===================== */

function buildFoldersCsvSorted(rows, overrides={}){
  const colSug=suggestedHeader();
  const folders=[];
  const byId=new Map();

  for (const r of rows){
    if(String(safeGet(r,"type"))==="O"){
      const id      = String(safeGet(r,"id")||"");
      const parent  = String(safeGet(r,"parent_id")||"");
      const id_path = String(safeGet(r,"id_path")||"");
      const orig    = String(safeGet(r,"isadg.title")||"");

      const sugFull = correctedTitle(orig,r);
      const sug     = splitBaseExt(sugFull).base;
      // overrides keyed by id_path
      const sugOver = overrides[String(safeGet(r,"id_path")||"")] !== undefined
        ? overrides[String(safeGet(r,"id_path")||"")]
        : sug;

      const node = { id, id_path, parent_id: parent, suggested: sugOver, original: orig, _autoSug: sug };
      folders.push(node);
      if (id) byId.set(id,node);
    }
  }

  const roots=[];
  for(const n of folders){
    const p=(n.parent_id||"").trim();
    if(!p || !byId.has(p)) roots.push(n);
  }

  const depth=new Map();
  const q=[];
  for(const r of roots){ depth.set(r.id,0); q.push(r); }

  const children=new Map();
  for(const n of folders){
    const p=(n.parent_id||"").trim();
    if(!children.has(p)) children.set(p,[]);
    children.get(p).push(n);
  }

  for(const [,arr] of children){
    arr.sort((a,b)=>{
      const t=a.suggested.localeCompare(b.suggested,"en",{sensitivity:"base"});
      if(t!==0) return t;
      return a.id_path.localeCompare(b.id_path);
    });
  }

  while(q.length){
    const cur=q.shift();
    const kids=children.get(cur.id)||[];
    for(const c of kids){
      if(!depth.has(c.id)){
        depth.set(c.id,(depth.get(cur.id)||0)+1);
        q.push(c);
      }
    }
  }
  for(const n of folders){
    if(!depth.has(n.id)) depth.set(n.id,0);
  }

  folders.sort((a,b)=>{
    const da=depth.get(a.id), db=depth.get(b.id);
    if(da!==db) return da-db;
    const t=a.suggested.localeCompare(b.suggested,"en",{sensitivity:"base"});
    if(t!==0) return t;
    return a.id_path.localeCompare(b.id_path);
  });

  const out=folders.map(f=>({
    id_path: f.id_path,
    [colSug]: f.suggested,
    original_title: f.original
  }));

  return Papa.unparse(out,{
    delimiter:",",
    columns:["id_path",colSug,"original_title"]
  });
}

/* ===================== FIXED CSV ===================== */

function buildFixedCsv(rows){
  const remove = $("optRemoveIdPath").checked;

  const rowsOut = rows.map(r=>{
    const o={...r};
    if(remove) delete o["id_path"];
    return o;
  });

  let fieldsOut=[...(state.fields||[])];
  if(remove){
    fieldsOut = fieldsOut.filter(f=>f!=="id_path");
    log("Removed id_path from Fixed CSV","ok");
  }

  return Papa.unparse(rowsOut,{
    delimiter:state.delimiter,
    columns:fieldsOut
  });
}

/* ===================== RESET ===================== */

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

  // Cacher les panneaux preview
  const pp = $("previewPanel");
  if (pp) pp.style.display = "none";
  const cp = $("csvPreviewContainer");
  if (cp) cp.innerHTML = "";

  // Cacher la section aperçu
  const csvSec = $("csvPreviewSection");
  if (csvSec) csvSec.style.display = "none";

  // Reset tabs
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(t => t.classList.remove("active"));
  const first = tabs[0];
  if (first) first.classList.add("active");
  document.querySelectorAll(".csv-preview-pane").forEach(p => p.style.display = "none");
  const fp = $("pane-fixed");
  if (fp) fp.style.display = "block";
}

/* ===================== TABS CSV PREVIEW ===================== */

function initTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".csv-preview-pane").forEach(p => p.style.display = "none");
      btn.classList.add("active");
      const target = $(btn.dataset.target);
      if (target) target.style.display = "block";
    });
  });
}


/* ===================== REVIEW MODAL ===================== */

/**
 * Ouvre la modale de révision pour les titres longs de Files + Folders.
 * items = [{ key, type, original, suggested, label }]
 * onConfirm(overridesFiles, overridesFolders) appelé quand on valide.
 */
function openReviewModal(items, onConfirm){
  const maxLen = parseInt($("renameMaxLen").value || "80", 10);
  const longItems = items.filter(it => it.suggested.length > maxLen || it.original.length > maxLen);

  if (!longItems.length){
    onConfirm({}, {});
    return;
  }

  // Créer la modale
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">✏️ Révision des titres longs</span>
      <span class="pill">${longItems.length} titre${longItems.length>1?"s":""} · seuil ${maxLen} car.</span>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer">
      <button class="btn secondary" id="modalClose">Fermer (garder propositions)</button>
      <button class="btn" id="modalConfirm">Valider les corrections</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const body = modal.querySelector("#modalBody");

  // Construire la liste
  for (const item of longItems){
    const row = document.createElement("div");
    row.className = "review-row";
    row.innerHTML = `
      <div class="review-meta">
        <span class="type-badge type-${item.type.toLowerCase()}">${item.type}</span>
        <span class="review-label" title="${escHtml(item.key)}">${escHtml(truncDisplay(item.key, 60))}</span>
        <span class="review-chars ${item.suggested.length > maxLen ? "chars-bad" : "chars-ok"}" id="chars-${item.key.replace(/\//g,'_')}">${item.suggested.length} car.</span>
      </div>
      <div class="review-original" title="${escHtml(item.original)}">${escHtml(item.original)}</div>
      <textarea class="review-input" data-key="${escHtml(item.key)}" data-type="${escHtml(item.type)}"
        rows="2" spellcheck="false">${escHtml(item.suggested)}</textarea>
    `;
    body.appendChild(row);
  }

  // Compteur de caractères live
  body.querySelectorAll(".review-input").forEach(ta => {
    ta.addEventListener("input", () => {
      const key = ta.dataset.key.replace(/\//g,'_');
      const el = modal.querySelector(`#chars-${key}`);
      if (el){
        const len = ta.value.length;
        el.textContent = len + " car.";
        el.className = "review-chars " + (len > maxLen ? "chars-bad" : "chars-ok");
      }
    });
  });

  function collect(){
    const filesOv = {}, foldersOv = {};
    body.querySelectorAll(".review-input").forEach(ta => {
      const type = ta.dataset.type;
      const key  = ta.dataset.key;
      if (type === "F") filesOv[key]   = ta.value;
      else              foldersOv[key] = ta.value;
    });
    return { filesOv, foldersOv };
  }

  modal.querySelector("#modalClose").addEventListener("click", () => {
    document.body.removeChild(overlay);
    onConfirm({}, {});
  });

  modal.querySelector("#modalConfirm").addEventListener("click", () => {
    const { filesOv, foldersOv } = collect();
    document.body.removeChild(overlay);
    onConfirm(filesOv, foldersOv);
  });

  // Fermer sur clic overlay
  overlay.addEventListener("click", e => {
    if (e.target === overlay){
      document.body.removeChild(overlay);
      onConfirm({}, {});
    }
  });
}

/* ===================== EVENTS ===================== */

$("file").addEventListener("change",(e)=>{
  resetAll();
  const file=e.target.files?.[0];
  if(!file) return;

  state.fileNameBase=inferBaseName(file.name);
  setStatus("Loaded: "+file.name);
  enableMainButtons(true);
  log("Loaded: "+file.name,"ok");

  Papa.parse(file,{
    header:true, skipEmptyLines:true, dynamicTyping:false, worker:true,
    complete:(res)=>{
      state.data  = res.data || [];
      state.fields= res.meta?.fields ? [...res.meta.fields] : [];
      state.delimiter = res.meta?.delimiter || ",";

      log(`Rows: ${state.data.length}`,"ok");
      log(`Columns: ${state.fields.length}`,"ok");
      log(`Delimiter: "${state.delimiter}"`,"ok");

      computeTypeCounts(state.data);
      renderKPIs();
      updateRenamePreview();
    },
    error:(err)=>{
      setStatus("Parse error");
      log(String(err),"bad");
    }
  });
});

// Drag & drop
const dropZone = $("dropZone");
if (dropZone){
  dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".csv")){
      // Simuler la sélection
      const dt = new DataTransfer();
      dt.items.add(file);
      $("file").files = dt.files;
      $("file").dispatchEvent(new Event("change"));
    }
  });
}

// Live preview quand les options de renommage changent
const renameInputs = [
  "optRename","renameMaxLen","optOnlyLong","optStripSender","optStripPrefixes","optNormSeparators"
];
for (const id of renameInputs){
  const el = $(id);
  if (!el) continue;
  el.addEventListener(el.tagName === "TEXTAREA" || el.type === "number" ? "input" : "change", updateRenamePreview);
}

$("run").addEventListener("click",()=>{
  if(!state.data) return;

  disableDownloads();
  setStatus("Processing…");
  log("Processing…","ok");

  const rows=state.data.map(r=>({...r}));
  state.fields=[...(state.fields||[])];

  applyRules(rows);
  computeTypeCounts(rows);

  state.fixedCsv = buildFixedCsv(rows);
  state.longCsv  = buildLongNamesReport(rows);
  state.statsCsv = buildStatsReport();

  log("Processing complete.","ok");

  // Collecter les titres longs pour Files + Folders
  const maxLen = parseInt($("renameMaxLen").value || "80", 10);
  const reviewItems = [];
  const colSug = suggestedHeader();

  for (const r of rows){
    const type = String(safeGet(r,"type")||"");
    const orig = String(safeGet(r,"isadg.title")||"").trim();
    if (!orig) continue;

    if (type === "F"){
      const sug = correctedTitle(orig, r);
      if (orig.length > maxLen || sug.length > maxLen){
        reviewItems.push({ key: safeGet(r,"id"), type: "F", original: orig, suggested: sug });
      }
    } else if (type === "O"){
      const sugFull = correctedTitle(orig, r);
      const sug = splitBaseExt(sugFull).base;
      if (orig.length > maxLen || sug.length > maxLen){
        reviewItems.push({ key: safeGet(r,"id_path"), type: "O", original: orig, suggested: sug });
      }
    }
  }

  function finalize(filesOv, foldersOv){
    state.filesCsv   = buildFilesCsv(rows, filesOv);
    state.foldersCsv = buildFoldersCsvSorted(rows, foldersOv);

    $("dlFixed").disabled=false;
    $("dlStats").disabled=false;
    $("dlFiles").disabled=false;
    $("dlFolders").disabled=false;
    $("dlLong").disabled=!state.longCsv;
    $("dlAll").disabled=false;
    $("togglePreview").disabled=false;

    setStatus("Done ✓");
    renderKPIs();

    showCsvPreview(state.fixedCsv,   "Fixed CSV",    "pane-fixed");
    showCsvPreview(state.filesCsv,   "Files.csv",    "pane-files");
    showCsvPreview(state.foldersCsv, "Folders.csv",  "pane-folders");
    if(state.longCsv)
      showCsvPreview(state.longCsv,  "Long Titles",  "pane-long");

    const firstTab = document.querySelector(".tab-btn");
    if (firstTab) firstTab.click();
    // Ne pas afficher automatiquement — le bouton toggle gère ça

    log(`Files/Folders générés (${Object.keys(filesOv).length + Object.keys(foldersOv).length} corrections manuelles).`,"ok");
  }

  if (reviewItems.length > 0){
    openReviewModal(reviewItems, (filesOv, foldersOv) => finalize(filesOv, foldersOv));
  } else {
    finalize({}, {});
  }
});

$("reset").addEventListener("click",()=>{
  $("file").value="";
  resetAll();
});

$("togglePreview").addEventListener("click",()=>{
  const section = $("csvPreviewSection");
  const btn = $("togglePreview");
  if (!section) return;
  const visible = section.style.display !== "none";
  section.style.display = visible ? "none" : "block";
  btn.textContent = visible ? "👁 Aperçu" : "👁 Masquer";
});

/* ===================== DOWNLOAD BUTTONS ===================== */

$("dlFixed").addEventListener("click",()=>{
  if(state.fixedCsv) downloadText(`${state.fileNameBase}_fixed.csv`,state.fixedCsv);
});
$("dlLong").addEventListener("click",()=>{
  if(state.longCsv) downloadText(`${state.fileNameBase}_long_titles.csv`,state.longCsv);
});
$("dlStats").addEventListener("click",()=>{
  if(state.statsCsv) downloadText(`${state.fileNameBase}_stats.csv`,state.statsCsv);
});
$("dlFiles").addEventListener("click",()=>{
  if(state.filesCsv) downloadText("Files.csv",state.filesCsv);
});
$("dlFolders").addEventListener("click",()=>{
  if(state.foldersCsv) downloadText("Folders.csv",state.foldersCsv);
});
$("dlAll").addEventListener("click",async()=>{
  const zip=new JSZip();
  const base=state.fileNameBase||"export";

  zip.file(`${base}_fixed.csv`,state.fixedCsv||"");
  if(state.longCsv)  zip.file(`${base}_long_titles.csv`,state.longCsv);
  if(state.statsCsv) zip.file(`${base}_stats.csv`,state.statsCsv);
  if(state.filesCsv) zip.file(`Files.csv`,state.filesCsv);
  if(state.foldersCsv) zip.file(`Folders.csv`,state.foldersCsv);

  const blob=await zip.generateAsync({type:"blob"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`${base}_exports.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

/* ===================== INIT ===================== */
initTabs();
resetAll();
