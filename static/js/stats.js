// stats.js — "%" navbar butonu + İstatistik modalı.
// Tür (Dizi/Film/Belgesel/Anime) kutuları + Genel (mini kutular) + Dağılım (bar) istatistikleri.
import { t } from "./i18n.js?v=692";
import { isDocItem, parseGenres } from "./utils.js?v=692";
import { state } from "./state.js";

function fmtSummaryTime(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  return Math.floor(min / 60) + ":" + String(min % 60).padStart(2, "0");
}

function fmtHoursMin(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return t("stats_time_hours_min", { h, m });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function itemCounts(item) {
  const e = item.total_eps != null ? (Number(item.total_eps) || 0)
    : item.total != null ? (Number(item.total) || 0)
    : (item.media_type === "movie" ? 1 : 0);
  const w = item.watched_eps != null ? (Number(item.watched_eps) || 0)
    : item.watched != null ? (Number(item.watched) || 0)
    : 0;
  return { e, w };
}

function statsForKind(items, kind) {
  let count = 0, eps = 0, weps = 0, ueps = 0, wmin = 0, umin = 0;
  (items || []).forEach((it) => {
    const { e, w } = itemCounts(it);
    count++;
    eps += e;
    weps += w;
    ueps += (e - w);
    wmin += Number(it.watched_min) || 0;
    umin += Number(it.unwatched_min) || 0;
  });
  return { kind, count, eps, weps, ueps, wmin, umin };
}

function statsBoxHTML(st, headLabel) {
  const multi = st.kind !== "movies";
  const lines = [t("stats_cards", { n: st.count })];
  if (multi && st.eps > 0) lines.push(t("summary_episodes", { n: st.eps }));
  if (st.weps > 0 && st.wmin > 0) {
    const key = st.kind === "movies" ? "summary_watched_movies" : "summary_watched";
    lines.push(t(key, { n: st.weps, t: fmtSummaryTime(st.wmin) }));
  }
  if (st.ueps > 0 && st.umin > 0) {
    const key = st.kind === "movies" ? "summary_unwatched_movies" : "summary_unwatched";
    lines.push(t(key, { n: st.ueps, t: fmtSummaryTime(st.umin) }));
  }
  return `<div class="stats-box"><div class="stats-box-head">${headLabel}</div>`
    + lines.map((l) => `<div class="stats-box-line">${l}</div>`).join("")
    + `</div>`;
}

function miniBox(head, body) {
  return `<div class="stats-box stats-mini"><div class="stats-box-head">${head}</div>`
    + `<div class="stats-box-line">${body}</div></div>`;
}

function sepBox(head, items, cls) {
  return `<div class="stats-box stats-mini${cls ? " " + cls : ""}"><div class="stats-box-head">${head}</div><div class="stats-box-lines">`
    + items.map((r) => `<div class="genre-row">`
      + `<span class="g-name" title="${esc(r.label)}">${esc(r.label)}</span>`
      + `<span class="g-sep">|</span>`
      + `<span class="g-time">${r.text}</span>`
      + `</div>`).join("")
    + `</div></div>`;
}

// ---- zaman / geçmiş (history) ----
function tz() { return state.currentTz || "Europe/Istanbul"; }

function locDateParts(ts) {
  const d = new Date(ts * 1000);
  const base = new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (tp) => { const p = base.find((x) => x.type === tp); return p ? p.value : ""; };
  const y = Number(g("year"));
  const m = Number(g("month"));
  const day = Number(g("day"));
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "long" }).format(d);
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { y, m, d: day, key, wd: wd.toLowerCase() };
}

function offsetKey(key, days) {
  const [yy, mm, dd] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd, 12) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const WEEKDAY_INDEX = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function historyStats(items) {
  const day = {};
  const wd = [0, 0, 0, 0, 0, 0, 0];
  const mon = {};
  items.forEach((it) => {
    if (!it.ts) return;
    const p = locDateParts(it.ts);
    const idx = WEEKDAY_INDEX[p.wd] != null ? WEEKDAY_INDEX[p.wd] : 6;
    wd[idx]++;
    day[p.key] = (day[p.key] || 0) + 1;
    const mk = p.key.slice(0, 7);
    mon[mk] = (mon[mk] || 0) + 1;
  });
  const keys = Object.keys(day).sort();
  const set = new Set(keys);
  const nowTs = Math.floor(Date.now() / 1000);
  let cur = 0;
  let k = locDateParts(nowTs).key;
  if (!set.has(k)) k = offsetKey(k, -1);
  while (set.has(k)) { cur++; k = offsetKey(k, -1); }
  let best = 0, run = 0, prev = null;
  keys.forEach((key) => {
    if (prev && offsetKey(prev, 1) === key) run++;
    else run = 1;
    prev = key;
    if (run > best) best = run;
  });
  let bd = null, bcount = 0;
  Object.keys(day).forEach((key) => { if (day[key] > bcount) { bcount = day[key]; bd = key; } });
  let last30 = 0;
  const tk = locDateParts(nowTs).key;
  for (let i = 0; i < 30; i++) { if (set.has(offsetKey(tk, -i))) last30++; }
  const cy = Number(tk.slice(0, 4));
  const cm = Number(tk.slice(5, 7));
  const monthly = [];
  for (let i = 0; i < 12; i++) {
    let yy = cy, mm = cm - (11 - i);
    while (mm < 1) { mm += 12; yy--; }
    monthly.push(mon[`${yy}-${String(mm).padStart(2, "0")}`] || 0);
  }
  return {
    activeDays: keys.length,
    last30,
    cur,
    best,
    bestDay: bd ? { date: `${bd.slice(8, 10)}/${bd.slice(5, 7)}/${bd.slice(0, 4)}`, count: bcount } : null,
    wd,
    wdMax: Math.max(1, ...wd),
    monthly,
    monthlyMax: Math.max(1, ...monthly),
  };
}

// ---- puan / tamamlanma / durum ----
function scoreOf(it) {
  if (it.media_type === "anime") {
    const s = Number(it.score);
    return s > 0 ? s / 10 : 0;
  }
  return Number(it.vote_average) || 0;
}

function scoreStats(shows, movies, docs, anime) {
  const all = [...shows, ...movies, ...docs, ...anime];
  const sc = [];
  all.forEach((it) => { const s = scoreOf(it); if (s > 0) sc.push({ name: it.title || "", v: s }); });
  const avg = sc.length ? sc.reduce((a, b) => a + b.v, 0) / sc.length : 0;
  const sorted = [...sc].sort((a, b) => b.v - a.v);
  const bands = [0, 0, 0];
  sc.forEach((x) => { if (x.v >= 8) bands[0]++; else if (x.v >= 6) bands[1]++; else bands[2]++; });
  return { avg, best: sorted[0] || null, worst: sorted.length ? sorted[sorted.length - 1] : null, bands, bandTotal: sc.length };
}

function completionPct(shows, movies, docs, anime) {
  const all = [...shows, ...movies, ...docs, ...anime];
  let sum = 0, n = 0;
  all.forEach((it) => {
    const { e, w } = itemCounts(it);
    if (e > 0) { sum += w / e; n++; }
  });
  return n ? Math.round((sum / n) * 100) : 0;
}

function statusStats(shows, movies, docs, anime) {
  const st = [0, 0, 0, 0];
  [...shows, ...docs, ...anime].forEach((it) => {
    const s = String(it.status || "").toLowerCase();
    if (/(returning|releasing|airing)/.test(s)) st[0]++;
    else if (/(ended|finished)/.test(s)) st[1]++;
    else if (/cancel/.test(s)) st[2]++;
    else st[3]++;
  });
  return st;
}

// ---- tür / platform (watched_min ağırlıklı) ----
function genreStats(all) {
  const w = {};
  const disp = {};
  all.forEach((it) => {
    const wm = Number(it.watched_min) || 0;
    if (wm <= 0) return;
    const gs = parseGenres(it.genres).filter(Boolean);
    if (!gs.length) return;
    const share = wm / gs.length;
    gs.forEach((g) => {
      const low = String(g).toLowerCase();
      w[low] = (w[low] || 0) + share;
      disp[low] = String(g);
    });
  });
  const top = Object.keys(w).map((k) => ({ label: disp[k] || k, value: w[k] })).sort((a, b) => b.value - a.value).slice(0, 5);
  return { top, max: Math.max(1, ...top.map((x) => x.value)) };
}

function platformStats(all) {
  const tot = { netflix: 0, hbo: 0, disney: 0, prime: 0, other: 0 };
  all.forEach((it) => {
    const wm = Number(it.watched_min) || 0;
    if (wm <= 0) return;
    const nets = Array.isArray(it.networks) ? it.networks : [];
    const name = nets.length ? String((nets[0] && nets[0].name) || nets[0] || "") : "";
    const n = name.toLowerCase();
    let k = "other";
    if (n.includes("netflix")) k = "netflix";
    else if (n.includes("hbo")) k = "hbo";
    else if (n.includes("disney")) k = "disney";
    else if (n.includes("prime")) k = "prime";
    tot[k] += wm;
  });
  const mx = Math.max(1, ...Object.values(tot));
  return [
    { label: t("feed_src_netflix"), value: tot.netflix, max: mx },
    { label: t("feed_src_hbo_max"), value: tot.hbo, max: mx },
    { label: t("feed_src_disney_plus"), value: tot.disney, max: mx },
    { label: t("feed_src_prime_video"), value: tot.prime, max: mx },
    { label: t("stats_other"), value: tot.other, max: mx },
  ];
}

async function fetchStatsData() {
  let followed = [];
  let anime = [];
  let history = [];
  try {
    const res = await fetch("/api/followed", { cache: "no-store" });
    followed = await res.json();
    if (!Array.isArray(followed)) followed = [];
  } catch (_) {}
  try {
    const res = await fetch("/api/anime/followed", { cache: "no-store" });
    anime = await res.json();
    if (!Array.isArray(anime)) anime = [];
  } catch (_) {}
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    const j = await res.json();
    history = Array.isArray(j && j.items) ? j.items : [];
  } catch (_) {}
  return { followed, anime, history };
}

function buildStatsHTML(data) {
  const followed = data.followed || [];
  const anime = data.anime || [];
  const history = data.history || [];
  const shows = followed.filter((f) => f.media_type === "tv" && !isDocItem(f));
  const movies = followed.filter((f) => f.media_type === "movie" && !isDocItem(f));
  const docs = followed.filter((f) => isDocItem(f));

  const stShows = statsForKind(shows, "shows");
  const stMovies = statsForKind(movies, "movies");
  const stDocs = statsForKind(docs, "docs");
  const stAnime = statsForKind(anime, "anime");
  const stTotal = {
    kind: "total",
    count: stShows.count + stMovies.count + stDocs.count + stAnime.count,
    eps: stShows.eps + stMovies.eps + stDocs.eps + stAnime.eps,
    weps: stShows.weps + stMovies.weps + stDocs.weps + stAnime.weps,
    ueps: stShows.ueps + stMovies.ueps + stDocs.ueps + stAnime.ueps,
    wmin: stShows.wmin + stMovies.wmin + stDocs.wmin + stAnime.wmin,
    umin: stShows.umin + stMovies.umin + stDocs.umin + stAnime.umin,
  };
  const kindBoxes = statsBoxHTML(stShows, t("tab_dizi"))
    + statsBoxHTML(stDocs, t("tab_belgesel"))
    + statsBoxHTML(stAnime, t("tab_anime"))
    + statsBoxHTML(stMovies, t("tab_film"))
    + statsBoxHTML(stTotal, t("stats_total"));

  const hs = historyStats(history);
  const sc = scoreStats(shows, movies, docs, anime);
  const completion = completionPct(shows, movies, docs, anime);
  const st = statusStats(shows, movies, docs, anime);
  const allItems = [...shows, ...movies, ...docs, ...anime];
  const gen = genreStats(allItems);
  const plat = platformStats(allItems);

  const bestDay = hs.bestDay ? t("stats_best_day_line", { d: hs.bestDay.date, n: hs.bestDay.count })
    : "—";
  const bestScore = sc.best ? t("stats_score_item", { name: esc(sc.best.name), score: sc.best.v.toFixed(1) }) : "—";
  const worstScore = sc.worst ? t("stats_score_item", { name: esc(sc.worst.name), score: sc.worst.v.toFixed(1) }) : "—";

  const genBoxes = [
    miniBox(t("stats_total_time_label"), fmtHoursMin(stTotal.wmin)),
    miniBox(t("stats_active_days"), t("stats_days", { n: hs.activeDays })),
    miniBox(t("stats_last30"), t("stats_days", { n: hs.last30 })),
    miniBox(t("stats_streak"), t("stats_streak_line", { c: hs.cur, r: hs.best })),
    miniBox(t("stats_best_day"), bestDay),
    miniBox(t("stats_avg_score"), sc.avg ? sc.avg.toFixed(1) : "—"),
    miniBox(t("stats_best_title"), bestScore),
    miniBox(t("stats_worst_title"), worstScore),
    miniBox(t("stats_completion"), t("stats_completion_val", { p: completion })),
    miniBox(t("stats_status_dist"), t("stats_status_line", { a: st[0], b: st[1], c: st[2], d: st[3] })),
  ];

  const wdItems = WEEKDAY_KEYS.map((k, i) => ({ label: t("weekday_" + k), text: String(hs.wd[i]) }));
  const bandItems = [
    { label: t("stats_band_high"), text: sc.bandTotal ? `${Math.round((sc.bands[0] / sc.bandTotal) * 100)}%` : "0%" },
    { label: t("stats_band_mid"), text: sc.bandTotal ? `${Math.round((sc.bands[1] / sc.bandTotal) * 100)}%` : "0%" },
    { label: t("stats_band_low"), text: sc.bandTotal ? `${Math.round((sc.bands[2] / sc.bandTotal) * 100)}%` : "0%" },
  ];
  const _tk = locDateParts(Math.floor(Date.now() / 1000)).key;
  const _cy = Number(_tk.slice(0, 4));
  const _cm = Number(_tk.slice(5, 7));
  const monthItems = hs.monthly.map((n, i) => {
    let yy = _cy, mm = _cm - (11 - i);
    while (mm < 1) { mm += 12; yy--; }
    return { label: `${String(mm).padStart(2, "0")}.${String(yy).slice(2)}`, text: String(n) };
  });
  const platItems = plat.map((r) => ({ label: r.label, text: fmtSummaryTime(r.value) }));
  const genreItems = gen.top.map((x) => ({ label: x.label, text: fmtSummaryTime(x.value) }));

  const sepBoxes = [
    sepBox(t("stats_weekly"), wdItems, "stats-barbig"),
    sepBox(t("stats_monthly"), monthItems, "stats-barbig"),
    sepBox(t("stats_score_dist"), bandItems, "stats-barbig"),
    sepBox(t("stats_platform"), platItems, "stats-barbig"),
    sepBox(t("stats_top_genres"), genreItems, "stats-barbig"),
  ];

  return `<div class="stats-kinds">${kindBoxes}</div>`
    + `<div class="stats-grid">${genBoxes.join("")}${sepBoxes.join("")}</div>`;
}

let _statsRenderToken = 0;

async function renderStats() {
  const list = document.getElementById("stats-list");
  if (!list) return;
  const token = ++_statsRenderToken;
  const data = await fetchStatsData();
  if (token !== _statsRenderToken) return;
  list.innerHTML = buildStatsHTML(data);
}

async function openStatsModal() {
  const modal = document.getElementById("stats-modal");
  const list = document.getElementById("stats-list");
  if (!modal || !list) return;
  list.innerHTML = `<div class="stats-loading muted">${t("loading")}</div>`;
  modal.style.display = "flex";
  await renderStats();
}

function closeStatsModal() {
  const modal = document.getElementById("stats-modal");
  if (modal) modal.style.display = "none";
}

function wireStats() {
  const btn = document.getElementById("tab-stats");
  if (btn) btn.addEventListener("click", openStatsModal);
  const close = document.getElementById("stats-close");
  if (close) close.addEventListener("click", closeStatsModal);
  const modal = document.getElementById("stats-modal");
  if (modal) {
    modal.addEventListener("click", (e) => { if (e.target === modal) closeStatsModal(); });
  }
  document.addEventListener("app:lists-refreshed", () => {
    const m = document.getElementById("stats-modal");
    if (m && m.style.display !== "none") renderStats();
  });
  document.addEventListener("app:langchange", () => {
    const m = document.getElementById("stats-modal");
    if (m && m.style.display !== "none") renderStats();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireStats);
else wireStats();