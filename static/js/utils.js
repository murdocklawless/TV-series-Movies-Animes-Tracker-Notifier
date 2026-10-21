// Faz 4: utils — genel yardımcılar, SVG sabitleri, tarih/saat formatları.
import { state } from "./state.js";
import { t } from "./i18n.js?v=647";

const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

async function loadGenres(source, force) {
  if (!force) {
    if (source === "tmdb" && state.tmdbGenresCache) return state.tmdbGenresCache;
    if (source === "anilist" && state.anilistGenresCache) return state.anilistGenresCache;
  }
  try {
    const r = await fetch(`/api/genres?source=${source}`);
    const j = await r.json();
    const genres = j.genres || [];
    if (source === "tmdb") state.tmdbGenresCache = genres;
    else state.anilistGenresCache = genres;
    return genres;
  } catch (e) {
    return [];
  }
}

const HEART_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
  </svg>`;

const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const TRASH_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

const UNDO_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

const EYE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

const FILM_SVG = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="7" y1="3" x2="7" y2="21"></line><line x1="17" y1="3" x2="17" y2="21"></line><line x1="3" y1="7" x2="21" y2="7"></line><line x1="3" y1="17" x2="21" y2="17"></line></svg>`;

// Faz 31c: uye cip ikonlari — FA regular'da pause/stop (ve sade check/xmark/play)
// bulunmadigindan satir-ici SVG (halka buton cercevesinde, currentColor ile boyanir).
const ROLE_CHECK_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const ROLE_X_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>`;
const ROLE_PLAY_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>`;
const ROLE_PAUSE_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="8" y1="5" x2="8" y2="19"></line><line x1="16" y1="5" x2="16" y2="19"></line></svg>`;
const ROLE_STOP_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>`;

window.noPosterFallback = function () {
  return `<div class="no-poster">${FILM_SVG}</div>`;
};

function posterHTML(posterPath, title, withBadge, posterLocal, posterLocalW185, withInfo) {
  let src = null, srcset = null;
  if (posterLocalW185 && posterLocal) {
    src = posterLocalW185;
    srcset = `${posterLocalW185} 185w, ${posterLocal} 500w`;
  } else if (posterLocal) {
    src = posterLocal;
  } else if (posterPath) {
    src = `${IMAGE_BASE}${posterPath}`;
  }
  const tvSizes = (document.documentElement && (document.documentElement.classList.contains('is-tv') || document.documentElement.classList.contains('tv-mode'))) ? '119px' : '170px';
  const img = src
    ? `<img src="${src}"${srcset ? ` srcset="${srcset}" sizes="${tvSizes}"` : ""} alt="${title}" loading="lazy" decoding="async" onerror="this.outerHTML=noPosterFallback()" />`
    : `<div class="no-poster">${FILM_SVG}</div>`;
  const badge = withBadge ? `<span class="badge-watched">${CHECK_SVG}</span>` : "";
  const infoBtn = withInfo ? `<button class="info-btn" data-tip="Info">${INFO_SVG}</button>` : "";
  return `<div class="poster-wrap">${img}${infoBtn}${badge}</div>`;
}

function animePosterHTML(coverUrl, title, withBadge, posterLocal, posterLocalW185, withInfo) {
  let src = null, srcset = null;
  if (posterLocalW185 && posterLocal) {
    src = posterLocalW185;
    srcset = `${posterLocalW185} 185w, ${posterLocal} 500w`;
  } else if (posterLocal) {
    src = posterLocal;
  } else if (coverUrl) {
    src = coverUrl;
  }
  const tvSizes2 = (document.documentElement && (document.documentElement.classList.contains('is-tv') || document.documentElement.classList.contains('tv-mode'))) ? '119px' : '170px';
  const img = src
    ? `<img src="${src}"${srcset ? ` srcset="${srcset}" sizes="${tvSizes2}"` : ""} alt="${title}" loading="lazy" decoding="async" onerror="this.outerHTML=noPosterFallback()" />`
    : `<div class="no-poster">${FILM_SVG}</div>`;
  const badge = withBadge ? `<span class="badge-watched">${CHECK_SVG}</span>` : "";
  const infoBtn = withInfo ? `<button class="info-btn" data-tip="Info">${INFO_SVG}</button>` : "";
  return `<div class="poster-wrap">${img}${infoBtn}${badge}</div>`;
}

function scoreTag(v) {
  if (!v || Number(v) <= 0) return "";
  return `<span class="badge badge-score">${Number(v).toFixed(1)}</span>`;
}

function platformTag(platform) {
  if (!platform) return "";
  const name = Array.isArray(platform) ? (platform[0] || "") : platform;
  if (!name) return "";
  const safe = escAttr(name);
  return `<span class="badge badge-platform" data-tip="${safe}">${safe}</span>`;
}

function typeLabel(mediaType) {
  return mediaType === "tv" ? t("type_tv") : t("type_movie");
}

// Poster altı sabit satırlar: tür+puan / yayıncı / orta(sezon-bölüm|statü) / statü (+ opsiyonel bölüm sayısı).
// Bilgi olmayan satır görünmez yer tutucu ile rezerve edilir → komşu kartlarla hizalanır.
// count verilmezse bölüm-sayısı satırı hiç basılmaz.
const CARD_SLOT = {
  net: `<span class="badge badge-platform slot-empty" aria-hidden="true">–</span>`,
  season: `<div class="season-line slot-empty" aria-hidden="true">&nbsp;</div>`,
  status: `<div class="next-ep slot-empty" aria-hidden="true">&nbsp;</div>`,
};

function cardRows({ type = "", score = "", net = "", mid = "", status = "", count = "", reserve = true }) {
  const netRow = net ? `<div class="meta-row mrow-net">${net}</div>` : (reserve ? `<div class="meta-row mrow-net">${CARD_SLOT.net}</div>` : "");
  const midRow = mid ? `<div class="meta-row mrow-mid">${mid}</div>` : (reserve ? `<div class="meta-row mrow-mid">${CARD_SLOT.season}</div>` : "");
  return `<div class="meta-row mrow-type">${type}${score}</div>`
    + netRow
    + midRow
    + (status ? `<div class="meta-row mrow-status">${status}</div>` : ``)
    + (count ? `<div class="meta-row mrow-count">${count}</div>` : ``);
}

// Kişi/yönetmen filmografi + arama/çoklu arama + favori kartları için sade 2 satır şeması:
// tip·puan / vizyon-yayın tarihi. Satır boşsa görünmez yer tutucu → kartlar hizalı kalır.
function resultCardRows({ type = "", score = "", status = "" }) {
  return `<div class="meta-row mrow-type">${type}${score}</div>`
    + `<div class="meta-row mrow-status">${status || CARD_SLOT.status}</div>`;
}

// Kart 3. satırı: film/single-doc → "Vizyon Tarihi: {tarih}", dizi/multi-doc/anime →
// "Yayın Tarihi: {tarih}". Tarih yoksa "" döner (çağıran yer tutucu basar).
function cardDateLine(mediaType, item) {
  if (!item) return "";
  if (mediaType === "anime") {
    const y = item.start_date;
    if (!y) return "";
    return `<div class="next-ep muted">${t("release_date")}: ${y}</div>`;
  }
  if (!item.release_date) return "";
  const label = t(mediaType === "movie" ? "movie_release_date" : "release_date");
  return `<div class="next-ep muted">${label}: ${formatDate(item.release_date).text}</div>`;
}

function toast(msg, isErr) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), 2500);
}

function escAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Kaynak etiketi (1.86) -------------------------------------------------
// Nereden izlendi: stremio|plex|jellyfin|emby|other. Ask damga satirinda ve
// ozet modalinda ayni renkler kullanilir (.src-* siniflari style.css'te).
const SOURCE_KEYS = ["stremio", "plex", "jellyfin", "emby", "trakt", "other"];
const SOURCE_NAMES = { stremio: "Stremio", plex: "Plex", jellyfin: "Jellyfin", emby: "Emby", trakt: "Trakt" };

// Bilinmeyen/bos kaynak -> "" (etiket cizilmez).
function srcKey(source) {
  const k = String(source == null ? "" : source).trim().toLowerCase();
  return SOURCE_KEYS.indexOf(k) >= 0 ? k : "";
}

// Gorunen ad: marka adlari sabit, "other" cevrilir.
function srcName(source) {
  const k = srcKey(source);
  if (!k) return "";
  return k === "other" ? t("other") : SOURCE_NAMES[k];
}

// Damga satiri eki: " - <renkli kaynak>" (kaynak yoksa bos).
function srcStampHTML(source) {
  const k = srcKey(source);
  if (!k) return "";
  return ` - <span class="src src-${k}">${escAttr(srcName(k))}</span>`;
}

function applyTitleHint(card) {
  const el = card.querySelector(".info .title");
  if (!el) return;
  if (el.scrollHeight > el.clientHeight) {
    el.setAttribute("data-tip", el.textContent);
  }
}


const CALENDAR_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="16" y1="2" x2="16" y2="6"></line>
    <line x1="8" y1="2" x2="8" y2="6"></line>
    <line x1="3" y1="10" x2="21" y2="10"></line>
  </svg>`;

const ARROW_DOWN_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="4" x2="12" y2="20"></line>
    <polyline points="5 13 12 20 19 13"></polyline>
  </svg>`;

const ARROW_UP_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="20" x2="12" y2="4"></line>
    <polyline points="5 11 12 4 19 11"></polyline>
  </svg>`;

const INFO_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </svg>`;

const CLOCK_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>`;

// 1.86: kaynak (nereden izlendi) satiri ikonu — etiket/oynatma kaynagi.
const SOURCE_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
    <line x1="7" y1="7" x2="7.01" y2="7"></line>
  </svg>`;

function tzLocale() {
  const z = state.allTimezones.find((x) => x.value === state.currentTz);
  if (z && z.locale) return z.locale;
  return "tr-TR";
}

function formatDate(dateStr) {
  if (!dateStr) return { text: t("date_unknown"), day: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return { text: dateStr, day: "" };
  const loc = tzLocale();
  let text;
  try {
    text = new Intl.DateTimeFormat(loc, {
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(d);
  } catch (e) {
    text = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  let day;
  try {
    day = new Intl.DateTimeFormat(loc, { weekday: "long" }).format(d);
  } catch (e) {
    day = "";
  }
  return { text, day };
}

// --- Takvim "gün" karşılaştırmaları: TEK KAYNAK todayInTzStr() ---
// Yerel gece yarısından sonra UTC hâlâ dün olabildiği için (ör. +03'te 02:20 >
// UTC 23:20) UTC ile gün kıyaslamak dünkü bölümü "bugün" gösteriyordu. Tüm gün
// karşılaştırmaları todayInTzStr() (backend server_today / kullanıcı dilimi) ile
// yapılır; renk/gün kararının kaynağı ekranda GÖRÜNEN tarih (it.date) olur.
function releaseDayStr(it) {
  if (!it) return "";
  return it.date || utcDayStr(it.air_time);
}

function utcDayStr(epochSec) {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Epoch -> kullanicinin (uygulama) dilimindeki gun "YYYY-MM-DD".
// Gun karsilastirmalarinin "gun" tarafi icin UTC gunu yerine yerel gun kullanilir
// (gece yarisi kaymasini ve 00:00-03:00 penceresindeki yanlis renkleri onler).
function dayStrInTz(epochSec) {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  if (isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: state.currentTz, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (_) {
    return utcDayStr(epochSec);
  }
}

function dayStateStr(it) {
  const day = releaseDayStr(it);
  if (!day) return "";
  const today = todayInTzStr();
  if (day < today) return "date-past";
  if (day > today) return "date-future";
  return "date-today";
}

function canSelectAll(it) {
  const day = releaseDayStr(it);
  return !!day && day < todayInTzStr();
}

function isNewEpisode(it) {
  if (it.watched) return false;
  const day = releaseDayStr(it);
  return !!day && day <= todayInTzStr();
}

function isNewTr(tr) {
  const day = tr.dataset.date || utcDayStr(tr.dataset.air ? Number(tr.dataset.air) : null);
  return !!day && day <= todayInTzStr();
}

function isTodayTr(tr) {
  const day = tr.dataset.date || utcDayStr(tr.dataset.air ? Number(tr.dataset.air) : null);
  return !!day && day === todayInTzStr();
}

function shortDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const loc = tzLocale();
  try {
    return new Intl.DateTimeFormat(loc, { day: "numeric", month: "long" }).format(d);
  } catch (e) {
    const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }
}

function shortDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  const loc = tzLocale();
  try {
    return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).format(d);
  } catch (e) {
    const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }
}

function isMobile() {
  return window.innerWidth <= 600;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = todayInTz();
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function daysHint(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return "";
  if (days <= 0) return t("today_release");
  if (days === 1) return t("days_left_1");
  return t("days_left", { n: days });
}

function todayInTz() {
  const iso = state.serverToday;
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso + "T00:00:00");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: state.currentTz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00`);
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  return d.getTime() === todayInTz().getTime();
}

function dateState(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  const today = todayInTz();
  if (d.getTime() < today.getTime()) return "date-past";
  if (d.getTime() > today.getTime()) return "date-future";
  return "date-today";
}

function todayInTzStr() {
  const d = todayInTz();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isReleaseToday(it) {
  return dayStateStr(it) === "date-today";
}

function fmtRuntime(min) {
  if (!min) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return t("runtime_hm", { h, m });
  if (h) return t("runtime_h", { h });
  return t("runtime_m", { m });
}

function fmtScore(v) {
  if (v == null) return "";
  return Number(v).toFixed(1);
}

const DOC_GENRES = ["documentary", "documentaries", "belgesel", "doku", "dokus", "documentaire", "documentaires", "documental", "documentales", "documentario", "documentari", "документальный", "доку", "وثائقي", "وثائقيات", "documentário", "documentários", "dokument", "dokumenty", "ドキュメンタリー", "다큐멘터리", "纪录片"];

function parseGenres(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g;
  try {
    const v = JSON.parse(g);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function isDocItem(item) {
  if (!item || item.isAnime) return false;
  const gs = parseGenres(item.genres).map((g) => String(g || "").trim().toLowerCase());
  if (gs.some((g) => DOC_GENRES.includes(g))) return true;
  const gids = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  return gids.includes(99);
}


export {
  IMAGE_BASE, HEART_SVG, CHECK_SVG, TRASH_SVG, UNDO_SVG, EYE_SVG, EYE_OFF_SVG, FILM_SVG, CALENDAR_SVG, INFO_SVG, CLOCK_SVG,
  SOURCE_SVG,
  ARROW_DOWN_SVG, ARROW_UP_SVG,
  ROLE_CHECK_SVG, ROLE_X_SVG, ROLE_PLAY_SVG, ROLE_PAUSE_SVG, ROLE_STOP_SVG,
  loadGenres, posterHTML, animePosterHTML, scoreTag, platformTag, typeLabel, toast, escAttr,
  SOURCE_KEYS, srcKey, srcName, srcStampHTML,
  CARD_SLOT, cardRows, resultCardRows, cardDateLine,
  applyTitleHint, tzLocale, formatDate, utcDayStr, dayStrInTz, dayStateStr, releaseDayStr,
  canSelectAll, isNewEpisode, isNewTr, isTodayTr, shortDate, shortDateShort,
  isMobile, daysUntil, daysHint, todayInTz, todayInTzStr, isReleaseToday, isToday, dateState,
  fmtRuntime, fmtScore, DOC_GENRES, parseGenres, isDocItem,
};
