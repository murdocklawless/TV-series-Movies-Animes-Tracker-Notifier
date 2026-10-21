// Faz 4: search — arama mantığı (normal/çoklu arama, filtre çipleri, sonuçlar, seçici modal).
import { state } from "./state.js";
import { t, animeGenreLabel, errText } from "./i18n.js?v=646";
import {
  posterHTML, scoreTag, typeLabel, CALENDAR_SVG, escAttr, INFO_SVG,
  toast, CHECK_SVG, loadGenres, FILM_SVG, applyTitleHint, isDocItem, resultCardRows, cardDateLine, dayStrInTz,
} from "./utils.js?v=646";
import { loadFollowed, loadBelgesel, loadAnime, makeFollowedCard, makeAnimeCard } from "./views.js?v=646";
function isTvUIActive() {
  try {
    const d = document.documentElement;
    if (d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode"))) return true;
    return !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
  } catch { return false; }
}
function setTvSearchCardAttrs(div, item){
  try{ div._sitem = item; }catch{}
  try{
    if (item) {
      if (item.title) div.dataset.sortTitle = String(item.title);
      const sc = (item.vote_average !== undefined && item.vote_average !== null) ? Number(item.vote_average) : (item.score !== undefined && item.score !== null ? Number(item.score) / 10 : NaN);
      if (!isNaN(sc)) div.dataset.sortScore = String(sc);
      const dt = (item.release_date || "") || (item.airing_at ? dayStrInTz(item.airing_at) : "");
      if (dt) div.dataset.sortDate = String(dt);
    }
  }catch{}
  try{ if(!isTvUIActive()) return; div.tabIndex=0; div.setAttribute('role','button'); if(item.title) div.setAttribute('aria-label', item.title); if(item.tmdb_id) div.dataset.tmdbId=item.tmdb_id; if(item.anilist_id) div.dataset.anilistId=item.anilist_id; if(item.media_type) div.dataset.mediaType=item.media_type; div.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){ e.preventDefault(); div.click(); }}); const cal=div.querySelector('.calendar-btn'); if(cal){cal.tabIndex=0; cal.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); cal.click();}});} const ib=div.querySelector('.info-btn'); if(ib){ib.tabIndex=0; ib.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); ib.click();}});} const rem=div.querySelector('.remove'); if(rem){rem.tabIndex=0; rem.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===' '||e.keyCode===23){e.preventDefault(); e.stopPropagation(); rem.click();}});} }catch{}
}

import { openDetails, openReleases, openAnimeDetails } from "./components.js?v=646";

/* Arama modalı satır üreticileri: tip·puan / vizyon-yayın tarihi (boşsa yer tutucu). */
function searchRows(item, badge) {
  return resultCardRows({
    type: badge,
    score: scoreTag(item.vote_average),
    status: cardDateLine(item.media_type, item),
  });
}

function animeSearchRows(item) {
  return resultCardRows({
    type: `<span class="badge badge-anime">${t("tab_anime")}</span>`,
    score: item.score ? scoreTag(item.score / 10) : "",
    status: cardDateLine("anime", item),
  });
}

function currentMedia() {
  return state.searchMedia;
}

function setMedia(media) {
  state.searchMedia = media;
  document.getElementById("media-dizi").classList.toggle("active", media === "dizi");
  document.getElementById("media-film").classList.toggle("active", media === "film");
  const belBtn = document.getElementById("media-belgesel");
  if (belBtn) belBtn.classList.toggle("active", media === "belgesel");
  document.getElementById("media-anime").classList.toggle("active", media === "anime");
  const ph = media === "anime" ? "anime_placeholder" : media === "belgesel" ? "belgesel_placeholder" : media === "film" ? "film_placeholder" : media === "dizi" ? "dizi_placeholder" : "search_placeholder";
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
}

// Çoklu arama kaynağı (üst butonlardan bağımsız): "tmdb" | "anime".
// Kaynak yalnız medya çipletinden (film/dizi/belgesel/anime) belirlenir.
function comboSource() {
  return state.comboSource === "anime" ? "anime" : "tmdb";
}

function updateComboActorLabel() {
  const actorBtn = document.getElementById("filter-actor");
  if (!actorBtn) return;
  const key = state.comboSource === "anime" ? "filter_character" : "filter_actor";
  actorBtn.dataset.i18n = key;
  actorBtn.textContent = t(key);
}

function setComboSource(src, silent) {
  src = src === "anime" ? "anime" : "tmdb";
  if (state.comboSource !== src) {
    state.comboSource = src;
    // Karşı kaynağın çiplerini temizle: oyuncu<->karakter + tür (liste kaynağı farklı).
    // Yönetmen / yıl / puan iki kaynakta da geçerli, korunur.
    const drop = src === "anime" ? ["actor"] : ["char"];
    drop.push("genre");
    let removed = 0;
    state.chips = state.chips.filter((c) => {
      if (drop.includes(c.type)) { removed++; return false; }
      return true;
    });
    if (removed && !silent) toast(t("combo_chips_cleared"));
  }
  updateComboActorLabel();
  renderChips();
}

document.getElementById("media-dizi").onclick = () => setMedia("dizi");
document.getElementById("media-film").onclick = () => setMedia("film");
document.getElementById("media-belgesel").onclick = () => setMedia("belgesel");
document.getElementById("media-anime").onclick = () => setMedia("anime");

function toggleMediaChip(value, label) {
  const idx = state.chips.findIndex((c) => c.type === "media");
  if (idx >= 0 && state.chips[idx].value === value) {
    state.chips.splice(idx, 1);
  } else {
    if (idx >= 0) state.chips.splice(idx, 1);
    state.chips.push({ type: "media", label, value });
  }
  // Kaynak yalnız çiplete göre: anime çipleti -> anime, diğerleri -> tmdb.
  // Çip kaldırılınca kaynak tmdb'ye döner (varsayılan).
  syncComboSourceFromChips(true);
}

function syncComboSourceFromChips(silent) {
  const hasAnime = state.chips.some((c) => c.type === "media" && c.value === "anime");
  setComboSource(hasAnime ? "anime" : "tmdb", silent);
}

function updateMediaButtons() {
  const active = state.chips.filter((c) => c.type === "media").map((c) => c.value);
  const movieBtn = document.getElementById("filter-media-movie");
  const tvBtn = document.getElementById("filter-media-tv");
  const docBtn = document.getElementById("filter-media-doc");
  const animeBtn = document.getElementById("filter-media-anime");
  if (movieBtn) movieBtn.classList.toggle("active", active.includes("movie"));
  if (tvBtn) tvBtn.classList.toggle("active", active.includes("tv"));
  if (docBtn) docBtn.classList.toggle("active", active.includes("doc"));
  if (animeBtn) animeBtn.classList.toggle("active", active.includes("anime"));
}

function updateFilterButtons() {
  const has = (t) => state.chips.some((c) => c.type === t);
  const actorBtn = document.getElementById("filter-actor");
  const directorBtn = document.getElementById("filter-director");
  const genreBtn = document.getElementById("filter-genre");
  const yearBtn = document.getElementById("filter-year");
  const scoreBtn = document.getElementById("filter-score");
  if (actorBtn) actorBtn.classList.toggle("active", has("actor") || has("char"));
  if (directorBtn) directorBtn.classList.toggle("active", has("director"));
  if (genreBtn) genreBtn.classList.toggle("active", has("genre"));
  if (yearBtn) yearBtn.classList.toggle("active", has("year"));
  if (scoreBtn) scoreBtn.classList.toggle("active", has("score"));
}

const CHIP_ORDER = { media: 0, actor: 1, char: 1, director: 1, genre: 2, year: 3, score: 4 };

// Tür listesi farkı (M4): önceki liste localStorage'da tutulur, picker açılışında
// taze çekilip fark bulunur; yeni tür varsa toast + (TV) ilk yeni türe odak.
function prevGenreKey(source) { return `prevGenres_${source}`; }
function readPrevGenres(source) {
  try {
    const v = JSON.parse(localStorage.getItem(prevGenreKey(source)) || "null");
    return Array.isArray(v) ? v : null;
  } catch(_) { return null; }
}
function writePrevGenres(source, list) {
  try { localStorage.setItem(prevGenreKey(source), JSON.stringify(list || [])); } catch(_) {}
}
async function freshGenreList(source) {
  const prev = readPrevGenres(source);
  const list = await loadGenres(source, true);
  writePrevGenres(source, list);
  if (!prev) return [];
  return list.filter((g) => !prev.includes(g));
}

// TV: chip silinince odak komşuda kalır (sol → yoksa sağ); chip kalmadıysa
// .filter-add-row'daki ilk görünür butona (en soldaki) gider. Desktop'ta dokunulmaz.
function focusChipAfterRemove(removedPos) {
  try {
    if (!isTvUIActive()) return;
    const box = document.getElementById("filter-chips");
    if (!box) return;
    const xs = Array.from(box.querySelectorAll(".chip-x"));
    if (xs.length) {
      // silinenin solu varsa sol komşu, yoksa sağ komşu (yeni listedeki konuma göre)
      const target = removedPos > 0 ? (xs[removedPos - 1] || xs[xs.length - 1]) : xs[0];
      if (target) { try { target.focus(); } catch(_){} }
      return;
    }
    const ids = ["filter-media-movie", "filter-media-tv", "filter-media-doc", "filter-media-anime", "filter-actor", "filter-director", "filter-genre", "filter-year", "filter-score"];
    for (const id of ids) {
      const b = document.getElementById(id);
      if (!b || b.disabled) continue;
      try {
        const s = getComputedStyle(b);
        if (s.display === "none" || s.visibility === "hidden") continue;
        const r = b.getBoundingClientRect();
        if (!r.width && !r.height) continue;
      } catch { continue; }
      try { b.focus(); } catch(_){}
      return;
    }
  } catch {}
}

function renderChips() {
  const box = document.getElementById("filter-chips");
  const sorted = state.chips.slice().sort(
    (a, b) => (CHIP_ORDER[a.type] ?? 9) - (CHIP_ORDER[b.type] ?? 9)
  );
  box.innerHTML = sorted
    .map(
      (c) => `<span class="chip chip-${c.type === "media" ? `media-${c.value}` : c.type}">${c.type === "genre" ? animeGenreLabel(c.label) : c.label}<button class="chip-x" data-i="${state.chips.indexOf(c)}">&times;</button></span>`
    )
    .join("");
  box.querySelectorAll(".chip-x").forEach((btn) => {
    btn.onclick = () => {
      const removedIdx = Number(btn.dataset.i);
      const sortedBefore = state.chips.slice().sort(
        (a, b) => (CHIP_ORDER[a.type] ?? 9) - (CHIP_ORDER[b.type] ?? 9)
      );
      const removedPos = sortedBefore.findIndex((c) => state.chips.indexOf(c) === removedIdx);
      const removed = state.chips[removedIdx];
      state.chips.splice(removedIdx, 1);
      if (removed && removed.type === "media") syncComboSourceFromChips(true);
      else renderChips();
      focusChipAfterRemove(removedPos);
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
  const modal = document.getElementById("value-modal");
  title.textContent = t(kind === "year" ? "search_type_year" : "search_type_score");
  input.dataset.filter = kind;
  input.value = "";
  input.maxLength = kind === "year" ? 4 : 3;
  input.placeholder = t(kind === "year" ? "year_placeholder" : "score_placeholder");
  try { modal.dataset.opener = kind === "year" ? "filter-year" : "filter-score"; } catch(_){}
  modal.style.display = "flex";
  input.focus();
}

// Merkezi kapatıcılar: gizle + (TV) açan filtre butonuna odak iadesi.
// opener: picker'da pickerMode'dan, value'da dataset.opener'dan çözülür.
function openerButtonFor(modal) {
  try {
    if (!modal) return null;
    if (modal.id === "picker-modal") {
      const m = state.pickerMode;
      return document.getElementById((m === "fav_actor" || m === "fav_anime_char") ? "filter-actor" : m === "fav_director" ? "filter-director" : "filter-genre");
    }
    if (modal.id === "value-modal") {
      const id = modal.dataset.opener;
      return id ? document.getElementById(id) : null;
    }
    return null;
  } catch { return null; }
}
function closePickerModal() {
  try { document.getElementById("picker-modal").style.display = "none"; } catch(_){}
  try {
    if (isTvUIActive()) {
      const b = openerButtonFor(document.getElementById("picker-modal"));
      if (b) b.focus();
    }
  } catch(_){}
}
function closeValueModal() {
  try { document.getElementById("value-modal").style.display = "none"; } catch(_){}
  try {
    if (isTvUIActive()) {
      const b = openerButtonFor(document.getElementById("value-modal"));
      if (b) b.focus();
    }
  } catch(_){}
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
  // Çoklu arama üst butonlardan bağımsızdır: kapsam yalnız çipletlerden gelir.
  const q = (document.getElementById("search-input")?.value || "").trim();
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
  doComboSearch(q, state.chips, comboAbort.signal).finally(() => {
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
  const mediaType = media === "film" ? "movie" : media === "belgesel" ? "doc" : "tv";
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
  const docMode = media === "belgesel";
  startResultsPager(grid, data, (item) => {
    const div = document.createElement("div");
    div.className = "card" + (item.media_type === "tv" ? " search-stacked" : "");
    setTvSearchCardAttrs(div, item);
    const searchBadge = docMode
      ? `<span class="badge badge-belgesel">${t("type_doc")}</span>`
      : `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${searchRows(item, searchBadge)}
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
        body: JSON.stringify({
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title,
          poster_path: item.poster_path,
        }),
      });
      const j = await r.json();
      if (r.ok) {
        toast(t("added", { name: item.title }));
        if (media === "belgesel") loadBelgesel();
        else loadFollowed(item.media_type === "tv" ? "dizi" : "film");
      } else {
        toast(errText(j.error) || t("error"), true);
      }
    };
    const calBtn = div.querySelector(".calendar-btn");
    if (calBtn && !calBtn.disabled) {
      calBtn.onclick = (e) => {
        e.stopPropagation();
        openReleases(item.media_type, item.tmdb_id, item.title);
      };
    }
    const ib = div.querySelector(".info-btn"); if(ib) ib.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true); };
    div.onclick = () => openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true);
    return div;
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
  startResultsPager(animeGrid, data, (item) => {
    const div = document.createElement("div");
    div.className = "card search-stacked";
    setTvSearchCardAttrs(div, item);
    div.innerHTML = `
      <div class="poster-wrap">${item.cover_url ? `<img src="${item.cover_url}" alt="${item.title}" onerror="this.outerHTML=noPosterFallback()" />` : `<div class="no-poster">${FILM_SVG}</div>`}<button class="info-btn" data-tip="Info">${INFO_SVG}</button></div>
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${animeSearchRows(item)}
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
      if (r.ok) {
        toast(t("added", { name: item.title }));
        loadAnime();
      } else {
        toast(errText(j.error) || t("error"), true);
      }
    };
    const ib2 = div.querySelector(".info-btn"); if(ib2) ib2.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(null, item.anilist_id, item.title, true); };
    div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title, true);
    return div;
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
document.getElementById("filter-media-doc").onclick = () => toggleMediaChip("doc", t("type_doc"));
document.getElementById("filter-media-anime").onclick = () => toggleMediaChip("anime", t("tab_anime"));
document.getElementById("filter-actor").onclick = () => openPicker(comboSource() === "anime" ? "fav_anime_char" : "fav_actor");
document.getElementById("filter-director").onclick = () => openPicker("fav_director");
document.getElementById("filter-genre").onclick = () => openPicker(comboSource() === "anime" ? "anime_genre" : "fav_genre");
document.getElementById("filter-year").onclick = () => openValueModal("year");
document.getElementById("filter-score").onclick = () => openValueModal("score");

document.getElementById("value-close").onclick = () => closeValueModal();
document.getElementById("value-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeValueModal();
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
  renderChips();
  // TV: chip eklenince kendi butonuna dön (yıl→yıl, puan→puan)
  closeValueModal();
};

function setResultsTitle(text) {
  const el = document.getElementById("results-title");
  if (el) el.textContent = text || "";
}

function openResultsModal() {
  const modal = document.getElementById("search-results-modal");
  try {
    const ae = document.activeElement;
    if (ae && ae.id) modal.dataset.opener = ae.id;
    else delete modal.dataset.opener;
  } catch (_) {}
  resetResultsSearch();
  resetResultsPager();
  modal.style.display = "flex";
  resetSearchSort();
}

// TV: sonuç modalı açılınca ilk sonuç kartına odak (X atlanır); kart yoksa X'te kalır.
function finishSearchRender() {
  try { resetSearchSort(); } catch (_) {}
  try { focusFirstResultCard(); } catch (_) {}
}
function focusFirstResultCard() {
  try {
    if (!isTvUIActive()) return;
    for (const gid of ["search-results", "anime-results"]) {
      const g = document.getElementById(gid);
      if (!g || g.style.display === "none") continue;
      const card = g.querySelector(".card");
      if (card) {
        try { card.focus(); card.scrollIntoView({ block: "nearest" }); } catch(_){}
        return;
      }
    }
  } catch {}
}

function closeResultsModal() {
  const modal = document.getElementById("search-results-modal");
  try { modal.style.display = "none"; } catch (_) {}
  try { resetResultsSearch(); } catch (_) {}
  resetResultsPager();
  // TV: X/overlay ile kapatınca odak yetim kalmasın; açan butona dön.
  try {
    if (isTvUIActive()) {
      const oid = modal && modal.dataset ? modal.dataset.opener : "";
      const ob = oid ? document.getElementById(oid) : null;
      if (ob && !ob.disabled) {
        const cs = getComputedStyle(ob);
        if (cs.display !== "none" && cs.visibility !== "hidden") { ob.focus(); return; }
      }
      const fb = document.getElementById("search-btn") || document.getElementById("normal-search-btn");
      if (fb && !fb.disabled) fb.focus();
    }
  } catch (_) {}
}

// Sonuç sayfalama: ilk 20 kart, alta kaydırdıkça +5, toplam en çok 50.
// Normal başlık + çoklu arama + anime grid'lerinin hepsinde çalışır.
const PAGER_FIRST = 20, PAGER_MORE = 5, PAGER_MAX = 50;
let resultsPager = null;

function resetResultsPager() { resultsPager = null; }

function searchAlphaSorted(items) {
  return (items || []).slice().sort((a, b) => {
    const x = String((a && a.title) || "").toLocaleLowerCase();
    const y = String((b && b.title) || "").toLocaleLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function startResultsPager(grid, items, build) {
  // Varsayılan alfabetik: sayfa dilimleri API sırasından değil, başlığa göre
  // ön-sıralanmış listeden alınır (yoksa ilk 20 API sırası kendi içinde sıralanırdı).
  resultsPager = { grid, items: searchAlphaSorted(items), build, shown: 0 };
  renderPagerBatch(true);
}

function renderPagerBatch(first) {
  const p = resultsPager;
  if (!p || !p.grid) return;
  const cap = Math.min(p.items.length, PAGER_MAX);
  const n = Math.min(first ? PAGER_FIRST : PAGER_MORE, cap - p.shown);
  if (n <= 0) return;
  const frag = document.createDocumentFragment();
  const cards = [];
  for (let i = p.shown; i < p.shown + n; i++) {
    try {
      const el = p.build(p.items[i], i);
      if (el) { frag.appendChild(el); cards.push(el); }
    } catch (_) {}
  }
  p.shown += n;
  p.grid.appendChild(frag);
  cards.forEach((c) => { try { applyTitleHint(c); } catch (_) {} });
  try { if (searchSort) sortSearchGrid(searchSort); } catch (_) {}
  try { applyResultsSearchFilter(); } catch (_) {}
  if (first) finishSearchRender();
}

function maybePagerMore(grid) {
  const p = resultsPager;
  if (!p || p.grid !== grid) return;
  const cap = Math.min(p.items.length, PAGER_MAX);
  if (p.shown >= cap) return;
  try {
    if (grid.scrollHeight - grid.scrollTop - grid.clientHeight < 500) renderPagerBatch(false);
  } catch (_) {}
}

["search-results", "anime-results"].forEach((gid) => {
  const g = document.getElementById(gid);
  if (g) g.addEventListener("scroll", () => maybePagerMore(g), { passive: true });
});

// Arama sonuçları modalı filtre (sıralama) — navbar sort deseni, modal içi.
// Sıralama DOM kartlarını yerinde dizer (re-render yok); ölçüt karttaki _sitem verisinden.
// Varsayılan sıralama alfabetiktir; menü ilk açıldığında Alfabetik seçili görünür.
let searchSort = "alpha";

function sitemDateISO(it) {
  if (!it) return "";
  if (it.release_date) return it.release_date;
  if (it.airing_at) {
    try { return dayStrInTz(it.airing_at); }
    catch (_) { return ""; }
  }
  return "";
}

function sitemScore(it) {
  if (!it) return 0;
  if (it.vote_average !== undefined && it.vote_average !== null) return Number(it.vote_average) || 0;
  if (it.score !== undefined && it.score !== null) return (Number(it.score) || 0) / 10;
  return 0;
}

function cardSortTitle(c) {
  try {
    if (c.dataset && c.dataset.sortTitle) return String(c.dataset.sortTitle);
  } catch (_) {}
  return String((c._sitem && c._sitem.title) || "");
}

function cardSortScore(c) {
  try {
    if (c.dataset && c.dataset.sortScore !== undefined && c.dataset.sortScore !== "") {
      const v = Number(c.dataset.sortScore);
      if (!isNaN(v)) return v;
    }
  } catch (_) {}
  return sitemScore(c._sitem);
}

function cardSortDate(c) {
  try {
    if (c.dataset && c.dataset.sortDate) return String(c.dataset.sortDate);
  } catch (_) {}
  return sitemDateISO(c._sitem);
}

function searchGridToday() {
  try {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch (_) { return ""; }
}

function visibleSearchGrid() {
  const g = document.getElementById("search-results");
  if (g && g.style.display !== "none") return g;
  return document.getElementById("anime-results");
}

function searchGridCards() {
  const grid = visibleSearchGrid();
  if (!grid || !grid.children) return { grid, cards: [] };
  return { grid, cards: Array.from(grid.children).filter((el) => el && el.classList && el.classList.contains("card")) };
}

function updateSearchFilterMenu() {
  const menu = document.getElementById("search-filter-menu");
  if (!menu) return;
  const today = searchGridToday();
  const hasUpcoming = searchGridCards().cards.some((c) => {
    const d = cardSortDate(c);
    return !!d && d > today;
  });
  menu.querySelectorAll(".sort-item").forEach((btn) => {
    const k = btn.dataset.sort;
    btn.classList.toggle("active", searchSort === k);
    const dis = k === "upcoming" && !hasUpcoming;
    btn.disabled = dis;
    btn.setAttribute("aria-disabled", dis ? "true" : "false");
  });
}

function sortSearchGrid(key) {
  searchSort = key;
  const { grid, cards } = searchGridCards();
  const today = searchGridToday();
  const probe = (arr) => arr.slice(0, 3).map((c) => cardSortTitle(c) || "?").join(" | ");
  const before = probe(cards);
  const titleOf = (c) => cardSortTitle(c).toLocaleLowerCase();
  const cmp = {
    alpha: (a, b) => {
      const x = titleOf(a), y = titleOf(b);
      return x < y ? -1 : x > y ? 1 : 0;
    },
    score: (a, b) => cardSortScore(b) - cardSortScore(a),
    vision: (a, b) => {
      const x = cardSortDate(a), y = cardSortDate(b);
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? 1 : x > y ? -1 : 0;
    },
    upcoming: (a, b) => {
      const x = cardSortDate(a), y = cardSortDate(b);
      const xp = !x || x <= today, yp = !y || y <= today;
      if (xp && yp) return 0;
      if (xp) return 1;
      if (yp) return -1;
      return x < y ? -1 : x > y ? 1 : 0;
    },
  }[key];
  if (cmp && cards.length) cards.sort(cmp).forEach((c) => grid.appendChild(c));
  try { console.info("[filter] sort:", key, cards.length, "before: " + before, "after: " + probe(cards)); } catch (_) {}
  updateSearchFilterMenu();
}

function resetSearchSort() {
  searchSort = "alpha";
  updateSearchFilterMenu();
}

function toggleSearchFilterMenu(on) {
  const menu = document.getElementById("search-filter-menu");
  const btn = document.getElementById("search-filter-btn");
  if (!menu || !btn) return;
  const open = typeof on === "boolean" ? on : !menu.classList.contains("open");
  updateSearchFilterMenu();
  menu.classList.toggle("open", open);
  btn.classList.toggle("active", open);
  if (open && isTvUIActive()) {
    const first = Array.from(menu.querySelectorAll(".sort-item")).find((el) => !el.disabled);
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} } }
  }
}

function closeSearchFilterMenu() {
  const menu = document.getElementById("search-filter-menu");
  const btn = document.getElementById("search-filter-btn");
  if (menu) menu.classList.remove("open");
  if (btn) btn.classList.remove("active");
}

document.getElementById("search-filter-btn").onclick = (e) => {
  e.stopPropagation();
  toggleSearchFilterMenu();
};
document.querySelectorAll("#search-filter-menu .sort-item").forEach((btn) => {
  btn.onclick = (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    sortSearchGrid(btn.dataset.sort);
    closeSearchFilterMenu();
    if (isTvUIActive()) {
      const f = document.getElementById("search-filter-btn");
      if (f) { try { f.focus({ preventScroll: true }); } catch (_) { try { f.focus(); } catch (_) {} } }
    }
  };
});
// Arama sonuçları modalı liste-içi filtre — hidden-modal arama deseni (input + büyüteç).
// Sıralamayla çakışmaz: sıralama DOM sırasını, filtre görünürlüğü değiştirir.
function resultsSearchFilter() {
  const input = document.getElementById("results-search-input");
  return (input && input.style.display === "block" ? (input.value || "").trim().toLowerCase() : "");
}

function applyResultsSearchFilter() {
  const filter = resultsSearchFilter();
  for (const gid of ["search-results", "anime-results"]) {
    const g = document.getElementById(gid);
    if (!g) continue;
    Array.from(g.children).forEach((c) => {
      if (!(c.classList && c.classList.contains("card"))) return;
      let title = "";
      try { title = cardSortTitle(c) || ""; } catch (_) {}
      if (!title) {
        try { title = ((c.querySelector(".title") || {}).textContent) || ""; } catch (_) {}
      }
      c.style.display = (!filter || title.toLowerCase().includes(filter)) ? "" : "none";
    });
  }
}

function resetResultsSearch() {
  const input = document.getElementById("results-search-input");
  const btn = document.getElementById("results-search-btn");
  if (input) { input.value = ""; input.style.display = "none"; input.classList.remove("open"); }
  if (btn) btn.classList.remove("active");
}

(function wireResultsSearch() {
  const btn = document.getElementById("results-search-btn");
  const input = document.getElementById("results-search-input");
  if (!btn || !input) return;
  btn.onclick = (e) => {
    if (e) e.stopPropagation();
    const open = input.style.display === "block";
    if (open) {
      resetResultsSearch();
      applyResultsSearchFilter();
    } else {
      input.style.display = "block";
      input.classList.add("open");
      btn.classList.add("active");
      input.focus();
    }
  };
  input.addEventListener("input", applyResultsSearchFilter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") btn.click();
    e.stopPropagation();
  });
})();

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest || !e.target.closest("#search-results-modal .sort-wrap")) closeSearchFilterMenu();
});

function comboTitle(chipsArr) {
  const parts = [];
  const q = (document.getElementById("search-input")?.value || "").trim();
  if (q) parts.push(q);
  chipsArr
    .slice()
    .sort((a, b) => (CHIP_ORDER[a.type] ?? 9) - (CHIP_ORDER[b.type] ?? 9))
    .forEach((c) => {
      if (c.type === "actor" || c.type === "char" || c.type === "director") parts.push(`${c.label}`);
      else if (c.type === "genre") parts.push(`${animeGenreLabel(c.label)}`);
      else if (c.type === "media") parts.push(`${c.label}`);
      else if (c.type === "year") parts.push(`${c.label}`);
      else if (c.type === "score") parts.push(`${c.label}`);
    });
  return parts.join(" • ");
}

async function doComboSearch(q, chipsArr, signal) {
  // Kaynak ve kapsam yalnız çipletlerden gelir; üst butonlar çoklu aramayı etkilemez.
  const source = chipsArr.some((c) => c.type === "media" && c.value === "anime") ? "anime" : "tmdb";
  const params = new URLSearchParams();
  params.set("source", source);
  if (q) params.set("q", q);
  const actors = chipsArr.filter((c) => c.type === "actor" || c.type === "char").map((c) => c.value).join(",");
  const directors = chipsArr.filter((c) => c.type === "director").map((c) => c.value).join(",");
  const genres = chipsArr.filter((c) => c.type === "genre").map((c) => c.value).join(",");
  const kindChip = chipsArr.filter((c) => c.type === "media" && c.value !== "anime").map((c) => c.value).join(",");
  const kind = kindChip || "";
  const year = chipsArr.filter((c) => c.type === "year").map((c) => c.value)[0] || "";
  const score = chipsArr.filter((c) => c.type === "score").map((c) => c.value)[0] || "";
  if (actors) params.set("actors", actors);
  if (directors) params.set("directors", directors);
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
  if (source === "anime") {
    grid.style.display = "none";
    animeGrid.style.display = "";
    if (!data.length) {
      animeGrid.innerHTML = `<div class="empty">${t("no_results")}</div>`;
      return;
    }
    startResultsPager(animeGrid, data, (item) => {
      const div = document.createElement("div");
      div.className = "card search-stacked";
      setTvSearchCardAttrs(div, item);
      div.innerHTML = `
        <div class="poster-wrap">${item.cover_url ? `<img src="${item.cover_url}" alt="${item.title}" onerror="this.outerHTML=noPosterFallback()" />` : `<div class="no-poster">${FILM_SVG}</div>`}<button class="info-btn" data-tip="Info">${INFO_SVG}</button></div>
        <div class="info">
          <div class="title">${item.title}</div>
<div class="meta">
          ${animeSearchRows(item)}
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
        if (r.ok) {
          toast(t("added", { name: item.title }));
          doComboSearch(q, chipsArr);
        } else {
          toast(errText(j.error) || t("error"), true);
        }
      };
      const ib3 = div.querySelector(".info-btn"); if(ib3) ib3.onclick = (e)=>{ e.stopPropagation(); openAnimeDetails(null, item.anilist_id, item.title, true); };
    div.onclick = () => openAnimeDetails(null, item.anilist_id, item.title, true);
      return div;
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
  const comboDoc = chipsArr.some((c) => c.type === "media" && c.value === "doc");
  startResultsPager(grid, data, (item) => {
    const div = document.createElement("div");
    div.className = "card" + (item.media_type === "tv" ? " search-stacked" : "");
    setTvSearchCardAttrs(div, item);
    const comboBadge = comboDoc
      ? `<span class="badge badge-belgesel">${t("type_doc")}</span>`
      : `<span class="badge badge-${item.media_type}">${typeLabel(item.media_type)}</span>`;
    div.innerHTML = `
      ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
      <div class="info">
        <div class="title">${item.title}</div>
        <div class="meta">
          ${searchRows(item, comboBadge)}
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
        body: JSON.stringify({
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          title: item.title,
          poster_path: item.poster_path,
        }),
      });
      const j = await r.json();
      if (r.ok) {
        toast(t("added", { name: item.title }));
        doComboSearch(q, chipsArr);
      } else {
        toast(errText(j.error) || t("error"), true);
      }
    };
    const cal = div.querySelector(".calendar-btn");
    if (cal && !cal.disabled) {
      cal.onclick = (e) => {
        e.stopPropagation();
        openReleases(item.media_type, item.tmdb_id, item.title);
      };
    }
    const ib4 = div.querySelector(".info-btn"); if(ib4) ib4.onclick = (e)=>{ e.stopPropagation(); openDetails(item.media_type, item.tmdb_id, item.title, undefined, undefined, undefined, true); };
    div.onclick = () => openDetails(
      item.media_type,
      item.tmdb_id,
      item.title,
      hlActor && /^\d+$/.test(hlActor) ? (state.favActors.get(hlActor) || "") : hlActor,
      hlActor && /^\d+$/.test(hlActor) ? hlActor : undefined,
      genreLabel || undefined,
      true
    );
    return div;
  });
}

setMedia("dizi");
updateComboActorLabel();
renderChips();

async function openPicker(mode) {
  state.pickerMode = mode;
  state.pickerSelected.clear();
  let freshGenres = [];
  const modal = document.getElementById("picker-modal");
  try { modal.dataset.opener = (mode === "fav_actor" || mode === "fav_anime_char") ? "filter-actor" : mode === "fav_director" ? "filter-director" : "filter-genre"; } catch(_){}
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
  } else if (mode === "fav_director") {
    title.textContent = t("picker_director_search");
    const favItems = state.favDirectors.size
      ? `<div class="picker-grid actor-grid">${[...state.favDirectors.entries()]
          .map(
            ([id, name]) => `<div class="picker-item actor" data-id="${escAttr(id)}" data-name="${escAttr(name)}">
              <span class="picker-name">${escAttr(name)}</span>
              <span class="picker-check">${CHECK_SVG}</span>
            </div>`
          )
          .join("")}</div>`
      : `<div class="picker-empty">${t("no_fav_director")}</div>`;
    body.innerHTML = `
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_director_search")}</div>
        <div class="picker-free">
          <input id="picker-free-input" type="text" placeholder="${t("director_placeholder")}" />
        </div>
      </div>
      <div class="picker-section">
        <div class="picker-section-title">${t("picker_fav_director_search")}</div>
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
    const allGenres = await loadGenres("anilist", true);
    try {
      const prevA = readPrevGenres("anilist");
      writePrevGenres("anilist", allGenres);
      if (prevA) freshGenres = allGenres.filter((g) => !prevA.includes(g));
    } catch(_) {}
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
    const allGenres = await loadGenres("tmdb", true);
    try {
      const prevT = readPrevGenres("tmdb");
      writePrevGenres("tmdb", allGenres);
      if (prevT) freshGenres = allGenres.filter((g) => !prevT.includes(g));
    } catch(_) {}
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
    try { el.tabIndex = 0; el.setAttribute("role", "button"); } catch(_){}
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " " || ev.keyCode === 23) {
        ev.preventDefault(); ev.stopPropagation(); el.click();
      }
    });
    el.onclick = () => {
      el.classList.toggle("sel");
      const id = el.dataset.id;
      if (state.pickerSelected.has(id)) state.pickerSelected.delete(id);
      else state.pickerSelected.add(id);
    };
  });
  modal.style.display = "flex";
  if (freshGenres.length) {
    try { toast(t("new_genres_toast", { n: freshGenres.length })); } catch(_){}
    if (isTvUIActive()) {
      let target = null;
      body.querySelectorAll(".picker-item").forEach((el) => {
        if (!target && el.dataset && el.dataset.id === freshGenres[0]) target = el;
      });
      if (target) {
        try { target.focus(); target.scrollIntoView({block: "nearest"}); } catch(_){}
      } else {
        document.getElementById("picker-free-input").focus();
      }
    } else {
      document.getElementById("picker-free-input").focus();
    }
  } else {
    document.getElementById("picker-free-input").focus();
  }
}

document.getElementById("picker-close").onclick = () => closePickerModal();
document.getElementById("picker-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closePickerModal();
});
document.getElementById("search-results-close").onclick = closeResultsModal;
document.getElementById("search-results-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeResultsModal();
});
document.getElementById("picker-go").onclick = () => {
  const freeVal = (document.getElementById("picker-free-input")?.value || "").trim();
  if (!state.pickerSelected.size && !freeVal) {
    toast(state.pickerMode === "fav_actor" ? t("no_fav_actor") : state.pickerMode === "fav_anime_char" ? t("no_fav_char") : state.pickerMode === "fav_director" ? t("no_fav_director") : t("no_fav_genre"));
    return;
  }
  const chipType = state.pickerMode === "fav_actor" ? "actor" : state.pickerMode === "fav_anime_char" ? "char" : state.pickerMode === "fav_director" ? "director" : "genre";
  const nameOf = (id) => {
    if (state.pickerMode === "fav_actor") return state.favActors.get(id) || id;
    if (state.pickerMode === "fav_anime_char") return state.favAnimeChars.get(id) || id;
    if (state.pickerMode === "fav_director") return state.favDirectors.get(String(id)) || state.favDirectors.get(id) || id;
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
  // TV: chip eklenince kendisini açan filtre butonuna dön (oyuncu→oyuncu, tür→tür)
  closePickerModal();
};


/* ===== 2.19.8 LOKAL ARA: NextEp içi kart arama (adanmış sonuç modalı) ===== */
let localSearchState = { q: "", kind: "all", items: [], truncated: false, seq: 0, timer: null };

function localSearchInput() { return document.getElementById("local-search-input"); }
function localSearchModalEl() { return document.getElementById("local-search-modal"); }

function updateLocalFilterMenu() {
  const menu = document.getElementById("local-search-filter-menu");
  if (!menu) return;
  menu.querySelectorAll(".sort-item").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.kind || "all") === (localSearchState.kind || "all"));
  });
}

function toggleLocalFilterMenu(on) {
  const menu = document.getElementById("local-search-filter-menu");
  const btn = document.getElementById("local-search-filter-btn");
  if (!menu || !btn) return;
  const open = typeof on === "boolean" ? on : !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  btn.classList.toggle("active", open);
}

function openLocalSearchModal() {
  const modal = localSearchModalEl();
  if (!modal) return;
  if (modal.style.display === "none") {
    // Filtre kalıcılığı yok: modal her açılışta "Tümü"ye döner (oturum içi).
    localSearchState.kind = "all";
    updateLocalFilterMenu();
  }
  modal.style.display = "flex";
}

function closeLocalSearchModal() {
  const modal = localSearchModalEl();
  if (modal) modal.style.display = "none";
  toggleLocalFilterMenu(false);
}

const LOCAL_KIND_ORDER = ["dizi", "film", "belgesel", "anime"];

function localKindOf(it) {
  if (it && it.kind) return it.kind;
  if (it && it.anilist_id) return "anime";
  return it && it.media_type === "movie" ? "film" : "dizi";
}

// "Tümü" → Dizi, Film, Belgesel, Anime; filtre seçiliyse seçilen tür önde,
// kalanlar varsayılan sırayla arkada.
function localSortRank(kind, k) {
  const idx = LOCAL_KIND_ORDER.indexOf(k);
  const rest = idx < 0 ? LOCAL_KIND_ORDER.length : idx;
  if (kind === "all") return rest;
  return k === kind ? -1 : rest;
}

function localTitleCmp(a, b) {
  const x = String((a && a.title) || ""), y = String((b && b.title) || "");
  try { return x.localeCompare(y, "tr", { sensitivity: "base" }); } catch (_) {
    const xl = x.toLocaleLowerCase(), yl = y.toLocaleLowerCase();
    return xl < yl ? -1 : xl > yl ? 1 : 0;
  }
}

async function runLocalSearch() {
  const inp = localSearchInput();
  const q = (inp ? inp.value : "").trim();
  if (q.length < 2) { closeLocalSearchModal(); return; }
  localSearchState.q = q;
  const seq = ++localSearchState.seq;
  let data = null;
  try {
    const res = await fetch(`/api/local-search?q=${encodeURIComponent(q)}&limit=200`);
    data = await res.json();
  } catch (_) { return; }
  if (seq !== localSearchState.seq) return; // yarış koruması: eski yanıt yeni sonucu ezmesin
  if (!data || !data.ok) return;
  localSearchState.items = Array.isArray(data.items) ? data.items : [];
  localSearchState.truncated = !!data.truncated;
  openLocalSearchModal();
  renderLocalResults();
}

function renderLocalResults() {
  const grid = document.getElementById("local-search-grid");
  const count = document.getElementById("local-search-count");
  if (!grid) return;
  const kind = localSearchState.kind || "all";
  const items = localSearchState.items.slice().sort((a, b) => {
    const ra = localSortRank(kind, localKindOf(a)), rb = localSortRank(kind, localKindOf(b));
    if (ra !== rb) return ra - rb;
    return localTitleCmp(a, b);
  });
  grid.innerHTML = "";
  if (count) {
    if (items.length) {
      count.textContent = t("search_local_count", { n: items.length })
        + (localSearchState.truncated ? " · " + t("search_local_truncated", { n: 200 }) : "");
    } else {
      count.textContent = "";
    }
  }
  if (!items.length) {
    const row = document.createElement("div");
    row.className = "local-search-empty";
    row.textContent = t("search_local_empty");
    grid.appendChild(row);
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach((item) => {
    const k = localKindOf(item);
    let card = null;
    try {
      if (k === "anime") {
        card = makeAnimeCard(item, { refresh: runLocalSearch, sectionMain: null, sectionLater: null });
      } else {
        card = makeFollowedCard(item, { view: k, isDoc: k === "belgesel", refresh: runLocalSearch, sectionMain: null, sectionLater: null });
      }
    } catch (_) { card = null; }
    if (card) {
      frag.appendChild(card);
      try { applyTitleHint(card); } catch (_) {}
    }
  });
  grid.appendChild(frag);
}

(function wireLocalSearch() {
  const inp = localSearchInput();
  const modal = localSearchModalEl();
  if (!inp || !modal) return;
  inp.addEventListener("input", () => {
    const q = (inp.value || "").trim();
    if (localSearchState.timer) { clearTimeout(localSearchState.timer); localSearchState.timer = null; }
    if (q.length < 2) { closeLocalSearchModal(); return; } // 2 karakterin altı: sessizce kapan
    localSearchState.timer = setTimeout(runLocalSearch, 250);
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = (inp.value || "").trim();
      if (q.length < 2) { toast(t("search_local_min"), true); return; } // kırmızı toast yalnız Enter'da
      if (localSearchState.timer) { clearTimeout(localSearchState.timer); localSearchState.timer = null; }
      runLocalSearch();
    } else if (e.key === "Escape") {
      closeLocalSearchModal();
    }
  });
  const closeBtn = document.getElementById("local-search-close");
  if (closeBtn) closeBtn.onclick = () => closeLocalSearchModal();
  modal.addEventListener("click", (e) => { if (e.target === modal) closeLocalSearchModal(); });
  const filterBtn = document.getElementById("local-search-filter-btn");
  const menu = document.getElementById("local-search-filter-menu");
  if (filterBtn) filterBtn.onclick = (e) => { e.stopPropagation(); toggleLocalFilterMenu(); };
  if (menu) {
    menu.querySelectorAll(".sort-item").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        localSearchState.kind = btn.dataset.kind || "all";
        updateLocalFilterMenu();
        toggleLocalFilterMenu(false);
        renderLocalResults();
      };
    });
  }
  document.addEventListener("click", (e) => {
    const m = document.getElementById("local-search-filter-menu");
    if (!m || !m.classList.contains("open")) return;
    const el = e.target;
    if (el && el.closest && el.closest("#local-search-filter-menu, #local-search-filter-btn")) return;
    toggleLocalFilterMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = localSearchModalEl();
    if (m && m.style.display !== "none") closeLocalSearchModal();
  });
})();


export { currentMedia, setMedia, comboSource, setComboSource, updateComboActorLabel, renderChips, openValueModal, setSearchBtnLoading,
         runSearch, runNormalSearch, doTitleSearch, doAnimeTitleSearch,
         setResultsTitle, openResultsModal, closeResultsModal, comboTitle, doComboSearch, openPicker, closeLocalSearchModal };
