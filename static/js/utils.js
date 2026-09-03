// Faz 4: utils — genel yardımcılar, SVG sabitleri, tarih/saat formatları.
import { state } from "./state.js";
import { t } from "./i18n.js";

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

const FILM_SVG = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="7" y1="3" x2="7" y2="21"></line><line x1="17" y1="3" x2="17" y2="21"></line><line x1="3" y1="7" x2="21" y2="7"></line><line x1="3" y1="17" x2="21" y2="17"></line></svg>`;

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

const INFO_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
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

function utcTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function utcDayStr(epochSec) {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function utcStateStr(it) {
  const today = utcTodayStr();
  if (it.air_time) {
    const day = utcDayStr(it.air_time);
    if (!day) return "";
    if (day < today) return "date-past";
    if (day > today) return "date-future";
    return "date-today";
  }
  if (!it.date) return "";
  if (it.date < today) return "date-past";
  if (it.date > today) return "date-future";
  return "date-today";
}

function canSelectAll(it) {
  const today = utcTodayStr();
  if (it.air_time) {
    const day = utcDayStr(it.air_time);
    return !!day && day < today;
  }
  return !!it.date && it.date < today;
}

function isNewEpisode(it) {
  if (it.watched) return false;
  if (it.air_time) {
    const day = utcDayStr(it.air_time);
    return !!day && day <= utcTodayStr();
  }
  const st = dateState(it.date);
  return st === "date-past" || st === "date-today";
}

function isNewTr(tr) {
  const air = tr.dataset.air ? Number(tr.dataset.air) : null;
  if (air) {
    const day = utcDayStr(air);
    return !!day && day <= utcTodayStr();
  }
  const st = dateState(tr.dataset.date);
  return st === "date-past" || st === "date-today";
}

function isTodayTr(tr) {
  const air = tr.dataset.air ? Number(tr.dataset.air) : null;
  if (air) {
    const day = utcDayStr(air);
    return !!day && day === utcTodayStr();
  }
  return dateState(tr.dataset.date) === "date-today";
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
  if (!it) return false;
  if (it.air_time) {
    const day = utcDayStr(it.air_time);
    if (!day) return false;
    return day === todayInTzStr();
  }
  if (it.date) {
    return dateState(it.date) === "date-today";
  }
  return false;
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


export {
  IMAGE_BASE, HEART_SVG, CHECK_SVG, FILM_SVG, CALENDAR_SVG, INFO_SVG,
  loadGenres, posterHTML, animePosterHTML, scoreTag, platformTag, typeLabel, toast, escAttr,
  applyTitleHint, tzLocale, formatDate, utcTodayStr, utcDayStr, utcStateStr,
  canSelectAll, isNewEpisode, isNewTr, isTodayTr, shortDate, shortDateShort,
  isMobile, daysUntil, daysHint, todayInTz, todayInTzStr, isReleaseToday, isToday, dateState,
  fmtRuntime, fmtScore,
};
