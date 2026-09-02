// Faz 4: views — görünüm (tab) yönetimi, sıralama ve ana liste yükleyicileri (takip edilenler / anime / izlenmemiş).
import { state } from "./state.js";
import { t } from "./i18n.js";
import {
  posterHTML, animePosterHTML, scoreTag, platformTag, typeLabel, applyTitleHint,
  formatDate, shortDate, shortDateShort, isMobile, daysUntil, daysHint,
  isToday, dateState, utcDayStr, utcTodayStr, FILM_SVG, CALENDAR_SVG, CHECK_SVG, INFO_SVG, toast, tzLocale,
} from "./utils.js";
import { openDetails, openReleases, openAnimeDetails, openAnimeSchedule, showConfirm, openUnwatchedModal } from "./components.js";
import { renderChips, closeResultsModal } from "./search.js";
import { closeSettingsMenu } from "./settings.js";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function setTvCardAttrs(div, item) {
  try { if (!isTvUIActive()) return; div.tabIndex = 0; div.setAttribute('role','button'); if(item.title) div.setAttribute('aria-label', item.title); if(item.tmdb_id) div.dataset.tmdbId = item.tmdb_id; if(item.anilist_id) div.dataset.anilistId = item.anilist_id; if(item.media_type) div.dataset.mediaType = item.media_type; if(item.id) div.dataset.dbId = item.id; if(item.isAnime) div.dataset.isAnime = '1'; div.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }}); const cal = div.querySelector('.calendar-btn'); if(cal){ cal.tabIndex=0; cal.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); cal.click(); }}); } const rem = div.querySelector('.remove'); if(rem){ rem.tabIndex=0; rem.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); rem.click(); }}); } const mv = div.querySelector('.move-btn,.move-back-btn'); if(mv){ mv.tabIndex=0; mv.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); mv.click(); }}); } const hb = div.querySelector('.hide-btn'); if(hb){ hb.tabIndex=0; hb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); hb.click(); }}); } const ib = div.querySelector('.info-btn'); if(ib){ ib.tabIndex=0; ib.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); ib.click(); }}); } if(hb){ hb.tabIndex=0; hb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); hb.click(); }}); } } catch {}
}


const views = {
  dizi: document.getElementById("view-dizi"),
  film: document.getElementById("view-film"),
  anime: document.getElementById("view-anime"),
  unwatched: document.getElementById("view-unwatched"),
  watched: document.getElementById("view-watched"),
  recommend: document.getElementById("view-recommend"),
  search: document.getElementById("view-search"),
};

const tabs = {
  dizi: document.getElementById("tab-dizi"),
  film: document.getElementById("tab-film"),
  anime: document.getElementById("tab-anime"),
  unwatched: document.getElementById("tab-unwatched"),
  watched: document.getElementById("tab-watched"),
  recommend: document.getElementById("tab-recommend"),
  search: document.getElementById("tab-search"),
  sort: document.getElementById("tab-sort"),
  settings: document.getElementById("tab-settings"),
};

let prevView = "dizi";

function switchView(name) {
  const current = Object.keys(views).find((k) => views[k].classList.contains("active"));
  if (name === "search" && current && current !== "search") prevView = current;
  if (name !== "search" && views.search.classList.contains("active")) {
    state.chips.length = 0;
    renderChips();
    closeResultsModal();
  }
  Object.keys(views).forEach((k) => views[k].classList.remove("active"));
  views[name].classList.add("active");
  if (name === "search") {
    tabs.sort.classList.remove("active");
    tabs.settings.classList.remove("active");
    tabs.search.classList.add("active");
  } else {
    Object.keys(tabs).forEach((k) => tabs[k].classList.remove("active"));
    tabs[name].classList.add("active");
  }
  try {
    localStorage.setItem("activeView", name);
  } catch (e) {}
  if (name === "dizi") loadFollowed("dizi");
  if (name === "film") loadFollowed("film");
  if (name === "anime") loadAnime();
  if (name === "unwatched") loadUnwatched();
  if (name === "watched") loadWatched();
  if (name === "recommend") loadRecommendations();
  if (SORT_VIEWS.includes(name)) {
    state.sortKey = loadViewSort(name);
    updateSortMenu();
  }
}

tabs.dizi.onclick = () => switchView("dizi");
tabs.film.onclick = () => switchView("film");
tabs.anime.onclick = () => switchView("anime");
tabs.unwatched.onclick = () => switchView("unwatched");
tabs.watched.onclick = () => switchView("watched");
tabs.recommend.onclick = () => switchView("recommend");
tabs.search.onclick = () => switchView("search");
document.getElementById("search-close").onclick = () => switchView(prevView);

const SORT_VIEWS = ["dizi", "film", "anime", "unwatched", "watched"];

function activeView() {
  if (views.film.classList.contains("active")) return "film";
  if (views.anime.classList.contains("active")) return "anime";
  if (views.unwatched.classList.contains("active")) return "unwatched";
  if (views.watched.classList.contains("active")) return "watched";
  return "dizi";
}

function loadViewSort(view) {
  let v = "added";
  try {
    v = localStorage.getItem("sortKey_" + view) || "added";
  } catch (e) {}
  return v;
}

function saveViewSort(view, key) {
  try {
    localStorage.setItem("sortKey_" + view, key);
  } catch (e) {}
}

try {
  state.sortKey = loadViewSort(activeView());
} catch (e) {}

function sortValue(item) {
  if (state.sortKey === "alpha") return (item.title || "").toLocaleLowerCase();
  if (state.sortKey === "score") return item.score != null ? item.score : item.vote_average || 0;
  if (state.sortKey === "date") {
    if (item.isAnime) {
      const at = item.items && item.items[0] ? item.items[0].air_at : null;
      return at ? new Date(at * 1000).toISOString() : "";
    }
    if (item.media_type) {
      if (item.media_type === "tv") return item.next_episode ? item.next_episode.air_date || "" : "";
      return item.release_date || "";
    }
    const ad = item.items && item.items[0] ? item.items[0].air_date || "" : "";
    return ad || item.release_date || "";
  }
  if (state.sortKey === "type") return item.isAnime ? "anime" : item.media_type || item.format || "";
  return item.id;
}

function compareItems(a, b) {
  let av = sortValue(a);
  let bv = sortValue(b);
  if (state.sortKey === "added") return bv - av;
  if (state.sortKey === "score") return (bv || 0) - (av || 0);
  if (state.sortKey === "date") {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const aPast = !av || av < today;
    const bPast = !bv || bv < today;
    if (aPast && !bPast) return 1;
    if (!aPast && bPast) return -1;
    if (av === bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av < bv ? -1 : 1;
  }
  av = String(av).toLocaleLowerCase();
  bv = String(bv).toLocaleLowerCase();
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function applySort(items) {
  const arr = items.slice();
  arr.sort(compareItems);
  return arr;
}

function updateSortMenu() {
  document.querySelectorAll(".sort-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sort === state.sortKey);
  });
}

const sortMenu = document.getElementById("sort-menu");
function activateUtilityTab(btn) {
  document.querySelectorAll(".utils-tabs-group .tab.active").forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
}
function closeSortMenu() {
  sortMenu.classList.remove("open");
  tabs.sort.classList.remove("active");
}
document.getElementById("tab-sort").onclick = (e) => {
  e.stopPropagation();
  closeSettingsMenu();
  const open = sortMenu.classList.contains("open");
  if (open) {
    closeSortMenu();
  } else {
    activateUtilityTab(tabs.sort);
    sortMenu.classList.add("open");
    updateSortMenu();
  }
};
document.querySelectorAll(".sort-item").forEach((btn) => {
  btn.onclick = (e) => {
    e.stopPropagation();
    state.sortKey = btn.dataset.sort;
    const av = activeView();
    saveViewSort(av, state.sortKey);
    closeSortMenu();
    if (views.dizi.classList.contains("active")) loadFollowed("dizi");
    if (views.film.classList.contains("active")) loadFollowed("film");
    if (views.anime.classList.contains("active")) loadAnime();
    if (views.unwatched.classList.contains("active")) loadUnwatched();
    if (views.watched.classList.contains("active")) loadWatched();
  };
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".sort-wrap")) closeSortMenu();
});

function tvStatusLabel(status) {
  const s = (status || "").trim();
  const map = {
    "Ended": "tv_status_ended",
    "Canceled": "tv_status_canceled",
    "Cancelled": "tv_status_canceled",
    "Returning Series": "tv_status_returning",
    "In Production": "tv_status_production",
    "Planned": "tv_status_planned",
    "Pilot": "tv_status_pilot",
  };
  return map[s] ? t(map[s]) : s;
}

function tvStatusText(item) {
  const status = (item.status || "").trim();
  if (status === "Ended") return `<div class="next-ep muted">${t("tv_status_ended")}</div>`;
  if (status === "Canceled") return `<div class="next-ep muted">${t("tv_status_canceled")}</div>`;
  let season = null;
  try {
    const sl = JSON.parse(item.season_list || "[]");
    const now = new Date().toISOString().slice(0, 10);
    season = sl
      .filter((s) => s.season_number && s.air_date && s.air_date >= now)
      .sort((a, b) => (a.air_date || "").localeCompare(b.air_date || ""))[0];
  } catch (e) {
    season = null;
  }
  if (season) return `<div class="next-ep muted">${t("tv_next_season", { date: shortDate(season.air_date) })}</div>`;
  if (status === "In Production") return `<div class="next-ep muted">${t("tv_status_production")}</div>`;
  if (status === "Planned") return `<div class="next-ep muted">${t("tv_status_planned")}</div>`;
  if (status === "Pilot") return `<div class="next-ep muted">${t("tv_status_pilot")}</div>`;
  if (status === "Returning Series") return `<div class="next-ep muted">${t("tv_status_returning")}</div>`;
  return `<div class="next-ep muted">${t("new_season")}</div>`;
}

async function loadFollowed(view) {
  const res = await fetch("/api/followed");
  let items = await res.json();
  const isTv = view === "dizi";
  items = items.filter((i) => (isTv ? i.media_type === "tv" : i.media_type === "movie") && !(i.in_watched == 1));
  items = applySort(items);
  const grid = document.getElementById(isTv ? "poster-grid-shows" : "poster-grid-movies");
  const empty = document.getElementById(isTv ? "empty-dizi" : "empty-film");
  grid.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item) => {
    const div = document.createElement("div");
    const todayNow =
      (item.media_type === "tv" && item.next_episode && isToday(item.next_episode.air_date)) ||
      (item.media_type === "movie" && dateState(item.release_date) === "date-today");
    div.className = todayNow ? "card today-release-card" : "card";
    setTvCardAttrs(div, item);
    const isMovieWatched = item.media_type === "movie" && item.watched == 1;
    const isTvCompleted = item.media_type === "tv" && item.completed;
    const showBadge = isMovieWatched || isTvCompleted;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, showBadge, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>
          ${scoreTag(item.vote_average)}
          ${platformTag(item.networks)}
          ${
            item.media_type === "tv"
              ? item.next_episode
                ? isToday(item.next_episode.air_date)
                  ? `<div class="next-ep today">S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")} ${t("today_airing")}</div>`
                  : `<div class="next-ep">S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")} · ${isMobile() ? shortDateShort(item.next_episode.air_date) : shortDate(item.next_episode.air_date)}${isMobile() ? "" : " · "}<span class="next-ep-days" data-tip="${daysHint(item.next_episode.air_date)}">${daysUntil(item.next_episode.air_date)}</span></div>`
                : tvStatusText(item)
              : item.release_date
                ? dateState(item.release_date) === "date-past"
                  ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
                  : dateState(item.release_date) === "date-today"
                    ? `<div class="next-ep today">${formatDate(item.release_date).text} ${t("today_theaters")}</div>`
                    : `<div class="next-ep">${formatDate(item.release_date).text} · <span class="next-ep-days" data-tip="${daysHint(item.release_date)}">${daysUntil(item.release_date)}</span></div>`
                : `<div>${t("date_unknown")}</div>`
          }
          ${item.notified ? `<div style="color:#6ee7a0">${t("notified")}</div>` : ""}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      ${showBadge ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>` : ""}
      <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
    `;
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      showConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadFollowed(view);
          toast(t("unfollowed", { name: item.title }));
        },
        { title: t("confirm_unfollow") }
      );
    };
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases(item.media_type, item.tmdb_id, item.title);
    };
    const infoBtn = div.querySelector(".info-btn");
    if(infoBtn) infoBtn.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title); };
    const moveBtn = div.querySelector(".move-btn");
    if (moveBtn) {
      moveBtn.onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/followed/move-watched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdb_id: item.tmdb_id,
            media_type: item.media_type,
            watched: 1,
          }),
        });
        const j = await r.json();
        if (r.ok) {
          toast(t("moved_to_watched", { name: item.title }));
          loadFollowed(view);
        } else {
          toast(j.error || t("error"));
        }
      };
    }
    div.onclick = () => {
      openDetails(item.media_type, item.tmdb_id, item.title);
    };
    grid.appendChild(div);
    applyTitleHint(div);
  });
}

function animeNextText(next, status) {
  if (!next) {
    if (status === "FINISHED") return `<div class="next-ep muted">${t("anime_status_finished")}</div>`;
    if (status === "CANCELLED") return `<div class="next-ep muted">${t("anime_status_cancelled")}</div>`;
    if (status === "HIATUS") return `<div class="next-ep muted">${t("anime_status_hiatus")}</div>`;
    if (status === "NOT_YET_RELEASED") return `<div class="next-ep muted">${t("anime_status_upcoming")}</div>`;
    if (status === "RELEASING") return `<div class="next-ep muted">${t("anime_status_releasing")}</div>`;
    return "";
  }
  const d = new Date(next.airing_at * 1000);
  const now = Date.now();
  const diffDays = Math.floor((d.getTime() - now) / 86400000);
  if (diffDays <= 0) return `<div class="next-ep today">EP ${next.episode} ${t("today_airing")}</div>`;
  const loc = tzLocale();
  let txt;
  try {
    txt = new Intl.DateTimeFormat(loc, { day: "numeric", month: isMobile() ? "short" : "long" }).format(d);
  } catch (e) {
    txt = d.toLocaleDateString();
  }
  return `<div class="next-ep anime-ep"><span>EP ${next.episode} · ${txt}</span><span class="next-ep-sep">·</span><span class="next-ep-days">${diffDays}</span></div>`;
}

function animeStatusLabel(status) {
  const s = (status || "").toUpperCase();
  if (s === "RELEASING") return t("anime_status_releasing");
  if (s === "FINISHED") return t("anime_status_finished");
  if (s === "NOT_YET_RELEASED") return t("anime_status_upcoming");
  return s;
}

async function loadAnime() {
  const res = await fetch("/api/anime/followed");
  let items = await res.json();
  items = items.filter((i) => !(i.in_watched == 1));
  items = applySort(items);
  const grid = document.getElementById("anime-grid");
  const empty = document.getElementById("empty-anime");
  grid.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item) => {
    const div = document.createElement("div");
    const animeToday = !!item.next_episode && utcDayStr(item.next_episode.airing_at) === utcTodayStr();
    const animeCompleted = !!item.completed;
    div.className = animeToday ? "card today-release-card" : "card";
    setTvCardAttrs(div, {title:item.title, tmdb_id:item.anilist_id, anilist_id:item.anilist_id, media_type:"anime", id:item.id, isAnime:true});
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, animeCompleted, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-anime">${t("tab_anime")}</span>
          ${item.score ? scoreTag(item.score / 10) : ""}
          ${platformTag(item.studios)}
          ${animeNextText(item.next_episode, item.status)}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      ${animeCompleted ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>` : ""}
      <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
    `;
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      showConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/anime/unfollow/${item.id}`, { method: "DELETE" });
          loadAnime();
          toast(t("unfollowed", { name: item.title }));
        },
        { title: t("confirm_unfollow") }
      );
    };
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openAnimeSchedule(item.id, item.title);
    };
    const infoBtnA = div.querySelector(".info-btn");
    if(infoBtnA) infoBtnA.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(item.id, item.anilist_id, item.title); };
    const animeMoveBtn = div.querySelector(".move-btn");
    if (animeMoveBtn) {
      animeMoveBtn.onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/anime/move-watched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anime_id: item.id, watched: 1 }),
        });
        const j = await r.json();
        if (r.ok) {
          toast(t("moved_to_watched", { name: item.title }));
          loadAnime();
        } else {
          toast(j.error || t("error"));
        }
      };
    }
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    grid.appendChild(div);
    applyTitleHint(div);
  });
}

function unwatchedFirstLabel(item) {
  if (!item.items || !item.items.length) return "";
  const it = item.items[0];
  if (item.isAnime) return `EP ${it.episode}`;
  return `S${String(it.season).padStart(2, "0")}E${String(it.episode).padStart(2, "0")}`;
}

async function loadUnwatched() {
  let data = { shows: [], anime: [], movies: [] };
  try {
    const res = await fetch("/api/unwatched");
    data = await res.json();
  } catch (e) {
    data = { shows: [], anime: [], movies: [] };
  }
  const unwatchedView = document.getElementById("view-unwatched");
  const empty = document.getElementById("empty-unwatched");
  const showsGrid = document.getElementById("unwatched-shows");
  const moviesGrid = document.getElementById("unwatched-movies");
  const animeGrid = document.getElementById("unwatched-anime");
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  const shows = applySort((data.shows || []).map((s) => ({ ...s, isAnime: false })));
  const movies = applySort((data.movies || []).map((m) => ({ ...m, isAnime: false })));
  const animes = applySort((data.anime || []).map((a) => ({ ...a, isAnime: true })));

  const hasContent = { shows: shows.length, movies: movies.length, anime: animes.length };

  document.getElementById("unwatched-shows-wrap").style.display = shows.length ? "" : "none";
  document.getElementById("unwatched-movies-wrap").style.display = movies.length ? "" : "none";
  const animeWrap = document.getElementById("unwatched-anime-wrap");
  animeWrap.style.display = animes.length ? "" : "none";
  animeWrap.classList.toggle("has-shows", shows.length > 0);
  empty.style.display = shows.length || movies.length || animes.length ? "none" : "block";

  // Kayıtlı bölüm sırasını uygula ve boş bölümleri çıkar
  const order = loadSectionOrder("unwatched").filter((s) => hasContent[s]);
  // Dolu olup da sırada olmayanları sona ekle
  ["shows", "movies", "anime"].forEach((s) => {
    if (hasContent[s] && !order.includes(s)) order.push(s);
  });
  order.forEach((s) => {
    const wrap = document.getElementById(`unwatched-${s}-wrap`);
    if (wrap) unwatchedView.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-unwatched");

  shows.forEach((item) => {
    const div = document.createElement("div");
    const singleToday = item.unwatched === 1 && isToday((item.items[0] || {}).air_date);
    div.className = singleToday ? "card today-release-card" : "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    let bottom;
    if (item.unwatched === 1) {
      const lbl = unwatchedFirstLabel(item);
      bottom = singleToday
        ? `<div class="next-ep today">${lbl} ${t("today_airing")}</div>`
        : `<div class="next-ep today">${lbl}</div>`;
    } else {
      bottom = `<div class="next-ep unwatched-count">${t("unwatched_count", { n: item.unwatched })}</div>`;
    }
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-tv">${typeLabel("tv")}</span>
          ${scoreTag(item.vote_average)}
          ${platformTag(item.networks)}
          ${bottom}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openUnwatchedModal(item, false);
    };
    const ib2 = div.querySelector(".info-btn"); if(ib2) ib2.onclick = (e)=>{ e.stopPropagation(); openDetails("tv", item.tmdb_id, item.title); };
    div.onclick = () => openDetails("tv", item.tmdb_id, item.title);
    showsGrid.appendChild(div);
    applyTitleHint(div);
  });

  movies.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    let dateLine = item.release_date
      ? dateState(item.release_date) === "date-past"
        ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
        : `<div class="next-ep">${formatDate(item.release_date).text}</div>`
      : `<div>${t("date_unknown")}</div>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-movie">${typeLabel("movie")}</span>
          ${scoreTag(item.vote_average)}
          ${platformTag(item.networks)}
          ${dateLine}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases("movie", item.tmdb_id, item.title);
    };
    const ib3 = div.querySelector(".info-btn"); if(ib3) ib3.onclick = (e)=>{ e.stopPropagation(); openDetails("movie", item.tmdb_id, item.title); };
    div.onclick = () => openDetails("movie", item.tmdb_id, item.title);
    moviesGrid.appendChild(div);
    applyTitleHint(div);
  });

  animes.forEach((item) => {
    const div = document.createElement("div");
    const singleToday = item.unwatched === 1 && !!item.items[0] && utcDayStr(item.items[0].air_at) === utcTodayStr();
    div.className = singleToday ? "card today-release-card" : "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    let bottom;
    if (item.unwatched === 1) {
      const lbl = unwatchedFirstLabel(item);
      bottom = singleToday
        ? `<div class="next-ep today">${lbl} ${t("today_airing")}</div>`
        : `<div class="next-ep today">${lbl}</div>`;
    } else {
      bottom = `<div class="next-ep unwatched-count">${t("unwatched_count", { n: item.unwatched })}</div>`;
    }
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-anime">${t("tab_anime")}</span>
          ${item.score ? scoreTag(item.score / 10) : ""}
          ${platformTag(item.studios)}
          ${bottom}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openUnwatchedModal(item, true);
    };
    const ib4 = div.querySelector(".info-btn"); if(ib4) ib4.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(item.id, item.anilist_id, item.title); };
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });
}

const DEFAULT_ORDER = ["shows", "movies", "anime"];

async function loadWatched() {
  let data = { shows: [], anime: [], movies: [] };
  try {
    const res = await fetch("/api/watched");
    data = await res.json();
  } catch (e) {
    data = { shows: [], anime: [], movies: [] };
  }
  const watchedView = document.getElementById("view-watched");
  const empty = document.getElementById("empty-watched");
  const showsGrid = document.getElementById("watched-shows");
  const moviesGrid = document.getElementById("watched-movies");
  const animeGrid = document.getElementById("watched-anime");
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  const shows = applySort((data.shows || []).map((s) => ({ ...s, isAnime: false })));
  const movies = applySort((data.movies || []).map((m) => ({ ...m, isAnime: false })));
  const animes = applySort((data.anime || []).map((a) => ({ ...a, isAnime: true })));

  const hasContent = { shows: shows.length, movies: movies.length, anime: animes.length };

  document.getElementById("watched-shows-wrap").style.display = shows.length ? "" : "none";
  document.getElementById("watched-movies-wrap").style.display = movies.length ? "" : "none";
  const animeWrap = document.getElementById("watched-anime-wrap");
  animeWrap.style.display = animes.length ? "" : "none";
  animeWrap.classList.toggle("has-shows", shows.length > 0);
  empty.style.display = shows.length || movies.length || animes.length ? "none" : "block";

  const order = loadSectionOrder("watched").filter((s) => hasContent[s]);
  ["shows", "movies", "anime"].forEach((s) => {
    if (hasContent[s] && !order.includes(s)) order.push(s);
  });
  order.forEach((s) => {
    const wrap = document.getElementById(`watched-${s}-wrap`);
    if (wrap) watchedView.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-watched");

  shows.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-tv">${typeLabel("tv")}</span>
          ${scoreTag(item.vote_average)}
          ${platformTag(item.networks)}
          <div class="next-ep unwatched-count">${t("watched_count", { n: item.watched })}</div>
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_dizi") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases("tv", item.tmdb_id, item.title);
    };
    const ibW = div.querySelector(".info-btn"); if(ibW) ibW.onclick = (e)=>{ e.stopPropagation(); openDetails("tv", item.tmdb_id, item.title); };
    div.querySelector(".move-back-btn").onclick = async (e) => {
      e.stopPropagation();
      await moveBackFromWatched(item, "dizi");
    };
    div.onclick = () => openDetails("tv", item.tmdb_id, item.title);
    showsGrid.appendChild(div);
    applyTitleHint(div);
  });

  movies.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    let dateLine = item.release_date
      ? dateState(item.release_date) === "date-past"
        ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
        : `<div class="next-ep">${formatDate(item.release_date).text}</div>`
      : `<div>${t("date_unknown")}</div>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-movie">${typeLabel("movie")}</span>
          ${scoreTag(item.vote_average)}
          ${platformTag(item.networks)}
          ${dateLine}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_film") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases("movie", item.tmdb_id, item.title);
    };
    div.querySelector(".move-back-btn").onclick = async (e) => {
      e.stopPropagation();
      await moveBackFromWatched(item, "film");
    };
    div.onclick = () => openDetails("movie", item.tmdb_id, item.title);
    moviesGrid.appendChild(div);
    applyTitleHint(div);
  });

  animes.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-anime">${t("tab_anime")}</span>
          ${item.score ? scoreTag(item.score / 10) : ""}
          ${platformTag(item.studios)}
          <div class="next-ep unwatched-count">${t("watched_count", { n: item.watched })}</div>
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_anime") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openAnimeSchedule(item.id, item.title);
    };
    div.querySelector(".move-back-btn").onclick = async (e) => {
      e.stopPropagation();
      await moveBackFromWatched(item, "anime");
    };
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });
}

async function moveBackFromWatched(item, targetView) {
  const isAnime = !!item.isAnime;
  let r;
  if (isAnime) {
    r = await fetch("/api/anime/move-watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anime_id: item.id, watched: 0 }),
    });
  } else {
    r = await fetch("/api/followed/move-watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type || (targetView === "film" ? "movie" : "tv"), watched: 0 }),
    });
  }
  const j = await r.json();
  if (!r.ok) {
    toast(j.error || t("error"));
    return;
  }
  toast(t("moved_back", { name: item.title }));
  await loadWatched();
  const empty = document.getElementById("empty-watched");
  const stillHasCards = !empty || empty.style.display === "none";
  if (!stillHasCards) {
    switchView(targetView);
  }
}

async function loadRecommendations() {
  const empty = { shows: [], movies: [], anime: [] };
  let shows = empty.shows, movies = empty.movies, anime = empty.anime;
  try {
    const [sr, mr, ar] = await Promise.all([
      fetch("/api/recommendations?media=dizi"),
      fetch("/api/recommendations?media=film"),
      fetch("/api/recommendations?media=anime"),
    ]);
    shows = (await sr.json()).shows || [];
    movies = (await mr.json()).movies || [];
    anime = (await ar.json()).anime || [];
  } catch (e) {
    shows = movies = anime = [];
  }
  renderRecommendations({ shows, movies, anime });
}

function renderRecommendations(data) {
  const view = document.getElementById("view-recommend");
  const empty = document.getElementById("empty-recommend");
  const showsGrid = document.getElementById("recommend-shows");
  const moviesGrid = document.getElementById("recommend-movies");
  const animeGrid = document.getElementById("recommend-anime");
  if (!showsGrid || !moviesGrid || !animeGrid) return;
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  const shows = data.shows || [];
  const movies = data.movies || [];
  const animes = data.anime || [];
  const hasContent = { shows: shows.length, movies: movies.length, anime: animes.length };

  ["recommend-shows-wrap", "recommend-movies-wrap", "recommend-anime-wrap"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasContent[id.replace("recommend-", "").replace("-wrap", "")] ? "" : "none";
  });
  empty.style.display = shows.length || movies.length || animes.length ? "none" : "block";

  const order = loadSectionOrder("recommend").filter((s) => hasContent[s]);
  ["shows", "movies", "anime"].forEach((s) => {
    if (hasContent[s] && !order.includes(s)) order.push(s);
  });
  order.forEach((s) => {
    const wrap = document.getElementById(`recommend-${s}-wrap`);
    if (wrap) view.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-recommend");

  renderRecCards(shows, showsGrid, false, "shows");
  renderRecCards(movies, moviesGrid, false, "movies");
  renderRecCards(animes, animeGrid, true, "anime");
}

function recHideBtnHTML(item) {
  return `<button class="hide-btn" data-tip="${t("rec_hide")}"><i class="fa-solid fa-ban"></i></button>`;
}

function recMoveBtnHTML(item) {
  return item.can_move_watched
    ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>`
    : "";
}

function addRecPlaceholder(grid) {
  if (!grid) return null;
  const ph = document.createElement("div");
  ph.className = "rec-placeholder";
  ph.innerHTML = `<div class="ph-box"><span class="ph-spin"></span></div>`;
  grid.appendChild(ph);
  // Çerçeveyi komşu kartın tam yüksekliğine eşitle -> spinner tüm kart çerçevesine ortalanır
  const ref = grid.querySelector(".card");
  if (ref && ref.offsetHeight > 0) {
    ph.classList.add("height-synced");
    ph.style.height = ref.offsetHeight + "px";
  }
  return ph;
}

function clearRecPlaceholders(grid) {
  if (!grid) return;
  grid.querySelectorAll(".rec-placeholder").forEach((p) => p.remove());
}

function recOptimistic(div, section, reqFn, okMsg) {
  const parent = div.parentNode;
  const next = div.nextSibling;
  div.remove();
  addRecPlaceholder(parent);
  if (okMsg) toast(okMsg);
  reqFn()
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        refillRecSection(section);
      } else {
        toast(j.error || t("error"));
        clearRecPlaceholders(parent);
        if (parent) next ? parent.insertBefore(div, next) : parent.appendChild(div);
      }
    })
    .catch(() => {
      toast(t("error"));
      clearRecPlaceholders(parent);
      if (parent) next ? parent.insertBefore(div, next) : parent.appendChild(div);
    });
}

function recHideHandler(div, item) {
  const body = item.anilist_id
    ? { anilist_id: item.anilist_id, title: item.title, poster_path: item.cover_url }
    : { tmdb_id: item.tmdb_id, media_type: item.media_type, title: item.title, poster_path: item.poster_path };
  return fetch("/api/recommendations/hide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function renderRecCards(items, grid, isAnime, section, anchor) {
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
        try{ setTvCardAttrs(div, item); }catch{}
    div.dataset.rid = item.tmdb_id || item.anilist_id;
    const moveBtn = recMoveBtnHTML(item);
    if (isAnime) {
      div.innerHTML = `
        ${animePosterHTML(item.cover_url, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            <span class="badge badge-anime">${t("tab_anime")}</span>
            ${item.score ? scoreTag(item.score / 10) : ""}
          </div>
        </div>
        ${moveBtn}
        ${recHideBtnHTML(item)}
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
      div.querySelector(".remove").onclick = (e) => {
        e.stopPropagation();
        recOptimistic(div, section,
          () => fetch("/api/anime/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ anilist_id: item.anilist_id }),
          }),
          t("added", { name: item.title })
        );
      };
      const mvBtn = div.querySelector(".move-btn");
      if (mvBtn) {
        mvBtn.onclick = (e) => {
          e.stopPropagation();
          recOptimistic(div, section,
            () => fetch("/api/recommendations/move-watched", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anilist_id: item.anilist_id }),
            }),
            t("moved_to_watched", { name: item.title })
          );
        };
      }
      const hideBtn = div.querySelector(".hide-btn");
      if (hideBtn) {
        hideBtn.onclick = (e) => {
          e.stopPropagation();
          recOptimistic(div, section,
            () => recHideHandler(div, item),
            t("rec_hidden_toast", { name: item.title })
          );
        };
      }
      div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title);
    } else {
      div.innerHTML = `
        ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            <span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>
            ${scoreTag(item.vote_average)}
            ${platformTag(item.networks)}
          </div>
        </div>
        ${moveBtn}
        ${recHideBtnHTML(item)}
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
      div.querySelector(".remove").onclick = (e) => {
        e.stopPropagation();
        recOptimistic(div, section,
          () => fetch("/api/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tmdb_id: item.tmdb_id,
              media_type: item.media_type,
              title: item.title,
              poster_path: item.poster_path,
            }),
          }),
          t("added", { name: item.title })
        );
      };
      const mvBtn = div.querySelector(".move-btn");
      if (mvBtn) {
        mvBtn.onclick = (e) => {
          e.stopPropagation();
          recOptimistic(div, section,
            () => fetch("/api/recommendations/move-watched", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                media_type: item.media_type,
                tmdb_id: item.tmdb_id,
                title: item.title,
                poster_path: item.poster_path,
              }),
            }),
            t("moved_to_watched", { name: item.title })
          );
        };
      }
      const hideBtn = div.querySelector(".hide-btn");
      if (hideBtn) {
        hideBtn.onclick = (e) => {
          e.stopPropagation();
          recOptimistic(div, section,
            () => recHideHandler(div, item),
            t("rec_hidden_toast", { name: item.title })
          );
        };
      }
      div.onclick = () => openDetails(item.media_type, item.tmdb_id, item.title);
    }
    if (anchor) grid.insertBefore(div, anchor);
    else grid.appendChild(div);
    applyTitleHint(div);
  });
}

function currentRecIds(section) {
  const grid = document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
  if (!grid) return [];
  return Array.from(grid.querySelectorAll(".card"))
    .map((c) => c.dataset.rid)
    .filter(Boolean);
}

const refillRunning = {};
const refillQueued = {};

async function fillOnce(section) {
  const media = { shows: "dizi", movies: "film", anime: "anime" }[section] || "";
  const grid = document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
  const shown = currentRecIds(section);
  const needed = 18 - shown.length;
  if (needed <= 0 || !grid) return;
  const url = `/api/recommendations?media=${media}&exclude=${shown.join(",")}&limit=${needed}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("http " + res.status);
      const data = await res.json();
      const items = data.shows || data.movies || data.anime || [];
      // Duplo koruması: paralel isteklerde grid'de zaten olan kartları at
      const have = new Set(currentRecIds(section).map(String));
      const fresh = items.filter((it) => !have.has(String(it.tmdb_id || it.anilist_id)));
      if (!fresh.length) {
        clearRecPlaceholders(grid);
        return;
      }
      // Birebir değişim: gelen her kart bir placeholder'ı kaldırır;
      // kalan placeholder'lar (bekleyen gizlemeler) animasyonla yerinde kalır.
      const phs = Array.from(grid.querySelectorAll(".rec-placeholder"));
      const removeCount = Math.min(fresh.length, phs.length);
      for (let i = 0; i < removeCount; i++) phs[i].remove();
      renderRecCards(fresh, grid, section === "anime", section, phs[removeCount] || null);
      return;
    } catch (e) {
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  clearRecPlaceholders(grid);
}

async function refillRecSection(section) {
  if (refillRunning[section]) {
    refillQueued[section] = true;
    return;
  }
  refillRunning[section] = true;
  try {
    do {
      refillQueued[section] = false;
      await fillOnce(section);
    } while (refillQueued[section]);
  } finally {
    refillRunning[section] = false;
  }
}

document.addEventListener("click", (e) => {
  const rb = e.target.closest(".section-refresh");
  if (rb && !rb.classList.contains("loading")) {
    const section = rb.dataset.section;
    const media = { shows: "dizi", movies: "film", anime: "anime" }[section] || "";
    const grid = document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
    const toastKey = { shows: "recommend_refreshed_shows", movies: "recommend_refreshed_movies", anime: "recommend_refreshed_anime" }[section] || "recommend_refreshed_shows";
    rb.classList.add("loading");
    fetch(`/api/recommendations?media=${media}&refresh=1`)
      .then((res) => res.json())
      .then((data) => {
        const items = data.shows || data.movies || data.anime || [];
        if (grid) {
          grid.innerHTML = "";
          renderRecCards(items, grid, section === "anime", section);
        }
        toast(t(toastKey));
      })
      .catch(() => toast(t("error")))
      .finally(() => rb.classList.remove("loading"));
    return;
  }
  const sh = e.target.closest(".section-hide");
  if (sh) openHiddenModal(sh.dataset.section);
});

function hiddenPosterSrc(poster) {
  if (!poster) return "";
  return poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w185${poster}`;
}

let hiddenItemsCache = [];

async function openHiddenModal(section) {
  const modal = document.getElementById("hidden-modal");
  const listEl = document.getElementById("hidden-list");
  const input = document.getElementById("hidden-search-input");
  if (!modal || !listEl) return;
  modal.dataset.section = section;
  hiddenItemsCache = [];
  if (input) {
    input.value = "";
    input.classList.remove("open");
    input.style.display = "none";
  }
  const sBtn = document.getElementById("hidden-search-btn");
  if (sBtn) sBtn.classList.remove("active");
  listEl.innerHTML = `<div class="hidden-loading muted">${t("loading")}</div>`;
  modal.style.display = "flex";
  const media = { shows: "dizi", movies: "film", anime: "anime" }[section] || "";
  try {
    const res = await fetch(`/api/recommendations/hidden?media=${encodeURIComponent(media)}`);
    const data = await res.json();
    hiddenItemsCache = (data && data.items) || [];
    renderHiddenList(hiddenItemsCache, currentHiddenFilter());
  } catch (err) {
    listEl.innerHTML = "";
  }
}

function currentHiddenFilter() {
  const input = document.getElementById("hidden-search-input");
  return (input && input.style.display === "block" ? (input.value || "").trim().toLowerCase() : "");
}

function renderHiddenList(items, filter) {
  const modal = document.getElementById("hidden-modal");
  const listEl = document.getElementById("hidden-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  items.forEach((h) => {
    if (filter && !(h.title || "").toLowerCase().includes(filter)) return;
    const tile = document.createElement("div");
    tile.className = "hidden-tile";
    const src = hiddenPosterSrc(h.poster);
    tile.innerHTML = `
      ${src ? `<img class="hidden-poster" src="${src}" alt="" loading="lazy" />` : `<span class="hidden-poster hidden-poster-empty"></span>`}
      <button class="hidden-restore" data-tip="${t("hidden_unhide")}"><i class="fa-solid fa-ban"></i></button>
      <div class="hidden-name" title="${h.title || "#" + h.id}">${h.title || "#" + h.id}</div>
    `;
    tile.querySelector(".hidden-restore").onclick = async () => {
      try {
        const res = await fetch("/api/recommendations/unhide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: modal ? modal.dataset.section : "", id: h.id }),
        });
        if (!res.ok) throw new Error("http " + res.status);
        tile.remove();
        if (!listEl.querySelector(".hidden-tile")) {
          modal.style.display = "none";
        }
      } catch (err) {
        toast(t("error"));
      }
    };
    listEl.appendChild(tile);
  });
}

function wireHiddenSearch() {
  const btn = document.getElementById("hidden-search-btn");
  const input = document.getElementById("hidden-search-input");
  if (!btn || !input) return;
  btn.onclick = () => {
    const open = input.style.display === "block";
    if (open) {
      input.value = "";
      input.style.display = "none";
      input.classList.remove("open");
      btn.classList.remove("active");
      renderHiddenList(hiddenItemsCache, "");
    } else {
      input.style.display = "block";
      input.classList.add("open");
      btn.classList.add("active");
      input.focus();
    }
  };
  input.addEventListener("input", () => renderHiddenList(hiddenItemsCache, currentHiddenFilter()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") btn.click();
  });
}

(function wireHiddenModal() {
  const modal = document.getElementById("hidden-modal");
  if (!modal) return;
  const close = () => { modal.style.display = "none"; };
  const btn = document.getElementById("hidden-close");
  if (btn) btn.onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  wireHiddenSearch();
})();

function loadSectionOrder(prefix) {
  const key = prefix + "SectionOrder";
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return [...DEFAULT_ORDER];
}

function saveSectionOrder(prefix, order) {
  const key = prefix + "SectionOrder";
  try {
    localStorage.setItem(key, JSON.stringify(order));
  } catch (e) {}
}

function updateMoveButtons(viewId) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const visible = [];
  view.querySelectorAll("[id$='-wrap']").forEach((w) => {
    if (w.style.display !== "none") visible.push(w);
  });
  visible.forEach((w, idx) => {
    const up = w.querySelector(".section-move-up");
    const down = w.querySelector(".section-move-down");
    if (up) up.disabled = idx === 0;
    if (down) down.disabled = idx === visible.length - 1;
  });
}

function moveSection(section, dir, prefix, viewId, emptyId) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const wrap = document.getElementById(`${prefix}-${section}-wrap`);
  if (!wrap || wrap.style.display === "none") return;
  const visible = [];
  view.querySelectorAll("[id$='-wrap']").forEach((w) => {
    if (w.style.display !== "none") visible.push(w);
  });
  const idx = visible.indexOf(wrap);
  if (idx < 0) return;
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= visible.length) return;
  const empty = document.getElementById(emptyId);
  // Preserve focus on the clicked button across DOM move (TV D-pad)
  const ae = document.activeElement;
  const aeBtn = ae && ae.closest && (ae.closest('.section-move-up')||ae.closest('.section-move-down')||ae.closest('.section-refresh')||ae.closest('.section-hide'));
  const aeIsHeader = !!(aeBtn && aeBtn.closest && aeBtn.closest('.unwatched-section-title'));
  if (dir === "up") {
    view.insertBefore(wrap, visible[target]);
  } else {
    if (visible[target].nextSibling && visible[target].nextSibling !== empty) {
      view.insertBefore(wrap, visible[target].nextSibling);
    } else {
      view.insertBefore(wrap, empty);
    }
  }
  const order = visible.map((w) => w.id.replace(`${prefix}-`, "").replace("-wrap", ""));
  const targetId = order[idx];
  const newId = order[target];
  order[idx] = newId;
  order[target] = targetId;
  saveSectionOrder(prefix, order);
  updateMoveButtons(viewId);
  try{ if(aeIsHeader && aeBtn && document.contains(aeBtn)) aeBtn.focus(); }catch(_){}
}

document.addEventListener("click", (e) => {
  const up = e.target.closest(".section-move-up");
  if (up && !up.disabled) {
    moveSection(up.dataset.section, "up", up.dataset.prefix, up.dataset.view, up.dataset.empty);
    return;
  }
  const down = e.target.closest(".section-move-down");
  if (down && !down.disabled) {
    moveSection(down.dataset.section, "down", down.dataset.prefix, down.dataset.view, down.dataset.empty);
  }
});

export { switchView, loadFollowed, loadAnime, loadUnwatched, loadWatched, animeNextText, animeStatusLabel, tvStatusLabel, applySort, updateSortMenu, views, tabs, sortMenu, activateUtilityTab, closeSortMenu };