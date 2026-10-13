// rowview.js — Liste bölümleri için Kart ↔ Satır görünümü geçişi + poster önizlemesi.
// views.js'e dokunmaz; mevcut .card verisini okuyup satır modunda hücre (tablo) düzenine çevirir.
// Kolon genişlikleri dinamiktir (display:table auto-layout). Boş kolonlar (tüm satırlarda boş) düşürülür.
import { state } from "./state.js";
import { t } from "./i18n.js?v=520";

const LIST_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="5" rx="1"></rect><line x1="11" y1="6.5" x2="21" y2="6.5"></line><rect x="3" y="15" width="5" height="5" rx="1"></rect><line x1="11" y1="17.5" x2="21" y2="17.5"></line></svg>`;
const GRID_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>`;

const ROW_TOOLTIP = { tr: "Satır görünümü", en: "Row view", de: "Zeilenansicht", fr: "Vue lignes", es: "Vista de filas", it: "Vista righe", ru: "Список", ar: "عرض الصفوف", pt: "Vista em linhas", nl: "Rijenweergave", pl: "Widok wierszy", ja: "行表示", ko: "행 보기", zh: "列表视图" };
const CARD_TOOLTIP = { tr: "Kart görünümü", en: "Card view", de: "Kartenansicht", fr: "Vue cartes", es: "Vista de tarjetas", it: "Vista schede", ru: "Сетка", ar: "عرض البطاقات", pt: "Vista em cartões", nl: "Kaartweergave", pl: "Widok kart", ja: "カード表示", ko: "카드 보기", zh: "卡片视图" };

const BTN_SEL = ".calendar-btn, .move-btn, .move-back-btn, .hide-btn, .remove";
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

// ---- Kart verisini çıkar --------------------------------------------------------
function txt(root, sel) { const e = root.querySelector(sel); return e ? e.textContent.trim() : ""; }
function isEmptySlot(e) { return !e || e.classList.contains("slot-empty"); }
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
  const out = { title: "", type: "", typeCls: "", score: "", net: "", season: "", episode: "", status: "", mid: "", count: "" };
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
  out.status = isEmptySlot(statusEl) ? "" : statusEl.textContent.trim();
  const midEl = info.querySelector(".mrow-mid");
  out.mid = isEmptySlot(midEl) ? "" : midEl.textContent.trim();
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

// Bir kart için (kind'a göre) hücre spesifikasyonları
function cellSpecs(d, kind) {
  const status = d.status || ((d.season || d.episode) ? "" : d.mid);
  const detail = (d.season || d.episode) ? [d.season, d.episode].filter(Boolean).join(" · ") : d.mid;
  const map = {
    title: { cls: "wc-title title", html: `<span class="wclip" title="${esc(d.title)}">${esc(d.title)}</span>` },
    type: { cls: "wc-type " + d.typeCls, html: esc(d.type) },
    score: { cls: "wc-score", html: esc(d.score) },
    net: { cls: "wc-net", html: esc(d.net) },
    season: { cls: "wc-season", html: esc(d.season) },
    episode: { cls: "wc-episode", html: esc(d.episode) },
    status: { cls: "wc-status", html: esc(status) },
    count: { cls: "wc-count", html: esc(d.count) },
    date: { cls: "wc-date", html: esc(d.mid) },
    detail: { cls: "wc-mid", html: esc(detail) },
  };
  const order = {
    tv: ["title", "type", "score", "net", "season", "episode", "status", "count"],
    movie: ["title", "type", "score", "net", "date"],
    anime: ["title", "type", "score", "net", "episode", "status", "count"],
    feed: ["title", "type", "score", "net", "detail", "status"],
  }[kind] || ["title", "type", "score", "net", "season", "episode", "status", "count"];
  return order.map((k) => ({ key: k, cls: map[k].cls, html: map[k].html }));
}

// Tüm satırlarda boş olan kolonları düşür (başlık her zaman kalır)
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

// ---- Satır modu: orijinale dön / yeniden kur -----------------------------------
function cardButtons(card) {
  return Array.from(card.querySelectorAll(BTN_SEL));
}
function restoreCard(card) {
  const info = card.querySelector(".info");
  if (!info) return;
  const btns = cardButtons(card);
  if (info.dataset.wrowOrig !== undefined) {
    info.innerHTML = info.dataset.wrowOrig;
    delete info.dataset.wrowOrig;
  }
  btns.forEach((b) => { if (b.parentNode !== card) card.appendChild(b); });
}
function buildCard(card, kind, d, kept, section) {
  const info = card.querySelector(".info");
  if (!info) return;
  const btns = cardButtons(card);
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

const SLOT_SEL = { calendar: ".calendar-btn", move: ".move-btn, .move-back-btn", hide: ".hide-btn", remove: ".remove" };
function slotKeysFor(kind, section) {
  const s = (section || "").toLowerCase();
  if (s === "feed" || s === "shows" || s === "movies" || s === "docs" || s === "anime" || s.startsWith("recommend")) return ["move", "hide", "remove"];
  if (s.startsWith("watched")) return ["calendar", "move"];
  if (s.startsWith("unwatched")) return ["calendar"];
  return ["calendar", "move", "remove"];
}

// Yatay kaydırma yalnız satır alanında olsun diye grid bir sarmalayıcıya alınır
function wrapGrid(grid) {
  if (grid.__rowWrap && grid.__rowWrap.parentNode) return;
  const w = document.createElement("div");
  w.className = "row-scroll";
  grid.parentNode.insertBefore(w, grid);
  w.appendChild(grid);
  grid.__rowWrap = w;
}
function unwrapGrid(grid) {
  const w = grid.__rowWrap;
  if (w && w.parentNode) { w.parentNode.insertBefore(grid, w); w.remove(); }
  grid.__rowWrap = null;
}

function enhance(grid, on) {
  const kind = gridKind(grid, grid.__section);
  const section = grid.__section;
  const cards = Array.from(grid.querySelectorAll(":scope > .card"));
  if (!on) {
    cards.forEach(restoreCard);
    unwrapGrid(grid);
    hidePreview();
    return;
  }
  // 1) hepsini orijinal DOM'a döndür
  cards.forEach(restoreCard);
  // 2) verileri ORİJİNALDOM'dan çıkar, kolonları belirle
  const datas = cards.map(extract);
  const kept = keptKeys(datas, kind);
  // 3) her kartı kur
  cards.forEach((card, i) => { try { buildCard(card, kind, datas[i], kept, section); } catch (_) {} });
  wrapGrid(grid);
}

// ---- Poster önizlemesi ----------------------------------------------------------
let previewEl = null;
let previewOwner = null;

function posterSrc(card) {
  const img = card.querySelector(".poster-wrap img");
  if (!img) return "";
  return img.currentSrc || img.src || "";
}
function showPreview(card) {
  const src = posterSrc(card);
  if (!src) return;
  if (previewOwner === card && previewEl) return;
  hidePreview();
  const el = document.createElement("div");
  el.className = "wrow-poster";
  el.innerHTML = `<img alt="" src="${src}" />`;
  document.body.appendChild(el);
  try {
    const r = card.getBoundingClientRect();
    el.style.left = Math.round(r.left + 8) + "px";
    el.style.top = Math.round(r.top + r.height / 2) + "px";
  } catch (_) {}
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

// ---- Kart/Satır geçişi ----------------------------------------------------------
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
    const grid = parent ? parent.querySelector(":scope > .poster-grid") : null;
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
  e.preventDefault(); e.stopImmediatePropagation();
  const ri = cards.indexOf(card);
  const step = dir === "down" ? 1 : -1;
  const ti = (ri + step + cards.length) % cards.length;
  const tt = firstTitle(cards[ti]);
  if (tt) focusNoScroll(tt);
}

function init() {
  initSections();
  bindPreview();
  document.addEventListener("keydown", onTvKey, true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
