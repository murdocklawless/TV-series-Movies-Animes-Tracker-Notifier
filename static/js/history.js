// history.js — "H" navbar butonu + İzleme Geçmişi takvimi (İstatistik modalı deseni).
import { state } from "./state.js";
import { t } from "./i18n.js?v=528";
import { toast, CHECK_SVG, tzLocale } from "./utils.js?v=521";

const KIND_COLOR = { shows: "#60a5fa", movies: "#22c55e", docs: "#faef15", anime: "#f472b6", marked: "#9ca3af" };
const KIND_ORDER = ["shows", "movies", "docs", "anime", "marked"];
const MARKED_BADGE = { tr: "İşaretlendi", en: "Marked", de: "Markiert", fr: "Marqué", es: "Marcado", it: "Contrassegnato", ru: "Отмечено", ar: "مُعلّم", pt: "Marcado", nl: "Gemarkeerd", pl: "Oznaczone", ja: "マーク済み", ko: "표시됨", zh: "已标记" };
function ml(map) { return map[state.currentLang] || map.tr; }

let _items = [];
let _view = { year: 0, month: 0, day: 0 };
let _byDay = {};
let _tipKey = null;
let _tipOpenedAt = 0;
const _hoverFine = !!(window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches);

function nowParts() {
  const d = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: state.currentTz || "Europe/Istanbul",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const g = (tp) => { const p = parts.find((x) => x.type === tp); return p ? p.value : "0"; };
    return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")) };
  } catch (_) {
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function localKey(ts) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: state.currentTz || "Europe/Istanbul",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(ts * 1000));
  } catch (_) {
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
}

function fmtDT(ts) {
  try {
    const d = new Date(ts * 1000);
    // Secili tz'nin ulke yereli; saat bicimi zorlanmaz (AM/PM dahil)
    const loc = tzLocale();
    const tz = state.currentTz;
    const mk = (o) => (tz ? Object.assign({ timeZone: tz }, o) : o);
    return {
      dv: new Intl.DateTimeFormat(loc, mk({ day: "2-digit", month: "2-digit", year: "numeric" })).format(d),
      tm: new Intl.DateTimeFormat(loc, mk({ hour: "2-digit", minute: "2-digit" })).format(d),
    };
  } catch (_) {
    return { dv: "", tm: "" };
  }
}

function segLabel(it) {
  if (it.kind === "anime") return it.episode != null ? `EP${String(it.episode).padStart(2, "0")}` : "";
  if (it.kind === "shows" || it.kind === "docs") {
    if (it.episode == null) return it.season != null ? `S${String(it.season).padStart(2, "0")}` : "";
    return `S${String(it.season || 1).padStart(2, "0")}E${String(it.episode).padStart(2, "0")}`;
  }
  return "";
}

function groupByDay() {
  _byDay = {};
  _items.forEach((it) => {
    if (!it.ts) return;
    const key = localKey(it.ts);
    if (!_byDay[key]) _byDay[key] = { counts: { shows: 0, movies: 0, docs: 0, anime: 0, marked: 0 }, entries: [] };
    const rec = _byDay[key];
    const k = it.marked ? "marked" : (KIND_ORDER.includes(it.kind) ? it.kind : "shows");
    rec.counts[k]++;
    rec.entries.push(it);
  });
}

function badgeStyle(counts) {
  const total = KIND_ORDER.reduce((s, k) => s + (counts[k] || 0), 0);
  if (!total) return "";
  let acc = 0;
  const stops = [];
  KIND_ORDER.forEach((k) => {
    const c = counts[k] || 0;
    if (!c) return;
    const from = (acc / total) * 100;
    acc += c;
    stops.push(`${KIND_COLOR[k]} ${from.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`);
  });
  return `background: conic-gradient(${stops.join(", ")});`;
}

function dayKeyFor(day) {
  return `${_view.year}-${String(_view.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function renderCalendar() {
  const cal = document.getElementById("history-cal");
  if (!cal) return;
  hideTooltip();
  _tipKey = null;
  const { year: y, month: m } = _view;
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const dim = daysInMonth(y, m);
  const total = offset + dim;
  const rows = total <= 35 ? 5 : 6;
  const keyFor = (day) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let html = "";
  for (let i = 0; i < rows * 7; i++) {
    const day = i - offset + 1;
    if (day < 1 || day > dim) {
      html += `<div class="history-cell blank"></div>`;
      continue;
    }
    const rec = _byDay[keyFor(day)];
    const totalCnt = rec ? KIND_ORDER.reduce((s, k) => s + (rec.counts[k] || 0), 0) : 0;
    const cls = ["history-cell"];
    if (rec && totalCnt > 0) cls.push("has");
    if (day === _view.day) cls.push("selected");
    cls.push("cell-" + day);
    const badge = rec && totalCnt > 0
      ? `<span class="history-badge" style="${badgeStyle(rec.counts)}">${totalCnt}</span>`
      : "";
    html += `<div class="${cls.join(" ")}" data-day="${day}"><span class="history-cell-day">${day}</span>${badge}</div>`;
  }
  cal.innerHTML = html;
}

// Tooltip: satır görünümü (medya takip) desenine göre gerçek tablo.
// Her kayıt bir tablo satırı, her alan bir hücre; ayraçlar ("|") hücre ::before'u
// ile basılır → tüm satırlarda aynı x'te alt alta hizalanır.
// Yapım ismi en fazla 30 karakter; uzunsa kesilip "…" eklenir (kod-noktası güvenli).
function truncTitle(s) {
  const chars = Array.from(String(s == null ? "" : s));
  return chars.length > 30 ? chars.slice(0, 30).join("") + "…" : chars.join("");
}

function tooltipHTML(entries) {
  const COLS = ["name", "seg", "date", "time"];
  const rows = entries.map((it) => {
    const { dv, tm } = fmtDT(it.ts);
    return {
      marked: !!it.marked,
      color: KIND_COLOR[KIND_ORDER.includes(it.kind) ? it.kind : "shows"] || "#fff",
      name: esc(truncTitle(it.title)),
      seg: esc(segLabel(it)),
      date: esc(dv),
      time: esc(tm),
    };
  });
  // Kolon kümesi tüm kayıtlar üzerinden belirlenir; eksik alanı olan satırlar da
  // hücre yer tutar (rowview keptKeys/is-empty deseni) → kolonlar kaymaz.
  const keep = COLS.filter((k) => rows.some((r) => r[k]));
  const body = rows
    .map((r) => {
      const cells = keep
        .map((k) => {
          const val = r[k] || "";
          const inner = k === "name" && val ? `<span class="history-tip-clip">${val}</span>` : val;
          return `<span class="history-tip-cell history-tip-${k}${val ? "" : " is-empty"}">${inner}</span>`;
        })
        .join("");
      const badge = r.marked ? `<span class="history-tip-cell history-tip-mark"><span class="history-marked-badge">${CHECK_SVG}</span></span>` : "";
      const style = r.marked ? "" : ` style="color:${r.color}"`;
      return `<div class="history-tip-row${r.marked ? " marked" : ""}"${style}>${cells}${badge}</div>`;
    })
    .join("");
  return `<div class="history-tip-table">${body}</div>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showTooltip(cell, rec, key) {
  const tip = document.getElementById("history-tooltip");
  const wrap = document.getElementById("history-cal-wrap");
  if (!tip || !wrap) return;
  const wasHidden = tip.style.display === "none" || !tip.style.display;
  if (_tipKey !== key || wasHidden) {
    tip.innerHTML = tooltipHTML(rec ? rec.entries : []);
    tip.scrollTop = 0;
    _tipKey = key;
    _tipOpenedAt = Date.now();
  }
  tip.style.display = "block";
  tip.style.maxHeight = "";
  const cr = cell.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const pad = 6;
  const below = wr.bottom - cr.bottom - pad;
  const above = cr.top - wr.top - pad;
  const placeBelow = below >= above;
  const maxH = Math.max(80, placeBelow ? below : above);
  tip.style.maxHeight = maxH + "px";
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = cr.left - wr.left;
  if (left + tw > wr.width - 4) left = Math.max(4, wr.width - tw - 4);
  if (left < 4) left = 4;
  const top = placeBelow
    ? (cr.bottom - wr.top + pad)
    : (cr.top - wr.top - th - pad);
  tip.style.left = left + "px";
  tip.style.top = Math.max(4, top) + "px";
}

function hideTooltip() {
  const tip = document.getElementById("history-tooltip");
  if (tip) tip.style.display = "none";
}
window.__nxHistHideTip = hideTooltip;

function clampView() {
  const t = nowParts();
  _view.year = Math.min(t.y, Math.max(2000, _view.year || 2000));
  const maxM = _view.year === t.y ? t.m : 12;
  _view.month = Math.min(maxM, Math.max(1, _view.month || 1));
  const maxD = (_view.year === t.y && _view.month === t.m) ? t.d : daysInMonth(_view.year, _view.month);
  _view.day = Math.min(maxD, Math.max(1, _view.day || 1));
}

// Canlı clamp: yazarken yalnız bugün tavanını uygular (min'i zorlamaz, parçalı giriş bozulmaz).
function clampFuture() {
  const t = nowParts();
  _view.year = Math.min(_view.year || t.y, t.y);
  _view.month = Math.min(_view.month || t.m, _view.year === t.y ? t.m : 12);
  const maxD = (_view.year === t.y && _view.month === t.m) ? t.d : daysInMonth(_view.year, _view.month);
  _view.day = Math.min(_view.day || 1, maxD);
}

function writeInputs() {
  const y = document.getElementById("history-year");
  const m = document.getElementById("history-month");
  const d = document.getElementById("history-day");
  if (y) y.value = String(_view.year);
  if (m) m.value = String(_view.month);
  if (d) d.value = String(_view.day);
}

function adj(target, dir) {
  if (target === "year") {
    _view.year += dir;
  } else if (target === "month") {
    let m = _view.month + dir;
    if (m < 1) { m = 12; _view.year -= 1; }
    else if (m > 12) { m = 1; _view.year += 1; }
    _view.month = m;
  } else if (target === "day") {
    const dim = daysInMonth(_view.year, _view.month);
    const d = _view.day + dir;
    if (d < 1) {
      if (_view.month === 1) { _view.month = 12; _view.year -= 1; }
      else _view.month -= 1;
      _view.day = daysInMonth(_view.year, _view.month);
    } else if (d > dim) {
      if (_view.month === 12) { _view.month = 1; _view.year += 1; }
      else _view.month += 1;
      _view.day = 1;
    } else {
      _view.day = d;
    }
  }
  if (_view.year < 2000) _view.year = 2000;
  clampView();
  writeInputs();
  renderCalendar();
}

function readInput(input, min, max, cur) {
  let v = parseInt(String(input.value || "").replace(/[^\d]/g, ""), 10);
  if (Number.isNaN(v)) return cur;
  v = Math.min(max, Math.max(min, v));
  return v;
}

function wireControls() {
  document.querySelectorAll(".history-arrow").forEach((btn) => {
    btn.addEventListener("click", () => adj(btn.dataset.target, Number(btn.dataset.dir)));
  });
  const y = document.getElementById("history-year");
  const m = document.getElementById("history-month");
  const d = document.getElementById("history-day");
  const onInput = () => {
    const yv = Number.parseInt((y.value || "").replace(/[^\d]/g, ""), 10);
    const mv = Number.parseInt((m.value || "").replace(/[^\d]/g, ""), 10);
    const dv = Number.parseInt((d.value || "").replace(/[^\d]/g, ""), 10);
    if (!Number.isNaN(yv)) _view.year = yv;
    if (!Number.isNaN(mv)) _view.month = mv;
    if (!Number.isNaN(dv)) _view.day = dv;
    clampFuture();
    writeInputs();
    renderCalendar();
  };
  if (y) { y.addEventListener("input", onInput); y.addEventListener("change", () => { clampView(); writeInputs(); renderCalendar(); }); }
  if (m) { m.addEventListener("input", onInput); m.addEventListener("change", () => { clampView(); writeInputs(); renderCalendar(); }); }
  if (d) { d.addEventListener("input", onInput); d.addEventListener("change", () => { clampView(); writeInputs(); renderCalendar(); }); }
}

function wireCalendar() {
  const cal = document.getElementById("history-cal");
  const wrap = document.getElementById("history-cal-wrap");
  if (!cal || !wrap) return;
  cal.addEventListener("mouseover", (e) => {
    const cell = e.target.closest(".history-cell.has");
    if (!cell) { if (_hoverFine) hideTooltip(); return; }
    const key = dayKeyFor(cell.dataset.day);
    const rec = _byDay[key];
    if (rec) showTooltip(cell, rec, key);
  });
  wrap.addEventListener("mouseleave", () => { if (_hoverFine) hideTooltip(); });
  const toggle = (e) => {
    if (e.target.closest("#history-tooltip")) return;
    const tip = document.getElementById("history-tooltip");
    const open = tip && tip.style.display !== "none";
    const cell = e.target.closest(".history-cell.has");
    if (!cell) { hideTooltip(); return; }
    const key = dayKeyFor(cell.dataset.day);
    const rec = _byDay[key];
    if (!rec) { hideTooltip(); return; }
    const justOpened = (Date.now() - _tipOpenedAt) < 400;
    if (open && _tipKey === key && !justOpened) hideTooltip();
    else showTooltip(cell, rec, key);
  };
  if (!_hoverFine) {
    wrap.addEventListener("click", toggle);
  } else {
    wrap.addEventListener("click", (e) => {
      if (!e.target.closest(".history-cell.has") && !e.target.closest("#history-tooltip")) hideTooltip();
    });
  }
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    const j = await res.json();
    _items = Array.isArray(j && j.items) ? j.items : [];
  } catch (_) {
    _items = [];
    toast(t("error"));
  }
  groupByDay();
}

async function openHistory() {
  const modal = document.getElementById("history-modal");
  if (!modal) return;
  if (!_view.year) {
    const n = nowParts();
    _view = { year: n.y, month: n.m, day: n.d };
  }
  clampView();
  writeInputs();
  await fetchHistory();
  modal.style.display = "flex";
  renderCalendar();
}

function closeHistory() {
  const modal = document.getElementById("history-modal");
  if (modal) modal.style.display = "none";
  hideTooltip();
}

function exportRows() {
  const head = [t("history_col_kind"), t("history_col_title"), t("history_col_ep"), t("history_col_date"), t("history_col_time")];
  const kindLabel = { shows: t("tab_dizi"), movies: t("tab_film"), docs: t("tab_belgesel"), anime: t("tab_anime") };
  const rows = [[...head]];
  [..._items]
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .forEach((it) => {
      const { dv, tm } = fmtDT(it.ts);
      const kl = kindLabel[KIND_ORDER.includes(it.kind) ? it.kind : "shows"] || "";
      rows.push([
        it.marked ? `${kl} (${ml(MARKED_BADGE)})` : kl,
        it.title || "",
        segLabel(it),
        dv,
        tm,
      ]);
    });
  return rows;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}

function exportCSV() {
  const rows = exportRows();
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const n = nowParts();
  download(`nextep_history_${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  toast(t("history_export_done"));
}

function loadXLSXLib() {
  return new Promise((resolve) => {
    if (window.XLSX) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "/static/js/lib/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function exportXLSX() {
  await loadXLSXLib();
  if (!window.XLSX) { toast(t("error")); return; }
  const aoa = exportRows();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("history_modal_title"));
  const n = nowParts();
  XLSX.writeFile(wb, `nextep_history_${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}.xlsx`);
  toast(t("history_export_done"));
}

function wireHistory() {
  const btn = document.getElementById("tab-history");
  if (btn) btn.addEventListener("click", openHistory);
  const close = document.getElementById("history-close");
  if (close) close.addEventListener("click", closeHistory);
  const modal = document.getElementById("history-modal");
  if (modal) {
    modal.addEventListener("click", (e) => { if (e.target === modal) closeHistory(); });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.style.display === "flex") {
      const tip = document.getElementById("history-tooltip");
      if (tip && tip.style.display !== "none") {
        hideTooltip();
        const c = window.__nxHistCell;
        if (c && document.contains(c)) { try{ c.tabIndex = 0; c.focus({ preventScroll: true }); }catch(_){} }
        window.__nxHistCell = null;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      closeHistory();
    }
  });
  const x = document.getElementById("history-export-xlsx");
  if (x) x.addEventListener("click", exportXLSX);
  const c = document.getElementById("history-export-csv");
  if (c) c.addEventListener("click", exportCSV);
  wireControls();
  wireCalendar();
  if (!_hoverFine) {
    document.addEventListener("click", (e) => {
      const hw = document.getElementById("history-cal-wrap");
      if (hw && !hw.contains(e.target)) hideTooltip();
    });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireHistory);
else wireHistory();