// Faz 4: components — modal bileşenleri (yayın takvimi, detaylar, kişi, anime detay/takvim, izlenmemiş, onay).
import { state } from "./state.js";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function cardTvAttrs(div, title){ try{ if(!isTvUIActive()) return; div.tabIndex=0; div.setAttribute('role','button'); if(title) div.setAttribute('aria-label', title); div.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }});}catch{} }

import { t, errText, animeGenreLabel } from "./i18n.js";
import {
  IMAGE_BASE, HEART_SVG, CHECK_SVG, CALENDAR_SVG, INFO_SVG,
  posterHTML, scoreTag, platformTag, typeLabel, formatDate,
  fmtRuntime, fmtScore, applyTitleHint, escAttr, toast,
  canSelectAll, utcStateStr, utcDayStr, utcTodayStr, isNewEpisode, tzLocale, dateState, isReleaseToday, todayInTzStr,
} from "./utils.js";
import { loadFollowed, loadAnime, switchView, animeStatusLabel, tvStatusLabel } from "./views.js";
import { setMedia, renderChips, doComboSearch } from "./search.js";

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
      let html = "";
      seasonNames.forEach((seasonKey) => {
        const seasonItems = groups[seasonKey].sort((a, b) => {
          const ea = a.episode == null ? -1 : a.episode;
          const eb = b.episode == null ? -1 : b.episode;
          return ea - eb;
        });
        const seasonLabel =
          seasonKey === "other"
            ? data.media_type === "movie"
              ? t("release_date")
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
          html += `<div class="season-box-title"><span class="season-name">${seasonLabel}</span><div class="season-progress"><div class="season-progress-fill" style="width:${pct}%"></div><span class="season-progress-text">${watched}/${total} · %${pct}</span></div><button class="season-watch-all" data-s="${seasonKey}" data-w="${allWatched ? 0 : 1}"${btnDisabled}>${allWatched ? t("clear") : t("watch_all")}</button></div>`;
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
          const prevWatched = i === 0 ? true : seasonItems[i - 1].watched;
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
            html += `<td><button class="${btnCls}" data-g="${seasonKey}" data-i="${i}"${btnDisabled}>${checkIcon}</button><span class="episode-cell"><span class="episode-label">${t("release_date")}</span>${epName}</span></td>`;
          }
          html += `<td${dateClass}>${dateText}</td></tr>`;
        });
        html += "</tbody></table></div>";
      });

      body.innerHTML = html || `<div class="releases-error">${t("no_release_date")}</div>`;
      bindReleasesEvents();
      // TV: toggle sonrası aynı butonda kal (senkron); ilk açılışta ilk izlenmemiş
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

function closeModals() {
  closeReleases();
  closeDetails();
  closeConfirm();
}

function closeConfirm() {
  document.getElementById("confirm-modal").style.display = "none";
}

function showConfirm(text, onYes, opts = {}) {
  if (opts.title) document.getElementById("confirm-title").textContent = opts.title;
  document.getElementById("confirm-text").textContent = text;
  const yesBtn = document.getElementById("confirm-yes");
  yesBtn.textContent = opts.yes || t("confirm_yes");
  yesBtn.classList.toggle("confirm-danger", opts.danger !== false);
  document.getElementById("confirm-modal").style.display = "flex";
  yesBtn.onclick = () => {
    closeConfirm();
    onYes();
  };
  document.getElementById("confirm-close").onclick = closeConfirm;
  document.getElementById("confirm-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeConfirm();
  });
}

document.getElementById("releases-close").onclick = closeReleases;
document.getElementById("releases-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeReleases();
});
document.getElementById("details-close").onclick = closeDetails;
document.getElementById("details-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeDetails();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModals();
});

function renderTmdbDetails(data, title, highlightGenre) {
  let html = '<div class="details-wrap">';
  html += '<div class="details-poster-col">';
  if (data.poster_path) {
    html += `<img class="details-poster" src="${data.poster_local || IMAGE_BASE + data.poster_path}" alt="${data.title}" />`;
  }
  const badges = [];
  if (data.media_type === "tv") {
    badges.push(t("type_tv"));
    if (data.number_of_seasons) badges.push(t("seasons", { n: data.number_of_seasons }));
    if (data.number_of_episodes) badges.push(t("episodes", { n: data.number_of_episodes }));
    if (data.status) badges.push(tvStatusLabel(data.status));
    if (data.first_air_date) badges.push(formatDate(data.first_air_date).text);
  } else {
    badges.push(t("type_movie"));
    if (data.release_date) badges.push(formatDate(data.release_date).text);
  }
  if (data.runtime) badges.push(fmtRuntime(data.runtime));
  html += '<div class="details-meta">';
  badges.forEach((b) => {
    html += `<span class="detail-badge">${b}</span>`;
  });
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
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.cast.forEach((c) => {
      const img = c.profile_path ? `<img class="cast-avatar" src="${IMAGE_BASE}${c.profile_path}" alt="${c.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${c.name.charAt(0)}</div>`;
      const fav = c.id && state.favActors.has(String(c.id)) ? " fav" : "";
      html += `<div class="cast-item" data-person-id="${c.id || ""}" role="button" tabindex="0">${img}<div class="cast-info"><div class="cast-name">${c.name}</div><div class="cast-char">${c.character || ""}</div></div>${c.id ? `<button class="cast-fav${fav}" data-person-id="${c.id}" data-person-name="${c.name.replace(/"/g, "&quot;")}" data-tip="${t("fav_actor")}">${HEART_SVG}</button>` : ""}</div>`;
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
  body.querySelectorAll(".cast-fav").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleFavActor(btn);
    };
  });
}

function renderAnimeDetails(data) {
  let html = '<div class="details-wrap">';
  html += '<div class="details-poster-col">';
  if (data.cover_url || data.poster_local) html += `<img class="details-poster" src="${data.poster_local || data.cover_url}" alt="${data.title}" />`;
  const badges = [];
  badges.push(t("tab_anime"));
  if (data.format) badges.push(data.format);
  if (data.status) badges.push(animeStatusLabel(data.status));
  if (data.episodes) badges.push(t("episodes", { n: data.episodes }));
  if (data.duration) badges.push(fmtRuntime(data.duration));
  if (data.start_date) badges.push(String(data.start_date));
  if (data.studios && data.studios.length) badges.push(data.studios.join(", "));
  html += '<div class="details-meta">';
  badges.forEach((b) => { html += `<span class="detail-badge">${b}</span>`; });
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
    html += '<div class="details-cast"><div class="details-cast-list">';
    data.characters.forEach((c) => {
      const img = c.image ? `<img class="cast-avatar" src="${c.image}" alt="${c.name}" />` : `<div class="cast-avatar cast-avatar-fallback">${c.name.charAt(0)}</div>`;
      const fav = c.id && state.favAnimeChars.has(String(c.id)) ? " fav" : "";
      html += `<div class="cast-item" data-char-id="${c.id || ""}" role="button" tabindex="0">${img}<div class="cast-info"><div class="cast-name">${c.name}</div></div>${c.id ? `<button class="cast-fav${fav}" data-char-id="${c.id}" data-char-name="${c.name.replace(/"/g, "&quot;")}" data-anime-title="${(data.title || "").replace(/"/g, "&quot;")}" data-tip="${t("fav_char")}">${HEART_SVG}</button>` : ""}</div>`;
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
      toggleFavAnimeChar(btn);
    };
  });
}

async function openDetails(mediaType, tmdbId, title, highlightPerson, highlightPersonId, highlightGenre) {
  currentDetails = { kind: "tmdb", mediaType, tmdbId, title, highlightPerson, highlightPersonId, highlightGenre };
  const modal = document.getElementById("details-modal");
  const body = document.getElementById("details-body");
  const calBtn = document.getElementById("details-calendar");
  document.getElementById("details-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  calBtn.style.display = "flex";
  calBtn.onclick = () => {
    closeDetails();
    openReleases(mediaType, tmdbId, title);
  };

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
  setMedia("anime");
  const input = document.getElementById("search-input");
  if (input) input.value = "";
  state.chips.length = 0;
  state.chips.push({ type: "char", label: name, value: charId });
  renderChips();
  doComboSearch("", state.chips, "anime");
}

async function openPerson(personId, name) {
  const modal = document.getElementById("person-modal");
  const body = document.getElementById("person-body");
  document.getElementById("person-title").textContent = name || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  try {
    const res = await fetch(`/api/person/${encodeURIComponent(personId)}`);
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div class="releases-error">${errText(data.error) || t("data_failed")}</div>`;
      return;
    }
const grid = document.createElement("div");
    grid.className = "poster-grid person-grid";
    if (!data.length) {
    grid.innerHTML = `<div class="empty">${t("no_credits")}</div>`;
    return;
  }
data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
    cardTvAttrs(div, item.title||"");
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
      <div class="info">
        <div class="title">${item.title}</div>
<div class="meta">
          <span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>
          ${scoreTag(item.vote_average)}
          ${item.media_type === "tv" && item.number_of_seasons ? `<div class="season-line"><span class="season-count-badge">${t("seasons", { n: item.number_of_seasons })}</span>${item.number_of_episodes ? `<span class="episode-count">${t("episodes", { n: item.number_of_episodes })}</span>` : ""}</div>` : `<div class="season-line"></div>`}
          ${item.release_date ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>` : ""}
        </div>
        </div>
        ${item.media_type === "tv" ? `<button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>` : ``}
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
      div.querySelector(".remove").onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdb_id: item.tmdb_id,
            media_type: item.media_type,
            title: item.title,
            poster_path: item.poster_path,
          }),
        });
        const j = await r.json();
        toast(r.ok ? t("added", { name: item.title }) : j.error || t("error"));
        if (r.ok) {
          loadFollowed(item.media_type === "tv" ? "dizi" : "film");
          switchView(item.media_type === "tv" ? "dizi" : "film");
          modal.style.display = "none";
        }
      };
      const calBtn = div.querySelector(".calendar-btn");
      if (calBtn) {
        calBtn.onclick = (e) => {
          e.stopPropagation();
          openReleases(item.media_type, item.tmdb_id, item.title);
        };
      }
      const infoBtnP = div.querySelector(".info-btn");
      if (infoBtnP) infoBtnP.onclick = (e) => { e.stopPropagation(); div.click(); };
      div.onclick = () => {
        openDetails(item.media_type, item.tmdb_id, item.title);
        modal.style.display = "none";
      };
      grid.appendChild(div);
      applyTitleHint(div);
    });
    body.innerHTML = "";
    body.appendChild(grid);
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

document.getElementById("person-close").onclick = () => {
  document.getElementById("person-modal").style.display = "none";
};
document.getElementById("person-modal").onclick = (e) => {
  if (e.target === e.currentTarget) document.getElementById("person-modal").style.display = "none";
};

async function openUnwatchedModal(item, isAnime) {
  const modal = document.getElementById("unwatched-modal");
  const body = document.getElementById("unwatched-body");
  document.getElementById("unwatched-title").textContent = `${item.title} · ${t("unwatched_title")}`;
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
        ? ` data-tip="${t("unwatched_tooltip", { ep: item.isAnime ? `EP ${firstUnwatched.episode}` : `S${String(firstUnwatched.season).padStart(2, "0")}E${String(firstUnwatched.episode).padStart(2, "0")}` })}"`
        : "";
      const label = isAnime
        ? `${t("col_episode")} ${it.episode}`
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
    // TV: toggle sonrası aynı butonda kal (senkron); ilk açılışta ilk izlenmemiş
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

async function openAnimeDetails(dbId, anilistId, title) {
  currentDetails = { kind: "anime", dbId, anilistId, title };
  const modal = document.getElementById("details-modal");
  const body = document.getElementById("details-body");
  const calBtn = document.getElementById("details-calendar");
  document.getElementById("details-title").textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  if (dbId) {
    calBtn.style.display = "flex";
    calBtn.onclick = () => {
      closeDetails();
      openAnimeSchedule(dbId, title);
    };
  } else {
    calBtn.style.display = "none";
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
      html += `<div class="season-box-title"><span class="season-name">${escAttr(data.title || title || "")}</span><div class="season-progress"><div class="season-progress-fill" style="width:${pct}%"></div><span class="season-progress-text">${releasedWatched}/${releasedCount} · %${pct}</span></div><button class="season-watch-all" data-w="${allWatched ? 0 : 1}"${releasedCount ? "" : " disabled"}>${allWatched ? t("clear") : t("watch_all")}</button></div>`;
      html += `<table class="releases-table"><thead><tr><th>${t("col_episode")}</th><th>${t("col_date")}</th></tr></thead><tbody>`;
      items.forEach((it, i) => {
        const d = it.airing_at ? new Date(it.airing_at * 1000) : null;
        let dateText = "—";
        let cls = "";
        if (d && !isNaN(d.getTime())) {
          try {
            dateText = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
          } catch (e) {
            dateText = d.toLocaleString();
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
        html += `<tr class="${watchedCls}${todayCls}" data-released="${released ? 1 : 0}"><td><button class="watch-btn anime-watch${it.watched ? " on" : ""}" data-e="${it.episode}" data-w="${it.watched ? 1 : 0}"${btnDisabled}>${it.watched ? CHECK_SVG : ""}</button><span class="episode-label">${t("col_episode")} ${it.episode}</span></td><td class="${cls}">${dateText}</td></tr>`;
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

      body.querySelectorAll(".season-watch-all").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          const watched = btn.dataset.w === "1" ? 1 : 0;
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
      // TV: toggle sonrası aynı butonda kal (senkron); ilk açılışta ilk izlenmemiş
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

export { openReleases, closeReleases, closeDetails, closeModals, closeConfirm, showConfirm,
         openDetails, toggleFavActor, toggleFavAnimeChar, openAnimeChar, openPerson,
         openUnwatchedModal, openAnimeDetails, openAnimeSchedule };
