// rowview.js â€” Liste bÃ¶lÃ¼mleri iÃ§in Kart â†” SatÄ±r gÃ¶rÃ¼nÃ¼mÃ¼ geÃ§iÅŸi + poster Ã¶nizlemesi.
// views.js'e dokunmaz; mevcut .card verisini okuyup satÄ±r modunda hÃ¼cre (tablo) dÃ¼zenine Ã§evirir.
// Kolon geniÅŸlikleri dinamiktir (display:table auto-layout). BoÅŸ kolonlar (tÃ¼m satÄ±rlarda boÅŸ) dÃ¼ÅŸÃ¼rÃ¼lÃ¼r.
import { state } from "./state.js";
import { t } from "./i18n.js?v=640";

const LIST_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="5" rx="1"></rect><line x1="11" y1="6.5" x2="21" y2="6.5"></line><rect x="3" y="15" width="5" height="5" rx="1"></rect><line x1="11" y1="17.5" x2="21" y2="17.5"></line></svg>`;
const GRID_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>`;

const ROW_TOOLTIP = { tr: "SatÄ±r gÃ¶rÃ¼nÃ¼mÃ¼", en: "Row view", de: "Zeilenansicht", fr: "Vue lignes", es: "Vista de filas", it: "Vista righe", ru: "Ğ¡Ğ¿Ğ¸ÑĞ¾Ğº", ar: "Ø¹Ø±Ø¶ Ø§Ù„ØµÙÙˆÙ", pt: "Vista em linhas", nl: "Rijenweergave", pl: "Widok wierszy", ja: "è¡Œè¡¨ç¤º", ko: "í–‰ ë³´ê¸°", zh: "åˆ—è¡¨è§†å›¾" };
const CARD_TOOLTIP = { tr: "Kart gÃ¶rÃ¼nÃ¼mÃ¼", en: "Card view", de: "Kartenansicht", fr: "Vue cartes", es: "Vista de tarjetas", it: "Vista schede", ru: "Ğ¡ĞµÑ‚ĞºĞ°", ar: "Ø¹Ø±Ø¶ Ø§Ù„Ø¨Ø·Ø§Ù‚Ø§Øª", pt: "Vista em cartÃµes", nl: "Kaartweergave", pl: "Widok kart", ja: "ã‚«ãƒ¼ãƒ‰è¡¨ç¤º", ko: "ì¹´ë“œ ë³´ê¸°", zh: "å¡ç‰‡è§†å›¾" };

const BTN_SEL = ".calendar-btn, .info-btn, .move-btn, .move-back-btn, .archive-btn, .unarchive-btn, .hide-btn, .remove, .defer-btn";
const hoverFine = !!(window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches);

function tr(map) {
  const lang = (state && state.currentLang) || "tr";
  return map[lang] || map.tr;
}
function isTvMode() {
  const d = document.documentElement;
  return !!(d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode")));
}
function isVisible(el) {
  try {
    if (!el || !document.contains(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  } catch (_) { return false; }
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Kart verisini Ã§Ä±kar --------------------------------------------------------
function txt(root, sel) { const e = root.querySelector(sel); return e ? e.textContent.trim() : ""; }
function isEmptySlot(e) { return !e || e.classList.contains("slot-empty"); }
// Bir .next-ep Ã¶ÄŸesinden taban metni ve geri-sayÄ±m rakamÄ±nÄ± (.next-ep-days) ayÄ±rÄ±r
function splitDays(el) {
  if (!el) return { text: "", days: "" };
  const daysEl = el.querySelector(".next-ep-days");
  let text = (el.textContent || "").trim();
  let days = "";
  if (daysEl) {
    days = (daysEl.textContent || "").trim();
    if (days && text.endsWith(days)) text = text.slice(0, text.length - days.length);
    text = text.replace(/[\sÂ·.]+$/, "").trim();
  }
  return { text, days };
}
function daysHTML(n) { return n ? ` Â· <span class="wrow-days">${esc(n)}</span>` : ""; }
function typeClass(badge) {
  if (!badge) return "";
  if (badge.classList.contains("badge-tv")) return "wtype-tv";
  if (badge.classList.contains("badge-movie")) return "wtype-movie";
  if (badge.classList.contains("badge-anime")) return "wtype-anime";
  if (badge.classList.contains("badge-belgesel")) return "wtype-doc";
  return "";
}
function extract(card) {
  const info = card.querySelector(".info");
  const out = { title: "", type: "", typeCls: "", score: "", net: "", season: "", episode: "", status: "", statusDays: "", mid: "", midDays: "", count: "" };
  if (!info) return out;
  out.title = txt(info, ".title");
  const typeBadge = info.querySelector(".mrow-type .badge");
  out.type = typeBadge ? typeBadge.textContent.trim() : "";
  out.typeCls = typeClass(typeBadge);
  const scoreBadge = info.querySelector(".mrow-type .badge.badge-score");
  out.score = scoreBadge ? scoreBadge.textContent.trim() : "";
  const netEl = info.querySelector(".mrow-net .badge");
  out.net = isEmptySlot(netEl) ? "" : netEl.textContent.trim();
  out.season = txt(info, ".season-count-badge");
  out.episode = txt(info, ".episode-count");
  const statusEl = info.querySelector(".mrow-status");
  const st = isEmptySlot(statusEl) ? { text: "", days: "" } : splitDays(statusEl);
  out.status = st.text; out.statusDays = st.days;
  out.statusToday = !!(statusEl && (statusEl.classList.contains("today") || statusEl.querySelector(".today")));
  // Metin statusu (Bitti / Iptal edildi / Yeni sezon bekleniyor ...) kartta
  // .next-ep.muted ile kirmizi gosterilir; satir gorunumunde ayni rengi korumak
  // icin bu bayragi tasiyoruz (tarihli statu: S02E03 Â· 21 Ekim Â· 3 -> yesil kalir).
  out.statusMuted = !!(statusEl && statusEl.querySelector(".next-ep.muted"));
  const midEl = info.querySelector(".mrow-mid");
  const md = isEmptySlot(midEl) ? { text: "", days: "" } : splitDays(midEl);
  out.mid = md.text; out.midDays = md.days;
  out.midToday = !!(midEl && (midEl.classList.contains("today") || midEl.querySelector(".today")));
  const line = info.querySelector(".ep-count-line");
  const badge = line ? line.querySelector(".ep-count-badge") : null;
  if (badge) {
    const weps = Number(card.dataset.sumWeps), eps = Number(card.dataset.sumEps);
    const label = (line.textContent || "").replace(badge.textContent || "", "").trim();
    const num = (Number.isFinite(weps) && Number.isFinite(eps) && eps > 0) ? (weps + "/" + eps) : badge.textContent.trim();
    out.count = (label ? label + " " : "") + num;
  }
  return out;
}

function gridKind(grid, section) {
  const s = (section || "").toLowerCase();
  if (s === "feed" || grid.id === "recommend-feed") return "feed";
  if (s.includes("anime") || grid.id.includes("anime")) return "anime";
  if (s.includes("movie") || s.includes("film") || grid.id.includes("movie")) return "movie";
  return "tv";
}

// Bir kart iÃ§in (kind'a gÃ¶re) hÃ¼cre spesifikasyonlarÄ±
function cellSpecs(d, kind) {
  const status = d.status || ((d.season || d.episode) ? "" : d.mid);
  const statusDays = d.status ? d.statusDays : ((d.season || d.episode) ? "" : d.midDays);
  const statusToday = !!(d.statusToday || (!d.status && !(d.season || d.episode) && d.midToday));
  const detail = (d.season || d.episode) ? [d.season, d.episode].filter(Boolean).join(" Â· ") : d.mid;
  const detailDays = (d.season || d.episode) ? "" : d.midDays;
  const map = {
    title: { cls: "wc-title title" + ((d.statusToday || d.midToday) ? " today" : ""), html: `<span class="wclip" title="${esc(d.title)}">${esc(d.title)}</span>` },
    type: { cls: "wc-type " + d.typeCls, html: esc(d.type) },
    score: { cls: "wc-score", html: esc(d.score) },
    net: { cls: "wc-net", html: esc(d.net) },
    season: { cls: "wc-season", html: esc(d.season) },
    episode: { cls: "wc-episode", html: esc(d.episode) },
    status: { cls: "wc-status" + (statusToday ? " today" : "") + (d.statusMuted ? " wc-status-muted" : ""), html: esc(status) + daysHTML(statusDays) },
    count: { cls: "wc-count", html: esc(d.count) },
    date: { cls: "wc-date" + (d.midToday ? " today" : ""), html: esc(d.mid) + daysHTML(d.midDays) },
    detail: { cls: "wc-mid" + (d.midToday ? " today" : ""), html: esc(detail) + daysHTML(detailDays) },
  };
  const order = {
    tv: ["title", "type", "score", "net", "season", "episode", "status", "count"],
    movie: ["title", "type", "score", "net", "date"],
    anime: ["title", "type", "score", "net", "episode", "status", "count"],
    feed: ["title", "type", "score", "net", "detail", "status"],
  }[kind] || ["title", "type", "score", "net", "season", "episode", "status", "count"];
  return order.map((k) => ({ key: k, cls: map[k].cls, html: map[k].html }));
}

// TÃ¼m satÄ±rlarda boÅŸ olan kolonlarÄ± dÃ¼ÅŸÃ¼r (baÅŸlÄ±k her zaman kalÄ±r)
function keptKeys(datas, kind) {
  const specs = datas.map((d) => cellSpecs(d, kind));
  const keys = specs.length ? specs[0].map((s) => s.key) : [];
  const kept = new Set(["title"]);
  keys.forEach((k) => {
    if (k === "title") return;
    if (specs.some((s) => { const c = s.find((x) => x.key === k); return c && c.html; })) kept.add(k);
  });
  return kept;
}

// ---- SatÄ±r modu: orijinale dÃ¶n / yeniden kur -----------------------------------
function cardButtons(card) {
  const tv = isTvMode();
  return Array.from(card.querySelectorAll(BTN_SEL)).filter((b) => tv || !b.classList.contains("info-btn"));
}
function restoreCard(card) {
  const info = card.querySelector(".info");
  if (!info) return;
  const btns = cardButtons(card);
  if (info.dataset.wrowOrig !== undefined) {
    info.innerHTML = info.dataset.wrowOrig;
    delete info.dataset.wrowOrig;
  }
  btns.forEach((b) => {
    const p = b.__wrowParent;
    if (p && b.parentNode !== p) p.appendChild(b);
  });
}
function buildCard(card, kind, d, kept, section) {
  const info = card.querySelector(".info");
  if (!info) return;
  const btns = cardButtons(card);
  btns.forEach((b) => { if (b.__wrowParent === undefined) b.__wrowParent = b.parentElement; });
  info.dataset.wrowOrig = info.innerHTML;
  const specs = cellSpecs(d, kind).filter((s) => kept.has(s.key));
  info.innerHTML = specs.map((s, i) => `<span class="wcell ${s.cls}${s.html ? "" : " is-empty"}${i === 0 ? " first" : ""}">${s.html || ""}</span>`).join("");
  const actions = document.createElement("span");
  actions.className = "wcell wc-actions";
  const used = new Set();
  slotKeysFor(kind, section).forEach((k, i) => {
    if (i > 0) { const sep = document.createElement("span"); sep.className = "wc-asep"; sep.textContent = "|"; actions.appendChild(sep); }
    const btn = btns.find((b) => !used.has(b) && b.matches(SLOT_SEL[k]));
    if (btn) { used.add(btn); actions.appendChild(btn); }
    else { const ph = document.createElement("span"); ph.className = "wc-slot-empty"; actions.appendChild(ph); }
  });
  btns.forEach((b) => { if (!used.has(b)) actions.appendChild(b); });
  info.appendChild(actions);
  const title = info.querySelector(".wc-title");
  if (title) { try { if (isTvMode()) title.tabIndex = 0; } catch (_) {} }
}

const SLOT_SEL = { calendar: ".calendar-btn", info: ".info-btn", defer: ".defer-btn", move: ".move-btn, .move-back-btn", archive: ".archive-btn, .unarchive-btn", hide: ".hide-btn", remove: ".remove" };
function slotKeysFor(kind, section) {
  const s = (section || "").toLowerCase();
  const tv = isTvMode();
  if (s.startsWith("archive")) return ["calendar", "archive", "remove"];
  if (s === "feed" || s === "shows" || s === "movies" || s === "docs" || s === "anime" || s.startsWith("recommend")) return tv ? ["info", "move", "hide", "remove"] : ["move", "hide", "remove"];
  if (s.startsWith("watched")) return tv ? ["calendar", "info", "move"] : ["calendar", "move"];
  if (s.startsWith("unwatched")) return tv ? ["calendar", "info"] : ["calendar"];
  return tv ? ["calendar", "info", "defer", "move", "archive", "remove"] : ["calendar", "defer", "move", "archive", "remove"];
}

// BÃ¶lÃ¼m sargÄ±sÄ±: grid'in id'si -wrap ile biten en yakÄ±n div atasÄ±
// (grid satÄ±r modunda iÃ§ sargÄ±ya alÄ±nsa bile deÄŸiÅŸmez).
function sectionWrap(grid) {
  try {
    const w = grid && grid.closest ? grid.closest('div[id$="-wrap"]') : null;
    if (w) return w;
  } catch (_) {}
  return grid ? grid.parentElement : null;
}

// Yatay kaydÄ±rma yalnÄ±z satÄ±r tablosunda olur: grid iÃ§ sargÄ±ya (div.row-hscroll)
// alÄ±nÄ±r; baÅŸlÄ±k + arama kutusu + Ã¶zet dÄ±ÅŸarÄ±da kalÄ±r, kÄ±rpÄ±lmaz.
// (grid.parentElement deÄŸiÅŸir â†’ views.js sargÄ±yÄ± sectionWrap ile bulur.)
function setXScroll(grid, on) {
  if (!grid) return;
  try {
    const wrap = sectionWrap(grid);
    if (wrap) wrap.classList.toggle("row-xscroll", !!on);
    const p = grid.parentElement;
    const inner = p && p.classList && p.classList.contains("row-hscroll") ? p : null;
    if (on && !inner && wrap) {
      const box = document.createElement("div");
      box.className = "row-hscroll";
      wrap.insertBefore(box, grid);
      box.appendChild(grid);
    } else if (!on && inner) {
      const outer = inner.parentElement;
      if (outer) outer.insertBefore(grid, inner);
      inner.remove();
    }
  } catch (_) {}
}

function enhance(grid, on) {
  const kind = gridKind(grid, grid.__section);
  const section = grid.__section;
  const cards = Array.from(grid.querySelectorAll(":scope > .card"));
  if (!on) {
    cards.forEach(restoreCard);
    setXScroll(grid, false);
    hidePreview();
    return;
  }
  // 1) hepsini orijinal DOM'a dÃ¶ndÃ¼r
  cards.forEach(restoreCard);
  // 2) verileri ORÄ°JÄ°NALDOM'dan Ã§Ä±kar, kolonlarÄ± belirle
  const datas = cards.map(extract);
  const kept = keptKeys(datas, kind);
  // 3) her kartÄ± kur
  cards.forEach((card, i) => { try { buildCard(card, kind, datas[i], kept, section); } catch (_) {} });
  setXScroll(grid, true);
}

// ---- Poster Ã¶nizlemesi ----------------------------------------------------------
let previewEl = null;
let previewOwner = null;

function posterSrc(card) {
  const img = card.querySelector(".poster-wrap img");
  if (!img) return "";
  // Ã–nizleme bÃ¼yÃ¼k aÃ§Ä±lÄ±r: srcset'in en bÃ¼yÃ¼k adayÄ± (yerel w500) kullanÄ±lÄ±r;
  // kartta gÃ¶rÃ¼nen w185 bÃ¼yÃ¼tÃ¼lÃ¼nce flu oluyordu.
  try {
    const cands = (img.getAttribute("srcset") || "").split(",")
      .map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    if (cands.length) return cands[cands.length - 1];
  } catch (_) {}
  const s = img.currentSrc || img.src || "";
  return s.indexOf("image.tmdb.org") !== -1 ? s.replace("/w185", "/w500") : s;
}
function showPreview(card) {
  const src = posterSrc(card);
  if (!src) return;
  if (previewOwner === card && previewEl) return;
  hidePreview();
  const img = card.querySelector(".poster-wrap img");
  const fb = img ? (img.currentSrc || img.src || "") : "";
  const el = document.createElement("div");
  el.className = "wrow-poster";
  el.innerHTML = `<img alt="" src="${src}" data-fb="${fb}" onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb;}" />`;
  document.body.appendChild(el);
  // Konum/boyut CSS'tedir (ekran ortasÄ±, min(720px, 92vh)); TV'de ise eski
  // WebView uyumu iÃ§in piksel geometri inline yazÄ±lÄ±r (min/aspect'e baÄŸlÄ± kalmaz).
  if (isTvMode()) {
    try {
      const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
      let h = Math.min(720, Math.floor(vh * 0.92));
      let w = Math.floor(h * 2 / 3);
      const maxW = Math.floor(vw * 0.94);
      if (w > maxW) { w = maxW; h = Math.floor(w * 3 / 2); }
      el.style.left = Math.round((vw - w) / 2) + "px";
      el.style.top = Math.round((vh - h) / 2) + "px";
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.style.transform = "none";
    } catch (_) {}
  }
  card.classList.add("wrow-has-preview");
  el.addEventListener("mouseleave", hidePreview);
  previewEl = el;
  previewOwner = card;
}
function hidePreview() {
  if (previewEl && previewEl.parentNode) previewEl.parentNode.removeChild(previewEl);
  if (previewOwner) previewOwner.classList.remove("wrow-has-preview");
  previewEl = null;
  previewOwner = null;
}
function togglePreview(card) {
  if (previewOwner === card && previewEl) hidePreview();
  else showPreview(card);
}

function bindPreview() {
  document.addEventListener("mouseover", (e) => {
    if (isTvMode() || !hoverFine) return;
    const title = e.target.closest && e.target.closest(".poster-grid.row-mode .card .wc-title");
    if (title && title.closest(".card")) showPreview(title.closest(".card"));
  });
  document.addEventListener("mouseout", (e) => {
    if (isTvMode() || !hoverFine) return;
    const title = e.target.closest && e.target.closest(".poster-grid.row-mode .card .wc-title");
    if (!title) return;
    const to = e.relatedTarget;
    if (previewEl && to && previewEl.contains(to)) return;
    hidePreview();
  });
  document.addEventListener("click", (e) => {
    if (isTvMode()) return;
    const title = e.target.closest && e.target.closest(".poster-grid.row-mode .card .wc-title");
    if (title && !hoverFine) {
      const card = title.closest(".card");
      if (card) { e.preventDefault(); e.stopPropagation(); togglePreview(card); return; }
    }
    if (previewEl && !previewEl.contains(e.target)) hidePreview();
  }, true);
}

// ---- Kart/SatÄ±r geÃ§iÅŸi ----------------------------------------------------------
function modeKey(section) { return "viewMode:" + section; }

function setToggleIcon(btn, grid) {
  const row = grid.classList.contains("row-mode");
  btn.innerHTML = row ? GRID_SVG : LIST_SVG;
  const tip = row ? tr(CARD_TOOLTIP) : tr(ROW_TOOLTIP);
  btn.setAttribute("data-tip", tip);
  btn.setAttribute("aria-label", tip);
}
function setMode(grid, section, mode, btn) {
  const row = mode === "row";
  grid.__section = section;
  grid.classList.toggle("row-mode", row);
  enhance(grid, row);
  try { localStorage.setItem(modeKey(section), row ? "row" : "card"); } catch (_) {}
  if (btn) setToggleIcon(btn, grid);
}
function makeToggle(section, grid) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "section-view-toggle";
  btn.dataset.section = section;
  setToggleIcon(btn, grid);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMode(grid, section, grid.classList.contains("row-mode") ? "card" : "row", btn);
  });
  return btn;
}
function watchGrid(grid) {
  try {
    const obs = new MutationObserver(() => {
      if (grid.classList.contains("row-mode")) enhance(grid, true);
    });
    obs.observe(grid, { childList: true });
  } catch (_) {}
}
function initSections() {
  document.querySelectorAll("h2.unwatched-section-title").forEach((h2) => {
    if (h2.querySelector(".section-view-toggle")) return;
    const filter = h2.querySelector(".section-filter");
    const sortWrap = h2.querySelector(".section-sort-wrap");
    if (!filter || !sortWrap) return;
    const parent = h2.parentElement;
    let grid = null;
    try { grid = parent ? parent.querySelector(":scope > .poster-grid") : null; } catch (_) { grid = null; }
    if (!grid && parent) grid = parent.querySelector(".poster-grid");
    if (!grid) return;
    const section = filter.dataset.section || grid.id;
    const btn = makeToggle(section, grid);
    sortWrap.insertAdjacentElement("afterend", btn);
    let mode = "card";
    try { mode = localStorage.getItem(modeKey(section)) === "row" ? "row" : "card"; } catch (_) {}
    setMode(grid, section, mode, btn);
    watchGrid(grid);
  });
}

// ---- TV (APK) D-pad navigasyon --------------------------------------------------
function keyDir(e) {
  const k = e.key, c = e.keyCode || e.which;
  if (k === "ArrowDown" || c === 20) return "down";
  if (k === "ArrowUp" || c === 19) return "up";
  if (k === "ArrowLeft" || c === 21) return "left";
  if (k === "ArrowRight" || c === 22) return "right";
  return null;
}
function isOkKey(e) {
  const k = e.key, c = e.keyCode || e.which;
  return k === "Enter" || k === " " || c === 23 || c === 66;
}
function isBackKey(e) {
  const k = e.key, c = e.keyCode || e.which;
  return k === "Escape" || k === "GoBack" || k === "BrowserBack" || c === 4 || c === 461 || k === "Back";
}
function focusNoScroll(el) { try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} } }
function rowCards(grid) {
  return Array.from(grid.querySelectorAll(":scope > .card")).filter(isVisible);
}
function rowFocusables(card) {
  const out = [];
  const title = card.querySelector(".wc-title");
  if (title) out.push(title);
  card.querySelectorAll(".wc-actions > button").forEach((b) => { if (isVisible(b)) out.push(b); });
  return out;
}
function firstTitle(card) { return card ? card.querySelector(".wc-title") : null; }

// GÃ¶rÃ¼nÃ¼mdeki bÃ¶lÃ¼mlerin Ä±zgaralarÄ± (DOM sÄ±rasÄ±): yalnÄ±z gÃ¶rÃ¼nÃ¼r + kartÄ± olanlar.
function sectionGrids() {
  const out = [];
  try {
    const view = document.querySelector(".view.active") || document;
    const wraps = view.querySelectorAll('div[id$="-wrap"]');
    wraps.forEach((w) => {
      if (!isVisible(w)) return;
      const grid = w.querySelector(".poster-grid");
      if (!grid || !isVisible(grid)) return;
      const cards = Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card"));
      if (!cards.some(isVisible)) return;
      out.push({ grid: grid, rowMode: grid.classList.contains("row-mode") });
    });
  } catch (_) {}
  return out;
}

// IzgaranÄ±n ilk odaÄŸÄ±: satÄ±rsa ilk satÄ±r baÅŸlÄ±ÄŸÄ±, kartsa ilk kart.
// OdaklananÄ± gÃ¶rÃ¼nÃ¼r alana kaydÄ±rÄ±r (tv.js focusEl kaydÄ±rma mantÄ±ÄŸÄ±).
function focusGridFirst(grid, rowMode) {
  try {
    let el = null;
    if (rowMode) {
      const cards = rowCards(grid).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      el = cards.length ? firstTitle(cards[0]) : null;
    } else {
      const cards = Array.from(grid.querySelectorAll(":scope > .card")).filter(isVisible);
      el = cards.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || cards[0] || null;
      if (el) { try { el.tabIndex = 0; } catch (_) {} }
    }
    if (!el) return false;
    focusNoScroll(el);
    ensureVisible(el);
    return true;
  } catch (_) { return false; }
}

// SatÄ±r tablosunun bÃ¶lÃ¼m baÅŸlÄ±ÄŸÄ±ndaki arama butonu (TV D-pad: ilk satÄ±rdan
// yukarÄ± Ã§Ä±kÄ±ÅŸ). Arama yoksa/kilitliyse ilk gÃ¶rÃ¼nÃ¼r baÅŸlÄ±k butonu; o da
// yoksa null (tv.js gridMove devralÄ±r).
function sectionSearchButton(grid) {
  try {
    const wrap = sectionWrap(grid);
    const h2 = wrap ? wrap.querySelector(":scope > h2.unwatched-section-title") : null;
    if (!h2) return null;
    const search = h2.querySelector(".section-search");
    if (search && !search.disabled && isVisible(search)) return search;
    const btns = h2.querySelectorAll(".section-view-toggle, .section-filter, .section-refresh, .section-hide, .section-move-up, .section-move-down");
    for (const b of btns) { if (b && !b.disabled && isVisible(b)) return b; }
  } catch (_) {}
  return null;
}

// Odaklanan Ã¶ÄŸe ekran dÄ±ÅŸÄ±ndaysa sayfayÄ± kaydÄ±r: navbar altÄ± ile ekran
// altÄ± arasÄ±nda tutar (tv.js focusEl kaydÄ±rma mantÄ±ÄŸÄ±). Zaten gÃ¶rÃ¼nÃ¼rdeyse
// hiÃ§bir ÅŸey yapmaz.
function ensureVisible(el) {
  try {
    if (!el) return;
    const nav = document.querySelector("nav");
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 60;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const curY = window.pageYOffset || document.documentElement.scrollTop || 0;
    let y = curY;
    if (r.top < navBottom) y = curY + r.top - navBottom - 6;
    if (r.bottom > vh - 10) y = Math.max(y, curY + r.bottom - vh + 10);
    if (y !== curY) window.scrollTo(0, Math.max(0, y));
  } catch (_) {}
  // Yatay: odak iÃ§ satÄ±r kaydÄ±rÄ±cÄ±nÄ±n (div.row-hscroll) dÄ±ÅŸÄ±nda kaldÄ±ysa
  // en-yakÄ±n kenara getir (satÄ±r baÅŸlÄ±ÄŸÄ± sola kayÄ±nca Ã§erÃ§eve kayboluyordu).
  try {
    const box = el.closest ? el.closest(".row-hscroll") : null;
    if (box) {
      const b = el.getBoundingClientRect(), c = box.getBoundingClientRect();
      if (b.left < c.left) box.scrollLeft -= (c.left - b.left);
      else if (b.right > c.right) box.scrollLeft += (b.right - c.right);
    }
  } catch (_) {}
}

function onTvKey(e) {
  if (!isTvMode()) return;
  const ae = document.activeElement;
  const grid = ae && ae.closest ? ae.closest(".poster-grid.row-mode") : null;
  if (!grid) {
    if (previewEl) hidePreview();
    return;
  }
  if (previewEl && isBackKey(e)) {
    e.preventDefault(); e.stopImmediatePropagation(); hidePreview(); return;
  }
  if (isOkKey(e) && ae && ae.classList && ae.classList.contains("wc-title")) {
    e.preventDefault(); e.stopImmediatePropagation();
    const card = ae.closest(".card");
    if (card) togglePreview(card);
    return;
  }
  const dir = keyDir(e);
  if (!dir) return;
  if (previewEl) hidePreview();
  const cards = rowCards(grid).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  if (!cards.length) return;
  const card = ae.closest(".card");
  const focusables = rowFocusables(card);
  if (dir === "left" || dir === "right") {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!focusables.length) return;
    const idx = focusables.indexOf(ae);
    const step = dir === "right" ? 1 : -1;
    const ni = idx === -1 ? (dir === "right" ? 0 : focusables.length - 1) : (idx + step + focusables.length) % focusables.length;
    focusNoScroll(focusables[ni]);
    return;
  }
  const ri = cards.indexOf(card);
  if (dir === "up" && ri <= 0) {
    // Ä°lk satÄ±rdan yukarÄ±: bÃ¶lÃ¼m arama butonuna Ã§Ä±k (dÃ¶ngÃ¼den Ã§Ä±kÄ±ÅŸ).
    // BaÅŸlÄ±k butonu yoksa dokunulmaz â†’ tv.js gridMove navbar akÄ±ÅŸÄ±nÄ± sÃ¼rdÃ¼rÃ¼r.
    const btn = sectionSearchButton(grid);
    if (!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    focusNoScroll(btn);
    ensureVisible(btn);
    return;
  }
  e.preventDefault(); e.stopImmediatePropagation();
  if (dir === "down" && ri >= cards.length - 1) {
    // En alt satÄ±rdan aÅŸaÄŸÄ±: sonraki bÃ¶lÃ¼me; son bÃ¶lÃ¼mse en Ã¼st bÃ¶lÃ¼me sar.
    // (Tek bÃ¶lÃ¼mlÃ¼k gÃ¶rÃ¼nÃ¼mde bÃ¶lÃ¼m iÃ§i sarma korunur.)
    const list = sectionGrids();
    const gi = list.findIndex((s) => s.grid === grid);
    for (let k = 1; k <= list.length; k++) {
      const s = list[(gi + k + list.length) % list.length];
      if (!s || s.grid === grid) continue;
      if (focusGridFirst(s.grid, s.rowMode)) return;
    }
  }
  const step = dir === "down" ? 1 : -1;
  const ti = (ri + step + cards.length) % cards.length;
  const tt = firstTitle(cards[ti]);
  if (tt) { focusNoScroll(tt); ensureVisible(tt); }
}

function init() {
  initSections();
  bindPreview();
  document.addEventListener("keydown", onTvKey, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
