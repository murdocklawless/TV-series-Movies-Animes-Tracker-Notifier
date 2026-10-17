// Faz 4: views — görünüm (tab) yönetimi, sıralama ve ana liste yükleyicileri (takip edilenler / anime / izlenmemiş).
import { state } from "./state.js";
import { t } from "./i18n.js?v=528";
import {
  posterHTML, animePosterHTML, scoreTag, platformTag, typeLabel, applyTitleHint, cardRows,
  CARD_SLOT, formatDate, shortDate, shortDateShort, isMobile, daysUntil, daysHint,
  dateState, isReleaseToday, todayInTzStr, dayStrInTz, FILM_SVG, CALENDAR_SVG, CHECK_SVG, INFO_SVG, ARROW_DOWN_SVG, ARROW_UP_SVG, toast, tzLocale,
  parseGenres, isDocItem,
} from "./utils.js?v=521";
import { openDetails, openReleases, openAnimeDetails, openAnimeSchedule, openTvUnfollowConfirm, openAnimeUnfollowConfirm, openUnwatchedModal } from "./components.js?v=532";
import { renderChips, closeResultsModal, setMedia } from "./search.js?v=528";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function setTvCardAttrs(div, item) {
  try { if (!isTvUIActive()) return; div.tabIndex = 0; div.setAttribute('role','button'); if(item.title) div.setAttribute('aria-label', item.title); if(item.tmdb_id) div.dataset.tmdbId = item.tmdb_id; if(item.anilist_id) div.dataset.anilistId = item.anilist_id; if(item.media_type) div.dataset.mediaType = item.media_type; if(item.id) div.dataset.dbId = item.id; if(item.isAnime) div.dataset.isAnime = '1'; div.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }}); const cal = div.querySelector('.calendar-btn'); if(cal){ cal.tabIndex=0; cal.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); cal.click(); }}); } const rem = div.querySelector('.remove'); if(rem){ rem.tabIndex=0; rem.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); rem.click(); }}); } const mv = div.querySelector('.move-btn,.move-back-btn'); if(mv){ mv.tabIndex=0; mv.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); mv.click(); }}); } const arb = div.querySelector('.archive-btn,.unarchive-btn'); if(arb){ arb.tabIndex=0; arb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); arb.click(); }}); } const hb = div.querySelector('.hide-btn'); if(hb){ hb.tabIndex=0; hb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); hb.click(); }}); } const ib = div.querySelector('.info-btn'); const dfb = div.querySelector('.defer-btn'); if(dfb){ dfb.tabIndex=0; dfb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); dfb.click(); }}); } if(ib){ ib.tabIndex=0; ib.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); ib.click(); }}); } if(hb){ hb.tabIndex=0; hb.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); e.stopPropagation(); hb.click(); }}); } } catch {}
}


const views = {
  dizi: document.getElementById("view-dizi"),
  film: document.getElementById("view-film"),
  belgesel: document.getElementById("view-belgesel"),
  anime: document.getElementById("view-anime"),
  unwatched: document.getElementById("view-unwatched"),
  watched: document.getElementById("view-watched"),
  archive: document.getElementById("view-archive"),
  recommend: document.getElementById("view-recommend"),
  search: document.getElementById("view-search"),
};

const tabs = {
  dizi: document.getElementById("tab-dizi"),
  film: document.getElementById("tab-film"),
  belgesel: document.getElementById("tab-belgesel"),
  anime: document.getElementById("tab-anime"),
  unwatched: document.getElementById("tab-unwatched"),
  watched: document.getElementById("tab-watched"),
  archive: document.getElementById("tab-archive"),
  recommend: document.getElementById("tab-recommend"),
  search: document.getElementById("tab-search"),
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
  if (name === "belgesel") loadBelgesel();
  if (name === "anime") loadAnime();
  if (name === "unwatched") loadUnwatched();
  if (name === "watched") loadWatched();
  if (name === "archive") loadArchive();
  if (name === "recommend") loadRecommendations();
}

tabs.dizi.onclick = () => switchView("dizi");
tabs.film.onclick = () => switchView("film");
if (tabs.belgesel) tabs.belgesel.onclick = () => switchView("belgesel");
tabs.anime.onclick = () => switchView("anime");
tabs.unwatched.onclick = () => switchView("unwatched");
tabs.watched.onclick = () => switchView("watched");
if (tabs.archive) tabs.archive.onclick = () => switchView("archive");
tabs.recommend.onclick = () => switchView("recommend");
tabs.search.onclick = () => {
  switchView("search");
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) {
      setMedia("dizi");
      setTimeout(() => { try { const m = document.getElementById("media-dizi"); if (m) m.focus(); } catch(_){} }, 60);
    }
  } catch(_){}
};
document.getElementById("search-close").onclick = () => {
  switchView(prevView);
  // TV: X ile kapatınca odak yetim kalmasın; Geri tuşuyla aynı: #tab-search'te kal.
  try {
    if (isTvUIActive()) {
      const sb = document.getElementById("tab-search");
      if (sb && !sb.disabled) sb.focus();
    }
  } catch (_) {}
};

// 1.83 Arsiv: medya sekmesi basliklarindaki "Arsivlenenleri goster" anahtari.
(function initArchivedToggles() {
  document.querySelectorAll(".section-archived-toggle").forEach((btn) => {
    const view = btn.dataset.view;
    if (!view) return;
    const on = archivedVisible(view);
    // Baslangicta gizli: updateArchiveUi arsivli varsa acar (yanip sonme olmaz).
    btn.style.display = "none";
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.onclick = (e) => {
      e.stopPropagation();
      const next = !archivedVisible(view);
      setArchivedVisible(view, next);
      if (view === "dizi" || view === "film") loadFollowed(view);
      else if (view === "belgesel") loadBelgesel();
      else if (view === "anime") loadAnime();
    };
  });
})();

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
    const today = todayInTzStr();
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

// Daha-sonra-izle (defer): kart en alta iner, sort'tan muaf, kendi arasında A-Z.
function isDeferred(item) {
  try { return Number(item.deferred || 0) === 1; } catch (_) { return false; }
}
function deferAlpha(a, b) {
  try {
    return String(a.title || "").localeCompare(String(b.title || ""), "tr", { sensitivity: "base" });
  } catch (_) {
    const at = String(a.title || "").toLocaleLowerCase(), bt = String(b.title || "").toLocaleLowerCase();
    return at < bt ? -1 : at > bt ? 1 : 0;
  }
}
function applySortDeferred(items) {
  const normal = applySort(items.filter((i) => !isDeferred(i)));
  const late = items.filter((i) => isDeferred(i)).sort(deferAlpha);
  return normal.concat(late);
}
function deferBtnHTML(item) {
  const d = isDeferred(item);
  return `<button class="defer-btn${d ? " active" : ""}" data-tip="${t(d ? "resume_tracking" : "watch_later")}">${d ? ARROW_UP_SVG : ARROW_DOWN_SVG}</button>`;
}
async function toggleDefer(item, isAnime, reload) {
  const url = isAnime ? "/api/anime/defer" : "/api/followed/defer";
  const body = isAnime
    ? { anime_id: item.id, deferred: isDeferred(item) ? 0 : 1 }
    : { tmdb_id: item.tmdb_id, media_type: item.media_type, deferred: isDeferred(item) ? 0 : 1 };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      let j = {};
      try { j = await r.json(); } catch (_) {}
      toast(j.error || t("error"));
      return;
    }
  } catch (_) { toast(t("error")); return; }
  try { reload(); } catch (_) {}
}

function activateUtilityTab(btn) {
  document.querySelectorAll(".utils-tabs-group .tab.active").forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
}

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
  let startedSeason = false;
  try {
    const sl = JSON.parse(item.season_list || "[]");
    const today = todayInTzStr();
    season = sl
      .filter((s) => s.season_number && s.air_date && s.air_date >= today)
      .sort((a, b) => (a.air_date || "").localeCompare(b.air_date || ""))[0];
    startedSeason = sl.some((s) => s.air_date && s.air_date <= today);
  } catch (e) {
    season = null;
    startedSeason = false;
  }
  if (season) return `<div class="next-ep muted">${t("tv_next_season", { date: shortDate(season.air_date) })}</div>`;
  if (status === "In Production") return `<div class="next-ep muted">${t("tv_status_production")}</div>`;
  if (status === "Planned") return `<div class="next-ep muted">${t("tv_status_planned")}</div>`;
  if (status === "Pilot") return `<div class="next-ep muted">${t("tv_status_pilot")}</div>`;
  if (status === "Returning Series") {
    // Gelecek sezon bilgisi yoksa: son sezon başladı mı?
    if (startedSeason) {
      // "Yeni bölüm" (sezon sürüyor) vs "Yeni sezon" (sezon bitmiş):
      // son yayın üzerinden geçen süre, sezonun kendi bölüm aralığının
      // ~2.5 katını aştıysa sezon bitmiş demektir.
      const last = (item && item.last_air_date) || "";
      if (last) {
        const gapD = Number((item && item.ep_gap_days) || 7) || 7;
        let daysSince = NaN;
        try {
          const nowD = new Date();
          const lastD = new Date(last + "T00:00:00");
          daysSince = Math.floor((nowD - lastD) / 86400000);
        } catch (_) {}
        if (!isNaN(daysSince) && daysSince > gapD * 2.5) {
          return `<div class="next-ep muted">${t("tv_status_returning")}</div>`;
        }
      }
      return `<div class="next-ep muted">${t("tv_status_new_episode")}</div>`;
    }
    return `<div class="next-ep muted">${t("tv_status_returning")}</div>`;
  }
  return `<div class="next-ep muted">${t("new_season")}</div>`;
}

// Takip kartı statü satırı (dizi + film ortak): sıradaki bölüm / durum / vizyon tarihi.
function followedStatusHTML(item) {
  if (item.media_type === "tv") {
    if (!item.next_episode) return tvStatusText(item);
    if (isReleaseToday({ date: item.next_episode.air_date }))
      return `<div class="next-ep today">S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")} ${t("today_airing")}</div>`;
    return `<div class="next-ep">S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")} · ${isMobile() ? shortDateShort(item.next_episode.air_date) : shortDate(item.next_episode.air_date)} · <span class="next-ep-days" data-tip="${daysHint(item.next_episode.air_date)}">${daysUntil(item.next_episode.air_date)}</span></div>`;
  }
  if (item.release_date) {
    if (dateState(item.release_date) === "date-past") return `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`;
    if (isReleaseToday({ date: item.release_date })) return `<div class="next-ep today">${formatDate(item.release_date).text} ${t("today_theaters")}</div>`;
    return `<div class="next-ep">${formatDate(item.release_date).text} · <span class="next-ep-days" data-tip="${daysHint(item.release_date)}">${daysUntil(item.release_date)}</span></div>`;
  }
  return `<div>${t("date_unknown")}</div>`;
}

// Orta satır: dizi/belgesel-TV → sezon + bölüm rozetleri (çoklu bölüm verisi varsa; yoksa boş).
// Mobil: yalnızca İKİSİ de varsa kısalt ("{n} Sez"/"{n} Böl"); tek biri varsa tam yaz.
function seasonEpMid(item) {
  if (item.media_type !== "tv") return "";
  const hasS = !!item.number_of_seasons;
  const hasE = !!item.number_of_episodes;
  const short = (isMobile() && hasS && hasE) || isTvUIActive();
  const s = hasS ? `<span class="season-count-badge">${t(short ? "seasons_short" : "seasons", { n: item.number_of_seasons })}</span>` : "";
  const e = hasE ? `<span class="episode-count">${t(short ? "episodes_short" : "episodes", { n: item.number_of_episodes })}</span>` : "";
  return s + e;
}

// Orta satır: anime → "{n} Bölüm" (bölüm sayısı varsa; yoksa boş).
function animeEpMid(item) {
  const n = item.episodes || item.number_of_episodes;
  if (!n) return "";
  if (isTvUIActive()) return `<span class="episode-count">${t("episodes_short", { n })}</span>`;
  return `<span class="episode-count">${n} ${t("col_episode")}</span>`;
}

async function loadFollowed(view) {
  const __run = __runToken("followed:" + view);
  if (view === "dizi") {
    try { await loadNextUp(); } catch (_) {}
  }
  const showArchived = archivedVisible(view);
  const res = await fetch("/api/followed");
  let items = await res.json();
  // Oturumsuz 401 gövdesi ({error}) sessizce yutulur — çökme yok.
  if (!Array.isArray(items)) return;
  // Arsivli liste HER ZAMAN cekilir (anahtar + Arşiv sekmesi gorunurlugu icin);
  // gosterime yalniz showArchived acikken katilir.
  try {
    const ares = await fetch("/api/followed?archived=1");
    const aitems = await ares.json();
    if (Array.isArray(aitems)) {
      archiveState.followed = aitems;
      if (showArchived) items = dedupeMerged(items.concat(aitems));
    }
  } catch (_) {}
  try { await ensureArchiveState(); } catch (_) {}
  try { updateArchiveUi(); } catch (_) {}
  const isTv = view === "dizi";
  const cardKind = isTv ? "shows" : "movies";
  items = items.filter((i) => (isTv ? i.media_type === "tv" : i.media_type === "movie") && (!(i.in_watched == 1) || i.archived == 1) && !isDocItem(i));
  items = applySortDeferred(items);
  const grid = document.getElementById(isTv ? "poster-grid-shows" : "poster-grid-movies");
  const empty = document.getElementById(isTv ? "empty-dizi" : "empty-film");
  // Takip görünümleri: normal kartlar üst gridde, sonra-izlenecek kartlar alt gridde (kendi başlığıyla).
  const secMain = isTv ? "dizi" : "film";
  const secLater = isTv ? "dizi-later" : "film-later";
  const gridIdLater = isTv ? "poster-grid-shows-later" : "poster-grid-movies-later";
  const wrapIdMain = isTv ? "dizi-shows-wrap" : "film-movies-wrap";
  const wrapIdLater = isTv ? "dizi-later-wrap" : "film-later-wrap";
  const laterGrid = document.getElementById(gridIdLater);
  const showsWrap = document.getElementById(wrapIdMain);
  const laterWrap = document.getElementById(wrapIdLater);
  if (!__runCurrent("followed:" + view, __run)) return;
  grid.innerHTML = "";
  if (laterGrid) laterGrid.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item) => {
    const div = document.createElement("div");
    const todayNow =
      (item.media_type === "tv" && item.next_episode && isReleaseToday({ date: item.next_episode.air_date })) ||
      (item.media_type === "movie" && isReleaseToday({ date: item.release_date }));
    div.className = todayNow ? "card today-release-card" : "card";
    setTvCardAttrs(div, item);
    setFollowSortAttrs(div, item);
    const isArchived = item.archived == 1;
    if (isArchived) div.classList.add("is-archived");
    const isMovieWatched = item.media_type === "movie" && item.watched == 1;
    const isTvCompleted = item.media_type === "tv" && item.completed;
    const showBadge = isMovieWatched || isTvCompleted;
    const showMoveBtn = showBadge || !!item.can_move_watched;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, showBadge, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: item.media_type === "movie" ? followedStatusHTML(item) : seasonEpMid(item),
            status: item.media_type === "movie" ? "" : followedStatusHTML(item),
          })}
          ${isArchived ? archivedBadgeHTML() : ""}
          ${item.notified ? `<div style="color:#6ee7a0">${t("notified")}</div>` : ""}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        ${showMoveBtn ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>` : ""}
        ${isArchived
          ? `<button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>`
          : `<button class="archive-btn" data-tip="${t("archive")}"><i class="fa-solid fa-box-archive"></i></button>`}
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openTvUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadFollowed(view);
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases(item.media_type, item.tmdb_id, item.title);
    };
    const archBtn = div.querySelector(".archive-btn");
    if (archBtn) archBtn.onclick = (e) => { e.stopPropagation(); archiveFollowedItem(item, () => loadFollowed(view)); };
    const unarchBtn = div.querySelector(".unarchive-btn");
    if (unarchBtn) unarchBtn.onclick = (e) => { e.stopPropagation(); unarchiveFollowedItem(item, () => loadFollowed(view)); };
    const infoBtn = div.querySelector(".info-btn");
    if(infoBtn) infoBtn.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title); };
    const moveBtn = div.querySelector(".move-btn");
    if (moveBtn) {
      moveBtn.onclick = (e) => {
        e.stopPropagation();
        optimisticMoveCard(
          div,
          () => fetch("/api/followed/move-watched", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tmdb_id: item.tmdb_id,
              media_type: item.media_type,
              watched: 1,
            }),
          }),
          t("moved_to_watched", { name: item.title }),
          isDeferred(item) ? secLater : secMain
        );
      };
    }
    div.onclick = () => {
      openDetails(item.media_type, item.tmdb_id, item.title);
    };
    if (isDeferred(item)) div.classList.add("is-deferred");
    const _pw = div.querySelector(".poster-wrap");
    if (_pw) {
      _pw.insertAdjacentHTML("beforeend", deferBtnHTML(item));
      const _df = _pw.querySelector(".defer-btn");
      if (_df) _df.onclick = (e) => { e.stopPropagation(); toggleDefer(item, false, () => loadFollowed(view)); };
    }
    tagCardStats(div, item, cardKind, item.runtime);
    if (laterGrid && isDeferred(item)) laterGrid.appendChild(div);
    else grid.appendChild(div);
    applyTitleHint(div);
  });
  if (laterWrap || showsWrap) {
    let hasNormal = false, hasLate = false;
    try {
      hasNormal = items.some((i) => !isDeferred(i));
      hasLate = items.some((i) => isDeferred(i));
    } catch (_) {}
    if (showsWrap) showsWrap.style.display = (!items.length || hasNormal) ? "" : "none";
    if (laterWrap) laterWrap.style.display = hasLate ? "" : "none";
    try { applyFollowSectionState(secMain); } catch (_) {}
    try { applyFollowSectionState(secLater); } catch (_) {}
    try { closeFollowSortMenus(); } catch (_) {}
    try { updateFollowSectionControls(secMain); } catch (_) {}
    try { updateFollowSectionControls(secLater); } catch (_) {}
  }
  renderSectionSummary(grid);
  if (laterGrid) renderSectionSummary(laterGrid);
  try { updateMoveButtons("view-dizi"); } catch (_) {}
  notifyListsRefreshed();
}

function docBadge() {
  return `<span class="badge badge-belgesel">${t("type_doc")}</span>`;
}

async function loadBelgesel() {
  const __run = __runToken("belgesel");
  try { await loadNextUp(); } catch (_) {}
  const showArchived = archivedVisible("belgesel");
  const res = await fetch("/api/followed");
  let items = await res.json();
  if (!Array.isArray(items)) return;
  if (showArchived) {
    try {
      const ares = await fetch("/api/followed?archived=1");
      const aitems = await ares.json();
      if (Array.isArray(aitems)) items = dedupeMerged(items.concat(aitems));
    } catch (_) {}
  }
  try { await ensureArchiveState(); } catch (_) {}
  try { updateArchiveUi(); } catch (_) {}
  items = items.filter((i) => !i.isAnime && isDocItem(i) && (!(i.in_watched == 1) || i.archived == 1));
  items = applySortDeferred(items);
  const grid = document.getElementById("poster-grid-docs");
  const empty = document.getElementById("empty-belgesel");
  if (!grid || !empty) return;
  const laterGridDoc = document.getElementById("poster-grid-docs-later");
  const docsWrap = document.getElementById("belgesel-docs-wrap");
  const laterWrapDoc = document.getElementById("belgesel-later-wrap");
  if (!__runCurrent("belgesel", __run)) return;
  grid.innerHTML = "";
  if (laterGridDoc) laterGridDoc.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item) => {
    const div = document.createElement("div");
    const todayNow =
      (item.media_type === "tv" && item.next_episode && isReleaseToday({ date: item.next_episode.air_date })) ||
      (item.media_type === "movie" && isReleaseToday({ date: item.release_date }));
    div.className = todayNow ? "card today-release-card" : "card";
    setTvCardAttrs(div, item);
    setFollowSortAttrs(div, item);
    const isArchived = item.archived == 1;
    if (isArchived) div.classList.add("is-archived");
    const isMovieWatched = item.media_type === "movie" && item.watched == 1;
    const isTvCompleted = item.media_type === "tv" && item.completed;
    const showBadge = isMovieWatched || isTvCompleted;
    const showMoveBtn = showBadge || !!item.can_move_watched;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, showBadge, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: docBadge(),
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: item.media_type === "movie" ? followedStatusHTML(item) : seasonEpMid(item),
            status: item.media_type === "movie" ? CARD_SLOT.status : followedStatusHTML(item),
          })}
          ${isArchived ? archivedBadgeHTML() : ""}
          ${item.notified ? `<div style="color:#6ee7a0">${t("notified")}</div>` : ""}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        ${showMoveBtn ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>` : ""}
        ${isArchived
          ? `<button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>`
          : `<button class="archive-btn" data-tip="${t("archive")}"><i class="fa-solid fa-box-archive"></i></button>`}
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openTvUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadBelgesel();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases(item.media_type, item.tmdb_id, item.title);
    };
    const archBtn = div.querySelector(".archive-btn");
    if (archBtn) archBtn.onclick = (e) => { e.stopPropagation(); archiveFollowedItem(item, loadBelgesel); };
    const unarchBtn = div.querySelector(".unarchive-btn");
    if (unarchBtn) unarchBtn.onclick = (e) => { e.stopPropagation(); unarchiveFollowedItem(item, loadBelgesel); };
    const infoBtn = div.querySelector(".info-btn");
    if (infoBtn) infoBtn.onclick = (e) => { e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title); };
    const moveBtn = div.querySelector(".move-btn");
    if (moveBtn) {
      moveBtn.onclick = (e) => {
        e.stopPropagation();
        optimisticMoveCard(
          div,
          () => fetch("/api/followed/move-watched", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tmdb_id: item.tmdb_id,
              media_type: item.media_type,
              watched: 1,
            }),
          }),
          t("moved_to_watched", { name: item.title }),
          isDeferred(item) ? "belgesel-later" : "belgesel"
        );
      };
    }
    div.onclick = () => {
      openDetails(item.media_type, item.tmdb_id, item.title);
    };
    if (isDeferred(item)) div.classList.add("is-deferred");
    const _pwDoc = div.querySelector(".poster-wrap");
    if (_pwDoc) {
      _pwDoc.insertAdjacentHTML("beforeend", deferBtnHTML(item));
      const _dfDoc = _pwDoc.querySelector(".defer-btn");
      if (_dfDoc) _dfDoc.onclick = (e) => { e.stopPropagation(); toggleDefer(item, false, loadBelgesel); };
    }
    tagCardStats(div, item, "docs", item.runtime);
    if (laterGridDoc && isDeferred(item)) laterGridDoc.appendChild(div);
    else grid.appendChild(div);
    applyTitleHint(div);
  });
  if (laterWrapDoc || docsWrap) {
    let hasNormalDoc = false, hasLateDoc = false;
    try {
      hasNormalDoc = items.some((i) => !isDeferred(i));
      hasLateDoc = items.some((i) => isDeferred(i));
    } catch (_) {}
    if (docsWrap) docsWrap.style.display = (!items.length || hasNormalDoc) ? "" : "none";
    if (laterWrapDoc) laterWrapDoc.style.display = hasLateDoc ? "" : "none";
    try { applyFollowSectionState("belgesel"); } catch (_) {}
    try { applyFollowSectionState("belgesel-later"); } catch (_) {}
    try { closeFollowSortMenus(); } catch (_) {}
    try { updateFollowSectionControls("belgesel"); } catch (_) {}
    try { updateFollowSectionControls("belgesel-later"); } catch (_) {}
  }
  renderSectionSummary(grid);
  if (laterGridDoc) renderSectionSummary(laterGridDoc);
  try { updateMoveButtons("view-belgesel"); } catch (_) {}
  notifyListsRefreshed();
}

function animeNextText(next, status) {
  if (!next || next.airing_at == null || isNaN(new Date(next.airing_at * 1000).getTime())) {
    if (status === "FINISHED") return `<div class="next-ep muted">${t("anime_status_finished")}</div>`;
    if (status === "CANCELLED") return `<div class="next-ep muted">${t("anime_status_cancelled")}</div>`;
    if (status === "HIATUS") return `<div class="next-ep muted">${t("anime_status_hiatus")}</div>`;
    if (status === "NOT_YET_RELEASED") return `<div class="next-ep muted">${t("anime_status_upcoming")}</div>`;
    if (status === "RELEASING") return `<div class="next-ep muted">${t("anime_status_releasing")}</div>`;
    return "";
  }
  const d = new Date(next.airing_at * 1000);
  const now = Date.now();
  if (isReleaseToday({ air_time: next.airing_at })) return `<div class="next-ep today">EP${next.episode} ${t("today_airing")}</div>`;
  const diffDays = Math.floor((d.getTime() - now) / 86400000);
  const loc = tzLocale();
  let txt;
  try {
    txt = new Intl.DateTimeFormat(loc, { day: "numeric", month: isMobile() ? "short" : "long" }).format(d);
  } catch (e) {
    txt = d.toLocaleDateString();
  }
  return `<div class="next-ep anime-ep"><span>EP${next.episode} · ${txt}</span><span class="next-ep-sep">·</span><span class="next-ep-days">${diffDays}</span></div>`;
}

function animeStatusLabel(status) {
  const s = (status || "").toUpperCase();
  if (s === "RELEASING") return t("anime_status_releasing");
  if (s === "FINISHED") return t("anime_status_finished");
  if (s === "NOT_YET_RELEASED") return t("anime_status_upcoming");
  return s;
}

async function loadAnime() {
  const __run = __runToken("anime");
  try { await loadNextUp(); } catch (_) {}
  const showArchived = archivedVisible("anime");
  const res = await fetch("/api/anime/followed");
  let items = await res.json();
  // Oturumsuz 401 gövdesi ({error}) sessizce yutulur — çökme yok.
  if (!Array.isArray(items)) return;
  // Arsivli anime HER ZAMAN cekilir (anahtar + Arşiv sekmesi gorunurlugu);
  // gosterime yalniz showArchived acikken katilir.
  try {
    const ares = await fetch("/api/anime/followed?archived=1");
    const aitems = await ares.json();
    if (Array.isArray(aitems)) {
      archiveState.anime = aitems;
      if (showArchived) items = dedupeMerged(items.concat(aitems));
    }
  } catch (_) {}
  try { await ensureArchiveState(); } catch (_) {}
  try { updateArchiveUi(); } catch (_) {}
  items = items.filter((i) => (!(i.in_watched == 1) || i.archived == 1));
  items = applySortDeferred(items);
  const grid = document.getElementById("anime-grid");  const empty = document.getElementById("empty-anime");
  const laterGridA = document.getElementById("anime-grid-later");
  const animeWrap = document.getElementById("anime-grid-wrap");
  const laterWrapA = document.getElementById("anime-later-wrap");
  if (!__runCurrent("anime", __run)) return;
  grid.innerHTML = "";
  if (laterGridA) laterGridA.innerHTML = "";
  empty.style.display = items.length ? "none" : "block";

  items.forEach((item) => {
    const div = document.createElement("div");
    const animeToday = !!item.next_episode && isReleaseToday({ air_time: item.next_episode.airing_at });
    const animeCompleted = !!item.completed;
    const animeMoveable = animeCompleted || !!item.can_move_watched;
    const isArchived = item.archived == 1;
    div.className = animeToday ? "card today-release-card" : "card";
    if (isArchived) div.classList.add("is-archived");
    setTvCardAttrs(div, {title:item.title, tmdb_id:item.anilist_id, anilist_id:item.anilist_id, media_type:"anime", id:item.id, isAnime:true});
    setFollowSortAttrs(div, item, "anime");
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, animeCompleted, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
            score: item.score ? scoreTag(item.score / 10) : "",
            net: platformTag(item.studios),
            mid: animeEpMid(item),
            status: animeNextText(item.next_episode, item.status),
          })}
          ${isArchived ? archivedBadgeHTML() : ""}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        ${animeMoveable ? `<button class="move-btn" data-tip="${t("move_to_watched")}"><i class="fa-solid fa-right-to-bracket"></i></button>` : ""}
        ${isArchived
          ? `<button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>`
          : `<button class="archive-btn" data-tip="${t("archive")}"><i class="fa-solid fa-box-archive"></i></button>`}
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openAnimeUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/anime/unfollow/${item.id}`, { method: "DELETE" });
          loadAnime();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openAnimeSchedule(item.id, item.title);
    };
    const archBtnA = div.querySelector(".archive-btn");
    if (archBtnA) archBtnA.onclick = (e) => { e.stopPropagation(); archiveAnimeItem(item, loadAnime); };
    const unarchBtnA = div.querySelector(".unarchive-btn");
    if (unarchBtnA) unarchBtnA.onclick = (e) => { e.stopPropagation(); unarchiveAnimeItem(item, loadAnime); };
    const infoBtnA = div.querySelector(".info-btn");
    if(infoBtnA) infoBtnA.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(item.id, item.anilist_id, item.title); };
    const animeMoveBtn = div.querySelector(".move-btn");
    if (animeMoveBtn) {
      animeMoveBtn.onclick = (e) => {
        e.stopPropagation();
        optimisticMoveCard(
          div,
          () => fetch("/api/anime/move-watched", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ anime_id: item.id, watched: 1 }),
          }),
          t("moved_to_watched", { name: item.title }),
          isDeferred(item) ? "anime-list-later" : "anime-list"
        );
      };
    }
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    if (isDeferred(item)) div.classList.add("is-deferred");
    const _pwA = div.querySelector(".poster-wrap");
    if (_pwA) {
      _pwA.insertAdjacentHTML("beforeend", deferBtnHTML(item));
      const _dfA = _pwA.querySelector(".defer-btn");
      if (_dfA) _dfA.onclick = (e) => { e.stopPropagation(); toggleDefer(item, true, loadAnime); };
    }
    tagCardStats(div, item, "anime", item.duration);
    if (laterGridA && isDeferred(item)) laterGridA.appendChild(div);
    else grid.appendChild(div);
    applyTitleHint(div);
  });
  if (laterWrapA || animeWrap) {
    let hasNormalA = false, hasLateA = false;
    try {
      hasNormalA = items.some((i) => !isDeferred(i));
      hasLateA = items.some((i) => isDeferred(i));
    } catch (_) {}
    if (animeWrap) animeWrap.style.display = (!items.length || hasNormalA) ? "" : "none";
    if (laterWrapA) laterWrapA.style.display = hasLateA ? "" : "none";
    try { applyFollowSectionState("anime-list"); } catch (_) {}
    try { applyFollowSectionState("anime-list-later"); } catch (_) {}
    try { closeFollowSortMenus(); } catch (_) {}
    try { updateFollowSectionControls("anime-list"); } catch (_) {}
    try { updateFollowSectionControls("anime-list-later"); } catch (_) {}
  }
  renderSectionSummary(grid);
  if (laterGridA) renderSectionSummary(laterGridA);
  try { updateMoveButtons("view-anime"); } catch (_) {}
  notifyListsRefreshed();
}

function unwatchedFirstLabel(item) {
  if (!item.items || !item.items.length) return "";
  const it = item.items[0];
  if (item.isAnime) return `EP${it.episode}`;
  return `S${String(it.season).padStart(2, "0")}E${String(it.episode).padStart(2, "0")}`;
}

function epochToTzDateStr(epochSec) {
  // Tek kural: gun cevrimi/karsilastirmasi ortak yardimcilardan (utils.js)
  return dayStrInTz(epochSec);
}

// İzlenmemiş kartı: sıradaki tarih bugünse "Bugün Yayında/Vizyonda", ilerideyse
// "<etiket> · <tarih> · <yeşil rozet: gün>". Tarih yok/geçmişse "" döner.
function unwatchedDateLine(dateStr, label, isMovie) {
  if (!dateStr) return "";
  const st = dateState(dateStr);
  if (st === "date-today") {
    const txt = isMovie ? t("today_theaters") : t("today_airing");
    return `<div class="next-ep today">${label ? label + " " : ""}${txt}</div>`;
  }
  if (st !== "date-future") return "";
  const days = daysUntil(dateStr);
  if (days === null || days <= 0) return "";
  const tip = isMovie
    ? (days === 1 ? t("days_left_theaters_1") : t("days_left_theaters", { n: days }))
    : (days === 1 ? t("days_left_1") : t("days_left", { n: days }));
  const dateText = isMobile() ? shortDateShort(dateStr) : shortDate(dateStr);
  const prefix = label ? `${label} · ` : "";
  return `<div class="next-ep">${prefix}${dateText} · <span class="next-ep-days" data-tip="${tip}">${days}</span></div>`;
}

function nextupImgSrc(item) {
  if (item.poster_local_w185) return item.poster_local_w185;
  if (item.poster_local) return item.poster_local;
  if (item.kind === "anime") return item.cover_url || null;
  if (item.poster_path) return `https://image.tmdb.org/t/p/w185${item.poster_path}`;
  return null;
}

// Siradaki Bolum seridi (1.84): dizi/belgesel/anime sekmelerinin en ustunde,
// her yapimin TEK sonraki izlenmemis bolumu. Bossa bolum tamamen gizlenir.
function nextupMatchKind(item, kind) {
  if (kind === "anime") return item.kind === "anime";
  if (item.kind !== "tv") return false;
  const doc = isDocItem(item);
  return kind === "belgesel" ? doc : !doc;
}

function nextupCard(item, cardKind) {
  const div = document.createElement("div");
  div.className = "card nextup-card";
  try { setTvCardAttrs(div, item); } catch (_) {}
  try { tagCardStats(div, item, cardKind || "shows", item.est_min); } catch (_) {}
  const src = nextupImgSrc(item);
  const img = src
    ? `<img class="nextup-poster" src="${src}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML=noPosterFallback()" />`
    : `<div class="no-poster nextup-poster">${FILM_SVG}</div>`;
  const se = item.kind === "anime"
    ? `EP${item.episode}`
    : `S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  const dur = item.est_min ? `<span class="nextup-dur"> · ${t("runtime_m", { m: item.est_min })}</span>` : "";
  div.innerHTML = `${img}<div class="nextup-info"><div class="nextup-title">${item.title}</div><div class="nextup-sub"><span class="nextup-ep">${se}</span>${dur}</div></div>`;
  if (item.kind === "anime") div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
  else div.onclick = () => openDetails("tv", item.tmdb_id, item.title);
  try {
    const tel = div.querySelector(".nextup-title");
    if (tel && tel.scrollWidth > tel.clientWidth) tel.setAttribute("data-tip", item.title);
  } catch (_) {}
  return div;
}

// Tum seritleri (dizi/belgesel/anime) tek fetch ile besler; her serit kendi
// turune gore suzulur. Bos seridin bolumu (baslik + oklar) gizlenir. Ozet
// satiri (bolum sayilari + sureler) standart bolum ozetiyle ayni bicimde.
async function loadNextUp() {
  const __run = __runToken("nextup");
  const strips = Array.from(document.querySelectorAll(".nextup-strip"));
  if (!strips.length) return;
  let payload = { items: [], totals: { count: 0, min: 0 } };
  try {
    const res = await fetch("/api/next-up");
    payload = await res.json();
  } catch (e) {
    payload = { items: [], totals: { count: 0, min: 0 } };
  }
  if (!__runCurrent("nextup", __run)) return;
  const items = (payload && payload.items) || [];
  strips.forEach((strip) => {
    const kind = strip.dataset.nextupKind || "dizi";
    const wrap = strip.closest("[id$='-nextup-wrap']");
    const list = items.filter((it) => nextupMatchKind(it, kind));
    strip.innerHTML = "";
    if (!list.length) {
      if (wrap) wrap.style.display = "none";
      try { renderSectionSummary(strip); } catch (_) {}
      return;
    }
    if (wrap) wrap.style.display = "";
    const cardKind = kind === "anime" ? "anime" : (kind === "belgesel" ? "docs" : "shows");
    list.forEach((item) => strip.appendChild(nextupCard(item, cardKind)));
    try { renderSectionSummary(strip); } catch (_) {}
  });
}

// Izlendi isaretlemesi sonrasi aktif gorunumu tazele (seritler de yukleyici
// icinde yenilenir). Boylece kart/serit otomatik guncellenir.
async function refreshListsAfterWatch() {
  try {
    const active = document.querySelector(".view.active");
    const id = active ? active.id : "";
    if (id === "view-dizi") await loadFollowed("dizi");
    else if (id === "view-film") await loadFollowed("film");
    else if (id === "view-belgesel") await loadBelgesel();
    else if (id === "view-anime") await loadAnime();
    else if (id === "view-unwatched") await loadUnwatched();
    else if (id === "view-watched") await loadWatched();
    else if (id === "view-archive") await loadArchive();
    else if (id === "view-dizi" || !id) await loadFollowed("dizi");
  } catch (_) {}
}

async function loadUnwatched() {
  const __run = __runToken("unwatched");
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
  const docsGrid = document.getElementById("unwatched-docs");
  const animeGrid = document.getElementById("unwatched-anime");
  if (!__runCurrent("unwatched", __run)) return;
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  if (docsGrid) docsGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  let shows = applySort((data.shows || []).map((s) => ({ ...s, isAnime: false })));
  let movies = applySort((data.movies || []).map((m) => ({ ...m, isAnime: false })));
  const animes = applySort((data.anime || []).map((a) => ({ ...a, isAnime: true })));
  const docs = applySort([...shows.filter(isDocItem), ...movies.filter(isDocItem)]);
  shows = shows.filter((s) => !isDocItem(s));
  movies = movies.filter((m) => !isDocItem(m));

  const hasContent = { shows: shows.length, movies: movies.length, docs: docs.length, anime: animes.length };

  document.getElementById("unwatched-shows-wrap").style.display = shows.length ? "" : "none";
  document.getElementById("unwatched-movies-wrap").style.display = movies.length ? "" : "none";
  const docsWrap = document.getElementById("unwatched-docs-wrap");
  if (docsWrap) docsWrap.style.display = docs.length ? "" : "none";
  const animeWrap = document.getElementById("unwatched-anime-wrap");
  animeWrap.style.display = animes.length ? "" : "none";
  animeWrap.classList.toggle("has-shows", shows.length > 0);
  empty.style.display = shows.length || movies.length || docs.length || animes.length ? "none" : "block";

  // Kayıtlı bölüm sırasını uygula ve boş bölümleri çıkar
  const order = loadSectionOrder("unwatched").filter((s) => hasContent[s]);
  // Dolu olup da sırada olmayanları sona ekle
  insertMissingSections(order, hasContent);
  order.forEach((s) => {
    const wrap = document.getElementById(`unwatched-${s}-wrap`);
    if (wrap) unwatchedView.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-unwatched");

  shows.forEach((item) => {
    const div = document.createElement("div");
    const singleToday = item.unwatched === 1 && isReleaseToday({ date: (item.items[0] || {}).air_date });
    div.className = singleToday ? "card today-release-card" : "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
    let primary = "";
    if (item.next_episode) primary = unwatchedDateLine(item.next_episode.air_date, `S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")}`, false);
    if (!primary) primary = tvStatusText(item);
    const countLine = `<div class="next-ep ep-count-line"><span>${t("unwatched_label")} <span class="ep-count-badge">${item.unwatched}</span></span></div>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-tv">${typeLabel("tv")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: seasonEpMid(item),
            status: primary,
            count: countLine,
          })}
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
    tagCardStats(div, item, "shows", item.runtime);
    showsGrid.appendChild(div);
    applyTitleHint(div);
  });

  movies.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
    let dateLine = unwatchedDateLine(item.release_date, "", true)
      || (item.release_date
        ? (dateState(item.release_date) === "date-past"
          ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
          : `<div class="next-ep">${formatDate(item.release_date).text}</div>`)
        : `<div>${t("date_unknown")}</div>`);
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-movie">${typeLabel("movie")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: dateLine,
            status: "",
          })}
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
    tagCardStats(div, item, "movies", item.runtime);
    moviesGrid.appendChild(div);
    applyTitleHint(div);
  });

  docs.forEach((item) => {
    const mt = item.media_type === "tv" ? "tv" : "movie";
    const div = document.createElement("div");
    div.className = "card unwatched-card";
    try { setTvCardAttrs(div, item); } catch {}
    try { setFollowSortAttrs(div, item); } catch {}
    let dateLine, countLine = "";
    if (mt === "movie") {
      dateLine = unwatchedDateLine(item.release_date, "", true)
        || (item.release_date
          ? (dateState(item.release_date) === "date-past"
            ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
            : `<div class="next-ep">${formatDate(item.release_date).text}</div>`)
          : `<div>${t("date_unknown")}</div>`);
    } else {
      let primary = "";
      if (item.next_episode) primary = unwatchedDateLine(item.next_episode.air_date, `S${String(item.next_episode.season).padStart(2, "0")}E${String(item.next_episode.episode).padStart(2, "0")}`, false);
      if (!primary) primary = tvStatusText(item);
      dateLine = primary;
      countLine = `<div class="next-ep ep-count-line"><span>${t("unwatched_label")} <span class="ep-count-badge">${item.unwatched || 0}</span></span></div>`;
    }
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-belgesel">${t("type_doc")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: mt === "movie" ? dateLine : seasonEpMid(item),
            status: mt === "movie" ? CARD_SLOT.status : dateLine,
            count: countLine,
          })}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      if (mt === "tv") openUnwatchedModal(item, false);
      else openReleases("movie", item.tmdb_id, item.title);
    };
    const ibD = div.querySelector(".info-btn"); if (ibD) ibD.onclick = (e) => { e.stopPropagation(); openDetails(mt, item.tmdb_id, item.title); };
    div.onclick = () => openDetails(mt, item.tmdb_id, item.title);
    tagCardStats(div, item, "docs", item.runtime);
    if (docsGrid) docsGrid.appendChild(div);
    applyTitleHint(div);
  });

  animes.forEach((item) => {
    const div = document.createElement("div");
    const singleToday = item.unwatched === 1 && !!item.items[0] && isReleaseToday({ air_time: item.items[0].air_at });
    div.className = singleToday ? "card today-release-card" : "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
    let primary = "";
    if (item.next_episode) primary = unwatchedDateLine(epochToTzDateStr(item.next_episode.airing_at), `EP${item.next_episode.episode}`, false);
    if (!primary) primary = animeNextText(null, item.status);
    const countLine = `<div class="next-ep ep-count-line"><span>${t("unwatched_label")} <span class="ep-count-badge">${item.unwatched}</span></span></div>`;
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, false, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
            score: item.score ? scoreTag(item.score / 10) : "",
            net: platformTag(item.studios),
            mid: animeEpMid(item),
            status: primary,
            count: countLine,
          })}
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
    tagCardStats(div, item, "anime", item.duration);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });
  try { closeFollowSortMenus(); } catch (_) {}
  ["unwatched-shows", "unwatched-movies", "unwatched-docs", "unwatched-anime"].forEach((sec) => {
    try { applyFollowSectionState(sec); } catch (_) {}
    try { updateFollowSectionControls(sec); } catch (_) {}
    renderSectionSummary(followSectionGrid(sec));
  });
  notifyListsRefreshed();
}

const DEFAULT_ORDER = ["shows", "movies", "docs", "anime"];

async function loadWatched() {
  const __run = __runToken("watched");
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
  const docsGrid = document.getElementById("watched-docs");
  const animeGrid = document.getElementById("watched-anime");
  if (!__runCurrent("watched", __run)) return;
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  if (docsGrid) docsGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  let shows = applySort((data.shows || []).map((s) => ({ ...s, isAnime: false })));
  let movies = applySort((data.movies || []).map((m) => ({ ...m, isAnime: false })));
  const animes = applySort((data.anime || []).map((a) => ({ ...a, isAnime: true })));
  const docs = applySort([...shows.filter(isDocItem), ...movies.filter(isDocItem)]);
  shows = shows.filter((s) => !isDocItem(s));
  movies = movies.filter((m) => !isDocItem(m));

  const hasContent = { shows: shows.length, movies: movies.length, docs: docs.length, anime: animes.length };

  document.getElementById("watched-shows-wrap").style.display = shows.length ? "" : "none";
  document.getElementById("watched-movies-wrap").style.display = movies.length ? "" : "none";
  const docsWrapW = document.getElementById("watched-docs-wrap");
  if (docsWrapW) docsWrapW.style.display = docs.length ? "" : "none";
  const animeWrap = document.getElementById("watched-anime-wrap");
  animeWrap.style.display = animes.length ? "" : "none";
  animeWrap.classList.toggle("has-shows", shows.length > 0);
  empty.style.display = shows.length || movies.length || docs.length || animes.length ? "none" : "block";

  const order = loadSectionOrder("watched").filter((s) => hasContent[s]);
  insertMissingSections(order, hasContent);
  order.forEach((s) => {
    const wrap = document.getElementById(`watched-${s}-wrap`);
    if (wrap) watchedView.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-watched");

  shows.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-tv">${typeLabel("tv")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: seasonEpMid(item),
            status: tvStatusText(item),
            count: `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total && item.total !== item.watched) ? (item.watched + "/" + item.total) : item.watched}</span></span></div>`,
          })}
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_dizi") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases("tv", item.tmdb_id, item.title);
    };
    const ibW = div.querySelector(".info-btn"); if(ibW) ibW.onclick = (e)=>{ e.stopPropagation(); openDetails("tv", item.tmdb_id, item.title); };
    div.querySelector(".move-back-btn").onclick = (e) => {
      e.stopPropagation();
      moveBackFromWatched(item, "dizi", div);
    };
    div.onclick = () => openDetails("tv", item.tmdb_id, item.title);
    tagCardStats(div, item, "shows", item.runtime);
    showsGrid.appendChild(div);
    applyTitleHint(div);
  });

  movies.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
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
          ${cardRows({
            type: `<span class="badge badge-movie">${typeLabel("movie")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: dateLine,
            status: "",
          })}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_film") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases("movie", item.tmdb_id, item.title);
    };
    div.querySelector(".move-back-btn").onclick = (e) => {
      e.stopPropagation();
      moveBackFromWatched(item, "film", div);
    };
    div.onclick = () => openDetails("movie", item.tmdb_id, item.title);
    tagCardStats(div, item, "movies", item.runtime);
    moviesGrid.appendChild(div);
    applyTitleHint(div);
  });

  docs.forEach((item) => {
    const mt = item.media_type === "tv" ? "tv" : "movie";
    const div = document.createElement("div");
    div.className = "card unwatched-card";
    try { setTvCardAttrs(div, item); } catch {}
    try { setFollowSortAttrs(div, item); } catch {}
    let dateLine, countLine = "";
    if (mt === "movie") {
      dateLine = item.release_date
        ? dateState(item.release_date) === "date-past"
          ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
          : `<div class="next-ep">${formatDate(item.release_date).text}</div>`
        : `<div>${t("date_unknown")}</div>`;
    } else {
      dateLine = tvStatusText(item);
      countLine = `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total && item.total !== item.watched) ? (item.watched + "/" + item.total) : item.watched}</span></span></div>`;
    }
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-belgesel">${t("type_doc")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: mt === "movie" ? dateLine : seasonEpMid(item),
            status: mt === "movie" ? CARD_SLOT.status : dateLine,
            count: countLine,
          })}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_belgesel") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openReleases(mt, item.tmdb_id, item.title);
    };
    const ibDW = div.querySelector(".info-btn"); if (ibDW) ibDW.onclick = (e) => { e.stopPropagation(); openDetails(mt, item.tmdb_id, item.title); };
    div.querySelector(".move-back-btn").onclick = (e) => {
      e.stopPropagation();
      moveBackFromWatched(item, "belgesel", div);
    };
    div.onclick = () => openDetails(mt, item.tmdb_id, item.title);
    tagCardStats(div, item, "docs", item.runtime);
    if (docsGrid) docsGrid.appendChild(div);
    applyTitleHint(div);
  });

  animes.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card";
        try{ setTvCardAttrs(div, item); }catch{}
        try{ setFollowSortAttrs(div, item); }catch{}
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, true, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
            score: item.score ? scoreTag(item.score / 10) : "",
            net: platformTag(item.studios),
            mid: animeEpMid(item),
            status: animeNextText(null, item.status),
            count: `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total && item.total !== item.watched) ? (item.watched + "/" + item.total) : item.watched}</span></span></div>`,
          })}
        </div>
      </div>
      <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
      <button class="move-back-btn" data-tip="${t("move_back_to", { view: t("tab_anime") })}"><i class="fa-solid fa-right-to-bracket"></i></button>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => {
      e.stopPropagation();
      openAnimeSchedule(item.id, item.title);
    };
    div.querySelector(".move-back-btn").onclick = (e) => {
      e.stopPropagation();
      moveBackFromWatched(item, "anime", div);
    };
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    tagCardStats(div, item, "anime", item.duration);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });
  try { closeFollowSortMenus(); } catch (_) {}
  ["watched-shows", "watched-movies", "watched-docs", "watched-anime"].forEach((sec) => {
    try { applyFollowSectionState(sec); } catch (_) {}
    try { updateFollowSectionControls(sec); } catch (_) {}
    renderSectionSummary(followSectionGrid(sec));
  });
  notifyListsRefreshed();
}

// ---- Arsiv (1.83) — Izlenmis deseninin arsiv karsiligi ----
const ARCHIVE_FLAG_KEY = "archivedVisible:";
// Arsivli listeler (anahtar + Arşiv sekmesi gorunurlugu icin onbellek):
// followed = arsivli tv+movie listesi, anime = arsivli anime listesi.
const archiveState = { followed: null, anime: null };
function archivedVisible(view) {
  try { return localStorage.getItem(ARCHIVE_FLAG_KEY + view) === "1"; } catch (_) { return false; }
}
// Sekmede arsivli yapim yoksa "Arşivlenenleri göster" anahtari gizlenir
// (basliktaki has-archived-toggle sinifi da kalkar -> sag kume kaymaz).
function setArchivedToggleVisible(view, hasAny) {
  const v = views[view];
  if (!v) return;
  v.querySelectorAll(".section-archived-toggle").forEach((btn) => {
    btn.style.display = hasAny ? "" : "none";
    const h2 = btn.closest(".unwatched-section-title");
    if (h2) h2.classList.toggle("has-archived-toggle", !!hasAny);
  });
}
// Hic arsivli yapim yoksa "Arşiv" sekmesi + gorunumu gizlenir.
function setArchiveTabVisible(on) {
  try {
    if (tabs.archive) tabs.archive.style.display = on ? "" : "none";
    if (views.archive) views.archive.style.display = on ? "" : "none";
    if (!on && views.archive && views.archive.classList.contains("active")) switchView("dizi");
  } catch (_) {}
}
// Arsivli sayilarindan anahtar + sekme gorunurlugunu gunceller.
function updateArchiveUi() {
  const f = archiveState.followed;
  const a = archiveState.anime;
  if (Array.isArray(f)) {
    const tv = f.filter((i) => i && i.media_type === "tv");
    const mov = f.filter((i) => i && i.media_type === "movie");
    setArchivedToggleVisible("dizi", tv.some((i) => !isDocItem(i)));
    setArchivedToggleVisible("belgesel", tv.some((i) => isDocItem(i)));
    setArchivedToggleVisible("film", mov.length > 0);
  }
  if (Array.isArray(a)) setArchivedToggleVisible("anime", a.length > 0);
  if (Array.isArray(f) && Array.isArray(a)) setArchiveTabVisible((f.length + a.length) > 0);
}
// Eksik arsivli listeyi (ilk seferde) tamamlar; sonra istek yapmaz.
async function ensureArchiveState() {
  if (archiveState.followed === null) {
    try {
      const r = await fetch("/api/followed?archived=1");
      const d = await r.json();
      if (Array.isArray(d)) archiveState.followed = d;
    } catch (_) {}
  }
  if (archiveState.anime === null) {
    try {
      const r = await fetch("/api/anime/followed?archived=1");
      const d = await r.json();
      if (Array.isArray(d)) archiveState.anime = d;
    } catch (_) {}
  }
}
function setArchivedVisible(view, on) {
  try { localStorage.setItem(ARCHIVE_FLAG_KEY + view, on ? "1" : "0"); } catch (_) {}
  const v = views[view];
  if (v) {
    v.classList.toggle("show-archived", !!on);
    v.querySelectorAll(".section-archived-toggle").forEach((b) => {
      b.classList.toggle("active", !!on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
}
async function fetchArchivedFollowed() {
  const res = await fetch("/api/followed?archived=1");
  const d = await res.json();
  return Array.isArray(d) ? d : [];
}
async function fetchArchivedAnime() {
  const res = await fetch("/api/anime/followed?archived=1");
  const d = await res.json();
  return Array.isArray(d) ? d : [];
}
// Kosu jetonu (acilis yarisi): ayni yukleyici eszamanli iki kez calisirsa
// (or. switchView + app:langchange) bayat kosu grid'e dokunmadan cikar;
// taze kosu tek basina temizler + basar (cift kart olmaz).
const __loadGen = {};
function __runToken(key) { const n = (__loadGen[key] || 0) + 1; __loadGen[key] = n; return n; }
function __runCurrent(key, n) { return __loadGen[key] === n; }
// Birlesik (aktif + arsivli) listelerde ayni yapim iki kaynaktan da gelebilir
// (eski onbellek / yaris durumu); id bazinda tekille (cift kart onlenir).
function dedupeMerged(items) {
  const seen = new Set();
  return (items || []).filter((i) => {
    if (!i || typeof i !== "object") return false;
    const k = i.anilist_id ? "a" + i.anilist_id : "f" + (i.tmdb_id || "") + ":" + (i.media_type || "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function archiveFollowedItem(item, done) {
  return fetch("/api/followed/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type, archived: 1 }),
  }).then(() => { toast(t("archived_toast", { name: item.title })); if (done) done(); });
}
function unarchiveFollowedItem(item, done) {
  return fetch("/api/followed/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type, archived: 0 }),
  }).then(() => { toast(t("unarchived_toast", { name: item.title })); if (done) done(); });
}
function archiveAnimeItem(item, done) {
  return fetch("/api/anime/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anime_id: item.id, archived: 1 }),
  }).then(() => { toast(t("archived_toast", { name: item.title })); if (done) done(); });
}
function unarchiveAnimeItem(item, done) {
  return fetch("/api/anime/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anime_id: item.id, archived: 0 }),
  }).then(() => { toast(t("unarchived_toast", { name: item.title })); if (done) done(); });
}
function archivedBadgeHTML() {
  return `<div class="archived-line"><span class="badge badge-archived"><i class="fa-solid fa-box-archive"></i> ${t("archived_badge")}</span></div>`;
}
async function loadArchive() {
  const __run = __runToken("archive");
  const archView = document.getElementById("view-archive");
  const empty = document.getElementById("empty-archive");
  if (!archView || !empty) return;
  const showsGrid = document.getElementById("archive-shows");
  const moviesGrid = document.getElementById("archive-movies");
  const docsGrid = document.getElementById("archive-docs");
  const animeGrid = document.getElementById("archive-anime");
  if (!showsGrid || !moviesGrid || !animeGrid) return;
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  if (docsGrid) docsGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  let items = [];
  let animes = [];
  try { items = await fetchArchivedFollowed(); } catch (_) { items = []; }
  try { animes = await fetchArchivedAnime(); } catch (_) { animes = []; }
  if (!Array.isArray(items)) items = [];
  if (!Array.isArray(animes)) animes = [];
  items = dedupeMerged(items);
  animes = dedupeMerged(animes);
  // Arsiv sekmesi/anahtar gorunurlugu bu iki listeden beslenir.
  archiveState.followed = items;
  archiveState.anime = animes;
  try { updateArchiveUi(); } catch (_) {}
  if (!__runCurrent("archive", __run)) return;

  let shows = applySort(items.filter((i) => i.media_type === "tv").map((s) => ({ ...s, isAnime: false })));
  let movies = applySort(items.filter((i) => i.media_type === "movie").map((m) => ({ ...m, isAnime: false })));
  animes = applySort(animes.map((a) => ({ ...a, isAnime: true })));
  const docs = applySort([...shows.filter(isDocItem), ...movies.filter(isDocItem)]);
  shows = shows.filter((s) => !isDocItem(s));
  movies = movies.filter((m) => !isDocItem(m));

  const hasContent = { shows: shows.length, movies: movies.length, docs: docs.length, anime: animes.length };
  document.getElementById("archive-shows-wrap").style.display = shows.length ? "" : "none";
  document.getElementById("archive-movies-wrap").style.display = movies.length ? "" : "none";
  const docsWrapA = document.getElementById("archive-docs-wrap");
  if (docsWrapA) docsWrapA.style.display = docs.length ? "" : "none";
  const animeWrapA = document.getElementById("archive-anime-wrap");
  if (animeWrapA) animeWrapA.style.display = animes.length ? "" : "none";
  empty.style.display = (shows.length || movies.length || docs.length || animes.length) ? "none" : "block";

  const order = loadSectionOrder("archive").filter((s) => hasContent[s]);
  insertMissingSections(order, hasContent);
  order.forEach((s) => {
    const wrap = document.getElementById(`archive-${s}-wrap`);
    if (wrap) archView.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-archive");

  shows.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card is-archived";
    try { setTvCardAttrs(div, item); } catch (_) {}
    try { setFollowSortAttrs(div, item); } catch (_) {}
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, !!item.completed, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-tv">${typeLabel("tv")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: seasonEpMid(item),
            status: tvStatusText(item),
            count: `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total_eps && item.total_eps !== item.watched_eps) ? (item.watched_eps + "/" + item.total_eps) : item.watched_eps}</span></span></div>`,
          })}
          ${archivedBadgeHTML()}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        <button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => { e.stopPropagation(); openReleases("tv", item.tmdb_id, item.title); };
    div.querySelector(".unarchive-btn").onclick = (e) => { e.stopPropagation(); unarchiveFollowedItem(item, loadArchive); };
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openTvUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadArchive();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.onclick = () => openDetails("tv", item.tmdb_id, item.title);
    tagCardStats(div, item, "shows", item.runtime);
    showsGrid.appendChild(div);
    applyTitleHint(div);
  });

  movies.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card is-archived";
    try { setTvCardAttrs(div, item); } catch (_) {}
    try { setFollowSortAttrs(div, item); } catch (_) {}
    const dateLine = item.release_date
      ? dateState(item.release_date) === "date-past"
        ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
        : `<div class="next-ep">${formatDate(item.release_date).text}</div>`
      : `<div>${t("date_unknown")}</div>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, item.watched == 1, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-movie">${typeLabel("movie")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: dateLine,
            status: "",
          })}
          ${archivedBadgeHTML()}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        <button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => { e.stopPropagation(); openReleases("movie", item.tmdb_id, item.title); };
    div.querySelector(".unarchive-btn").onclick = (e) => { e.stopPropagation(); unarchiveFollowedItem(item, loadArchive); };
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openTvUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadArchive();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.onclick = () => openDetails("movie", item.tmdb_id, item.title);
    tagCardStats(div, item, "movies", item.runtime);
    moviesGrid.appendChild(div);
    applyTitleHint(div);
  });

  docs.forEach((item) => {
    const mt = item.media_type === "tv" ? "tv" : "movie";
    const div = document.createElement("div");
    div.className = "card unwatched-card is-archived";
    try { setTvCardAttrs(div, item); } catch (_) {}
    try { setFollowSortAttrs(div, item); } catch (_) {}
    let dateLine;
    if (mt === "movie") {
      dateLine = item.release_date
        ? dateState(item.release_date) === "date-past"
          ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`
          : `<div class="next-ep">${formatDate(item.release_date).text}</div>`
        : `<div>${t("date_unknown")}</div>`;
    } else {
      dateLine = tvStatusText(item);
    }
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, mt === "movie" ? item.watched == 1 : !!item.completed, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-belgesel">${t("type_doc")}</span>`,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: mt === "movie" ? dateLine : seasonEpMid(item),
            status: mt === "movie" ? CARD_SLOT.status : dateLine,
            count: mt === "movie" ? "" : `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total_eps && item.total_eps !== item.watched_eps) ? (item.watched_eps + "/" + item.total_eps) : item.watched_eps}</span></span></div>`,
          })}
          ${archivedBadgeHTML()}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        <button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => { e.stopPropagation(); openReleases(mt, item.tmdb_id, item.title); };
    div.querySelector(".unarchive-btn").onclick = (e) => { e.stopPropagation(); unarchiveFollowedItem(item, loadArchive); };
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openTvUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/unfollow/${item.id}`, { method: "DELETE" });
          loadArchive();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.onclick = () => openDetails(mt, item.tmdb_id, item.title);
    tagCardStats(div, item, "docs", item.runtime);
    if (docsGrid) docsGrid.appendChild(div);
    applyTitleHint(div);
  });

  animes.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card unwatched-card is-archived";
    try { setTvCardAttrs(div, {title:item.title, tmdb_id:item.anilist_id, anilist_id:item.anilist_id, media_type:"anime", id:item.id, isAnime:true}); } catch (_) {}
    try { setFollowSortAttrs(div, item, "anime"); } catch (_) {}
    div.innerHTML = `
      ${animePosterHTML(item.cover_url, item.title, !!item.completed, item.poster_local, item.poster_local_w185, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
            score: item.score ? scoreTag(item.score / 10) : "",
            net: platformTag(item.studios),
            mid: animeEpMid(item),
            status: animeNextText(null, item.status),
            count: `<div class="next-ep ep-count-line"><span>${t("watched_label")} <span class="ep-count-badge">${(item.total_eps && item.total_eps !== item.watched_eps) ? (item.watched_eps + "/" + item.total_eps) : item.watched_eps}</span></span></div>`,
          })}
          ${archivedBadgeHTML()}
        </div>
      </div>
      <div class="poster-top">
        <button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>
        <button class="unarchive-btn" data-tip="${t("unarchive")}"><i class="fa-solid fa-box-open"></i></button>
        <button class="remove" data-tip="${t("unfollow_title")}">&times;</button>
      </div>
    `;
    div.querySelector(".calendar-btn").onclick = (e) => { e.stopPropagation(); openAnimeSchedule(item.id, item.title); };
    div.querySelector(".unarchive-btn").onclick = (e) => { e.stopPropagation(); unarchiveAnimeItem(item, loadArchive); };
    div.querySelector(".remove").onclick = (e) => {
      e.stopPropagation();
      openAnimeUnfollowConfirm(
        t("unfollow_confirm", { title: item.title }),
        async () => {
          await fetch(`/api/anime/unfollow/${item.id}`, { method: "DELETE" });
          loadArchive();
          toast(t("unfollowed", { name: item.title }));
        }
      );
    };
    div.onclick = () => openAnimeDetails(item.id, item.anilist_id, item.title);
    tagCardStats(div, item, "anime", item.duration);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });

  try { closeFollowSortMenus(); } catch (_) {}
  ["archive-shows", "archive-movies", "archive-docs", "archive-anime"].forEach((sec) => {
    try { applyFollowSectionState(sec); } catch (_) {}
    try { updateFollowSectionControls(sec); } catch (_) {}
    renderSectionSummary(followSectionGrid(sec));
  });
  notifyListsRefreshed();
}

function moveBackFromWatched(item, targetView, div) {
  const isAnime = !!item.isAnime;
  const sectionKey = isAnime
    ? "watched-anime"
    : isDocItem(item)
      ? "watched-docs"
      : item.media_type === "movie"
        ? "watched-movies"
        : "watched-shows";
  const reqFn = () => {
    if (isAnime) {
      return fetch("/api/anime/move-watched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anime_id: item.id, watched: 0 }),
      });
    }
    return fetch("/api/followed/move-watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type || (targetView === "film" ? "movie" : "tv"), watched: 0 }),
    });
  };
  optimisticMoveCard(div, reqFn, t("moved_back", { name: item.title }), sectionKey);
  const empty = document.getElementById("empty-watched");
  const stillHasCards = !empty || (Array.from(document.querySelectorAll("#view-watched .poster-grid")).some((g) => g.querySelector(".card")));
  if (!stillHasCards) {
    setTimeout(() => switchView(targetView), 400);
  }
}

// ---- Öneriler beslemesi (feed): iki pulldown + tek ızgara ----
const FEED_SOURCE_VALUES = ["trend", "popular", "top_rated", "netflix", "hbo_max", "disney_plus", "paramount", "apple_tv", "prime_video", "amc", "random"];
const FEED_MEDIA_VALUES = ["dizi", "film", "belgesel", "anime"];
const FEED_MEDIA_KEY = "feedMedia";
const FEED_SOURCE_KEY = "feedSource";
const FEED_DEFAULT = { media: "dizi", source: "trend" };
const FEED_KIND = { dizi: "shows", film: "movies", belgesel: "docs", anime: "anime" };

function loadFeedPrefs() {
  let media = FEED_DEFAULT.media, source = FEED_DEFAULT.source;
  try { media = localStorage.getItem(FEED_MEDIA_KEY) || media; } catch (_) {}
  try { source = localStorage.getItem(FEED_SOURCE_KEY) || source; } catch (_) {}
  if (FEED_MEDIA_VALUES.indexOf(media) === -1) media = FEED_DEFAULT.media;
  if (FEED_SOURCE_VALUES.indexOf(source) === -1) source = FEED_DEFAULT.source;
  return { media, source };
}
function saveFeedPrefs(media, source) {
  try { localStorage.setItem(FEED_MEDIA_KEY, media); } catch (_) {}
  try { localStorage.setItem(FEED_SOURCE_KEY, source); } catch (_) {}
}
function updateFeedTitle(source) {
  const el = document.getElementById("feed-title");
  if (el) el.textContent = t("feed_src_" + source);
}
let feedPulldownsInited = false;
let feedControlsWired = false;
function initFeedControls() {
  const m = document.getElementById("feed-media");
  const s = document.getElementById("feed-source");
  if (!m || !s) return;
  if (!feedPulldownsInited && typeof window.initPulldownCombobox === "function") {
    try {
      window.initPulldownCombobox("feed-media", "feed-media-list");
      window.initPulldownCombobox("feed-source", "feed-source-list");
      feedPulldownsInited = true;
    } catch (_) {}
  }
  if (feedControlsWired) return;
  const prefs = loadFeedPrefs();
  m.value = prefs.media;
  s.value = prefs.source;
  const onChange = () => {
    saveFeedPrefs(m.value, s.value);
    loadFeed(false);
  };
  m.addEventListener("change", onChange);
  s.addEventListener("change", onChange);
  updateFeedTitle(s.value);
  feedControlsWired = true;
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFeedControls);
else initFeedControls();
document.addEventListener("app:langchange", () => {
  const s = document.getElementById("feed-source");
  if (s) updateFeedTitle(s.value);
});

function feedKind(item) {
  if (item.anilist_id) return "anime";
  if (item.is_doc) return "docs";
  return item.media_type === "movie" ? "movies" : "shows";
}
function feedBody(item) {
  if (item.anilist_id) {
    return {
      anilist_id: item.anilist_id,
      title: item.title,
      poster_path: item.cover_url,
      kind: feedKind(item),
      score: item.score != null ? item.score / 10 : null,
      release_date: item.release_date || "",
      networks: item.networks || [],
      media_type: "anime",
      tv_status: item.status || "",
    };
  }
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path,
    kind: feedKind(item),
    vote_average: item.vote_average,
    release_date: item.release_date || "",
    networks: item.networks || [],
    tv_status: item.tv_status || "",
  };
}
function feedAction(div, reqFn, okMsg, onOk) {
  reqFn().then(async (r) => {
    let j = {};
    try { j = await r.json(); } catch (_) { j = {}; }
    if (!r.ok) { toast((j && j.error) || t("error")); return; }
    div.remove();
    if (okMsg) toast(okMsg);
    if (onOk) onOk();
  }).catch(() => toast(t("error")));
}

function renderFeedCards(items, grid, media) {
  items.forEach((item) => {
    const isAnimeCard = !!item.anilist_id;
    const section = item.kind || FEED_KIND[media] || "shows";
    const div = document.createElement("div");
    div.className = "card";
    try { setTvCardAttrs(div, item); } catch (_) {}
    div.dataset.rid = item.tmdb_id || item.anilist_id;
    div.dataset.sortTitle = item.title || "";
    let _rs = item.vote_average;
    if (_rs === undefined || _rs === null) _rs = item.score != null ? item.score / 10 : 0;
    div.dataset.sortScore = String(Number(_rs) || 0);
    div.dataset.sortDate = item.release_date || "";
    const moveBtn = recMoveBtnHTML(item);
    let badge;
    if (isAnimeCard || section === "anime") {
      badge = `<span class="badge badge-anime">${t("tab_anime")}</span>`;
    } else if (section === "docs" || item.is_doc) {
      badge = `<span class="badge badge-belgesel">${t("type_doc")}</span>`;
    } else {
      badge = `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`;
    }
    if (isAnimeCard) {
      div.innerHTML = `
        ${animePosterHTML(item.cover_url, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            ${cardRows({
              type: badge,
              score: item.score ? scoreTag(item.score / 10) : "",
              net: platformTag(item.networks),
              mid: animeEpMid(item),
              status: animeNextText(item.next_episode ? { episode: item.next_episode, airing_at: item.airing_at } : null, item.status),
              reserve: false,
            })}
          </div>
        </div>
        ${recHideBtnHTML(item)}
        ${moveBtn}
        <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>`;
    } else {
      div.innerHTML = `
        ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            ${cardRows({
              type: badge,
              score: scoreTag(item.vote_average),
              net: platformTag(item.networks),
              mid: item.media_type === "movie" ? recStatusLine(item, section) : seasonEpMid(item),
              status: item.media_type === "movie" ? "" : recStatusLine(item, section),
              reserve: false,
            })}
          </div>
        </div>
        ${recHideBtnHTML(item)}
        ${moveBtn}
        <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>`;
    }
    const rem = div.querySelector(".remove");
    if (rem) rem.onclick = (e) => {
      e.stopPropagation();
      const req = isAnimeCard
        ? () => fetch("/api/anime/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anilist_id: item.anilist_id }) })
        : () => fetch("/api/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type, title: item.title, poster_path: item.poster_path }) });
      feedAction(div, req, t("added", { name: item.title }));
    };
    const mvBtn = div.querySelector(".move-btn");
    if (mvBtn) mvBtn.onclick = (e) => {
      e.stopPropagation();
      feedAction(div, () => fetch("/api/recommendations/move-watched", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isAnimeCard ? { anilist_id: item.anilist_id } : { media_type: item.media_type, tmdb_id: item.tmdb_id, title: item.title, poster_path: item.poster_path }) }), t("moved_to_watched", { name: item.title }));
    };
    const hideBtn = div.querySelector(".hide-btn");
    if (hideBtn) hideBtn.onclick = (e) => {
      e.stopPropagation();
      feedAction(div, () => fetch("/api/recommendations/hide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feedBody(item)) }), t("rec_hidden_toast", { name: item.title }), () => setHiddenButtonDisabled(section, false));
    };
    div.onclick = () => isAnimeCard ? openAnimeDetails(null, item.anilist_id, item.title, true) : openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true);
    grid.appendChild(div);
    applyTitleHint(div);
  });
  try { applyRecSectionState("feed"); } catch (_) {}
}

const _feedUpdateCache = { updated_at: null, next_update: null };

function feedDateTime(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts * 1000);
    // Secili tz'nin ulke yereli; saat bicimi zorlanmaz (AM/PM dahil)
    const loc = tzLocale();
    const tz = state.currentTz;
    const mk = (o) => (tz ? Object.assign({ timeZone: tz }, o) : o);
    const dv = new Intl.DateTimeFormat(loc, mk({ day: "2-digit", month: "2-digit", year: "numeric" })).format(d);
    const tm = new Intl.DateTimeFormat(loc, mk({ hour: "2-digit", minute: "2-digit" })).format(d);
    return `${dv} - ${tm}`;
  } catch (_) { return null; }
}

function renderFeedUpdateInfo(payload) {
  _feedUpdateCache.updated_at = (payload && payload.updated_at) || null;
  _feedUpdateCache.next_update = (payload && payload.next_update) || null;
  const el = document.getElementById("feed-update-info");
  if (!el) return;
  const d = feedDateTime(_feedUpdateCache.updated_at);
  const n = feedDateTime(_feedUpdateCache.next_update);
  const parts = [];
  if (d) parts.push(t("feed_last_update", { dv: d }));
  if (n) parts.push(t("feed_next_update", { dv: n }));
  if (!parts.length) { el.style.display = "none"; el.textContent = ""; return; }
  el.style.display = "";
  el.textContent = parts.join(" | ");
}

async function loadFeed(force) {
  const __run = __runToken("recommend");
  initFeedControls();
  const m = document.getElementById("feed-media");
  const s = document.getElementById("feed-source");
  const grid = document.getElementById("recommend-feed");
  const empty = document.getElementById("empty-recommend");
  const header = document.getElementById("feed-header");
  if (!grid) return;
  const prefs = loadFeedPrefs();
  const media = (m && m.value) || prefs.media;
  const source = (s && s.value) || prefs.source;
  if (header) header.style.display = "";
  const hideBtn = document.querySelector('#feed-header .section-hide');
  if (hideBtn) hideBtn.dataset.section = FEED_KIND[media] || "shows";
  refreshHiddenButton(FEED_KIND[media] || "shows");
  updateFeedTitle(source);
  grid.innerHTML = `<div class="rec-placeholder"><div class="ph-box"><span class="ph-spin"></span></div></div>`;
  if (empty) empty.style.display = "none";
  try {
    const res = await fetch(`/api/recommendations/feed?media=${encodeURIComponent(media)}&source=${encodeURIComponent(source)}${force ? "&refresh=1" : ""}`, { cache: "no-store" });
    const j = await res.json();
    const items = (j && j.items) || [];
    if (!__runCurrent("recommend", __run)) return;
    grid.innerHTML = "";
    renderFeedCards(items, grid, media);
    renderFeedUpdateInfo(j);
    if (empty) empty.style.display = items.length ? "none" : "block";
  } catch (_) {
    grid.innerHTML = "";
    renderFeedUpdateInfo(null);
    if (empty) empty.style.display = "block";
    toast(t("error"));
  }
}

async function loadRecommendations() {
  await loadFeed(false);
}

function renderRecommendations(data) {
  const view = document.getElementById("view-recommend");
  const empty = document.getElementById("empty-recommend");
  const showsGrid = document.getElementById("recommend-shows");
  const moviesGrid = document.getElementById("recommend-movies");
  const docsGrid = document.getElementById("recommend-docs");
  const animeGrid = document.getElementById("recommend-anime");
  if (!showsGrid || !moviesGrid || !docsGrid || !animeGrid) return;
  showsGrid.innerHTML = "";
  moviesGrid.innerHTML = "";
  docsGrid.innerHTML = "";
  animeGrid.innerHTML = "";

  const shows = data.shows || [];
  const movies = data.movies || [];
  const docs = data.docs || [];
  const animes = data.anime || [];
  const hasContent = { shows: shows.length, movies: movies.length, docs: docs.length, anime: animes.length };

  ["recommend-shows-wrap", "recommend-movies-wrap", "recommend-docs-wrap", "recommend-anime-wrap"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasContent[id.replace("recommend-", "").replace("-wrap", "")] ? "" : "none";
  });
  empty.style.display = shows.length || movies.length || docs.length || animes.length ? "none" : "block";

  const order = loadSectionOrder("recommend").filter((s) => hasContent[s]);
  insertMissingSections(order, hasContent);
  order.forEach((s) => {
    const wrap = document.getElementById(`recommend-${s}-wrap`);
    if (wrap) view.insertBefore(wrap, empty);
  });
  updateMoveButtons("view-recommend");

  renderRecCards(shows, showsGrid, false, "shows");
  renderRecCards(movies, moviesGrid, false, "movies");
  renderRecCards(docs, docsGrid, false, "docs");
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

// Öneri kartı statü satırı: dizi→tv_status, film/belgesel→vizyon tarihi (takip kartlarıyla birebir)
function recStatusLine(item, section) {
  if (section === "shows") {
    return item.tv_status ? `<div class="next-ep muted">${tvStatusLabel(item.tv_status)}</div>` : "";
  }
  if (!item.release_date) return "";
  if (dateState(item.release_date) === "date-past") {
    return `<div class="next-ep muted">${formatDate(item.release_date).text}</div>`;
  }
  if (isReleaseToday({ date: item.release_date })) {
    return `<div class="next-ep today">${formatDate(item.release_date).text} ${t("today_theaters")}</div>`;
  }
  return `<div class="next-ep">${formatDate(item.release_date).text} · <span class="next-ep-days" data-tip="${daysHint(item.release_date)}">${daysUntil(item.release_date)}</span></div>`;
}

// Öneri bölümü liste-içi arama + sıralama durumu (bölüm başına bağımsız, hatırlamalı)
const REC_DEFAULT_DIR = { alpha: "asc", score: "desc", vision: "desc", upcoming: "asc" };
function recFilterKey(section) { return "recFilter_" + section; }
function recFilterDirKey(section) { return "recFilterDir_" + section; }
function loadRecFilter(section) {
  let s = "alpha";
  try { s = localStorage.getItem(recFilterKey(section)) || "alpha"; } catch (_) {}
  if (!REC_DEFAULT_DIR[s]) s = "alpha";
  let d = REC_DEFAULT_DIR[s];
  try { d = localStorage.getItem(recFilterDirKey(section)) || d; } catch (_) {}
  if (d !== "asc" && d !== "desc") d = REC_DEFAULT_DIR[s];
  return { sort: s, dir: d };
}
function saveRecFilter(section) {
  try {
    const st = recSectionState[section];
    if (!st) return;
    localStorage.setItem(recFilterKey(section), st.sort);
    localStorage.setItem(recFilterDirKey(section), st.dir);
  } catch (_) {}
}
const recSectionState = {
  shows: Object.assign({ q: "" }, loadRecFilter("shows")),
  movies: Object.assign({ q: "" }, loadRecFilter("movies")),
  docs: Object.assign({ q: "" }, loadRecFilter("docs")),
  anime: Object.assign({ q: "" }, loadRecFilter("anime")),
  feed: Object.assign({ q: "" }, loadRecFilter("feed")),
};
function recSectionGrid(section) {
  return document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
}
function recSectionCards(section) {
  const grid = recSectionGrid(section);
  if (!grid) return { grid: null, cards: [] };
  return { grid, cards: Array.from(grid.children).filter((el) => el && el.classList && el.classList.contains("card")) };
}
function recCardTitle(c) {
  try {
    if (c.dataset && c.dataset.sortTitle) return String(c.dataset.sortTitle);
  } catch (_) {}
  try {
    return ((c.querySelector(".title") || {}).textContent) || "";
  } catch (_) { return ""; }
}
function recCardDate(c) {
  try {
    if (c.dataset && c.dataset.sortDate) return String(c.dataset.sortDate);
  } catch (_) {}
  return "";
}
function recToday() {
  try {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch (_) { return ""; }
}
function applyRecSectionState(section) {
  const st = recSectionState[section];
  const { grid, cards } = recSectionCards(section);
  if (!st || !grid) return;
  const q = (st.q || "").toLowerCase();
  cards.forEach((c) => {
    c.style.display = (!q || recCardTitle(c).toLowerCase().includes(q)) ? "" : "none";
  });
  const flip = st.dir === (REC_DEFAULT_DIR[st.sort] || "asc") ? 1 : -1;
  if (st.sort === "alpha") {
    cards.sort((a, b) => {
      const x = recCardTitle(a).toLocaleLowerCase(), y = recCardTitle(b).toLocaleLowerCase();
      return (x < y ? -1 : x > y ? 1 : 0) * flip;
    }).forEach((c) => grid.appendChild(c));
  } else if (st.sort === "score") {
    cards.sort((a, b) => ((Number((b.dataset && b.dataset.sortScore) || 0) - Number((a.dataset && a.dataset.sortScore) || 0))) * flip).forEach((c) => grid.appendChild(c));
  } else if (st.sort === "vision") {
    cards.sort((a, b) => {
      const x = recCardDate(a), y = recCardDate(b);
      let r = 0;
      if (!x && !y) r = 0;
      else if (!x) r = 1;
      else if (!y) r = -1;
      else r = x < y ? 1 : x > y ? -1 : 0;
      return r * flip;
    }).forEach((c) => grid.appendChild(c));
  } else if (st.sort === "upcoming") {
    const today = recToday();
    cards.sort((a, b) => {
      const x = recCardDate(a), y = recCardDate(b);
      const xp = !x || x <= today, yp = !y || y <= today;
      let r = 0;
      if (xp && yp) r = 0;
      else if (xp) r = 1;
      else if (yp) r = -1;
      else r = x < y ? -1 : x > y ? 1 : 0;
      return r * flip;
    }).forEach((c) => grid.appendChild(c));
  }
  updateRecSortMenu(section);
}
function resetRecSectionUI(section) {
  const st = recSectionState[section];
  if (st) { st.q = ""; st.sort = "alpha"; st.dir = REC_DEFAULT_DIR.alpha; try { saveRecFilter(section); } catch (_) {} }
  document.querySelectorAll(`.rec-search-input[data-section="${section}"]`).forEach((inp) => {
    inp.value = ""; inp.style.display = "none"; inp.classList.remove("open");
  });
  document.querySelectorAll(`.section-search[data-section="${section}"]`).forEach((b) => b.classList.remove("active"));
  updateRecSortMenu(section);
}
function updateRecSortMenu(section) {
  const st = recSectionState[section];
  const menu = document.querySelector(`.rec-sort-menu[data-section="${section}"]`);
  if (!menu) return;
  const today = recToday();
  const hasUpcoming = recSectionCards(section).cards.some((c) => {
    const d = recCardDate(c);
    return !!d && d > today;
  });
  menu.querySelectorAll(".sort-item").forEach((b) => {
    const k = b.dataset.sort;
    const active = !!st && st.sort === k;
    b.classList.toggle("active", active);
    try { b.querySelectorAll(".dir-arrow").forEach((a) => a.remove()); } catch (_) {}
    if (active) {
      try {
        const arrow = document.createElement("i");
        arrow.className = "dir-arrow fa-solid " + (st.dir === "asc" ? "fa-arrow-up" : "fa-arrow-down");
        arrow.setAttribute("aria-hidden", "true");
        b.prepend(arrow, document.createTextNode(" "));
      } catch (_) {}
    }
    const dis = k === "upcoming" && !hasUpcoming;
    b.disabled = dis;
    b.setAttribute("aria-disabled", dis ? "true" : "false");
  });
}
function toggleRecSortMenu(section, on) {
  const menu = document.querySelector(`.rec-sort-menu[data-section="${section}"]`);
  const btn = document.querySelector(`.section-filter[data-section="${section}"]`);
  if (!menu || !btn) return;
  document.querySelectorAll(".rec-sort-menu.open").forEach((m) => {
    if (m !== menu) {
      m.classList.remove("open");
      const b = document.querySelector(`.section-filter[data-section="${m.dataset.section}"]`);
      if (b) b.classList.remove("active");
    }
  });
  const open = typeof on === "boolean" ? on : !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  btn.classList.toggle("active", open);
  if (open && isTvUIActive()) {
    const first = menu.querySelector(".sort-item:not([disabled])");
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} } }
  }
}
function closeRecSortMenus() {
  document.querySelectorAll(".rec-sort-menu.open").forEach((m) => m.classList.remove("open"));
  document.querySelectorAll(".section-filter.active").forEach((b) => b.classList.remove("active"));
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

function recHideHandler(div, item, section) {
  // Gizlenen kart bilgi satırı + sıralama için ek alanlar taşınır (öneri kartındaki değerler).
  const body = item.anilist_id
    ? {
        anilist_id: item.anilist_id,
        title: item.title,
        poster_path: item.cover_url,
        score: item.score != null ? item.score / 10 : null,
        studios: item.studios || [],
        tv_status: item.status || "",
      }
    : {
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        title: item.title,
        poster_path: item.poster_path,
        vote_average: item.vote_average,
        release_date: item.release_date || "",
        networks: item.networks || [],
        tv_status: item.tv_status || "",
      };
  if (section === "docs") body.kind = "docs";
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
    div.dataset.sortTitle = item.title || "";
    let _rs = item.vote_average;
    if (_rs === undefined || _rs === null) _rs = item.score != null ? item.score / 10 : 0;
    div.dataset.sortScore = String(Number(_rs) || 0);
    div.dataset.sortDate = item.release_date || "";
    const moveBtn = recMoveBtnHTML(item);
    if (isAnime) {
      div.innerHTML = `
        ${animePosterHTML(item.cover_url, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            ${cardRows({
              type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
              score: item.score ? scoreTag(item.score / 10) : "",
              net: platformTag(item.studios),
              mid: animeEpMid(item),
              status: animeNextText(item.next_episode ? { episode: item.next_episode, airing_at: item.airing_at } : null, item.status),
              reserve: false,
            })}
          </div>
        </div>
        ${recHideBtnHTML(item)}
        ${moveBtn}
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
            () => recHideHandler(div, item, section),
            t("rec_hidden_toast", { name: item.title })
          );
        };
      }
      div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title, true);
    } else {
      const recBadge = (section === "docs")
        ? `<span class="badge badge-belgesel">${t("type_doc")}</span>`
        : `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`;
      div.innerHTML = `
        ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${item.title}</div>
        <div class="meta">
          ${cardRows({
            type: recBadge,
            score: scoreTag(item.vote_average),
            net: platformTag(item.networks),
            mid: item.media_type === "movie" ? recStatusLine(item, section) : seasonEpMid(item),
            status: item.media_type === "movie" ? "" : recStatusLine(item, section),
            reserve: false,
          })}
        </div>
        </div>
        ${recHideBtnHTML(item)}
        ${moveBtn}
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
            () => recHideHandler(div, item, section),
            t("rec_hidden_toast", { name: item.title })
          );
        };
      }
      div.onclick = () => openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true);
    }
    if (anchor) grid.insertBefore(div, anchor);
    else grid.appendChild(div);
    applyTitleHint(div);
  });
  try { applyRecSectionState(section); } catch (_) {}
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
  const media = { shows: "dizi", movies: "film", docs: "belgesel", anime: "anime" }[section] || "";
  const grid = document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
  const shown = currentRecIds(section);
  const needed = 12 - shown.length;
  if (needed <= 0 || !grid) return;
  const url = `/api/recommendations?media=${media}&exclude=${shown.join(",")}&limit=${needed}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("http " + res.status);
      const data = await res.json();
      const items = data.docs || data.shows || data.movies || data.anime || [];
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
  if (rb && rb.dataset.section === "feed") {
    if (!rb.classList.contains("loading")) {
      rb.classList.add("loading");
      loadFeed(true).finally(() => rb.classList.remove("loading"));
    }
    return;
  }
  if (rb && !rb.classList.contains("loading")) {
    const section = rb.dataset.section;
    const media = { shows: "dizi", movies: "film", docs: "belgesel", anime: "anime" }[section] || "";
    const grid = document.getElementById(section === "anime" ? "recommend-anime" : `recommend-${section}`);
    const toastKey = { shows: "recommend_refreshed_shows", movies: "recommend_refreshed_movies", docs: "recommend_refreshed_docs", anime: "recommend_refreshed_anime" }[section] || "recommend_refreshed_shows";
    rb.classList.add("loading");
    fetch(`/api/recommendations?media=${media}&refresh=1`)
      .then((res) => res.json())
      .then((data) => {
        const items = data.docs || data.shows || data.movies || data.anime || [];
        if (grid) {
          grid.innerHTML = "";
          resetRecSectionUI(section);
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

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest || !e.target.closest(".section-sort-wrap")) closeRecSortMenus();
});

// Acik bolum arama kutulari (.rec-search-input + hidden-modal kutusu):
// disari tiklaninca veya odak baska yere gecince kapat (yazi silinir,
// filtre sifirlanir; simgeye basip kapatmadaki mevcut davranisla ayni).
// Kapatma icin ilgili simgenin tiklanmasi tetiklenir (tek kapatma yolu).
function closeOpenSectionSearch() {
  document.querySelectorAll(".rec-search-input").forEach((inp) => {
    if (inp.style.display !== "block") return;
    const section = inp.dataset.section;
    const scope = inp.closest("[id^='view-']") || document;
    const btn = (scope.querySelector && scope.querySelector(`.section-search[data-section="${section}"]`))
      || document.querySelector(`.section-search[data-section="${section}"]`);
    if (btn && !btn.disabled) { btn.click(); return; }
    inp.value = ""; inp.style.display = "none"; inp.classList.remove("open");
    if (btn) btn.classList.remove("active");
    if (section && typeof recSectionState !== "undefined" && recSectionState[section]) {
      recSectionState[section].q = ""; applyRecSectionState(section);
    }
    if (section && typeof followSectionState !== "undefined" && followSectionState[section]) {
      followSectionState[section].q = ""; applyFollowSectionState(section);
    }
  });
  const hInp = document.getElementById("hidden-search-input");
  if (hInp && hInp.style.display === "block") {
    const hBtn = document.getElementById("hidden-search-btn");
    if (hBtn) hBtn.click();
  }
}
document.addEventListener("mousedown", (e) => {
  if (e.target.closest && e.target.closest(".rec-search-input, .section-search, #hidden-search-input, #hidden-search-btn")) return;
  closeOpenSectionSearch();
});
document.addEventListener("focusin", (e) => {
  if (e.target.closest && e.target.closest(".rec-search-input, .section-search, #hidden-search-input, #hidden-search-btn")) return;
  closeOpenSectionSearch();
});

(function wireRecSectionControls() {
  document.querySelectorAll(".section-search").forEach((btn) => {
    btn.onclick = () => {
      const section = btn.dataset.section;
      const inp = document.querySelector(`.rec-search-input[data-section="${section}"]`);
      if (!inp) return;
      const open = inp.style.display === "block";
      if (open) {
        inp.value = ""; inp.style.display = "none"; inp.classList.remove("open");
        btn.classList.remove("active");
        if (recSectionState[section]) recSectionState[section].q = "";
        applyRecSectionState(section);
      } else {
        inp.style.display = "block"; inp.classList.add("open"); btn.classList.add("active");
        inp.focus();
      }
    };
  });
  document.querySelectorAll(".section-filter").forEach((btn) => {
    btn.onclick = (e) => {
      if (e) e.stopPropagation();
      toggleRecSortMenu(btn.dataset.section);
    };
  });
  document.querySelectorAll(".rec-sort-menu .sort-item").forEach((btn) => {
    btn.onclick = (e) => {
      if (e) e.stopPropagation();
      if (btn.disabled) return;
      const menu = btn.closest(".rec-sort-menu");
      const section = menu ? menu.dataset.section : "";
      if (section && recSectionState[section]) {
        const key = btn.dataset.sort;
        const st = recSectionState[section];
        if (st.sort === key) {
          st.dir = st.dir === "asc" ? "desc" : "asc";
          saveRecFilter(section);
          applyRecSectionState(section);
        } else {
          st.sort = key;
          st.dir = REC_DEFAULT_DIR[key] || "asc";
          saveRecFilter(section);
          applyRecSectionState(section);
          toggleRecSortMenu(section, false);
          if (isTvUIActive()) {
            const b = document.querySelector(`.section-filter[data-section="${section}"]`);
            if (b) { try { b.focus({ preventScroll: true }); } catch (_) { try { b.focus(); } catch (_) {} } }
          }
        }
      }
    };
  });
  document.querySelectorAll(".rec-search-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const section = inp.dataset.section;
      if (section && recSectionState[section]) {
        recSectionState[section].q = (inp.value || "").trim();
        applyRecSectionState(section);
      }
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const btn = document.querySelector(`.section-search[data-section="${inp.dataset.section}"]`);
        if (btn) btn.click();
      }
      e.stopPropagation();
    });
  });
})();

// Takip görünümleri bölüm başlıkları: liste-içi arama (bölüm başına bağımsız, öneri deseni).
// Not: jenerik wireRecSectionControls da bu butonlara .onclick bağlar; aşağıdaki
// kablolama sonra çalıştığı için takip butonlarında onunki ezilir (çift toggle yok).
// Jenerik input/keydown dinleyicileri recSectionState bulamayınca zaten atlar.
// "anime" adı öneriler+izlenmemişle paylaşılır — çakışmaması için anime "anime-list" kullanır.
// Her bölümün filtre (sıralama + yön) seçimi localStorage'da hatırlanır.
const FOLLOW_DEFAULT_DIR = { added: "desc", alpha: "asc", score: "desc", date: "asc", type: "asc" };
const FOLLOW_NO_DATE = new Set(["watched-shows", "watched-movies", "watched-docs", "watched-anime"]);
function followFilterKey(section) { return "followFilter_" + section; }
function followFilterDirKey(section) { return "followFilterDir_" + section; }
function loadFollowFilter(section) {
  let s = "added";
  try { s = localStorage.getItem(followFilterKey(section)) || "added"; } catch (_) {}
  if (!FOLLOW_DEFAULT_DIR[s]) s = "added";
  if (FOLLOW_NO_DATE.has(section) && s === "date") s = "added";
  let d = FOLLOW_DEFAULT_DIR[s];
  try { d = localStorage.getItem(followFilterDirKey(section)) || d; } catch (_) {}
  if (d !== "asc" && d !== "desc") d = FOLLOW_DEFAULT_DIR[s];
  return { sort: s, dir: d };
}
function saveFollowFilter(section) {
  try {
    const st = followSectionState[section];
    if (!st) return;
    localStorage.setItem(followFilterKey(section), st.sort);
    localStorage.setItem(followFilterDirKey(section), st.dir);
  } catch (_) {}
}
const followSectionState = {
  dizi: Object.assign({ q: "" }, loadFollowFilter("dizi")),
  "dizi-later": Object.assign({ q: "" }, loadFollowFilter("dizi-later")),
  film: Object.assign({ q: "" }, loadFollowFilter("film")),
  "film-later": Object.assign({ q: "" }, loadFollowFilter("film-later")),
  belgesel: Object.assign({ q: "" }, loadFollowFilter("belgesel")),
  "belgesel-later": Object.assign({ q: "" }, loadFollowFilter("belgesel-later")),
  "anime-list": Object.assign({ q: "" }, loadFollowFilter("anime-list")),
  "anime-list-later": Object.assign({ q: "" }, loadFollowFilter("anime-list-later")),
  "unwatched-shows": Object.assign({ q: "" }, loadFollowFilter("unwatched-shows")),
  "unwatched-movies": Object.assign({ q: "" }, loadFollowFilter("unwatched-movies")),
  "unwatched-docs": Object.assign({ q: "" }, loadFollowFilter("unwatched-docs")),
  "unwatched-anime": Object.assign({ q: "" }, loadFollowFilter("unwatched-anime")),
  "watched-shows": Object.assign({ q: "" }, loadFollowFilter("watched-shows")),
  "watched-movies": Object.assign({ q: "" }, loadFollowFilter("watched-movies")),
  "watched-docs": Object.assign({ q: "" }, loadFollowFilter("watched-docs")),
  "watched-anime": Object.assign({ q: "" }, loadFollowFilter("watched-anime")),
  "archive-shows": Object.assign({ q: "" }, loadFollowFilter("archive-shows")),
  "archive-movies": Object.assign({ q: "" }, loadFollowFilter("archive-movies")),
  "archive-docs": Object.assign({ q: "" }, loadFollowFilter("archive-docs")),
  "archive-anime": Object.assign({ q: "" }, loadFollowFilter("archive-anime")),
};
const followSectionGridId = {
  dizi: "poster-grid-shows",
  "dizi-later": "poster-grid-shows-later",
  film: "poster-grid-movies",
  "film-later": "poster-grid-movies-later",
  belgesel: "poster-grid-docs",
  "belgesel-later": "poster-grid-docs-later",
  "anime-list": "anime-grid",
  "anime-list-later": "anime-grid-later",
  "unwatched-shows": "unwatched-shows",
  "unwatched-movies": "unwatched-movies",
  "unwatched-docs": "unwatched-docs",
  "unwatched-anime": "unwatched-anime",
  "watched-shows": "watched-shows",
  "watched-movies": "watched-movies",
  "watched-docs": "watched-docs",
  "watched-anime": "watched-anime",
  "archive-shows": "archive-shows",
  "archive-movies": "archive-movies",
  "archive-docs": "archive-docs",
  "archive-anime": "archive-anime",
};
const followSectionView = {
  dizi: "view-dizi",
  "dizi-later": "view-dizi",
  film: "view-film",
  "film-later": "view-film",
  belgesel: "view-belgesel",
  "belgesel-later": "view-belgesel",
  "anime-list": "view-anime",
  "anime-list-later": "view-anime",
  "unwatched-shows": "view-unwatched",
  "unwatched-movies": "view-unwatched",
  "unwatched-docs": "view-unwatched",
  "unwatched-anime": "view-unwatched",
  "watched-shows": "view-watched",
  "watched-movies": "view-watched",
  "watched-docs": "view-watched",
  "watched-anime": "view-watched",
  "archive-shows": "view-archive",
  "archive-movies": "view-archive",
  "archive-docs": "view-archive",
  "archive-anime": "view-archive",
};
function followSectionGrid(section) {
  const id = followSectionGridId[section];
  return id ? document.getElementById(id) : null;
}
// Takip kartı sıralama verisi (öneri kartlarındaki dataset.sort* deseni).
function followSortDateISO(item, typeOverride) {
  try {
    const isAnime = item.isAnime || item.anilist_id || typeOverride === "anime";
    if (isAnime) {
      const at = item.items && item.items[0] ? item.items[0].air_at : null;
      if (at) return new Date(at * 1000).toISOString();
      if (item.next_episode && item.next_episode.airing_at) return new Date(item.next_episode.airing_at * 1000).toISOString();
      return "";
    }
    if (item.media_type === "tv") return (item.next_episode && item.next_episode.air_date) || (item.items && item.items[0] && item.items[0].air_date) || "";
    if (item.items && item.items[0] && item.items[0].air_date) return item.items[0].air_date;
    return item.release_date || "";
  } catch (_) { return ""; }
}
function setFollowSortAttrs(div, item, typeOverride) {
  try {
    div.dataset.sortTitle = item.title || "";
    const sc = item.score != null ? item.score : (item.vote_average || 0);
    div.dataset.sortScore = String(Number(sc) || 0);
    div.dataset.sortDate = followSortDateISO(item, typeOverride);
    div.dataset.sortAdded = String(item.id || 0);
    const isAnime = item.isAnime || item.anilist_id || typeOverride === "anime";
    div.dataset.sortType = isAnime ? "anime" : item.media_type || item.format || "";
  } catch (_) {}
}
function followStrCmp(a, b) {
  const x = String(a || "").toLocaleLowerCase(), y = String(b || "").toLocaleLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
// Global compareItems'ın bölüm-parametreli karşılığı: baz yönde karşılaştır, dir tersse çevir.
function compareFollowCards(a, b, key, dir) {
  let r = 0;
  try {
    if (key === "added") {
      r = (Number((b.dataset && b.dataset.sortAdded) || 0)) - (Number((a.dataset && a.dataset.sortAdded) || 0));
    } else if (key === "score") {
      r = (Number((b.dataset && b.dataset.sortScore) || 0)) - (Number((a.dataset && a.dataset.sortScore) || 0));
    } else if (key === "type") {
      r = followStrCmp(a.dataset && a.dataset.sortType, b.dataset && b.dataset.sortType);
    } else if (key === "date") {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const av = (a.dataset && a.dataset.sortDate) || "", bv = (b.dataset && b.dataset.sortDate) || "";
      const aPast = !av || av < today, bPast = !bv || bv < today;
      if (aPast && !bPast) r = 1;
      else if (!aPast && bPast) r = -1;
      else if (av === bv) r = 0;
      else if (!av) r = 1;
      else if (!bv) r = -1;
      else if (aPast && bPast) r = av < bv ? 1 : -1;
      else r = av < bv ? -1 : 1;
    } else {
      r = followStrCmp(a.dataset && (a.dataset.sortTitle || ((a.querySelector(".title") || {}).textContent)), b.dataset && (b.dataset.sortTitle || ((b.querySelector(".title") || {}).textContent)));
    }
  } catch (_) { r = 0; }
  const def = FOLLOW_DEFAULT_DIR[key] || "asc";
  return dir === def ? r : -r;
}
function applyFollowSectionState(section) {
  const st = followSectionState[section];
  const grid = followSectionGrid(section);
  if (!st || !grid) return;
  const q = (st.q || "").toLocaleLowerCase();
  const cards = Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card"));
  cards.forEach((c) => {
    let title = "";
    try { title = ((c.querySelector(".title") || {}).textContent) || ""; } catch (_) {}
    c.style.display = (!q || title.toLocaleLowerCase().includes(q)) ? "" : "none";
  });
  const key = st.sort || "added";
  const dir = st.dir || FOLLOW_DEFAULT_DIR[key] || "asc";
  if (cards.length > 1) {
    try { cards.sort((a, b) => compareFollowCards(a, b, key, dir)).forEach((c) => grid.appendChild(c)); } catch (_) {}
  }
}
// İkiden az kartlı bölümde arama + filtre simgeleri kilitlenir (üst/alt bölüm ayrı sayılır).
function updateFollowSectionControls(section) {
  const grid = followSectionGrid(section);
  if (!grid) return;
  const n = Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card")).length;
  const dis = n < 2;
  const viewId = followSectionView[section] || "view-dizi";
  const scope = document.getElementById(viewId);
  if (!scope) return;
  [`.section-search[data-section="${section}"]`, `.section-filter[data-section="${section}"]`].forEach((sel) => {
    const b = scope.querySelector(sel);
    if (!b) return;
    b.disabled = dis;
    b.setAttribute("aria-disabled", dis ? "true" : "false");
  });
  if (dis) {
    try {
      const menu = document.querySelector(`.follow-sort-menu[data-section="${section}"]`);
      if (menu) menu.classList.remove("open");
      const fb = scope.querySelector(`.section-filter[data-section="${section}"]`);
      if (fb) fb.classList.remove("active");
    } catch (_) {}
  }
}
// ---- Bölüm özeti (dotted çizgi altı): sayı | bölüm | izlenmiş/izlenmemiş saat ----
const SUMMARY_KIND_KEY = { shows: "summary_shows", movies: "summary_films", docs: "summary_docs", anime: "summary_anime" };
const SUMMARY_HAS_HOURS = { shows: true, movies: true, docs: true, anime: true };
const SUMMARY_HAS_EPISODES = { shows: true, movies: false, docs: true, anime: true };

function fmtSummaryTime(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(min / 60);
  return h + ":" + String(min % 60).padStart(2, "0");
}

function tagCardStats(div, item, kind, min) {
  try {
    const eps = item.total_eps != null ? (Number(item.total_eps) || 0)
      : item.total != null ? (Number(item.total) || 0)
      : (kind === "movies" || (kind === "docs" && item.media_type === "movie") ? 1 : 0);
    const weps = item.watched_eps != null ? (Number(item.watched_eps) || 0)
      : item.watched != null ? (Number(item.watched) || 0)
      : 0;
    div.dataset.sumKind = kind || "";
    div.dataset.sumEps = String(eps);
    div.dataset.sumWeps = String(weps);
    div.dataset.sumWmin = String(Number(item.watched_min) || 0);
    div.dataset.sumUmin = String(Number(item.unwatched_min) || 0);
  } catch (_) {}
}

function rowSectionWrap(grid) {
  try {
    const w = grid && grid.closest ? grid.closest('div[id$="-wrap"]') : null;
    if (w) return w;
  } catch (_) {}
  return grid ? grid.parentElement : null;
}

function ensureSectionSummary(wrap) {
  if (!wrap) return null;
  let s = null;
  try { s = wrap.querySelector(":scope > .section-summary"); } catch (_) {}
  if (!s) {
    s = document.createElement("div");
    s.className = "section-summary";
    try {
      const h2 = wrap.querySelector(":scope > h2.unwatched-section-title");
      // Serit bolumunde grid yerine .nextup-strip var; ikisini de ara ki ozet
      // satiri h2'nin HEMEN ALTINA (kartlarin USTUNE) gelsin.
      let grid = null;
      try { grid = wrap.querySelector(":scope > .poster-grid, :scope > .nextup-strip"); } catch (_) { grid = null; }
      if (!grid) grid = wrap.querySelector(".poster-grid, .nextup-strip");
      if (h2 && grid) h2.after(s);
      else if (grid) grid.before(s);
      else wrap.appendChild(s);
    } catch (_) { wrap.appendChild(s); }
  }
  return s;
}

function renderSectionSummary(grid) {
  if (!grid) return;
  const wrap = rowSectionWrap(grid);
  if (wrap && wrap.closest && wrap.closest("#view-recommend")) return;
  const summary = ensureSectionSummary(wrap);
  if (!summary) return;
  const cards = Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card"));
  if (!cards.length) { summary.textContent = ""; return; }
  let eps = 0, weps = 0, ueps = 0, wmin = 0, umin = 0, hours = 0, kind = "";
  cards.forEach((c) => {
    const k = c.dataset.sumKind || "";
    if (!kind) kind = k;
    const e = Number(c.dataset.sumEps) || 0;
    const w = Number(c.dataset.sumWeps) || 0;
    eps += e;
    weps += w;
    ueps += (e - w);
    if (SUMMARY_HAS_HOURS[k]) {
      hours = 1;
      wmin += Number(c.dataset.sumWmin) || 0;
      umin += Number(c.dataset.sumUmin) || 0;
    }
  });
  const nounKey = SUMMARY_KIND_KEY[kind] || "summary_shows";
  const parts = [t(nounKey, { n: cards.length })];
  if (SUMMARY_HAS_EPISODES[kind] && eps > 0) parts.push(t("summary_episodes", { n: eps }));
  const inUnwatched = !!(wrap && wrap.closest && wrap.closest("#view-unwatched"));
  const inWatched = !!(wrap && wrap.closest && wrap.closest("#view-watched"));
  if (!inUnwatched && hours && weps > 0 && wmin > 0) {
    const key = kind === "movies" ? "summary_watched_movies" : "summary_watched";
    parts.push(t(key, { n: weps, t: fmtSummaryTime(wmin) }));
  }
  if (!inWatched && hours && ueps > 0 && umin > 0) {
    const key = kind === "movies" ? "summary_unwatched_movies" : "summary_unwatched";
    parts.push(t(key, { n: ueps, t: fmtSummaryTime(umin) }));
  }
  summary.textContent = parts.join(" | ");
}

// Kart kaldırıldıktan sonra bölümün arama/sıralama + wrap/empty görünürlüğü + özeti yenilenir.
function refreshSectionAfterCardRemove(sectionKey, grid) {
  if (!grid) grid = followSectionGrid(sectionKey);
  if (!grid) return;
  try { applyFollowSectionState(sectionKey); } catch (_) {}
  try { updateFollowSectionControls(sectionKey); } catch (_) {}
  renderSectionSummary(grid);
  const wrap = rowSectionWrap(grid);
  if (wrap) wrap.style.display = grid.querySelector(".card") ? "" : "none";
  const viewId = followSectionView[sectionKey] || "";
  if (viewId) {
    const view = document.getElementById(viewId);
    if (view) {
      const emptyEl = view.querySelector(".empty");
      if (emptyEl) {
        let any = false;
        view.querySelectorAll(".poster-grid").forEach((g) => { if (g.querySelector(".card")) any = true; });
        emptyEl.style.display = any ? "none" : "block";
      }
    }
  }
}

function optimisticMoveCard(div, reqFn, okMsg, sectionKey) {
  const grid = div.parentElement;
  const next = div.nextElementSibling;
  const rollback = () => {
    if (grid && next) grid.insertBefore(div, next);
    else if (grid) grid.appendChild(div);
  };
  div.remove();
  refreshSectionAfterCardRemove(sectionKey, grid);
  reqFn().then(async (r) => {
    let j = {};
    try { j = await r.json(); } catch (_) { j = {}; }
    if (!r.ok) {
      rollback();
      refreshSectionAfterCardRemove(sectionKey, grid);
      toast((j && j.error) || t("error"));
      return;
    }
    if (okMsg) toast(okMsg);
    notifyListsRefreshed();
  }).catch(() => {
    rollback();
    refreshSectionAfterCardRemove(sectionKey, grid);
    toast(t("error"));
  });
}
document.addEventListener("app:langchange", () => {
  document.querySelectorAll(".poster-grid, .nextup-strip").forEach((g) => renderSectionSummary(g));
  renderFeedUpdateInfo(_feedUpdateCache);
});
function notifyListsRefreshed() {
  try { document.dispatchEvent(new CustomEvent("app:lists-refreshed")); } catch (_) {}
}
// Dis kaynak (Stremio eklentisi / baska istemci) yazdi -> aktif gorunumu tazele
// (seritler de yukleyici icinde yenilenir).
document.addEventListener("app:external-refresh", () => {
  try { refreshListsAfterWatch(); } catch (_) {}
});
(function wireFollowSearch() {
  document.querySelectorAll("#view-dizi .section-search, #view-film .section-search, #view-belgesel .section-search, #view-anime .section-search, #view-unwatched .section-search, #view-watched .section-search, #view-archive .section-search").forEach((btn) => {
    btn.onclick = () => {
      const section = btn.dataset.section;
      const viewId = followSectionView[section] || "view-dizi";
      const inp = document.querySelector(`#${viewId} .rec-search-input[data-section="${section}"]`);
      if (!inp) return;
      const open = inp.style.display === "block";
      if (open) {
        inp.value = ""; inp.style.display = "none"; inp.classList.remove("open");
        btn.classList.remove("active");
        if (followSectionState[section]) followSectionState[section].q = "";
        applyFollowSectionState(section);
      } else {
        inp.style.display = "block"; inp.classList.add("open"); btn.classList.add("active");
        inp.focus();
      }
    };
  });
  document.querySelectorAll("#view-dizi .rec-search-input, #view-film .rec-search-input, #view-belgesel .rec-search-input, #view-anime .rec-search-input, #view-unwatched .rec-search-input, #view-watched .rec-search-input, #view-archive .rec-search-input").forEach((inp) => {
    inp.addEventListener("input", () => {
      const section = inp.dataset.section;
      if (section && followSectionState[section]) {
        followSectionState[section].q = (inp.value || "").trim();
        applyFollowSectionState(section);
      }
    });
    inp.addEventListener("keydown", (e) => {
      // Jenerik dinleyici önce çalışıp kapatmışsa (display none) ikinci kez tıklatma.
      if (e.key === "Escape" && inp.style.display === "block") {
        const section = inp.dataset.section;
        const viewId = followSectionView[section] || "view-dizi";
        const btn = document.querySelector(`#${viewId} .section-search[data-section="${section}"]`);
        if (btn) btn.click();
      }
      e.stopPropagation();
    });
  });
})();

// Takip bölümleri filtre (sıralama) menüleri: jenerik wireRecSectionControls .section-filter
// bağını ezer (takip arama ezmesiyle aynı desen). Aynı seçeneğe 2. tıklama yönü
// çevirir ve menü açık kalır; farklı seçim varsayılan yönle kapanır.
function closeFollowSortMenus() {
  try {
    document.querySelectorAll(".follow-sort-menu.open").forEach((m) => m.classList.remove("open"));
    document.querySelectorAll("#view-dizi .section-filter.active, #view-film .section-filter.active, #view-belgesel .section-filter.active, #view-anime .section-filter.active, #view-unwatched .section-filter.active, #view-watched .section-filter.active, #view-archive .section-filter.active").forEach((b) => b.classList.remove("active"));
  } catch (_) {}
}
function updateFollowSortMenu(section) {
  const menu = document.querySelector(`.follow-sort-menu[data-section="${section}"]`);
  const st = followSectionState[section];
  if (!menu || !st) return;
  menu.querySelectorAll(".sort-item").forEach((b) => {
    const active = b.dataset.sort === st.sort;
    b.classList.toggle("active", active);
    try { b.querySelectorAll(".dir-arrow").forEach((a) => a.remove()); } catch (_) {}
    if (active) {
      try {
        const arrow = document.createElement("i");
        arrow.className = "dir-arrow fa-solid " + (st.dir === "asc" ? "fa-arrow-up" : "fa-arrow-down");
        arrow.setAttribute("aria-hidden", "true");
        b.prepend(arrow, document.createTextNode(" "));
      } catch (_) {}
    }
  });
}
function toggleFollowSortMenu(section, force) {
  const menu = document.querySelector(`.follow-sort-menu[data-section="${section}"]`);
  if (!menu) return;
  const viewId = followSectionView[section] || "view-dizi";
  const scope = document.getElementById(viewId);
  const btn = scope ? scope.querySelector(`.section-filter[data-section="${section}"]`) : null;
  const willOpen = force !== undefined ? !!force : !menu.classList.contains("open");
  closeFollowSortMenus();
  try { closeRecSortMenus(); } catch (_) {}
  if (willOpen) {
    updateFollowSortMenu(section);
    menu.classList.add("open");
    if (btn) btn.classList.add("active");
    if (isTvUIActive()) {
      const first = menu.querySelector(".sort-item:not([disabled])");
      if (first) { try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} } }
    }
  }
}
(function wireFollowFilter() {
  document.querySelectorAll("#view-dizi .section-filter, #view-film .section-filter, #view-belgesel .section-filter, #view-anime .section-filter, #view-unwatched .section-filter, #view-watched .section-filter, #view-archive .section-filter").forEach((btn) => {
    btn.onclick = (e) => {
      if (e) e.stopPropagation();
      if (btn.disabled) return;
      toggleFollowSortMenu(btn.dataset.section);
    };
  });
  document.querySelectorAll(".follow-sort-menu .sort-item").forEach((btn) => {
    btn.onclick = (e) => {
      if (e) e.stopPropagation();
      if (btn.disabled) return;
      const menu = btn.closest(".follow-sort-menu");
      const section = menu ? menu.dataset.section : "";
      const st = section && followSectionState[section];
      if (!st) return;
      const key = btn.dataset.sort;
      if (st.sort === key) {
        st.dir = st.dir === "asc" ? "desc" : "asc";
        saveFollowFilter(section);
        applyFollowSectionState(section);
        updateFollowSortMenu(section);
      } else {
        st.sort = key;
        st.dir = FOLLOW_DEFAULT_DIR[key] || "asc";
        saveFollowFilter(section);
        applyFollowSectionState(section);
        toggleFollowSortMenu(section, false);
        if (isTvUIActive()) {
          const viewId = followSectionView[section] || "view-dizi";
          const scope = document.getElementById(viewId);
          const b = scope ? scope.querySelector(`.section-filter[data-section="${section}"]`) : null;
          if (b) { try { b.focus({ preventScroll: true }); } catch (_) { try { b.focus(); } catch (_) {} } }
        }
      }
    };
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest || !e.target.closest(".follow-sort-wrap")) closeFollowSortMenus();
  });
})();

function hiddenPosterSrc(poster) {
  if (!poster) return "";
  return poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w185${poster}`;
}

let hiddenItemsCache = [];
let hiddenSort = "alpha";
let hiddenSortDir = "asc";
const HIDDEN_DEFAULT_DIR = { alpha: "asc", score: "desc", vision: "desc", upcoming: "asc" };
function loadHiddenFilter() {
  try {
    const s = localStorage.getItem("hiddenFilter");
    if (s && HIDDEN_DEFAULT_DIR[s]) {
      hiddenSort = s;
      const d = localStorage.getItem("hiddenFilterDir");
      hiddenSortDir = (d === "asc" || d === "desc") ? d : HIDDEN_DEFAULT_DIR[s];
      return;
    }
  } catch (_) {}
  hiddenSort = "alpha";
  hiddenSortDir = "asc";
}
function saveHiddenFilter() {
  try {
    localStorage.setItem("hiddenFilter", hiddenSort);
    localStorage.setItem("hiddenFilterDir", hiddenSortDir);
  } catch (_) {}
}
loadHiddenFilter();

const HIDDEN_MEDIA = { shows: "dizi", movies: "film", docs: "belgesel", anime: "anime" };
function setHiddenButtonDisabled(section, disabled) {
  document.querySelectorAll(`#view-recommend .section-hide[data-section="${section}"]`).forEach((b) => {
    b.disabled = !!disabled;
  });
}
async function refreshHiddenButton(section) {
  const media = HIDDEN_MEDIA[section] || "";
  if (!media) return;
  try {
    const res = await fetch(`/api/recommendations/hidden?media=${encodeURIComponent(media)}`);
    const data = await res.json();
    const items = (data && data.items) || [];
    setHiddenButtonDisabled(section, items.length === 0);
  } catch (_) {
    // Durum bilinemiyorsa buton aktif kalsin (yanlis solukluk olmasin).
  }
}

async function openHiddenModal(section) {
  const modal = document.getElementById("hidden-modal");
  const listEl = document.getElementById("hidden-list");
  const input = document.getElementById("hidden-search-input");
  if (!modal || !listEl) return;
  modal.dataset.section = section;
  const titleEl = document.getElementById("hidden-title");
  if (titleEl) {
    const key = { shows: "hidden_title_shows", movies: "hidden_title_movies", docs: "hidden_title_docs", anime: "hidden_title_anime" }[section];
    titleEl.setAttribute("data-i18n", key || "hidden_title");
    titleEl.textContent = t(key || "hidden_title");
  }
  hiddenItemsCache = [];
  loadHiddenFilter();
  const fBtn = document.getElementById("hidden-filter-btn");
  if (fBtn) fBtn.classList.remove("active");
  const fMenu = document.getElementById("hidden-sort-menu");
  if (fMenu) fMenu.classList.remove("open");
  if (input) {
    input.value = "";
    input.classList.remove("open");
    input.style.display = "none";
  }
  const sBtn = document.getElementById("hidden-search-btn");
  if (sBtn) sBtn.classList.remove("active");
  listEl.innerHTML = `<div class="hidden-loading muted">${t("loading")}</div>`;
  modal.style.display = "flex";
  const media = { shows: "dizi", movies: "film", docs: "belgesel", anime: "anime" }[section] || "";
  try {
    const res = await fetch(`/api/recommendations/hidden?media=${encodeURIComponent(media)}`);
    const data = await res.json();
    hiddenItemsCache = (data && data.items) || [];
    setHiddenButtonDisabled(section, hiddenItemsCache.length === 0);
    renderHiddenList(hiddenItemsCache, currentHiddenFilter());
  } catch (err) {
    listEl.innerHTML = "";
  }
}

function currentHiddenFilter() {
  const input = document.getElementById("hidden-search-input");
  return (input && input.style.display === "block" ? (input.value || "").trim().toLowerCase() : "");
}

function sortHiddenItems(items) {
  const arr = [...items];
  const flip = hiddenSortDir === (HIDDEN_DEFAULT_DIR[hiddenSort] || "asc") ? 1 : -1;
  if (hiddenSort === "score") {
    arr.sort((a, b) => ((Number(b.score) || 0) - (Number(a.score) || 0)) * flip);
  } else if (hiddenSort === "vision") {
    arr.sort((a, b) => {
      const x = a.release_date || "", y = b.release_date || "";
      let r = 0;
      if (!x && !y) r = 0;
      else if (!x) r = 1;
      else if (!y) r = -1;
      else r = x < y ? 1 : x > y ? -1 : 0;
      return r * flip;
    });
  } else if (hiddenSort === "upcoming") {
    const today = recToday();
    arr.sort((a, b) => {
      const x = a.release_date || "", y = b.release_date || "";
      const xp = !x || x <= today, yp = !y || y <= today;
      let r = 0;
      if (xp && yp) r = 0;
      else if (xp) r = 1;
      else if (yp) r = -1;
      else r = x < y ? -1 : x > y ? 1 : 0;
      return r * flip;
    });
  } else {
    arr.sort((a, b) => {
      const x = (a.title || "").toLocaleLowerCase(), y = (b.title || "").toLocaleLowerCase();
      return (x < y ? -1 : x > y ? 1 : 0) * flip;
    });
  }
  return arr;
}

function updateHiddenSortMenu() {
  const menu = document.getElementById("hidden-sort-menu");
  if (!menu) return;
  const hasScore = hiddenItemsCache.some((h) => Number(h.score) > 0);
  const hasDate = hiddenItemsCache.some((h) => !!h.release_date);
  const today = recToday();
  const hasUpcoming = hiddenItemsCache.some((h) => h.release_date && h.release_date > today);
  menu.querySelectorAll(".sort-item").forEach((b) => {
    const k = b.dataset.sort;
    const active = hiddenSort === k;
    b.classList.toggle("active", active);
    try { b.querySelectorAll(".dir-arrow").forEach((a) => a.remove()); } catch (_) {}
    if (active) {
      try {
        const arrow = document.createElement("i");
        arrow.className = "dir-arrow fa-solid " + (hiddenSortDir === "asc" ? "fa-arrow-up" : "fa-arrow-down");
        arrow.setAttribute("aria-hidden", "true");
        b.prepend(arrow, document.createTextNode(" "));
      } catch (_) {}
    }
    const dis = (k === "score" && !hasScore) || (k === "vision" && !hasDate) || (k === "upcoming" && !hasUpcoming);
    b.disabled = dis;
    b.setAttribute("aria-disabled", dis ? "true" : "false");
  });
}

function toggleHiddenSortMenu(on) {
  const menu = document.getElementById("hidden-sort-menu");
  const btn = document.getElementById("hidden-filter-btn");
  if (!menu || !btn) return;
  const open = typeof on === "boolean" ? on : !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  btn.classList.toggle("active", open);
  if (open && isTvUIActive()) {
    const first = menu.querySelector(".sort-item:not([disabled])");
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} } }
  }
}

function renderHiddenList(items, filter) {
  const modal = document.getElementById("hidden-modal");
  const listEl = document.getElementById("hidden-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const section = modal ? modal.dataset.section : "";
  sortHiddenItems(items).forEach((h) => {
    if (filter && !(h.title || "").toLowerCase().includes(filter)) return;
    const tile = document.createElement("div");
    tile.className = "hidden-tile";
    const src = hiddenPosterSrc(h.poster);
    let badge = "";
    if (section === "docs") badge = `<span class="badge badge-belgesel">${t("type_doc")}</span>`;
    else if (section === "anime") badge = `<span class="badge badge-anime">${t("tab_anime")}</span>`;
    else if (h.media_type) badge = `<span class="badge badge-${h.media_type}">${typeLabel(h.media_type)}</span>`;
    const score = (h.score != null && Number(h.score) > 0) ? scoreTag(h.score) : "";
    const nets = (h.networks && h.networks.length) ? h.networks : h.studios;
    const network = platformTag(nets);
    let status = recStatusLine(h, section);
    if (section === "anime" && h.tv_status) {
      status = `<div class="next-ep muted">${animeStatusLabel(h.tv_status)}</div>`;
    }
    const meta = `<div class="hidden-meta">
      <div class="hidden-meta-row">${badge}${score}</div>
      <div class="hidden-meta-net">${network || ""}</div>
      <div class="hidden-meta-status">${status || ""}</div>
    </div>`;
    tile.innerHTML = `
      ${src ? `<img class="hidden-poster" src="${src}" alt="" loading="lazy" />` : `<span class="hidden-poster hidden-poster-empty"></span>`}
      <button class="hidden-restore" data-tip="${t("hidden_unhide")}"><i class="fa-solid fa-ban"></i></button>
      <div class="hidden-name" title="${h.title || "#" + h.id}">${h.title || "#" + h.id}</div>
      ${meta}
    `;
    tile.querySelector(".hidden-restore").onclick = async () => {
      try {
        const res = await fetch("/api/recommendations/unhide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: modal ? modal.dataset.section : "", id: h.id }),
        });
        if (!res.ok) throw new Error("http " + res.status);
        // TV: odak çöpe düşmesin — önce komşu kartın unhide butonu, yoksa header
        let tvNext = null;
        try {
          if (isTvUIActive()) {
            const sib = tile.nextElementSibling || tile.previousElementSibling;
            tvNext = (sib && sib.querySelector && sib.querySelector(".hidden-restore")) || document.getElementById("hidden-search-btn");
          }
        } catch {}
        tile.remove();
        if (!listEl.querySelector(".hidden-tile")) {
          modal.style.display = "none";
          setHiddenButtonDisabled(modal.dataset.section, true);
        } else if (tvNext && document.contains(tvNext)) {
          try { tvNext.focus({ preventScroll: true }); } catch (_) { try { tvNext.focus(); } catch (_) {} }
        }
      } catch (err) {
        toast(t("error"));
      }
    };
    listEl.appendChild(tile);
  });
  updateHiddenSortMenu();
  equalizeHiddenRows();
  // TV: açılışta odak ilk kartın unhide butonunda (header'a değil).
  // Filtre yazarken (input odakta) ve sıralama menüsünde çalma.
  try {
    if (isTvUIActive() && modal && modal.style.display !== "none") {
      const ae = document.activeElement;
      const inModal = !!(ae && modal.contains(ae));
      const typing = !!(ae && (ae.id === "hidden-search-input" || (ae.closest && ae.closest(".hidden-sort-wrap"))));
      if (!typing && (!inModal || ae === document.body)) {
        const first = listEl.querySelector(".hidden-tile .hidden-restore");
        if (first) first.focus({ preventScroll: true });
      }
    }
  } catch (_) { try {
    if (isTvUIActive() && modal && modal.style.display !== "none") {
      const first = listEl.querySelector(".hidden-tile .hidden-restore");
      if (first && document.activeElement !== first) first.focus();
    }
  } catch (_) {} }
}

// Gizli kart satır hizalama: isim + 3 meta slotunun gerçek yüksekliğini ölçüp
// listedeki en büyüğe eşitler. Tek satır isim altına boşluk kazanır; rozet/
// yayıncı/statü her kartta aynı dikeyde başlar. CSS varsayımına dayanmaz.
function equalizeHiddenRows() {
  const listEl = document.getElementById("hidden-list");
  if (!listEl) return;
  [" .hidden-meta-row"].forEach((sel) => {
    const els = Array.from(listEl.querySelectorAll(".hidden-tile" + sel));
    if (!els.length) return;
    els.forEach((el) => { el.style.height = ""; });
    let max = 0;
    els.forEach((el) => { max = Math.max(max, el.offsetHeight); });
    if (max > 0) els.forEach((el) => { el.style.height = max + "px"; });
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

function wireHiddenSort() {
  const btn = document.getElementById("hidden-filter-btn");
  const menu = document.getElementById("hidden-sort-menu");
  if (!btn || !menu) return;
  btn.onclick = (e) => {
    if (e) e.stopPropagation();
    toggleHiddenSortMenu();
  };
  menu.querySelectorAll(".sort-item").forEach((b) => {
    b.onclick = (e) => {
      if (e) e.stopPropagation();
      if (b.disabled) return;
      const key = b.dataset.sort;
      if (hiddenSort === key) {
        hiddenSortDir = hiddenSortDir === "asc" ? "desc" : "asc";
        saveHiddenFilter();
        renderHiddenList(hiddenItemsCache, currentHiddenFilter());
      } else {
        hiddenSort = key;
        hiddenSortDir = HIDDEN_DEFAULT_DIR[key] || "asc";
        saveHiddenFilter();
        renderHiddenList(hiddenItemsCache, currentHiddenFilter());
        toggleHiddenSortMenu(false);
        if (isTvUIActive()) {
          try { btn.focus({ preventScroll: true }); } catch (_) { try { btn.focus(); } catch (_) {} }
        }
      }
    };
  });
}

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest || !e.target.closest(".hidden-sort-wrap")) {
    const menu = document.getElementById("hidden-sort-menu");
    if (menu && menu.classList.contains("open")) toggleHiddenSortMenu(false);
  }
});

(function wireHiddenModal() {
  const modal = document.getElementById("hidden-modal");
  if (!modal) return;
  const close = () => { modal.style.display = "none"; };
  const btn = document.getElementById("hidden-close");
  if (btn) btn.onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  wireHiddenSearch();
  wireHiddenSort();
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

function insertMissingSections(order, hasContent) {
  // Kayitli sirada olmayan dolu bolumleri DEFAULT_ORDER konumuna yerlestir
  // (sona push degil; ornegin docs her zaman movies-anime arasina gelir).
  ["shows", "movies", "docs", "anime"].forEach((s) => {
    if (hasContent[s] && !order.includes(s)) {
      const ref = DEFAULT_ORDER.indexOf(s);
      let at = order.length;
      for (let i = 0; i < order.length; i++) {
        if (DEFAULT_ORDER.indexOf(order[i]) > ref) { at = i; break; }
      }
      order.splice(at, 0, s);
    }
  });
  return order;
}

function sectionKeyOf(wrap, prefix) {
  try {
    return wrap.id.replace(`${prefix}-`, "").replace("-wrap", "");
  } catch (_) { return ""; }
}

function readSectionOrder(view, prefix) {
  const out = [];
  if (!view || !view.querySelectorAll) return out;
  view.querySelectorAll("[id$='-wrap']").forEach((w) => {
    try {
      if (w.style.display === "none") return;
      const cs = getComputedStyle(w);
      if (!cs || cs.display === "none" || cs.visibility === "hidden") return;
      if (!w.offsetParent && (!cs.position || cs.position === "static")) return;
    } catch (_) { return; }
    const k = sectionKeyOf(w, prefix);
    if (k) out.push(k);
  });
  return out;
}

function paintSectionOrder(view, prefix, empty, order) {
  if (!view) return;
  order.forEach((s) => {
    try {
      const wrap = document.getElementById(`${prefix}-${s}-wrap`);
      if (wrap) view.insertBefore(wrap, empty);
    } catch (_) {}
  });
  try { saveSectionOrder(prefix, order.slice()); } catch (_) {}
  try {
    const viewId = view.id;
    if (viewId) updateMoveButtons(viewId);
  } catch (_) {}
}

function updateMoveButtons(viewId) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const prefix = (viewId || "").replace(/^view-/, "");
  const order = readSectionOrder(view, prefix);
  order.forEach((s, idx) => {
    let wrap = null;
    try { wrap = document.getElementById(`${prefix}-${s}-wrap`); } catch (_) {}
    if (!wrap) return;
    const up = wrap.querySelector(".section-move-up");
    const down = wrap.querySelector(".section-move-down");
    if (up) up.disabled = idx === 0;
    if (down) down.disabled = idx === order.length - 1;
  });
}

const stepDebounce = {};

function stepSection(section, dir, prefix, viewId, emptyId) {
  const view = document.getElementById(viewId);
  if (!view) return;
  const dkey = viewId + "|" + section + "|" + dir;
  try {
    const now = Date.now();
    if (stepDebounce[dkey] && now - stepDebounce[dkey] < 350) return;
    stepDebounce[dkey] = now;
  } catch (_) {}
  const empty = document.getElementById(emptyId);
  const ae = document.activeElement;
  const aeBtn = ae && ae.closest && (ae.closest('.section-move-up')||ae.closest('.section-move-down')||ae.closest('.section-refresh')||ae.closest('.section-hide'));
  const aeIsHeader = !!(aeBtn && aeBtn.closest && aeBtn.closest('.unwatched-section-title'));
  const cur = readSectionOrder(view, prefix);
  const i = cur.indexOf(section);
  if (i < 0) return;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= cur.length) return;
  const next = cur.slice();
  next[i] = cur[j];
  next[j] = cur[i];
  paintSectionOrder(view, prefix, empty, next);
  try { if (typeof console !== "undefined" && console.debug) console.debug("[section-move]", prefix, section, dir, next.join(",")); } catch (_) {}
  try{ if(aeIsHeader && aeBtn && document.contains(aeBtn)) aeBtn.focus(); }catch(_){}
}

document.addEventListener("click", (e) => {
  if (e && e.detail > 1) return;
  const up = e.target.closest(".section-move-up");
  if (up && !up.disabled) {
    stepSection(up.dataset.section, "up", up.dataset.prefix, up.dataset.view, up.dataset.empty);
    return;
  }
  const down = e.target.closest(".section-move-down");
  if (down && !down.disabled) {
    stepSection(down.dataset.section, "down", down.dataset.prefix, down.dataset.view, down.dataset.empty);
  }
});

export { switchView, loadFollowed, loadBelgesel, loadAnime, loadUnwatched, loadWatched, loadArchive, loadRecommendations, refreshListsAfterWatch, animeNextText, animeStatusLabel, tvStatusLabel, applySort, views, tabs, activateUtilityTab };
