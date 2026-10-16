// Faz 4: components � modal bile�enleri (yay�n takvimi, detaylar, ki�i, anime detay/takvim, izlenmemi�, onay).
import { state } from "./state.js";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function cardTvAttrs(div, title){ try{ if(!isTvUIActive()) return; div.tabIndex=0; div.setAttribute('role','button'); if(title) div.setAttribute('aria-label', title); div.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }});}catch{} }

import { t, errText, animeGenreLabel } from "./i18n.js?v=523";
import {
  IMAGE_BASE, HEART_SVG, CHECK_SVG, TRASH_SVG, EYE_SVG, EYE_OFF_SVG, CALENDAR_SVG, INFO_SVG, CLOCK_SVG,
  posterHTML, scoreTag, typeLabel, formatDate, resultCardRows, cardDateLine,
  fmtRuntime, fmtScore, applyTitleHint, escAttr, toast,
  canSelectAll, utcStateStr, utcDayStr, utcTodayStr, isNewEpisode, tzLocale, dateState, isReleaseToday, todayInTzStr, isDocItem,
} from "./utils.js?v=518";
import { loadFollowed, loadAnime, switchView, animeStatusLabel, tvStatusLabel } from "./views.js?v=522";
import { renderChips, updateComboActorLabel, doComboSearch } from "./search.js?v=520";

let currentDetails = null;

async function openReleases(mediaType, tmdbId, title) {
  const modal = document.getElementById("releases-modal");
  const body = document.getElementById("releases-body");
  document.getElementById("releases-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";

  try {
    const res = await fetch(`/api/releases?media_type=${encodeURIComponent(mediaType)}&tmdb_id=${encodeURIComponent(tmdbId)}&title=${encodeURIComponent(title || "")}`);
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
      return;
    }
    document.getElementById("releases-title").textContent = data.title || title || "";

    if (!data.items.length) {
      body.innerHTML = `<div class="releases-error">${t("no_release_date")}</div>`;
      return;
    }

    const groups = {};
    data.items.forEach((it) => {
      const season = it.season != null ? it.season : "other";
      if (!groups[season]) groups[season] = [];
      groups[season].push(it);
    });

    const seasonNames = Object.keys(groups).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return 0;
    });

    const renderAll = (focusKey) => {
      // Hic izlenmemis dizide "tum sezonlari temizle" anlamsiz -> disable
      const totalWatchedAll = seasonNames.reduce((n, k) => n + groups[k].filter((it) => it.watched).length, 0);
      let html = "";
      seasonNames.forEach((seasonKey, si) => {
        const seasonItems = groups[seasonKey].sort((a, b) => {
          const ea = a.episode == null ? -1 : a.episode;
          const eb = b.episode == null ? -1 : b.episode;
          return ea - eb;
        });
        const seasonLabel =
          seasonKey === "other"
            ? data.media_type === "movie"
              ? t("movie_release_date")
              : t("other")
            : t("season", { n: seasonKey });
        html += `<div class="season-box">`;
        if (data.media_type === "tv") {
          const releasedItems = seasonItems.filter((it) => canSelectAll(it));
          const total = releasedItems.length;
          const watched = releasedItems.filter((it) => it.watched).length;
          const pct = total ? Math.round((watched / total) * 100) : 0;
          const allWatched = total > 0 && watched === total;
          const btnDisabled = total === 0 ? " disabled" : "";
          const multiSeason = seasonNames.length > 1;
          const isFirstSeason = multiSeason && seasonKey === seasonNames[0];
          const seasonCode = "S" + String(seasonKey).padStart(2, "0");
          const watchTipText = allWatched ? t("season_mark_unwatched", { code: seasonCode }) : t("season_mark_watched", { code: seasonCode });
          const watchIcon = allWatched ? EYE_OFF_SVG : EYE_SVG;
          html += `<div class="season-box-title"><span class="season-name">${seasonLabel}</span><div class="season-progress"><div class="season-progress-fill" style="width:${pct}%"></div><span class="season-progress-text">${watched}/${total} · %${pct}</span></div><div class="season-actions">${isFirstSeason ? `<button class="season-clear-all" data-i18n-title="clear_all_seasons" data-tip="${t("clear_all_seasons")}"${totalWatchedAll ? "" : " disabled"}>${TRASH_SVG}</button>` : ""}<button class="season-watch-all${allWatched ? " is-clear" : ""}" data-s="${seasonKey}" data-w="${allWatched ? 0 : 1}" data-tip="${watchTipText}"${btnDisabled}>${watchIcon}</button></div></div>`;
        } else {
          html += `<div class="season-box-title">${seasonLabel}</div>`;
        }
        html += `<table class="releases-table"><thead><tr><th>${t("col_episode")}</th><th>${t("col_date")}</th></tr></thead><tbody>`;
        seasonItems.forEach((it, i) => {
          const f = formatDate(it.date);
          const st = utcStateStr(it);
          const isToday = isReleaseToday(it);
          const dateClass = isToday ? ` class="date-today"` : (st ? ` class="${st}"` : "");
          const epName = it.episode_name
            ? `<div class="episode-name">${it.episode_name}</div>`
            : "";
          const watchedClass = it.watched ? " watched" : "";
          const released = st === "date-past" || st === "date-today" || isToday;
          // Sezon kilidi: onceki sezon tamamen izlenmeden bu sezonun ilk bolumu kapali.
          // Izlenmis bolumler geri alinabilsin diye her zaman secilebilir.
          const prevKey = si > 0 ? seasonNames[si - 1] : null;
          const prevReleased = prevKey ? groups[prevKey].filter((x) => canSelectAll(x)) : [];
          const prevComplete = !prevKey || prevReleased.length === 0 || prevReleased.every((x) => x.watched);
          const prevWatched = i === 0 ? prevComplete : seasonItems[i - 1].watched;
          const selectable =
            data.media_type === "tv"
              ? it.watched || (released && prevWatched)
              : released;
          const btnDisabled = !selectable ? " disabled" : "";
          const selectableAttr = canSelectAll(it) ? 1 : 0;
          const btnCls = it.watched ? "watch-btn on" : "watch-btn";
          const checkIcon = it.watched ? CHECK_SVG : "";
          const newCls = isNewEpisode(it) ? " new" : "";
          const todayCls = isToday ? " today-release" : "";
          const dateText = f.text;
          html += `<tr class="${watchedClass}${newCls}${todayCls}" data-released="${selectableAttr}" data-air="${it.air_time || ""}" data-date="${it.date || ""}">`;
          if (data.media_type === "tv") {
            html += `<td><button class="${btnCls}" data-g="${seasonKey}" data-i="${i}"${btnDisabled}>${checkIcon}</button><span class="episode-cell"><span class="episode-label">${t("season_ep", { s: it.season, e: it.episode })}</span>${epName}</span></td>`;
          } else {
            html += `<td><button class="${btnCls}" data-g="${seasonKey}" data-i="${i}"${btnDisabled}>${checkIcon}</button><span class="episode-cell"><span class="episode-label">${t("movie_release_date")}</span>${epName}</span></td>`;
          }
          const infoBtn = data.media_type === "tv" || data.media_type === "movie"
            ? `<button class="episode-info-btn" data-g="${seasonKey}" data-i="${i}" data-tip="${data.media_type === "movie" ? t("info_title") : t("ep_summary")}" data-i18n-title="${data.media_type === "movie" ? "info_title" : "ep_summary"}">${INFO_SVG}</button>`
            : "";
          html += `<td${dateClass}><span class="episode-date-wrap"><span class="episode-date-text">${dateText}</span>${infoBtn}</span></td></tr>`;
        });
        html += "</tbody></table></div>";
      });

      body.innerHTML = html || `<div class="releases-error">${t("no_release_date")}</div>`;
      bindReleasesEvents();
      // TV: toggle sonras� ayn� butonda kal (senkron); ilk a��l��ta ilk izlenmemi�
      try {
        if (focusKey && (focusKey.g !== undefined || focusKey.s !== undefined)) {
          let same = null;
          if (focusKey.g !== undefined) {
            same = body.querySelector(`.watch-btn[data-g="${focusKey.g}"][data-i="${focusKey.i}"]`);
            if (same && same.disabled) same = null;
          } else if (focusKey.s !== undefined) {
            same = body.querySelector(`.season-watch-all[data-s="${focusKey.s}"]`);
            if (same && same.disabled) same = null;
          }
          if (same) { try { same.focus(); same.scrollIntoView({block:'nearest'}); } catch(_){} return; }
        }
        const btns = Array.from(body.querySelectorAll('.watch-btn'));
        if (btns.length) {
          let firstUnwatchedIdx = -1, lastWatchedIdx = -1;
          btns.forEach((btn, idx) => {
            if (btn.disabled) return;
            const g = btn.dataset.g;
            const i = Number(btn.dataset.i);
            const it = groups[g] ? groups[g][i] : null;
            if (!it) return;
            if (!it.watched && firstUnwatchedIdx === -1) firstUnwatchedIdx = idx;
            if (it.watched) lastWatchedIdx = idx;
          });
          let targetIdx = -1;
          if (firstUnwatchedIdx !== -1) targetIdx = firstUnwatchedIdx;
          else if (lastWatchedIdx !== -1) targetIdx = lastWatchedIdx;
          else {
            const firstEnabled = btns.findIndex(b=>!b.disabled);
            if (firstEnabled !== -1) targetIdx = firstEnabled;
          }
          const target = targetIdx !== -1 ? btns[targetIdx] : null;
          if (target) setTimeout(() => { try { target.focus(); target.scrollIntoView({block:'nearest'}); } catch(_){} }, 120);
        }
      } catch(_){}
    };

    const bindReleasesEvents = () => {
      body.querySelectorAll(".watch-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const gk = btn.dataset.g, ik = Number(btn.dataset.i);
          const it = groups[gk][ik];
          const newWatched = it.watched ? 0 : 1;
          const isMovie = data.media_type === "movie";
          try {
            const res = await fetch(isMovie ? "/api/movie/watch" : "/api/episode/watch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                isMovie
                  ? { tmdb_id: tmdbId, watched: newWatched }
                  : { tmdb_id: tmdbId, season: Number(it.season), episode: Number(it.episode), watched: newWatched }
              ),
            });
            if (!res.ok) return;
            it.watched = newWatched;
            renderAll({g: gk, i: ik});
            loadFollowed(mediaType === "tv" ? "dizi" : "film");
          } catch (e) {
            toast(t("error"));
          }
        });
      });

      body.querySelectorAll(".season-watch-all").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const seasonKey = btn.dataset.s;
          const watched = btn.dataset.w === "1" ? 1 : 0;
          // Tek sezonlu dizide Temizle -> clear-apply (tampon otomatik uygulanir)
          if (data.media_type === "tv" && watched === 0 && seasonNames.length === 1) {
            btn.disabled = true;
            try {
              const res = await fetch("/api/seasons/clear-apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tmdb_id: tmdbId }),
              });
              const j = await res.json();
              if (!res.ok) return;
              data.items.forEach((it) => { it.watched = 0; });
              (j.applied || []).forEach((a) => {
                const it = data.items.find((x) => x.season === a.season && x.episode === a.episode);
                if (it) it.watched = 1;
              });
              toast(j.applied && j.applied.length ? t("clear_applied", { n: j.applied.length }) : t("clear_no_signals"));
              renderAll({s: seasonKey});
              loadFollowed("dizi");
            } catch (e) {
              toast(t("error"));
            } finally {
              btn.disabled = false;
            }
            return;
          }
          try {
            const res = await fetch("/api/season/watch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tmdb_id: tmdbId, season: Number(seasonKey), watched }),
            });
            if (!res.ok) return;
            groups[seasonKey].forEach((it) => {
              if (watched === 1 && !canSelectAll(it)) return;
              it.watched = watched;
            });
            renderAll({s: seasonKey});
            loadFollowed("dizi");
          } catch (e) {
            toast(t("error"));
          }
        });
      });

      body.querySelectorAll(".episode-info-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          if (e) e.stopPropagation();
          const gk = btn.dataset.g, ik = Number(btn.dataset.i);
          const it = groups[gk] ? groups[gk][ik] : null;
          if (!it) return;
          if (data.media_type === "movie") {
            openMovieInfo(tmdbId, data.title || title, it);
          } else {
            openEpisodeInfo(tmdbId, data.title || title, it.season, it.episode);
          }
        });
      });

      body.querySelectorAll(".season-clear-all").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            const res = await fetch("/api/seasons/clear-apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tmdb_id: tmdbId }),
            });
            const j = await res.json();
            if (!res.ok) return;
            data.items.forEach((it) => { it.watched = 0; });
            (j.applied || []).forEach((a) => {
              const it = data.items.find((x) => x.season === a.season && x.episode === a.episode);
              if (it) it.watched = 1;
            });
            toast(j.applied && j.applied.length ? t("clear_applied", { n: j.applied.length }) : t("clear_no_signals"));
            renderAll();
            loadFollowed("dizi");
          } catch (e) {
            toast(t("error"));
          } finally {
            btn.disabled = false;
          }
        });
      });
    };

    renderAll();
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

function closeReleases() {
  document.getElementById("releases-modal").style.display = "none";
}

function closeDetails() {
  document.getElementById("details-modal").style.display = "none";
  currentDetails = null;
}

function openMovieInfo(tmdbId, movieTitle, it) {
  const modal = document.getElementById("episode-info-modal");
  if (!modal) return;
  const metaEl = document.querySelector(".episode-info-meta");
  document.getElementById("episode-info-title").textContent = `${movieTitle || ""} ${t("info_title")}`;
  document.getElementById("episode-info-runtime-icon").innerHTML = CLOCK_SVG;
  document.getElementById("episode-info-watched-icon").innerHTML = EYE_SVG;
  document.getElementById("episode-info-overview").style.display = "none";
  document.getElementById("episode-info-overview").textContent = "";
  if (metaEl) metaEl.style.borderTop = "none";
  document.getElementById("episode-info-runtime").textContent = `${t("ep_runtime")}: ${it.runtime ? fmtRuntime(it.runtime) : "—"}`;
  document.getElementById("episode-info-watched").textContent = `${t("ep_watched")}: ${formatWatchedAt(it.watched_at)}`;
  modal.style.display = "flex";
  try {
    if (isTvUIActive()) document.getElementById("episode-info-close").focus({ preventScroll: true });
  } catch (_) {}
}

function openAnimeEpisodeInfo(animeId, animeTitle, it, animeDuration) {
  const modal = document.getElementById("episode-info-modal");
  if (!modal) return;
  const metaEl = document.querySelector(".episode-info-meta");
  document.getElementById("episode-info-title").textContent = `${animeTitle || ""} EP${it.episode} ${t("info_title")}`;
  document.getElementById("episode-info-runtime-icon").innerHTML = CLOCK_SVG;
  document.getElementById("episode-info-watched-icon").innerHTML = EYE_SVG;
  document.getElementById("episode-info-overview").style.display = "none";
  document.getElementById("episode-info-overview").textContent = "";
  if (metaEl) metaEl.style.borderTop = "none";
  document.getElementById("episode-info-runtime").textContent = `${t("ep_runtime")}: ${animeDuration ? fmtRuntime(animeDuration) : "—"}`;
  document.getElementById("episode-info-watched").textContent = `${t("ep_watched")}: ${formatWatchedAt(it.watched_at)}`;
  modal.style.display = "flex";
  try {
    if (isTvUIActive()) document.getElementById("episode-info-close").focus({ preventScroll: true });
  } catch (_) {}
}

function formatWatchedAt(watchedAt) {
  let wText = "—";
  if (watchedAt) {
    try {
      wText = new Intl.DateTimeFormat(tzLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: state.currentTz }).format(new Date(watchedAt * 1000));
    } catch (_) {
      try {
        wText = new Intl.DateTimeFormat(tzLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(watchedAt * 1000));
      } catch (_) { wText = String(watchedAt); }
    }
  }
  return wText;
}

async function openEpisodeInfo(tmdbId, showTitle, season, episode) {
  const modal = document.getElementById("episode-info-modal");
  if (!modal) return;
  const metaEl = document.querySelector(".episode-info-meta");
  const s2 = String(season).padStart(2, "0"), e2 = String(episode).padStart(2, "0");
  document.getElementById("episode-info-title").textContent = `${showTitle || ""} S${s2}E${e2} ${t("ep_summary")}`;
  document.getElementById("episode-info-runtime-icon").innerHTML = CLOCK_SVG;
  document.getElementById("episode-info-watched-icon").innerHTML = EYE_SVG;
  document.getElementById("episode-info-overview").style.display = "";
  document.getElementById("episode-info-overview").textContent = t("loading");
  if (metaEl) metaEl.style.borderTop = "";
  document.getElementById("episode-info-runtime").textContent = "";
  document.getElementById("episode-info-watched").textContent = "";
  modal.style.display = "flex";
  try {
    if (isTvUIActive()) document.getElementById("episode-info-close").focus({ preventScroll: true });
  } catch (_) {}
  try {
    const res = await fetch(`/api/episode/info?tmdb_id=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}&lang=${encodeURIComponent(state.currentLang || "en-US")}`);
    const j = await res.json();
    if (!res.ok) throw new Error("http " + res.status);
    document.getElementById("episode-info-overview").textContent = (j.overview || "").trim() || t("ep_no_overview");
    document.getElementById("episode-info-runtime").textContent = `${t("ep_runtime")}: ${j.runtime ? fmtRuntime(j.runtime) : "—"}`;
    let wText = "—";
    if (j.watched_at) {
      try {
        wText = new Intl.DateTimeFormat(tzLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: state.currentTz }).format(new Date(j.watched_at * 1000));
      } catch (_) {
        try {
          wText = new Intl.DateTimeFormat(tzLocale(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(j.watched_at * 1000));
        } catch (_) { wText = String(j.watched_at); }
      }
    }
    document.getElementById("episode-info-watched").textContent = `${t("ep_watched")}: ${wText}`;
  } catch (e) {
    document.getElementById("episode-info-overview").textContent = t("error");
  }
}

function closeEpisodeInfo() {
  document.getElementById("episode-info-modal").style.display = "none";
}

function closeModals() {
  closeReleases();
  closeEpisodeInfo();
  closeDetails();
  closeTvUnfollow();
  closeAnimeUnfollow();
  closeRejectConfirm();
  closeMemberDelete();
  closeMemberDeactivate();
  closeLogoutConfirm();
  closeNotifClear();
  closeStremioDisconnect();
}

// Adanmis onay modallari: her biri yalniz kendi blogunu acar/kapatir.
// Ortak confirm-modal YASAKTIR (KRITIK KURAL) � yeni onay akisi yeni blok ister.
function wireDedicatedConfirm(id, text, onYes) {
  const ov = document.getElementById(id);
  const body = ov.querySelector(".confirm-text");
  if (body) body.textContent = text;
  const yes = ov.querySelector(".confirm-actions .btn");
  const close = () => {
    ov.style.display = "none";
  };
  ov.querySelector(".modal-close").onclick = close;
  ov.onclick = (e) => {
    if (e.target === e.currentTarget) close();
  };
  yes.onclick = () => {
    close();
    onYes();
  };
  ov.style.display = "flex";
}
function closeTvUnfollow() {
  document.getElementById("tv-unfollow-modal").style.display = "none";
}
function openTvUnfollowConfirm(text, onYes) {
  wireDedicatedConfirm("tv-unfollow-modal", text, onYes);
}
function closeAnimeUnfollow() {
  document.getElementById("anime-unfollow-modal").style.display = "none";
}
function openAnimeUnfollowConfirm(text, onYes) {
  wireDedicatedConfirm("anime-unfollow-modal", text, onYes);
}
function closeRejectConfirm() {
  document.getElementById("reject-confirm-modal").style.display = "none";
}
function openRejectConfirm(text, onYes) {
  wireDedicatedConfirm("reject-confirm-modal", text, onYes);
}
function closeMemberDelete() {
  document.getElementById("member-delete-modal").style.display = "none";
}
function openMemberDeleteConfirm(text, onYes) {
  wireDedicatedConfirm("member-delete-modal", text, onYes);
}
function closeMemberDeactivate() {
  document.getElementById("member-deactivate-modal").style.display = "none";
}
function openMemberDeactivateConfirm(text, onYes) {
  wireDedicatedConfirm("member-deactivate-modal", text, onYes);
}
function closeLogoutConfirm() {
  document.getElementById("logout-confirm-modal").style.display = "none";
}
function openLogoutConfirm(text, onYes) {
  wireDedicatedConfirm("logout-confirm-modal", text, onYes);
}
function closeNotifClear() {
  document.getElementById("notif-clear-modal").style.display = "none";
}
function openNotifClearConfirm(text, onYes) {
  wireDedicatedConfirm("notif-clear-modal", text, onYes);
}
function closeAskClear() {
  document.getElementById("ask-clear-modal").style.display = "none";
}
function openAskClearConfirm(text, onYes) {
  wireDedicatedConfirm("ask-clear-modal", text, onYes);
}
function closeStremioDisconnect() {
  document.getElementById("stremio-disconnect-modal").style.display = "none";
}
function openStremioInstallModal() {
  const ov = document.getElementById("stremio-install-modal");
  if (!ov) return;
  const close = () => { ov.style.display = "none"; };
  const x = ov.querySelector(".modal-close");
  if (x) x.onclick = close;
  ov.onclick = (e) => { if (e.target === e.currentTarget) close(); };
  ov.style.display = "flex";
}
function closeStremioInstallModal() {
  const ov = document.getElementById("stremio-install-modal");
  if (ov) ov.style.display = "none";
}
function openStremioTunnelRemoveConfirm(text, onYes) {
  wireDedicatedConfirm("stremio-tunnel-remove-modal", text, onYes);
}
function openRemoteResetConfirm(text, onYes) {
  wireDedicatedConfirm("remote-reset-modal", text, onYes);
}
function openStremioDisconnectConfirm(text, onYes) {
  wireDedicatedConfirm("stremio-disconnect-modal", text, onYes);
}
function closeRemoteDisconnect() {
  document.getElementById("remote-disconnect-modal").style.display = "none";
}
function openRemoteDisconnectConfirm(text, onYes) {
  wireDedicatedConfirm("remote-disconnect-modal", text, onYes);
}
function closeRemotePeerDelete() {
  document.getElementById("remote-peer-delete-modal").style.display = "none";
}
function openRemotePeerDeleteConfirm(text, onYes) {
  wireDedicatedConfirm("remote-peer-delete-modal", text, onYes);
}

document.getElementById("releases-close").onclick = closeReleases;
document.getElementById("releases-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeReleases();
});
document.getElementById("episode-info-close").onclick = closeEpisodeInfo;
document.getElementById("episode-info-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeEpisodeInfo();
});
document.getElementById("details-close").onclick = closeDetails;
document.getElementById("details-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeDetails();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModals();
});

// Bilgi modalı statü rozeti rengi: duruma göre sınıf (Returning→yeşil, Ended→gri,
// Canceled→kırmızı, diğer/yakında→amber).
function statusColorClass(status) {
  const s = (status || "").trim().toUpperCase();
  if (s === "CANCELED" || s === "CANCELLED") return "db-status-canceled";
  if (s === "ENDED" || s === "FINISHED") return "db-status-ended";
  if (s === "RETURNING SERIES" || s === "RELEASING") return "db-status-returning";
  return "db-status-upcoming";
}

function renderTmdbDetails(data, title, highlightGenre) {
  let html = '<div class="details-wrap">';
  html += '<div class="details-poster-col">';
  if (data.poster_path) {
    html += `<img class="details-poster" src="${data.poster_local || IMAGE_BASE + data.poster_path}" alt="${data.title}" />`;
  }
  const isTv = data.media_type === "tv";
  const isDoc = isDocItem(data);
  const typeCls = isDoc ? "belgesel" : (isTv ? "tv" : "movie");
  const typeLbl = isDoc ? t("type_doc") : (isTv ? t("type_tv") : t("type_movie"));
  let typeBadges = `<span class="detail-badge db-type db-${typeCls}">${typeLbl}</span>`;
  if (isTv && data.number_of_seasons) typeBadges += `<span class="detail-badge db-season">${t("seasons", { n: data.number_of_seasons })}</span>`;
  if (isTv && data.number_of_episodes) typeBadges += `<span class="detail-badge db-episode">${t("episodes", { n: data.number_of_episodes })}</span>`;

  let dateRow = "";
  if (isTv) {
    if (data.first_air_date) dateRow = `<span class="detail-badge db-date">${t("release_date")}: ${formatDate(data.first_air_date).text}</span>`;
  } else {
    if (data.release_date) dateRow = `<span class="detail-badge db-date">${t("movie_release_date")}: ${formatDate(data.release_date).text}</span>`;
    if (data.runtime) dateRow += `<span class="detail-badge db-runtime">${fmtRuntime(data.runtime)}</span>`;
  }
  const statusRow = isTv && data.status ? `<span class="detail-badge db-status ${statusColorClass(data.status)}">${tvStatusLabel(data.status)}</span>` : "";

  html += '<div class="details-meta">';
  html += `<div class="details-meta-row dmr-types">${typeBadges}</div>`;
  if (dateRow) html += `<div class="details-meta-row dmr-date">${dateRow}</div>`;
  if (statusRow) html += `<div class="details-meta-row dmr-status">${statusRow}</div>`;
  html += "</div>";
  if (data.genres && data.genres.length) {
    html += '<div class="genre-tags">';
    const hg = highlightGenre ? highlightGenre.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    data.genres.forEach((g) => {
      const fav = state.favGenres.has(g) || hg.includes(g.toLowerCase());
      html += `<span class="detail-badge genre-tag${fav ? " fav" : ""}" data-genre="${g.replace(/"/g, "&quot;")}">${g}</span>`;
    });
    html += "</div>";
  }
  if (data.vote_average != null) {
    html += `<div class="details-rating">${fmtScore(data.vote_average)} / 10 <span class="details-votes">${t("votes", { n: data.vote_count || 0 })}</span></div>`;
  }
  html += "</div>";
  html += '<div class="details-main">';
  if (data.tagline) html += `<div class="details-tagline">${data.tagline}</div>`;
  if (data.overview) html += `<p class="details-overview">${data.overview}</p>`;
  if (data.cast && data.cast.length) {
    html += `<div class="details-section-title"><span data-i18n="cast_title">${t("cast_title")}</span></div>`;
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.cast.forEach((c) => {
      const img = c.profile_path ? `<img class="cast-avatar" src="${IMAGE_BASE}${c.profile_path}" alt="${c.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${c.name.charAt(0)}</div>`;
      const fav = c.id && state.favActors.has(String(c.id)) ? " fav" : "";
      html += `<div class="cast-item" data-person-id="${c.id || ""}" role="button" tabindex="0">${img}<div class="cast-info"><div class="cast-name">${c.name}</div><div class="cast-char">${c.character || ""}</div></div>${c.id ? `<button class="cast-fav${fav}" data-person-id="${c.id}" data-person-name="${c.name.replace(/"/g, "&quot;")}" data-tip="${t("fav_actor")}">${HEART_SVG}</button>` : ""}</div>`;
    });
    html += "</div></div>";
  }
  if (data.directors && data.directors.length) {
    html += `<div class="details-section-title"><span data-i18n="director_title">${t("director_title")}</span></div>`;
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.directors.forEach((d) => {
      const img = d.profile_path ? `<img class="cast-avatar" src="${IMAGE_BASE}${d.profile_path}" alt="${d.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${d.name.charAt(0)}</div>`;
      const fav = d.id && state.favDirectors.has(String(d.id)) ? " fav" : "";
      html += `<div class="cast-item" data-director-id="${d.id || ""}" data-source="tmdb" role="button" tabindex="0">${img}<div class="cast-info"><div class="cast-name">${d.name}</div></div>${d.id ? `<button class="cast-fav${fav}" data-director-id="${d.id}" data-director-name="${d.name.replace(/"/g, "&quot;")}" data-source="tmdb" data-tip="${t("fav_director")}">${HEART_SVG}</button>` : ""}</div>`;
    });
    html += "</div></div>";
  }
  html += "</div></div>";
  return html;
}

function bindTmdbDetailsEvents() {
  const body = document.getElementById("details-body");
  body.querySelectorAll(".cast-item").forEach((el) => {
    const pid = el.dataset.personId;
    if (!pid) return;
    el.onclick = () => openPerson(pid, el.querySelector(".cast-name").textContent);
  });
  body.querySelectorAll('.cast-item[data-director-id]').forEach((el) => {
    const did = el.dataset.directorId;
    if (!did) return;
    // anime director is not TMDB, not clickable
    if (el.dataset.source === "anilist") return;
    el.onclick = () => openDirector(did, el.querySelector(".cast-name").textContent);
  });
  body.querySelectorAll(".cast-fav").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.dataset.directorId) toggleFavDirector(btn);
      else toggleFavActor(btn);
    };
  });
}

function renderAnimeDetails(data) {
  let html = '<div class="details-wrap">';
  html += '<div class="details-poster-col">';
  if (data.cover_url || data.poster_local) html += `<img class="details-poster" src="${data.poster_local || data.cover_url}" alt="${data.title}" />`;
  let typeBadges = `<span class="detail-badge db-type db-anime">${t("tab_anime")}</span>`;
  if (data.format) typeBadges += `<span class="detail-badge">${data.format}</span>`;
  if (data.episodes) typeBadges += `<span class="detail-badge db-episode">${t("episodes", { n: data.episodes })}</span>`;
  const dateRow = data.start_date ? `<span class="detail-badge db-date">${t("release_date")}: ${data.start_date}</span>` : "";
  const statusRow = data.status ? `<span class="detail-badge db-status ${statusColorClass(data.status)}">${animeStatusLabel(data.status)}</span>` : "";
  html += '<div class="details-meta">';
  html += `<div class="details-meta-row dmr-types">${typeBadges}</div>`;
  if (dateRow) html += `<div class="details-meta-row dmr-date">${dateRow}</div>`;
  if (statusRow) html += `<div class="details-meta-row dmr-status">${statusRow}</div>`;
  html += "</div>";
  if (data.genres && data.genres.length) {
    html += '<div class="genre-tags">';
    data.genres.forEach((g) => {
      html += `<span class="detail-badge anime-genre-tag${state.favAnimeGenres.has(g) ? " fav" : ""}" data-anime-genre="${g.replace(/"/g, "&quot;")}">${animeGenreLabel(g)}</span>`;
    });
    html += "</div>";
  }
  if (data.score != null) html += `<div class="details-rating">${fmtScore(data.score / 10)} / 10</div>`;
  html += "</div>";
  html += '<div class="details-main">';
  if (data.description) html += `<div class="details-tagline" style="white-space:pre-wrap">${data.description.replace(/<[^>]*>/g, "")}</div>`;
  if (data.characters && data.characters.length) {
    html += `<div class="details-section-title"><span data-i18n="char_title">${t("char_title")}</span></div>`;
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.characters.forEach((c) => {
      const img = c.image ? `<img class="cast-avatar" src="${c.image}" alt="${c.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${c.name.charAt(0)}</div>`;
      const fav = c.id && state.favAnimeChars.has(String(c.id)) ? " fav" : "";
      html += `<div class="cast-item" data-char-id="${c.id || ""}" role="button" tabindex="0">${img}<div class="cast-info"><div class="cast-name">${c.name}</div></div>${c.id ? `<button class="cast-fav${fav}" data-char-id="${c.id}" data-char-name="${c.name.replace(/"/g, "&quot;")}" data-anime-title="${(data.title || "").replace(/"/g, "&quot;")}" data-tip="${t("fav_char")}">${HEART_SVG}</button>` : ""}</div>`;
    });
    html += "</div></div>";
  }
  if (data.directors && data.directors.length) {
    html += `<div class="details-section-title"><span data-i18n="director_title">${t("director_title")}</span></div>`;
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.directors.forEach((d) => {
      const img = d.image ? `<img class="cast-avatar" src="${d.image}" alt="${d.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${d.name.charAt(0)}</div>`;
      const fav = d.id && state.favDirectors.has(String(d.id)) ? " fav" : "";
      html += `<div class="cast-item cast-item-static" data-director-id="${d.id || ""}" data-source="anilist">${img}<div class="cast-info"><div class="cast-name">${d.name}</div></div>${d.id ? `<button class="cast-fav${fav}" data-director-id="${d.id}" data-director-name="${d.name.replace(/"/g, "&quot;")}" data-source="anilist" data-tip="${t("fav_director")}">${HEART_SVG}</button>` : ""}</div>`;
    });
    html += "</div></div>";
  }
  html += "</div></div>";
  return html;
}

function bindAnimeDetailsEvents() {
  const body = document.getElementById("details-body");
  body.querySelectorAll(".cast-item").forEach((el) => {
    const cid = el.dataset.charId;
    if (!cid) return;
    el.onclick = () => openAnimeChar(cid, el.querySelector(".cast-name").textContent);
  });
  body.querySelectorAll(".cast-fav").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.dataset.directorId) toggleFavDirector(btn);
      else toggleFavAnimeChar(btn);
    };
  });
}

async function openDetails(mediaType, tmdbId, title, highlightPerson, highlightPersonId, highlightGenre, restrictCalendar) {
  currentDetails = { kind: "tmdb", mediaType, tmdbId, title, highlightPerson, highlightPersonId, highlightGenre };
  const modal = document.getElementById("details-modal");
  const body = document.getElementById("details-body");
  const calBtn = document.getElementById("details-calendar");
  document.getElementById("details-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  calBtn.style.display = "flex";
  const disabled = !!restrictCalendar;
  calBtn.disabled = disabled;
  calBtn.classList.toggle("disabled", disabled);
  calBtn.dataset.tip = disabled ? t("calendar_follow_hint") : t("calendar_title");
  calBtn.dataset.i18nTitle = disabled ? "calendar_follow_hint" : "calendar_title";
  if (disabled) {
    calBtn.onclick = null;
  } else {
    calBtn.onclick = () => {
      closeDetails();
      openReleases(mediaType, tmdbId, title);
    };
  }

  try {
    const res = await fetch(`/api/details?media_type=${encodeURIComponent(mediaType)}&tmdb_id=${encodeURIComponent(tmdbId)}&lang=${encodeURIComponent(state.currentLang)}${highlightPerson ? `&highlight_person=${encodeURIComponent(highlightPerson)}` : ""}${highlightPersonId ? `&highlight_person_id=${encodeURIComponent(highlightPersonId)}` : ""}`);
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
      return;
    }
    document.getElementById("details-title").textContent = data.title || title || "";
    body.innerHTML = renderTmdbDetails(data, title, highlightGenre);
    bindTmdbDetailsEvents();
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

async function toggleFavActor(btn) {
  const personId = btn.dataset.personId;
  const name = btn.dataset.personName || "";
  const prevFav = state.favActors.has(personId);
  try {
    const r = await fetch("/api/fav_actors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId, name }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    if (j.added) state.favActors.set(personId, name);
    else state.favActors.delete(personId);
    btn.classList.toggle("fav", j.added);
    toast(j.added ? t("fav_actor_added", { name }) : t("fav_actor_removed", { name }));
  } catch (err) {
    if (prevFav) state.favActors.delete(personId);
    else state.favActors.delete(personId);
    btn.classList.toggle("fav", prevFav);
    toast(errText(err.message) || t("error"));
  }
}

async function toggleFavDirector(btn) {
  const personId = btn.dataset.directorId || btn.dataset.personId;
  const name = btn.dataset.directorName || btn.dataset.personName || "";
  const source = btn.dataset.source || "tmdb";
  const key = String(personId);
  const prevFav = state.favDirectors.has(key);
  try {
    const r = await fetch("/api/fav_directors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId, name, source }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    if (j.added) state.favDirectors.set(key, name);
    else state.favDirectors.delete(key);
    btn.classList.toggle("fav", j.added);
    toast(j.added ? t("fav_director_added", { name }) : t("fav_director_removed", { name }));
  } catch (err) {
    btn.classList.toggle("fav", prevFav);
    toast(errText(err.message) || t("error"));
  }
}

async function toggleFavAnimeChar(btn) {
  const charId = btn.dataset.charId;
  const name = btn.dataset.charName || "";
  const animeTitle = btn.dataset.animeTitle || "";
  const prevFav = state.favAnimeChars.has(charId);
  try {
    const r = await fetch("/api/fav_anime_chars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_id: charId, name, anime_title: animeTitle }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    if (j.added) state.favAnimeChars.set(charId, name);
    else state.favAnimeChars.delete(charId);
    btn.classList.toggle("fav", j.added);
    toast(j.added ? t("fav_char_added", { name }) : t("fav_char_removed", { name }));
  } catch (err) {
    if (prevFav) state.favAnimeChars.delete(charId);
    else state.favAnimeChars.delete(charId);
    btn.classList.toggle("fav", prevFav);
    toast(errText(err.message) || t("error"));
  }
}

function openAnimeChar(charId, name) {
  // Üst butonlara dokunulmaz; kapsam yalnız çiplerden gelir.
  const input = document.getElementById("search-input");
  if (input) input.value = "";
  state.chips.length = 0;
  state.comboSource = "anime";
  state.chips.push({ type: "media", label: t("tab_anime"), value: "anime" });
  state.chips.push({ type: "char", label: name, value: charId });
  updateComboActorLabel();
  renderChips();
  doComboSearch("", state.chips);
}

async function openPerson(personId, name) {
  const modal = document.getElementById("person-modal");
  const body = document.getElementById("person-body");
  document.getElementById("person-title").textContent = name || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  resetCreditsUI("person");
  modal.style.display = "flex";
  try {
    const res = await fetch(`/api/person/${encodeURIComponent(personId)}`);
    const data = await res.json();
    if (!res.ok) { body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`; return; }
    const grid = _buildCreditsGrid(data, modal);
    body.innerHTML = "";
    body.appendChild(grid);
    applyCreditsState("person");
  } catch (e) { body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`; }
}

document.getElementById("person-close").onclick = () => {
  document.getElementById("person-modal").style.display = "none";
};
document.getElementById("person-modal").onclick = (e) => {
  if (e.target === e.currentTarget) document.getElementById("person-modal").style.display = "none";
};

/* Filmografi kartları arama kartlarındaki sade şemayı (tip·puan / statü) kullanır. */
/* Filmografi sıralama durumu: arama metni modal-açılışlık, sıralama+yön global hatırlamalı. */
const CREDITS_DEFAULT_DIR = { alpha: "asc", score: "desc", vision: "desc", upcoming: "asc" };
let creditsSort = "alpha";
let creditsSortDir = "asc";
const creditsQ = { person: "", director: "" };
function loadCreditsFilter() {
  try {
    const s = localStorage.getItem("creditsFilter");
    if (s && CREDITS_DEFAULT_DIR[s]) {
      creditsSort = s;
      const d = localStorage.getItem("creditsFilterDir");
      creditsSortDir = (d === "asc" || d === "desc") ? d : CREDITS_DEFAULT_DIR[s];
      return;
    }
  } catch (_) {}
  creditsSort = "alpha";
  creditsSortDir = "asc";
}
function saveCreditsFilter() {
  try {
    localStorage.setItem("creditsFilter", creditsSort);
    localStorage.setItem("creditsFilterDir", creditsSortDir);
  } catch (_) {}
}
loadCreditsFilter();
function creditsWhich(modal) {
  return modal && modal.id === "director-modal" ? "director" : "person";
}
function creditsGridEl(which) {
  const body = document.getElementById(which === "director" ? "director-body" : "person-body");
  return body ? body.querySelector(".person-grid") : null;
}
function creditsMenuEl(which) {
  return document.getElementById(which === "director" ? "director-filter-menu" : "person-filter-menu");
}
function creditsFilterBtn(which) {
  return document.getElementById(which === "director" ? "director-filter-btn" : "person-filter-btn");
}
function creditsToday() {
  try {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch (_) { return ""; }
}
function resetCreditsUI(which) {
  creditsQ[which] = "";
  const inp = document.getElementById(which === "director" ? "director-search-input" : "person-search-input");
  if (inp) { inp.value = ""; inp.style.display = "none"; }
  const sBtn = document.getElementById(which === "director" ? "director-search-btn" : "person-search-btn");
  if (sBtn) sBtn.classList.remove("active");
  closeCreditsMenu(which);
}
function closeCreditsMenu(which) {
  try {
    const menu = creditsMenuEl(which);
    if (menu) menu.classList.remove("open");
    const btn = creditsFilterBtn(which);
    if (btn) btn.classList.remove("active");
  } catch (_) {}
}
function updateCreditsMenu(which) {
  const menu = creditsMenuEl(which);
  if (!menu) return;
  const grid = creditsGridEl(which);
  const cards = grid ? Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card")) : [];
  const today = creditsToday();
  const hasUpcoming = cards.some((c) => { const d = (c.dataset && c.dataset.sortDate) || ""; return !!d && d > today; });
  menu.querySelectorAll(".sort-item").forEach((b) => {
    const k = b.dataset.sort;
    const active = creditsSort === k;
    b.classList.toggle("active", active);
    try { b.querySelectorAll(".dir-arrow").forEach((a) => a.remove()); } catch (_) {}
    if (active) {
      try {
        const arrow = document.createElement("i");
        arrow.className = "dir-arrow fa-solid " + (creditsSortDir === "asc" ? "fa-arrow-up" : "fa-arrow-down");
        arrow.setAttribute("aria-hidden", "true");
        b.prepend(arrow, document.createTextNode(" "));
      } catch (_) {}
    }
    const dis = k === "upcoming" && !hasUpcoming;
    b.disabled = dis;
    b.setAttribute("aria-disabled", dis ? "true" : "false");
  });
}
function toggleCreditsMenu(which, force) {
  const menu = creditsMenuEl(which);
  const btn = creditsFilterBtn(which);
  if (!menu || !btn) return;
  const willOpen = force !== undefined ? !!force : !menu.classList.contains("open");
  closeCreditsMenu("person");
  closeCreditsMenu("director");
  if (willOpen) {
    updateCreditsMenu(which);
    menu.classList.add("open");
    btn.classList.add("active");
    if (isTvUIActive()) {
      const first = menu.querySelector(".sort-item:not([disabled])");
      if (first) { try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} } }
    }
  }
}
function applyCreditsState(which) {
  const grid = creditsGridEl(which);
  if (!grid) return;
  const q = (creditsQ[which] || "").toLocaleLowerCase();
  const cards = Array.from(grid.children).filter((c) => c && c.classList && c.classList.contains("card"));
  cards.forEach((c) => {
    let title = "";
    try { title = ((c.querySelector(".title") || {}).textContent) || ""; } catch (_) {}
    c.style.display = (!q || title.toLocaleLowerCase().includes(q)) ? "" : "none";
  });
  const flip = creditsSortDir === (CREDITS_DEFAULT_DIR[creditsSort] || "asc") ? 1 : -1;
  const base = (a, b) => {
    if (creditsSort === "score") return (Number((b.dataset && b.dataset.sortScore) || 0) - Number((a.dataset && a.dataset.sortScore) || 0));
    if (creditsSort === "vision") {
      const x = (a.dataset && a.dataset.sortDate) || "", y = (b.dataset && b.dataset.sortDate) || "";
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : x > y ? -1 : 0;
    }
    if (creditsSort === "upcoming") {
      const today = creditsToday();
      const x = (a.dataset && a.dataset.sortDate) || "", y = (b.dataset && b.dataset.sortDate) || "";
      const xp = !x || x <= today, yp = !y || y <= today;
      if (xp && yp) return 0;
      if (xp) return 1;
      if (yp) return -1;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = ((a.dataset && a.dataset.sortTitle) || "").toLocaleLowerCase(), y = ((b.dataset && b.dataset.sortTitle) || "").toLocaleLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  };
  if (cards.length > 1) {
    try { cards.sort((a, b) => base(a, b) * flip).forEach((c) => grid.appendChild(c)); } catch (_) {}
  }
  updateCreditsMenu(which);
}
(function wireCreditsControls() {
  ["person", "director"].forEach((which) => {
    const sBtn = document.getElementById(which === "director" ? "director-search-btn" : "person-search-btn");
    const inp = document.getElementById(which === "director" ? "director-search-input" : "person-search-input");
    const fBtn = creditsFilterBtn(which);
    const menu = creditsMenuEl(which);
    if (sBtn && inp) {
      sBtn.onclick = () => {
        const open = inp.style.display === "block";
        if (open) {
          inp.value = ""; inp.style.display = "none";
          sBtn.classList.remove("active");
          creditsQ[which] = "";
          applyCreditsState(which);
        } else {
          inp.style.display = "block"; sBtn.classList.add("active");
          inp.focus();
        }
      };
      inp.addEventListener("input", () => {
        creditsQ[which] = (inp.value || "").trim();
        applyCreditsState(which);
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && inp.style.display === "block") sBtn.click();
        e.stopPropagation();
      });
    }
    if (fBtn) {
      fBtn.onclick = (e) => {
        if (e) e.stopPropagation();
        if (fBtn.disabled) return;
        toggleCreditsMenu(which);
      };
    }
    if (menu) {
      menu.querySelectorAll(".sort-item").forEach((b) => {
        b.onclick = (e) => {
          if (e) e.stopPropagation();
          if (b.disabled) return;
          const key = b.dataset.sort;
          if (creditsSort === key) {
            creditsSortDir = creditsSortDir === "asc" ? "desc" : "asc";
            saveCreditsFilter();
            applyCreditsState(which);
          } else {
            creditsSort = key;
            creditsSortDir = CREDITS_DEFAULT_DIR[key] || "asc";
            saveCreditsFilter();
            applyCreditsState(which);
            toggleCreditsMenu(which, false);
            if (isTvUIActive() && fBtn) {
              try { fBtn.focus({ preventScroll: true }); } catch (_) { try { fBtn.focus(); } catch (_) {} }
            }
          }
        };
      });
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest || !e.target.closest(".credits-sort-wrap")) {
      closeCreditsMenu("person");
      closeCreditsMenu("director");
    }
  });
})();

function _buildCreditsGrid(data, modal) {
  const grid = document.createElement("div");
  grid.className = "poster-grid person-grid";
  if (!data.length) {
    grid.innerHTML = `<div class="empty">${t("no_credits")}</div>`;
    return grid;
  }
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
    cardTvAttrs(div, item.title||"");
    try {
      div.dataset.sortTitle = item.title || "";
      div.dataset.sortScore = String(Number(item.vote_average) || 0);
      div.dataset.sortDate = item.release_date || "";
    } catch (_) {}
    const status = cardDateLine(item.media_type, item);
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${resultCardRows({
            type: `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`,
            score: scoreTag(item.vote_average),
            status,
          })}
        </div>
      </div>
      ${item.media_type === "tv" ? `<button class="calendar-btn" disabled data-tip="${t("calendar_follow_hint")}">${CALENDAR_SVG}</button>` : ``}
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
    `;
    div.querySelector(".remove").onclick = async (e) => {
      e.stopPropagation();
      const r = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdb_id: item.tmdb_id, media_type: item.media_type, title: item.title, poster_path: item.poster_path }),
      });
      const j = await r.json();
      toast(r.ok ? t("added", { name: item.title }) : j.error || t("error"));
      if (r.ok) { loadFollowed(item.media_type === "tv" ? "dizi" : "film"); switchView(item.media_type === "tv" ? "dizi" : "film"); modal.style.display = "none"; }
    };
    const calBtn = div.querySelector(".calendar-btn");
    if (calBtn && !calBtn.disabled) calBtn.onclick = (e) => { e.stopPropagation(); openReleases(item.media_type, item.tmdb_id, item.title); };
    const infoBtnP = div.querySelector(".info-btn");
    if (infoBtnP) infoBtnP.onclick = (e) => { e.stopPropagation(); div.click(); };
    div.onclick = () => { openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true); modal.style.display = "none"; };
    grid.appendChild(div);
    applyTitleHint(div);
  });
  return grid;
}

async function openDirector(personId, name) {
  const modal = document.getElementById("director-modal");
  const body = document.getElementById("director-body");
  document.getElementById("director-title").textContent = name || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  resetCreditsUI("director");
  modal.style.display = "flex";
  try {
    const res = await fetch(`/api/director/${encodeURIComponent(personId)}`);
    const data = await res.json();
    if (!res.ok) { body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`; return; }
    const grid = _buildCreditsGrid(data, modal);
    body.innerHTML = "";
    body.appendChild(grid);
    applyCreditsState("director");
  } catch (e) { body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`; }
}

document.getElementById("director-close").onclick = () => { document.getElementById("director-modal").style.display = "none"; };
document.getElementById("director-modal").onclick = (e) => { if (e.target === e.currentTarget) document.getElementById("director-modal").style.display = "none"; };

async function openUnwatchedModal(item, isAnime) {
  const modal = document.getElementById("unwatched-modal");
  const body = document.getElementById("unwatched-body");
  document.getElementById("unwatched-title").textContent = `${item.title} � ${t("unwatched_title")}`;
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";

  const renderList = (savedIdx) => {
    const sorted = [...item.items].sort((a, b) =>
      a.season != null
        ? (a.season - b.season) || (a.episode - b.episode)
        : a.episode - b.episode
    );
    const firstUnwatched = sorted.find((it) => !it.watched);
    const rows = sorted.map((it) => {
      const isUnwatched = !it.watched;
      const isFirst = isUnwatched && firstUnwatched === it;
      const lockedCls = isUnwatched && !isFirst ? " locked" : "";
      const watchedCls = !isUnwatched ? " watched" : "";
      const tip = isUnwatched && !isFirst
          ? ` data-tip="${t("unwatched_tooltip", { ep: item.isAnime ? `EP${firstUnwatched.episode}` : `S${String(firstUnwatched.season).padStart(2, "0")}E${String(firstUnwatched.episode).padStart(2, "0")}` })}"`
        : "";
      const label = isAnime
        ? `${it.episode} ${t("col_episode")}`
        : t("season_ep", { s: it.season, e: it.episode });
      const epName = it.episode_name
        ? `<div class="episode-name">${it.episode_name}</div>`
        : "";
      return `<tr class="${watchedCls}">
        <td><button class="watch-btn uw-watch${it.watched ? " on" : ""}${lockedCls}" data-i="${it.idx}"${tip}>${it.watched ? CHECK_SVG : ""}</button><span class="episode-cell"><span class="episode-label">${label}</span>${epName}</span></td>
      </tr>`;
    });
    body.innerHTML = `<div class="season-box"><table class="releases-table"><thead><tr><th>${t("col_episode")}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;

    body.querySelectorAll(".uw-watch").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.classList.contains("locked")) return;
        const savedIdx = Number(btn.dataset.i);
        const it = sorted[savedIdx];
        const newWatched = it.watched ? 0 : 1;
        try {
          if (isAnime) {
            await fetch("/api/anime/episode/watch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anime_id: item.id, episode: it.episode, watched: newWatched }),
            });
          } else {
            await fetch("/api/episode/watch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tmdb_id: item.tmdb_id, season: it.season, episode: it.episode, watched: newWatched }),
            });
          }
          it.watched = newWatched;
          renderList(savedIdx);
        } catch (e) {
          toast(t("error"));
        }
      });
    });
    // TV: toggle sonras� ayn� butonda kal (senkron); ilk a��l��ta ilk izlenmemi�
    try {
      if (savedIdx !== undefined && savedIdx !== null) {
        const same = body.querySelector(`.uw-watch[data-i="${savedIdx}"]`);
        if (same && !same.classList.contains("locked")) { try { same.focus(); same.scrollIntoView({block:'nearest'}); } catch(_){} return; }
      }
      const btns = Array.from(body.querySelectorAll('.uw-watch'));
      if (btns.length) {
        let firstUnwatchedIdx = -1, lastWatchedIdx = -1;
        btns.forEach((btn, idx) => {
          const it = sorted[Number(btn.dataset.i)];
          if (!it) return;
          if (!it.watched && firstUnwatchedIdx === -1) firstUnwatchedIdx = idx;
          if (it.watched) lastWatchedIdx = idx;
        });
        let tIdx = -1;
        if (firstUnwatchedIdx !== -1) tIdx = firstUnwatchedIdx;
        else if (lastWatchedIdx !== -1) tIdx = lastWatchedIdx;
        else {
          const firstEnabled = btns.findIndex(b=>!b.disabled);
          if (firstEnabled !== -1) tIdx = firstEnabled;
        }
        const target = tIdx !== -1 ? btns[tIdx] : null;
        if (target) setTimeout(()=>{ try{ target.focus(); target.scrollIntoView({block:'nearest'});}catch(_){} }, 120);
      }
    } catch(_){}
  };

  item.items = (item.items || []).map((it, idx) => ({ ...it, idx }));
  renderList();
}

document.getElementById("unwatched-close").onclick = () => {
  document.getElementById("unwatched-modal").style.display = "none";
};
document.getElementById("unwatched-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) document.getElementById("unwatched-modal").style.display = "none";
});

async function openAnimeDetails(dbId, anilistId, title, restrictCalendar) {
  currentDetails = { kind: "anime", dbId, anilistId, title };
  const modal = document.getElementById("details-modal");
  const body = document.getElementById("details-body");
  const calBtn = document.getElementById("details-calendar");
  document.getElementById("details-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  const disabled = !!restrictCalendar || !dbId;
  calBtn.style.display = "flex";
  calBtn.disabled = disabled;
  calBtn.classList.toggle("disabled", disabled);
  calBtn.dataset.tip = disabled ? t("calendar_follow_hint") : t("calendar_title");
  calBtn.dataset.i18nTitle = disabled ? "calendar_follow_hint" : "calendar_title";
  if (disabled) {
    calBtn.onclick = null;
  } else {
    calBtn.onclick = () => {
      closeDetails();
      openAnimeSchedule(dbId, title);
    };
  }

  try {
    const res = await fetch(`/api/anime/details?anilist_id=${encodeURIComponent(anilistId)}`);
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
      return;
    }
    document.getElementById("details-title").textContent = data.title || title || "";
    body.innerHTML = renderAnimeDetails(data);
    bindAnimeDetailsEvents();
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

async function openAnimeSchedule(id, title) {
  const modal = document.getElementById("releases-modal");
  const body = document.getElementById("releases-body");
  document.getElementById("releases-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";

  try {
    const res = await fetch(`/api/anime/schedule?anime_id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
      return;
    }
    document.getElementById("releases-title").textContent = data.title || title || "";

    if (!data.items.length) {
      body.innerHTML = `<div class="releases-error">${t("no_release_date")}</div>`;
      return;
    }

    const loc = tzLocale();
    const items = [...data.items].sort((a, b) => (a.episode || 0) - (b.episode || 0));
    const now = Date.now();
    const releasedCount = items.filter((it) => it.airing_at && it.airing_at * 1000 <= now).length;

    const renderTable = (savedEp) => {
      const releasedWatched = items.filter((it) => it.watched && it.airing_at && it.airing_at * 1000 <= now).length;
      const allWatched = releasedCount > 0 && releasedWatched === releasedCount;
      const pct = releasedCount ? Math.round((releasedWatched / releasedCount) * 100) : 0;
      let html = `<div class="season-box">`;
      const rawTitleA = data.title || title || "";
      const truncA = rawTitleA.length > 30 ? rawTitleA.slice(0, 30) : rawTitleA;
      const watchTipTextA = allWatched ? t("season_mark_unwatched", { code: truncA }) : t("season_mark_watched", { code: truncA });
      const watchIconA = allWatched ? EYE_OFF_SVG : EYE_SVG;
      html += `<div class="season-box-title"><span class="season-name">${escAttr(data.title || title || "")}</span><div class="season-progress"><div class="season-progress-fill" style="width:${pct}%"></div><span class="season-progress-text">${releasedWatched}/${releasedCount} · %${pct}</span></div><div class="season-actions"><button class="season-watch-all${allWatched ? " is-clear" : ""}" data-w="${allWatched ? 0 : 1}" data-tip="${escAttr(watchTipTextA)}"${releasedCount ? "" : " disabled"}>${watchIconA}</button></div></div>`;
      html += `<table class="releases-table"><thead><tr><th>${t("col_episode")}</th><th>${t("col_date")}</th></tr></thead><tbody>`;
      items.forEach((it, i) => {
        const d = it.airing_at ? new Date(it.airing_at * 1000) : null;
        let dateText = "�";
        let cls = "";
        if (d && !isNaN(d.getTime())) {
          try {
            dateText = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
          } catch (e) {
            dateText = d.toLocaleDateString();
          }
          const day = utcDayStr(it.airing_at);
          const localT = todayInTzStr();
          if (day === localT) cls = "date-today";
          else if (day && day < localT) cls = "date-past";
          else if (day && day > localT) cls = "date-future";
          else {
            // fallback to time comparison when day strings unavailable
            if (d.getTime() < now) cls = "date-past";
            else if (d.getTime() > now) cls = "date-future";
            else cls = "date-today";
          }
        }
        const released = it.airing_at && it.airing_at * 1000 <= now;
        const prevWatched = i === 0 ? true : items[i - 1].watched;
        const selectable = released && prevWatched;
        const btnDisabled = !selectable ? " disabled" : "";
        const watchedCls = it.watched ? " watched" : "";
        const todayCls = cls === "date-today" ? " today-release" : "";
        html += `<tr class="${watchedCls}${todayCls}" data-released="${released ? 1 : 0}"><td><button class="watch-btn anime-watch${it.watched ? " on" : ""}" data-g="0" data-i="${i}" data-e="${it.episode}" data-w="${it.watched ? 1 : 0}"${btnDisabled}>${it.watched ? CHECK_SVG : ""}</button><span class="episode-label">${it.episode} ${t("col_episode")}</span></td><td class="${cls}"><span class="episode-date-wrap"><span class="episode-date-text">${dateText}</span><button class="episode-info-btn" data-g="0" data-i="${i}" data-e="${it.episode}" data-tip="${t("info_title")}" data-i18n-title="info_title">${INFO_SVG}</button></span></td></tr>`;
      });
      html += "</tbody></table></div>";
      body.innerHTML = html;

      body.querySelectorAll(".anime-watch").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const episode = Number(btn.dataset.e);
          const newWatched = btn.dataset.w === "1" ? 0 : 1;
          try {
            const r = await fetch("/api/anime/episode/watch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ anime_id: id, episode, watched: newWatched }),
            });
            if (!r.ok) return;
            const idx = items.findIndex((it) => it.episode === episode);
            if (idx >= 0) items[idx].watched = newWatched;
            renderTable(episode);
            if (typeof loadAnime === "function") loadAnime();
          } catch (e) {
            toast(t("error"));
          }
        });
      });

      body.querySelectorAll(".episode-info-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (e) e.stopPropagation();
          const episode = Number(btn.dataset.e);
          const it = items.find((x) => x.episode === episode);
          if (!it) return;
          openAnimeEpisodeInfo(id, data.title || title, it, data.duration);
        });
      });

      body.querySelectorAll(".season-watch-all").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const watched = btn.dataset.w === "1" ? 1 : 0;
          // Temizle -> clear-apply (tampon otomatik uygulanir)
          if (watched === 0) {
            btn.disabled = true;
            try {
              const r = await fetch("/api/seasons/clear-apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ anilist_id: data.anilist_id }),
              });
              const j = await r.json();
              if (!r.ok) return;
              items.forEach((it) => { it.watched = 0; });
              (j.applied || []).forEach((a) => {
                const idx = items.findIndex((it) => it.episode === a.episode);
                if (idx >= 0) items[idx].watched = 1;
              });
              toast(j.applied && j.applied.length ? t("clear_applied", { n: j.applied.length }) : t("clear_no_signals"));
              renderTable('all');
              if (typeof loadAnime === "function") loadAnime();
            } catch (e) {
              toast(t("error"));
            } finally {
              btn.disabled = false;
            }
            return;
          }
          const targets = items.filter((it) => it.airing_at && it.airing_at * 1000 <= now);
          try {
            for (const it of targets) {
              if (it.watched === watched) continue;
              const r = await fetch("/api/anime/episode/watch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ anime_id: id, episode: it.episode, watched }),
              });
              if (r.ok) it.watched = watched;
            }
            renderTable('all');
            if (typeof loadAnime === "function") loadAnime();
          } catch (e) {
            toast(t("error"));
          }
        });
      });
      // TV: toggle sonras� ayn� butonda kal (senkron); ilk a��l��ta ilk izlenmemi�
      try {
        if (savedEp !== undefined && savedEp !== null) {
          if (savedEp === 'all') {
            const allBtn = body.querySelector('.season-watch-all');
            if (allBtn && !allBtn.disabled) { try { allBtn.focus(); allBtn.scrollIntoView({block:'nearest'}); } catch(_){} return; }
          } else {
            const same = body.querySelector(`.anime-watch[data-e="${savedEp}"]`);
            if (same && !same.disabled) { try { same.focus(); same.scrollIntoView({block:'nearest'}); } catch(_){} return; }
          }
        }
        const btns = Array.from(body.querySelectorAll('.anime-watch'));
        if (btns.length) {
          let firstUnwatchedIdx = -1, lastWatchedIdx = -1;
          btns.forEach((btn, idx) => {
            if (btn.disabled) return;
            const ep = Number(btn.dataset.e);
            const it = items.find(x=>x.episode===ep);
            if (!it) return;
            if (!it.watched && firstUnwatchedIdx === -1) firstUnwatchedIdx = idx;
            if (it.watched) lastWatchedIdx = idx;
          });
          let tIdx = -1;
          if (firstUnwatchedIdx !== -1) tIdx = firstUnwatchedIdx;
          else if (lastWatchedIdx !== -1) tIdx = lastWatchedIdx;
          else {
            const firstEnabled = btns.findIndex(b=>!b.disabled);
            if (firstEnabled !== -1) tIdx = firstEnabled;
          }
          const target = tIdx !== -1 ? btns[tIdx] : null;
          if (target) setTimeout(()=>{ try{ target.focus(); target.scrollIntoView({block:'nearest'});}catch(_){} }, 120);
        }
      } catch(_){}
    };

    renderTable();
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

document.getElementById("details-modal").addEventListener("click", async (e) => {
  const animeTag = e.target.closest(".anime-genre-tag");
  if (animeTag) {
    e.stopPropagation();
    const genre = animeTag.dataset.animeGenre;
    const prevFav = state.favAnimeGenres.has(genre);
    state.favAnimeGenres.add(genre);
    animeTag.classList.add("fav");
    try {
      const r = await fetch("/api/fav_anime_genres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      state.favAnimeGenres = new Set(j.genres);
      if (!j.added) animeTag.classList.remove("fav");
      toast(j.added ? t("fav_anime_genre_added", { name: genre }) : t("fav_anime_genre_removed", { name: genre }));
    } catch (err) {
      if (prevFav) state.favAnimeGenres.delete(genre);
      else state.favAnimeGenres.delete(genre);
      if (prevFav) animeTag.classList.remove("fav");
      toast(errText(err.message) || t("error"));
    }
    return;
  }
  const tag = e.target.closest(".genre-tag");
  if (!tag) return;
  e.stopPropagation();
  const genre = tag.dataset.genre;
  const prevFav = state.favGenres.has(genre);
  state.favGenres.add(genre);
  tag.classList.add("fav");
  try {
    const r = await fetch("/api/fav_genres", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    state.favGenres = new Set(j.genres);
    if (!j.added) tag.classList.remove("fav");
    toast(j.added ? t("fav_genre_added", { name: genre }) : t("fav_genre_removed", { name: genre }));
  } catch (err) {
    if (prevFav) state.favGenres.delete(genre);
    else state.favGenres.delete(genre);
    if (prevFav) tag.classList.remove("fav");
    toast(errText(err.message) || t("error"));
  }
});


const detailsRefreshBtn = document.getElementById("details-refresh");
if (detailsRefreshBtn) {
  detailsRefreshBtn.onclick = async () => {
    if (!currentDetails || detailsRefreshBtn.classList.contains("loading")) return;
    const body = document.getElementById("details-body");
    detailsRefreshBtn.classList.add("loading");
    detailsRefreshBtn.disabled = true;
    body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
    try {
      if (currentDetails.kind === "tmdb") {
        const { mediaType, tmdbId, title, highlightPerson, highlightPersonId, highlightGenre } = currentDetails;
        const res = await fetch(`/api/details?media_type=${encodeURIComponent(mediaType)}&tmdb_id=${encodeURIComponent(tmdbId)}&lang=${encodeURIComponent(state.currentLang)}${highlightPerson ? `&highlight_person=${encodeURIComponent(highlightPerson)}` : ""}${highlightPersonId ? `&highlight_person_id=${encodeURIComponent(highlightPersonId)}` : ""}&refresh=1`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
          toast(errText(data.error) || t("data_failed"), true);
          return;
        }
        document.getElementById("details-title").textContent = data.title || title || "";
        body.innerHTML = renderTmdbDetails(data, title, highlightGenre);
        bindTmdbDetailsEvents();
        toast(t("refreshed") || "Yenilendi");
      } else if (currentDetails.kind === "anime") {
        const { anilistId, title } = currentDetails;
        const res = await fetch(`/api/anime/details?anilist_id=${encodeURIComponent(anilistId)}&refresh=1`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
          toast(errText(data.error) || t("data_failed"), true);
          return;
        }
        document.getElementById("details-title").textContent = data.title || title || "";
        body.innerHTML = renderAnimeDetails(data);
        bindAnimeDetailsEvents();
        toast(t("refreshed") || "Yenilendi");
      }
    } catch (e) {
      body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
      toast(t("conn_error"), true);
    } finally {
      detailsRefreshBtn.classList.remove("loading");
      detailsRefreshBtn.disabled = false;
    }
  };
}

export { openReleases, closeReleases, closeDetails, closeModals,
         openTvUnfollowConfirm, openAnimeUnfollowConfirm, openRejectConfirm,
         openMemberDeleteConfirm, openMemberDeactivateConfirm, openLogoutConfirm,
         openNotifClearConfirm, openAskClearConfirm, openStremioDisconnectConfirm,
         openRemoteDisconnectConfirm, openRemotePeerDeleteConfirm,
         openStremioInstallModal, closeStremioInstallModal,
         openStremioTunnelRemoveConfirm, openRemoteResetConfirm,
          openDetails, toggleFavActor, toggleFavDirector, toggleFavAnimeChar, openAnimeChar, openPerson, openDirector,
         openUnwatchedModal, openAnimeDetails, openAnimeSchedule };
