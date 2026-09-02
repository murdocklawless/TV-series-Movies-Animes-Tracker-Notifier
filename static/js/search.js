// Faz 4: search — arama mantığı (normal/çoklu arama, filtre çipleri, sonuçlar, seçici modal).
import { state } from "./state.js";
import { t, animeGenreLabel } from "./i18n.js";
import {
  posterHTML, scoreTag, typeLabel, formatDate, CALENDAR_SVG, escAttr, INFO_SVG,
  toast, CHECK_SVG, loadGenres, FILM_SVG, applyTitleHint,
} from "./utils.js";
import { switchView } from "./views.js";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function setTvSearchCardAttrs(div, item){
  try{ if(!isTvUIActive()) return; div.tabIndex=0; div.setAttribute('role','button'); if(item.title) div.setAttribute('aria-label', item.title); if(item.tmdb_id) div.dataset.tmdbId=item.tmdb_id; if(item.anilist_id) div.dataset.anilistId=item.anilist_id; if(item.media_type) div.dataset.mediaType=item.media_type; div.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }}); const cal=div.querySelector('.calendar-btn'); if(cal){cal.tabIndex=0; cal.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); cal.click();}});} const ib=div.querySelector('.info-btn'); if(ib){ib.tabIndex=0; ib.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); ib.click();}});} const rem=div.querySelector('.remove'); if(rem){rem.tabIndex=0; rem.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); rem.click();}});} }catch{}
}

import { openDetails, openReleases, openAnimeDetails } from "./components.js";

function currentMedia() {
  return state.searchMedia;
}

function setMedia(media) {
  state.searchMedia = media;
  document.getElementById("media-dizi").classList.toggle("active", media === "dizi");
  document.getElementById("media-film").classList.toggle("active", media === "film");
  document.getElementById("media-anime").classList.toggle("active", media === "anime");
  const ph = media === "anime" ? "anime_placeholder" : "search_placeholder";
  const comboInput = document.getElementById("search-input");
  const normalInput = document.getElementById("normal-search-input");
  if (comboInput) {
    comboInput.dataset.i18n = ph;
    comboInput.placeholder = t(ph);
  }
  if (normalInput) {
    normalInput.dataset.i18n = ph;
    normalInput.placeholder = t(ph);
  }
  const actorBtn = document.getElementById("filter-actor");
  if (actorBtn) {
    actorBtn.dataset.i18n = media === "anime" ? "filter_character" : "filter_actor";
    actorBtn.textContent = t(media === "anime" ? "filter_character" : "filter_actor");
  }
  state.chips = state.chips.filter((c) => c.type !== "media");
  renderChips();
  const movieBtn = document.getElementById("filter-media-movie");
  const tvBtn = document.getElementById("filter-media-tv");
  if (movieBtn) movieBtn.style.display = media === "anime" ? "none" : "";
  if (tvBtn) tvBtn.style.display = media === "anime" ? "none" : "";
  updateMediaButtons();
}

document.getElementById("media-dizi").onclick = () => setMedia("dizi");
document.getElementById("media-film").onclick = () => setMedia("film");
document.getElementById("media-anime").onclick = () => setMedia("anime");

function toggleMediaChip(value, label) {
  const idx = state.chips.findIndex((c) => c.type === "media");
  if (idx >= 0 && state.chips[idx].value === value) {
    state.chips.splice(idx, 1);
  } else {
    if (idx >= 0) state.chips.splice(idx, 1);
    state.chips.push({ type: "media", label, value });
  }
  renderChips();
  updateMediaButtons();
}

function updateMediaButtons() {
  const active = state.chips.filter((c) => c.type === "media").map((c) => c.value);
  const movieBtn = document.getElementById("filter-media-movie");
  const tvBtn = document.getElementById("filter-media-tv");
  if (movieBtn) movieBtn.classList.toggle("active", active.includes("movie"));
  if (tvBtn) tvBtn.classList.toggle("active", active.includes("tv"));
}

function updateFilterButtons() {
  const has = (t) => state.chips.some((c) => c.type === t);
  const actorBtn = document.getElementById("filter-actor");
  const genreBtn = document.getElementById("filter-genre");
  const yearBtn = document.getElementById("filter-year");
  const scoreBtn = document.getElementById("filter-score");
  if (actorBtn) actorBtn.classList.toggle("active", has("actor") || has("char"));
  if (genreBtn) genreBtn.classList.toggle("active", has("genre"));
  if (yearBtn) yearBtn.classList.toggle("active", has("year"));
  if (scoreBtn) scoreBtn.classList.toggle("active", has("score"));
}

const CHIP_ORDER = { media: 0, actor: 1, char: 1, genre: 2, year: 3, score: 4 };

function renderChips() {
  const box = document.getElementById("filter-chips");
  const sorted = state.chips.slice().sort(
    (a, b) => (CHIP_ORDER[a.type] ?? 9) - (CHIP_ORDER[b.type] ?? 9)
  );
  box.innerHTML = sorted
    .map(
      (c) => `<span class="chip chip-${c.type === "media" ? `media-${c.value}` : c.type}">${c.type === "genre" ? animeGenreLabel(c.label) : c.label}<button class="chip-x" data-i="${state.chips.indexOf(c)}">✕</button></span>`
    )
    .join("");
  box.querySelectorAll(".chip-x").forEach((btn) => {
    btn.onclick = () => {
      state.chips.splice(Number(btn.dataset.i), 1);
      renderChips();
    };
  });
  updateMediaButtons();
  updateFilterButtons();
  if (!state.chips.length) {
    document.getElementById("search-results").innerHTML = "";
    document.getElementById("anime-results").innerHTML = "";
    setResultsTitle("");
    closeResultsModal();
  }
}

function openValueModal(kind) {
  const title = document.getElementById("value-title");
  const input = document.getElementById("value-input");
  title.textContent = t(kind === "year" ? "search_type_year" : "search_type_score");
  input.dataset.filter = kind;
  input.value = "";
  input.maxLength = kind === "year" ? 4 : 3;
  input.placeholder = t(kind === "year" ? "year_placeholder" : "score_placeholder");
  document.getElementById("value-modal").style.display = "flex";
  input.focus();
}

function setSearchBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    btn.classList.add("loading");
    btn.innerHTML = `<span class="btn-spinner"></span><span class="btn-stop-label">${t("search_stop")}</span>`;
    btn.disabled = false;
  } else {
    if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

let comboAbort = null;

function runSearch() {
  const q = (document.getElementById("search-input")?.value || "").trim();
  const media = currentMedia();
  if (!q && !state.chips.length) return;
  const btn = document.getElementById("search-btn");
  setSearchBtnLoading(btn, true);
  if (comboAbort) comboAbort.abort();
  comboAbort = new AbortController();
  const handler = () => {
    if (comboAbort) comboAbort.abort();
    setSearchBtnLoading(btn, false);
    btn.onclick = runSearch;
  };
  btn.onclick = handler;
  doComboSearch(q, state.chips, media, comboAbort.signal).finally(() => {
    if (comboAbort) {
      comboAbort = null;
      setSearchBtnLoading(btn, false);
      btn.onclick = runSearch;
    }
  });
}

document.getElementById("search-btn").onclick = runSearch;
document.getElementById("search-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

let normalAbort = null;

function runNormalSearch() {
  const q = document.getElementById("normal-search-input").value.trim();
  if (!q) return;
  const btn = document.getElementById("normal-search-btn");
  setSearchBtnLoading(btn, true);
  if (normalAbort) normalAbort.abort();
  normalAbort = new AbortController();
  const handler = () => {
    if (normalAbort) normalAbort.abort();
    setSearchBtnLoading(btn, false);
    btn.onclick = runNormalSearch;
  };
  btn.onclick = handler;
  const media = currentMedia();
  const p = media === "anime" ? doAnimeTitleSearch(q, normalAbort.signal) : doTitleSearch(q, media, normalAbort.signal);
  p.finally(() => {
    if (normalAbort) {
      normalAbort = null;
      setSearchBtnLoading(btn, false);
      btn.onclick = runNormalSearch;
    }
  });
}

async function doTitleSearch(q, media, signal) {
  const mediaType = media === "film" ? "movie" : "tv";
  const res = await fetch("/api/search?q=" + encodeURIComponent(q) + "&media_type=" + mediaType, { signal });
  const data = await res.json();
  const grid = document.getElementById("search-results");
  const animeGrid = document.getElementById("anime-results");
  grid.innerHTML = "";
  animeGrid.style.display = "none";
  grid.style.display = "";
  setResultsTitle(q);
  openResultsModal();
  if (!res.ok) {
    toast(errText(data.error) || t("search_error"));
    return;
  }
  if (!data.length) {
    grid.innerHTML = `<div class="empty">${t("no_results")}</div>`;
    return;
  }
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
    setTvSearchCardAttrs(div, item);
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
      ${item.media_type === "tv" ? `<button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>` : ""}
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
      if (r.ok) switchView(item.media_type === "tv" ? "dizi" : "film");
    };
    const calBtn = div.querySelector(".calendar-btn");
    if (calBtn) {
      calBtn.onclick = (e) => {
        e.stopPropagation();
        openReleases(item.media_type, item.tmdb_id, item.title);
      };
    }
    const ib = div.querySelector(".info-btn"); if(ib) ib.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title); };
    div.onclick = () => openDetails(item.media_type, item.tmdb_id, item.title);
    grid.appendChild(div);
    applyTitleHint(div);
  });
}

async function doAnimeTitleSearch(q, signal) {
  const res = await fetch("/api/anime/search?q=" + encodeURIComponent(q), { signal });
  const data = await res.json();
  const grid = document.getElementById("search-results");
  const animeGrid = document.getElementById("anime-results");
  grid.style.display = "none";
  animeGrid.innerHTML = "";
  animeGrid.style.display = "";
  setResultsTitle(q);
  openResultsModal();
  if (!res.ok) {
    toast(errText(data.error) || t("search_error"));
    return;
  }
  if (!data.length) {
    animeGrid.innerHTML = `<div class="empty">${t("no_results")}</div>`;
    return;
  }
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
    setTvSearchCardAttrs(div, item);
    div.innerHTML = `
      <div class="poster-wrap">${item.cover_url ? `<img src="${item.cover_url}" alt="${item.title}" onerror="this.outerHTML=noPosterFallback()" />` : `<div class="no-poster">${FILM_SVG}</div>`}<button class="info-btn" data-tip="Info">${INFO_SVG}</button></div>
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          <span class="badge badge-anime">${t("tab_anime")}</span>
          ${item.score ? scoreTag(item.score / 10) : ""}
          ${item.status ? `<span class="badge badge-anime-status">${animeStatusLabel(item.status)}</span>` : ""}
          ${animeNextText(item.next_episode ? { episode: item.next_episode, airing_at: item.airing_at } : null)}
        </div>
      </div>
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
    `;
    div.querySelector(".remove").onclick = async (e) => {
      e.stopPropagation();
      const r = await fetch("/api/anime/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anilist_id: item.anilist_id }),
      });
      const j = await r.json();
      toast(r.ok ? t("added", { name: item.title }) : j.error || t("error"));
      if (r.ok) switchView("anime");
    };
    const ib2 = div.querySelector(".info-btn"); if(ib2) ib2.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(null, item.anilist_id, item.title); };
    div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title);
    animeGrid.appendChild(div);
    applyTitleHint(div);
  });
}

document.getElementById("normal-search-btn").onclick = runNormalSearch;
document.getElementById("normal-search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runNormalSearch();
});
document.getElementById("search-input")?.addEventListener("input", (e) => {
  const filter = e.target.dataset.filter;
  if (!filter) return;
  const cleaned = filter === "year" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value.replace(/[^0-9.,]/g, "");
  if (cleaned !== e.target.value) {
    const pos = e.target.selectionStart;
    e.target.value = cleaned;
    e.target.setSelectionRange(pos - 1, pos - 1);
  }
});

document.getElementById("filter-media-movie").onclick = () => toggleMediaChip("movie", t("type_movie"));
document.getElementById("filter-media-tv").onclick = () => toggleMediaChip("tv", t("type_tv"));
document.getElementById("filter-actor").onclick = () => openPicker(currentMedia() === "anime" ? "fav_anime_char" : "fav_actor");
document.getElementById("filter-genre").onclick = () => openPicker(currentMedia() === "anime" ? "anime_genre" : "fav_genre");
document.getElementById("filter-year").onclick = () => openValueModal("year");
document.getElementById("filter-score").onclick = () => openValueModal("score");

document.getElementById("value-close").onclick = () => {
  document.getElementById("value-modal").style.display = "none";
};
document.getElementById("value-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) document.getElementById("value-modal").style.display = "none";
});
document.getElementById("value-go").onclick = () => {
  const kind = document.getElementById("value-input").dataset.filter;
  const val = document.getElementById("value-input").value.trim();
  const nowYear = new Date().getFullYear();
  if (kind === "year") {
    if (!/^\d{4}$/.test(val)) {
      toast(t("year_invalid", { max: nowYear }));
      return;
    }
    const y = parseInt(val, 10);
    if (y < 1900 || y > nowYear) {
      toast(t("year_invalid", { max: nowYear }));
      return;
    }
  } else {
    const norm = val.replace(",", ".");
    if (!/^(10|\d(\.\d)?)$/.test(norm)) {
      toast(t("score_invalid"));
      return;
    }
    const s = parseFloat(norm);
    if (s < 0 || s > 10) {
      toast(t("score_invalid"));
      return;
    }
  }
  state.chips.push({ type: kind, label: val, value: val });
  document.getElementById("value-modal").style.display = "none";
  renderChips();
};

function setResultsTitle(text) {
  const el = document.getElementById("results-title");
  if (el) el.textContent = text || "";
}

function openResultsModal() {
  document.getElementById("search-results-modal").style.display = "flex";
}

function closeResultsModal() {
  document.getElementById("search-results-modal").style.display = "none";
}

function comboTitle(chipsArr) {
  const parts = [];
  const q = (document.getElementById("search-input")?.value || "").trim();
  if (q) parts.push(q);
  chipsArr
    .slice()
    .sort((a, b) => (CHIP_ORDER[a.type] ?? 9) - (CHIP_ORDER[b.type] ?? 9))
    .forEach((c) => {
      if (c.type === "actor" || c.type === "char") parts.push(`${c.label}`);
      else if (c.type === "genre") parts.push(`${animeGenreLabel(c.label)}`);
      else if (c.type === "media") parts.push(`${c.label}`);
      else if (c.type === "year") parts.push(`${c.label}`);
      else if (c.type === "score") parts.push(`${c.label}`);
    });
  return parts.join(" • ");
}

async function doComboSearch(q, chipsArr, media, signal) {
  const params = new URLSearchParams();
  params.set("media", media);
  if (q) params.set("q", q);
  const actors = chipsArr.filter((c) => c.type === "actor" || c.type === "char").map((c) => c.value).join(",");
  const genres = chipsArr.filter((c) => c.type === "genre").map((c) => c.value).join(",");
  const kindChip = chipsArr.filter((c) => c.type === "media").map((c) => c.value).join(",");
  const kind = kindChip || (media === "film" ? "movie" : media === "dizi" ? "tv" : "");
  const year = chipsArr.filter((c) => c.type === "year").map((c) => c.value)[0] || "";
  const score = chipsArr.filter((c) => c.type === "score").map((c) => c.value)[0] || "";
  if (actors) params.set("actors", actors);
  if (genres) params.set("genres", genres);
  if (kind) params.set("kind", kind);
  if (year) params.set("year", year);
  if (score) params.set("score", score);
  const res = await fetch("/api/combo-search?" + params.toString(), { signal });
  const data = await res.json();
  const grid = document.getElementById("search-results");
  const animeGrid = document.getElementById("anime-results");
  grid.innerHTML = "";
  animeGrid.innerHTML = "";
  setResultsTitle(comboTitle(chipsArr));
  openResultsModal();
  if (!res.ok) {
    grid.style.display = "";
    animeGrid.style.display = "none";
    toast(errText(data.error) || t("search_error"));
    return;
  }
  const actorLabel = actors
    ? chipsArr.filter((c) => c.type === "actor").map((c) => c.label).join(", ")
    : "";
  const genreLabel = genres ? chipsArr.filter((c) => c.type === "genre").map((c) => animeGenreLabel(c.label)).join(", ") : "";
  if (media === "anime") {
    grid.style.display = "none";
    animeGrid.style.display = "";
    if (!data.length) {
      animeGrid.innerHTML = `<div class="empty">${t("no_results")}</div>`;
      return;
    }
    data.forEach((item) => {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="poster-wrap">${item.cover_url ? `<img src="${item.cover_url}" alt="${item.title}" onerror="this.outerHTML=noPosterFallback()" />` : `<div class="no-poster">${FILM_SVG}</div>`}<button class="info-btn" data-tip="Info">${INFO_SVG}</button></div>
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">
            <span class="badge badge-anime">${t("tab_anime")}</span>
            ${item.score ? scoreTag(item.score / 10) : ""}
            ${item.status ? `<span class="badge badge-anime-status">${animeStatusLabel(item.status)}</span>` : ""}
          </div>
        </div>
      <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
      div.querySelector(".remove").onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/anime/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anilist_id: item.anilist_id }),
        });
        const j = await r.json();
        toast(r.ok ? t("added", { name: item.title }) : j.error || t("error"));
        if (r.ok) doComboSearch(q, chipsArr, media);
      };
      const ib3 = div.querySelector(".info-btn"); if(ib3) ib3.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(null, item.anilist_id, item.title); };
    div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title);
      animeGrid.appendChild(div);
    });
    return;
  }
  grid.style.display = "";
  animeGrid.style.display = "none";
  if (!data.length) {
    grid.innerHTML = `<div class="empty">${t("no_results")}</div>`;
    return;
  }
  const hlActor = chipsArr.filter((c) => c.type === "actor").map((c) => c.value)[0];
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "card";
    setTvSearchCardAttrs(div, item);
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
${item.media_type === "tv" ? `<button class="calendar-btn" data-tip="${t("calendar_title")}">${CALENDAR_SVG}</button>` : ""}
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
        doTitleSearch(q, media, signal);
      }
    };
    const cal = div.querySelector(".calendar-btn");
    if (cal) {
      cal.onclick = (e) => {
        e.stopPropagation();
        openReleases(item.media_type, item.tmdb_id, item.title);
      };
    }
    const ib4 = div.querySelector(".info-btn"); if(ib4) ib4.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title); };
    div.onclick = () => openDetails(
      item.media_type,
      item.tmdb_id,
      item.title,
      hlActor && /^\d+$/.test(hlActor) ? (state.favActors.get(hlActor) || "") : hlActor,
      hlActor && /^\d+$/.test(hlActor) ? hlActor : undefined,
      genreLabel || undefined
    );
    grid.appendChild(div);
    applyTitleHint(div);
  });
}

setMedia("dizi");
renderChips();

async function openPicker(mode) {
  state.pickerMode = mode;
  state.pickerSelected.clear();
  const modal = document.getElementById("picker-modal");
  const title = document.getElementById("picker-title");
  const body = document.getElementById("picker-body");
  if (mode === "fav_actor") {
    title.textContent = t("picker_actor_search");
    const favItems = state.favActors.size
      ? `<div class="picker-grid actor-grid">${[...state.favActors.entries()]
          .map(
            ([id, name]) => `<div class="picker-item actor" data-id="${escAttr(id)}" data-name="${escAttr(name)}">
              <span class="picker-name">${escAttr(name)}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
          )
          .join("")}</div>`
      : `<div class="picker-empty">${t("no_fav_actor")}</div>`;
    body.innerHTML = `
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_actor_search")}</div>
        <div class="picker-free">
          <input id="picker-free-input" type="text" placeholder="${t("actor_placeholder")}" />
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_fav_actor_search")}</div>
        ${favItems}
      </div>`;
  } else if (mode === "fav_anime_char") {
    title.textContent = t("picker_char_search");
    const favItems = state.favAnimeChars.size
      ? `<div class="picker-grid actor-grid">${[...state.favAnimeChars.entries()]
          .map(
            ([id, name]) => `<div class="picker-item actor" data-id="${escAttr(id)}" data-name="${escAttr(name)}">
              <span class="picker-name">${escAttr(name)}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
          )
          .join("")}</div>`
      : `<div class="picker-empty">${t("no_fav_char")}</div>`;
    body.innerHTML = `
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_char_search")}</div>
        <div class="picker-free">
          <input id="picker-free-input" type="text" placeholder="${t("char_placeholder")}" />
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_fav_char_search")}</div>
        ${favItems}
      </div>`;
  } else if (mode === "anime_genre") {
    title.textContent = t("picker_genre_search");
    const favItems = state.favAnimeGenres.size
      ? `<div class="picker-grid genre-grid">${[...state.favAnimeGenres]
          .map(
            (g) => `<div class="picker-item genre" data-id="${escAttr(g)}" data-name="${escAttr(g)}">
              <span class="picker-name">${escAttr(animeGenreLabel(g))}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
          )
          .join("")}</div>`
      : `<div class="picker-empty">${t("no_fav_anime_genre")}</div>`;
    const allGenres = await loadGenres("anilist");
    const allItems = allGenres.length
      ? `<div class="picker-grid genre-grid">${allGenres.map(
          (g) => `<div class="picker-item genre" data-id="${escAttr(g)}" data-name="${escAttr(g)}">
              <span class="picker-name">${escAttr(animeGenreLabel(g))}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
        ).join("")}</div>`
      : `<div class="picker-empty">${t("no_results")}</div>`;
    body.innerHTML = `
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_genre_search")}</div>
        <div class="picker-free">
          <input id="picker-free-input" type="text" placeholder="${t("genre_placeholder")}" />
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_fav_genre_search")}</div>
        ${favItems}
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("search_type_genre")}</div>
        ${allItems}
      </div>`;
  } else {
    title.textContent = t("picker_genre_search");
    const favItems = state.favGenres.size
      ? `<div class="picker-grid genre-grid">${[...state.favGenres]
          .map(
            (g) => `<div class="picker-item genre" data-id="${escAttr(g)}" data-name="${escAttr(g)}">
              <span class="picker-name">${escAttr(g)}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
          )
          .join("")}</div>`
      : `<div class="picker-empty">${t("no_fav_genre")}</div>`;
    const allGenres = await loadGenres("tmdb");
    const allItems = allGenres.length
      ? `<div class="picker-grid genre-grid">${allGenres.map(
          (g) => `<div class="picker-item genre" data-id="${escAttr(g)}" data-name="${escAttr(g)}">
              <span class="picker-name">${escAttr(g)}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
        ).join("")}</div>`
      : `<div class="picker-empty">${t("no_results")}</div>`;
    body.innerHTML = `
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_genre_search")}</div>
        <div class="picker-free">
          <input id="picker-free-input" type="text" placeholder="${t("genre_placeholder")}" />
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_fav_genre_search")}</div>
        ${favItems}
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("search_type_genre")}</div>
        ${allItems}
      </div>`;
  }
  body.querySelectorAll(".picker-item").forEach((el) => {
    el.onclick = () => {
      el.classList.toggle("sel");
      const id = el.dataset.id;
      if (state.pickerSelected.has(id)) state.pickerSelected.delete(id);
      else state.pickerSelected.add(id);
    };
  });
  modal.style.display = "flex";
  document.getElementById("picker-free-input").focus();
}

document.getElementById("picker-close").onclick = () => {
  document.getElementById("picker-modal").style.display = "none";
};
document.getElementById("picker-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) document.getElementById("picker-modal").style.display = "none";
});
document.getElementById("search-results-close").onclick = closeResultsModal;
document.getElementById("search-results-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeResultsModal();
});
document.getElementById("picker-go").onclick = () => {
  const freeVal = (document.getElementById("picker-free-input")?.value || "").trim();
  if (!state.pickerSelected.size && !freeVal) {
    toast(state.pickerMode === "fav_actor" ? t("no_fav_actor") : state.pickerMode === "fav_anime_char" ? t("no_fav_char") : t("no_fav_genre"));
    return;
  }
  const chipType = state.pickerMode === "fav_actor" ? "actor" : state.pickerMode === "fav_anime_char" ? "char" : "genre";
  const nameOf = (id) => {
    if (state.pickerMode === "fav_actor") return state.favActors.get(id) || id;
    if (state.pickerMode === "fav_anime_char") return state.favAnimeChars.get(id) || id;
    return id;
  };
  state.pickerSelected.forEach((id) => {
    state.chips.push({ type: chipType, label: nameOf(id), value: id });
  });
  if (freeVal) {
    freeVal.split(",").forEach((s) => {
      const v = s.trim();
      if (v) state.chips.push({ type: chipType, label: v, value: v });
    });
  }
  document.getElementById("picker-modal").style.display = "none";
  renderChips();
};


export { currentMedia, setMedia, renderChips, openValueModal, setSearchBtnLoading,
         runSearch, runNormalSearch, doTitleSearch, doAnimeTitleSearch,
         setResultsTitle, openResultsModal, closeResultsModal, comboTitle, doComboSearch, openPicker };
