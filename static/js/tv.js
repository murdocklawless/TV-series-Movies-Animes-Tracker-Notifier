// tv.js — Android TV detection + modal stack + D-pad
import { state } from "./state.js";

export function isAndroidTV() {
  try {
    const ua = navigator.userAgent || "";
    const uaTv = /aft|bravia|smart-tv|googletv|android.*tv|crkey|wv.*tv|NextEpTV/i.test(ua);
    const bridgeTv = !!(window.NextEpTV && typeof window.NextEpTV.isTv === "function" && window.NextEpTV.isTv());
    if (uaTv || bridgeTv) return true;
    // debug override
    const qs = new URLSearchParams(location.search);
    if (qs.get("tv") === "1" || localStorage.getItem("forceTv") === "1") return true;
    const m = window.matchMedia && window.matchMedia("(hover:none) and (pointer:coarse) and (min-width:960px)").matches;
    const noTouch = (navigator.maxTouchPoints || 0) === 0 && !("ontouchstart" in window);
    return !!(m && noTouch);
  } catch { return false; }
}

function applyTvClass() {
  if (isAndroidTV()) {
    document.documentElement.classList.add("is-tv", "tv-mode");
    try{ const img=document.querySelector('.logo-img'); if(img) img.src='/static/images/nextep_tv_logo.png'; }catch(_){}
  } else {
    // keep off on desktop/mobile
  }
}
applyTvClass();
window.addEventListener("DOMContentLoaded", applyTvClass);

// ---- Modal stack LIFO ----
const modalStack = [];
function focusNoScroll(el) {
  try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
}
export function pushModal(el) {
  if (!el) return;
  const prev = document.activeElement;
  el.dataset.prevFocus = prev && prev.id ? prev.id : "";
  el._prevEl = prev;
  modalStack.push(el);
  // TV: releases/unwatched takvimde ilk odak episode yuvarlaginda kalsin, X'e degil;
  // picker'da free-input'ta, sonuç modalında ilk kartta kalsın (açılış focus'unu observer çalmasın)
  if (isTvMode() && (el.id === 'releases-modal' || el.id === 'unwatched-modal' || el.id === 'picker-modal' || el.id === 'search-results-modal' || el.id === 'value-modal')) return;
  // focus first focusable (no scroll — scroll can yank fixed overlay in WebView)
  try {
    const f = el.querySelector('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (f) focusNoScroll(f);
  } catch {}
}
export function popModal(el) {
  let top = null;
  if (el) {
    const idx = modalStack.lastIndexOf(el);
    if (idx !== -1) { top = modalStack.splice(idx, 1)[0]; }
  } else {
    top = modalStack.pop();
  }
  try {
    const live = top && top._prevEl ? resolveLiveButton(top._prevEl) : null;
    if (live) focusNoScroll(live);
    else if (top && top.dataset.prevFocus) {
      const p = document.getElementById(top.dataset.prevFocus);
      if (p && document.contains(p)) focusNoScroll(p);
    }
  } catch {}
  return top;
}
// loadFollowed/loadAnime grid'i yeniden çizince saklanan kart/btn detached kalır;
// aynı kartı dataset kimliğiyle yeniden bul (canlı DOM'a dön)
function resolveLiveCard(oldCard) {
  try {
    if (!oldCard) return null;
    if (document.contains(oldCard)) return oldCard;
    const d = oldCard.dataset || {};
    const sels = [];
    if (d.dbId) sels.push(`.card[data-db-id="${d.dbId}"]`);
    if (d.tmdbId && d.mediaType) sels.push(`.card[data-tmdb-id="${d.tmdbId}"]`);
    if (d.anilistId) sels.push(`.card[data-anilist-id="${d.anilistId}"]`);
    for (const s of sels) {
      const found = document.querySelector(s);
      if (found) return found;
    }
    return null;
  } catch { return null; }
}
function resolveLiveButton(oldBtn) {
  try {
    if (!oldBtn) return null;
    if (document.contains(oldBtn)) return oldBtn;
    const card = oldBtn.closest && oldBtn.closest('.card');
    const liveCard = card ? resolveLiveCard(card) : null;
    if (liveCard) {
      const cls = ['calendar-btn','info-btn','remove','move-btn','move-back-btn','hide-btn'].find(c=>oldBtn.classList && oldBtn.classList.contains(c));
      if (cls) {
        const nb = liveCard.querySelector('.'+cls);
        if (nb) return nb;
      }
      return liveCard;
    }
    return null;
  } catch { return null; }
}
export function topModal() { return modalStack[modalStack.length - 1] || null; }
window._tvModalStack = modalStack;

// Hook existing modals: when display:flex, push; when none, pop
function hookModals() {
  const ids = ["releases-modal","details-modal","tv-unfollow-modal","anime-unfollow-modal","reject-confirm-modal","member-delete-modal","member-deactivate-modal","logout-confirm-modal","notif-clear-modal","stremio-disconnect-modal","person-modal","fav-listing-modal","picker-modal","value-modal","unwatched-modal","hidden-modal","settings-notify-modal","settings-thirdparty-modal","settings-form","notification-modal","search-results-modal"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new MutationObserver(() => {
      const vis = el.style.display !== "none" && getComputedStyle(el).display !== "none";
      if (vis) { if (!modalStack.includes(el)) pushModal(el); }
      else { const idx = modalStack.indexOf(el); if (idx !== -1) modalStack.splice(idx, 1); }
      // tv-info-btn visibility handled separately
    });
    obs.observe(el, { attributes: true, attributeFilter: ["style","class"] });
  });
}
if (isAndroidTV()) { try { hookModals(); } catch {} }
document.addEventListener("DOMContentLoaded", () => { if (isAndroidTV()) { try { hookModals(); } catch {} } });

// ---- TV focus / 2D grid navigation state ----
let buttonMode = null; // { card } — card overlay buttons active

// Back/Escape: modal -> close (kart modunda kal, originating butona dön); button-mode -> back to card; else no-op
document.addEventListener("keydown", (e) => {
  if (!isTvMode()) return;
  const key = e.key;
  const code = e.keyCode || e.which;
  const isBack = key === "Escape" || key === "GoBack" || key === "BrowserBack" || code === 4 || code === 461 || key === "Back";
  if (!isBack) return;
  // Login gorunumunde Geri no-op (cikis yalniz login-exit butonundan).
  // Acik dil listesi varsa once o kapanir (tuzaktan cikis).
  try {
    const LL = window.__NX_langList;
    if (typeof isLoginViewActive === "function" && isLoginViewActive() && LL && LL.isOpen && LL.isOpen()){
      e.preventDefault(); e.stopPropagation(); LL.close(); return;
    }
  } catch {}
  // Kapali liste + odak dil butonunda: Geri, gelinen yere dondurur.
  try {
    const LL2 = window.__NX_langList;
    const ae2 = document.activeElement;
    const lb2 = document.getElementById('login-lang-btn');
    if (typeof isLoginViewActive === "function" && isLoginViewActive() && ae2 && lb2 && ae2 === lb2 && LL2 && LL2.exitToOrigin){
      e.preventDefault(); e.stopPropagation(); LL2.exitToOrigin(); return;
    }
  } catch {}
  if (openMenuItems().length) {
    e.preventDefault(); e.stopPropagation();
    // Hangi pencere açıksa kapatınca onun butonunda kal (bildirim/sıralama/ayarlar).
    const backTarget =
      (isMenuOpen('#notif-menu') && '#tab-notif') ||
      (isMenuOpen('#sort-menu') && '#tab-sort') ||
      (isMenuOpen('#settings-menu') && '#tab-settings') || null;
    closeOpenMenus();
    if (backTarget) {
      try {
        const b = document.querySelector(backTarget);
        if (b && !b.disabled && isVisible(b)) focusEl(b);
      } catch {}
    }
    return;
  }
  const top = topModal();
  if (top) {
    const isCardModal = top.id === 'releases-modal' || top.id === 'details-modal' || top.id === 'unwatched-modal';
    if (isCardModal && buttonMode && buttonMode.card) {
      const liveCard = resolveLiveCard(buttonMode.card) || buttonMode.card;
      buttonMode.card = liveCard;
      const prev = top._prevEl ? (resolveLiveButton(top._prevEl) || null) : null;
      e.preventDefault(); e.stopPropagation();
      try { top.style.display = "none"; } catch {}
      popModal(top);
      try {
        const btns = cardButtons(liveCard);
        let idx = -1;
        if (prev) idx = btns.indexOf(prev);
        if (idx === -1) {
          if (top.id === 'releases-modal' || top.id === 'unwatched-modal') idx = btns.findIndex(b=>b.classList.contains('calendar-btn'));
          else if (top.id === 'details-modal') idx = btns.findIndex(b=>b.classList.contains('info-btn'));
        }
        if (idx !== -1 && btns[idx]) {
          buttonMode.idx = idx;
          focusEl(btns[idx]);
        } else if (prev && btns.includes(prev)) {
          focusEl(prev);
        } else if (btns.length) {
          focusEl(btns[buttonMode.idx] || btns[0]);
        }
      } catch(_){}
      return;
    }
    // Sonuç modalında buton modundayken Back karta döner, modal açık kalır
    if (top.id === 'search-results-modal' && buttonMode && buttonMode.card && top.contains(buttonMode.card)) {
      e.preventDefault(); e.stopPropagation();
      exitButtonMode();
      return;
    }
    e.preventDefault(); e.stopPropagation();
    try { top.style.display = "none"; } catch {}
    popModal(top);
    // picker/value: hangi buton açtıysa ona dön (dataset.opener; örn. tür→tür)
    try {
      const oid = top.dataset && top.dataset.opener;
      if (oid) {
        const ob = document.getElementById(oid);
        if (ob && !ob.disabled && isVisible(ob)) focusEl(ob);
      }
    } catch(_){}
    return;
  }
  if (buttonMode) {
    e.preventDefault(); e.stopPropagation();
    exitButtonMode();
    return;
  }
  try {
    const sv = document.getElementById('view-search');
    if (sv && sv.classList.contains('active')) {
      const c = document.getElementById('search-close');
      if (c) {
        e.preventDefault(); e.stopPropagation(); c.click();
        // Arama kapanınca açan butonda kal (#tab-search), dizi'ye düşme.
        try {
          const t = document.getElementById('tab-search');
          if (t && !t.disabled && isVisible(t)) focusEl(t);
        } catch {}
        return;
      }
    }
  } catch(_){}
});

function isTvMode() {
  const d = document.documentElement;
  return !!(d && (d.classList.contains("is-tv") || d.classList.contains("tv-mode")));
}
function isVisible(el){
  try{ const s=getComputedStyle(el); if(s.display==="none"||s.visibility==="hidden") return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0; }catch{ return false; }
}
function rectOf(el){ try{ return el.getBoundingClientRect(); }catch{ return {left:0,top:0,width:0,height:0}; } }
function rectC(el){ const r=rectOf(el); return r.left + r.width/2; }
function rectT(el){ return rectOf(el).top; }

const NAVBAR_SEL = '#tab-dizi,#tab-film,#tab-anime,#tab-unwatched,#tab-watched,#tab-recommend,#tab-notif,#tab-search,#tab-sort,#tab-settings,#tab-exit,#search-close';
const CARD_BTN_SEL = '.calendar-btn,.info-btn,.remove,.move-btn,.move-back-btn,.hide-btn';
const SECTION_HDR_SEL = '.unwatched-section-title .section-refresh, .unwatched-section-title .section-hide, .unwatched-section-title .section-move-up, .unwatched-section-title .section-move-down';

function isCard(el){ return !!(el && el.classList && el.classList.contains('card')); }
function cardButtons(card){
  const out = Array.from(card.querySelectorAll(CARD_BTN_SEL)).filter(el=>isVisible(el)&&!el.disabled);
  out.forEach((b)=>{ try{ b.tabIndex = 0; }catch(_){} });
  // Kanonik sıra: takvim -> taşı -> info -> takibi bırak (yalnız takvimli kartlarda;
  // takvimsiz kartlar DOM sırasında kalır)
  try {
    if (out.some((b)=>b.classList && b.classList.contains('calendar-btn'))) {
      const RANK = { 'calendar-btn': 0, 'move-btn': 1, 'move-back-btn': 1, 'info-btn': 2, 'hide-btn': 3, 'remove': 4 };
      const rank = (b) => {
        if (!b.classList) return 9;
        for (const k of Object.keys(RANK)) if (b.classList.contains(k)) return RANK[k];
        return 9;
      };
      out.sort((a, b) => rank(a) - rank(b));
    }
  } catch(_){}
  return out;
}
function sectionHeaderButtons(h2){
  const out = Array.from(h2.querySelectorAll(SECTION_HDR_SEL)).filter(el=>isVisible(el)&&!el.disabled);
  out.forEach((b)=>{ try{ b.tabIndex = 0; }catch(_){} });
  // also ensure Enter/Space triggers click when focused via D-pad (native button does, but ensure)
  return out;
}

function buildGrid(){
  const rows = [];
  const navEls = Array.from(document.querySelectorAll(NAVBAR_SEL)).filter(el=>isVisible(el)&&!el.disabled);
  // top-band (8px) toleransi: #tab-sort/#tab-settings top:-1px oldugu icin x sirasi bozulmasin
  navEls.sort((a,b)=>{
    const band = (el) => Math.round(rectT(el)/8);
    return (band(a)-band(b)) || (rectC(a)-rectC(b));
  });
  rows.push(navEls);
  // Section headers — single row per h2, tek satır (refresh/hide/move hepsi aynı satırda)
  const activeView = document.querySelector('.view.active');
  const scope = activeView || document;
  const headers = Array.from(scope.querySelectorAll('.unwatched-section-title')).filter(el=>isVisible(el));
  const hdrRows = [];
  for (const h2 of headers){
    const btns = sectionHeaderButtons(h2);
    if (btns.length){
      // ensure header row sorted left->right via rectC (refresh 0, hide 22px, move-down 22px right, move-up 0 right)
      btns.sort((a,b)=>rectC(a)-rectC(b));
      hdrRows.push({ top: rectT(h2), btns });
    }
  }
  hdrRows.sort((a,b)=>a.top - b.top);
  const cards = Array.from(document.querySelectorAll('.card')).filter(el=>isVisible(el)&&!el.disabled);
  cards.sort((a,b)=>rectT(a)-rectT(b)||rectC(a)-rectC(b));
  const groups = [];
  const TOL = 24;
  for (const c of cards){
    const t = rectT(c);
    let placed = false;
    for (const g of groups){
      if (Math.abs(rectT(g[0]) - t) <= TOL){ g.push(c); placed = true; break; }
    }
    if (!placed) groups.push([c]);
  }
  groups.sort((a,b)=>rectT(a[0])-rectT(b[0]));
  // Interleave header rows and card groups by rectT
  let hi = 0, gi = 0;
  while (hi < hdrRows.length || gi < groups.length){
    const hTop = hi < hdrRows.length ? hdrRows[hi].top : Infinity;
    const gTop = gi < groups.length ? rectT(groups[gi][0]) : Infinity;
    if (hTop < gTop){ rows.push(hdrRows[hi].btns); hi++; }
    else { groups[gi].sort((a,b)=>rectC(a)-rectC(b)); rows.push(groups[gi]); gi++; }
  }
  return rows;
}

function locate(el, rows){
  for (let r=0;r<rows.length;r++){
    const i = rows[r].indexOf(el);
    if (i!==-1) return {r, c:i};
  }
  const card = el && el.closest && el.closest('.card');
  if (card){
    for (let r=1;r<rows.length;r++){
      const i = rows[r].indexOf(card);
      if (i!==-1) return {r, c:i};
    }
  }
  const hdr = el && el.closest && el.closest('.unwatched-section-title');
  if (hdr){
    for (let r=1;r<rows.length;r++){
      const row = rows[r];
      for (let c=0;c<row.length;c++){
        if (row[c] && row[c].closest && row[c].closest('.unwatched-section-title')===hdr){
          // if active element is inside header, map to its row and closest button index
          const idx = row.indexOf(el);
          if (idx!==-1) return {r, c:idx};
          // fallback: header row itself
          return {r, c:0};
        }
      }
    }
  }
  return null;
}

function focusEl(el){
  if (!el) return;
  try{ focusNoScroll(el); }catch(_){}
  try{
    // Bildirim/sort/settings dropdown: yalniz liste kabini kaydir, sayfayi oynatma
    const dd = el.closest && el.closest('#notif-menu, #sort-menu, #settings-menu');
    if (dd){
      const list = (dd.querySelector('#notif-list') && dd.querySelector('#notif-list').contains(el))
        ? dd.querySelector('#notif-list')
        : (el.closest && el.closest('.notif-list, .fav-list, .sort-menu, .settings-menu'));
      const box = (list && list.contains(el)) ? list : dd;
      try{
        const br = box.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (box !== dd || box === dd){
          // scroll edilebilir kapta en yakin konum
          if (r.top < br.top) box.scrollTop -= (br.top - r.top + 6);
          else if (r.bottom > br.bottom) box.scrollTop += (r.bottom - br.bottom + 6);
        }
      }catch(_){
        try{ el.scrollIntoView({block:"nearest", inline:"nearest"}); }catch(_){}
      }
      return;
    }
    if (el.closest && el.closest('.modal-overlay')){
      // odak zaten kaydırmasız verildi; tek minimal kaydırma
      el.scrollIntoView({block:"nearest", inline:"nearest"});
      return;
    }
    // grid: kartin TAMAMI gorunsun (sticky navbar alti ile ekran alti arasinda)
    const nav = document.querySelector('nav');
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 60;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const curY = window.pageYOffset || document.documentElement.scrollTop;
    let y = curY;
    if (r.top < navBottom) y = curY + r.top - navBottom - 6;
    if (r.bottom > vh - 10) y = Math.max(y, curY + r.bottom - vh + 10);
    if (y !== curY) window.scrollTo(0, Math.max(0, y));
  }catch(_){}
}

function isHeaderRow(row){
  return !!(row && row.length && row[0] && row[0].closest && row[0].closest('.unwatched-section-title'));
}
function findFirstCardRow(rows){
  for(let i=1;i<rows.length;i++){
    const row = rows[i];
    if(!row || !row.length) continue;
    if(isHeaderRow(row)) continue;
    if(row.some(el=>isCard(el))) return i;
  }
  return -1;
}
function gridMove(dir){
  const rows = buildGrid();
  if (!rows.length) return;
  const ae = document.activeElement;
  const src = isCard(ae) ? ae : (ae && ae.closest && ae.closest('.card')) || ae;
  const pos = locate(src, rows);
  if (!pos){
    const first = (rows[0] && rows[0][0]) || (rows[1] && rows[1][0]) || null;
    focusEl(first);
    return;
  }
  const r = pos.r, c = pos.c;
  let target = null;
  if (dir === 'left' || dir === 'right'){
    const row = rows[r];
    if (!row.length){ target = rows[0][0]; }
    else {
      const step = dir === 'right' ? 1 : -1;
      target = row[(c + step + row.length) % row.length];
    }
  } else {
    if (r === 0 && dir === 'down'){
      const fIdx = findFirstCardRow(rows);
      if(fIdx !== -1) target = rows[fIdx][0];
      else {
        const firstRow = rows[1];
        if (firstRow && firstRow.length) target = firstRow[0];
        else if (rows[0] && rows[0].length) target = rows[0][0];
      }
    } else {
      const nr = dir === 'down' ? (r+1 < rows.length ? r+1 : 0) : (r-1 >= 0 ? r-1 : rows.length-1);
      if (nr === 0){
        const active = document.querySelector('.tabs-group .tab.active') || document.querySelector(NAVBAR_SEL + '.active') || document.querySelector('.tab.active');
        if (active) target = active;
        else target = rows[0][0] || null;
      } else {
        const row = rows[nr];
        if (!row.length){ target = rows[0][0]; }
        else if(isHeaderRow(row) || isHeaderRow(rows[r])){
          target = row[0];
        } else {
          const srcC = rectC(src);
          let best = row[0], bestD = Infinity;
          for (const el of row){
            const d = Math.abs(rectC(el) - srcC);
            if (d < bestD){ bestD = d; best = el; }
          }
          target = best;
        }
      }
    }
  }
  if (target) focusEl(target);
}

function enterButtonMode(card){
  const btns = cardButtons(card);
  if (!btns.length) return;
  // Takvim varsa ilk odak takvim (eski davranış); yoksa (önerilenler/fav) info ilk sırada kalır
  let idx = btns.findIndex((b)=>b.classList.contains('calendar-btn'));
  if (idx === -1) idx = 0;
  buttonMode = { card, idx };
  focusEl(btns[idx]);
}
// Sonuç modalı kart seviyesi 2D navigasyon (kart-içi butonlara dalmaz;
// butonlara OK ile buton modunda girilir, Back ile karta dönülür)
function resultsModalMove(top, dir, e){
  try {
    const closeBtn = top.querySelector('#search-results-close');
    const cards = Array.from(top.querySelectorAll('.card')).filter(el=>isVisible(el)&&!el.disabled);
    if (!cards.length) return false;
    const ae = document.activeElement;
    if (closeBtn && ae === closeBtn){
      const t = (dir === 'down' || dir === 'right') ? cards[0] : cards[cards.length - 1];
      e.preventDefault(); focusEl(t); return true;
    }
    let card = isCard(ae) ? ae : (ae && ae.closest && ae.closest('.card')) || null;
    if (!card || !top.contains(card)){
      const t = (dir === 'down' || dir === 'right') ? cards[0] : cards[cards.length - 1];
      e.preventDefault(); focusEl(t); return true;
    }
    cards.sort((a,b)=>rectT(a)-rectT(b)||rectC(a)-rectC(b));
    const TOL = 24, rows = [];
    for (const c of cards){
      const t = rectT(c);
      let placed = false;
      for (const g of rows){
        if (Math.abs(rectT(g[0]) - t) <= TOL){ g.push(c); placed = true; break; }
      }
      if (!placed) rows.push([c]);
    }
    rows.sort((a,b)=>rectT(a[0])-rectT(b[0]));
    rows.forEach(r=>r.sort((a,b)=>rectC(a)-rectC(b)));
    let ri = -1, ci = -1;
    rows.forEach((r,i)=>{ const j = r.indexOf(card); if (j !== -1){ ri = i; ci = j; } });
    if (ri === -1){ e.preventDefault(); focusEl(cards[0]); return true; }
    let target = null;
    if (dir === 'left' || dir === 'right'){
      const row = rows[ri];
      const step = dir === 'right' ? 1 : -1;
      target = row[(ci + step + row.length) % row.length];
    } else {
      const nr = dir === 'down' ? ri + 1 : ri - 1;
      if (nr < 0 || nr >= rows.length){
        if (closeBtn) target = closeBtn;
        else {
          const wrap = dir === 'down' ? rows[0] : rows[rows.length - 1];
          const srcC = rectC(card);
          let best = wrap[0], bestD = Infinity;
          for (const el of wrap){ const d = Math.abs(rectC(el) - srcC); if (d < bestD){ bestD = d; best = el; } }
          target = best;
        }
      } else {
        const srcC = rectC(card);
        let best = rows[nr][0], bestD = Infinity;
        for (const el of rows[nr]){ const d = Math.abs(rectC(el) - srcC); if (d < bestD){ bestD = d; best = el; } }
        target = best;
      }
    }
    if (target){ e.preventDefault(); focusEl(target); return true; }
    return false;
  } catch { return false; }
}
function exitButtonMode(){
  if (!buttonMode) return;
  const card = resolveLiveCard(buttonMode.card) || buttonMode.card;
  buttonMode = null;
  if (card) focusEl(card);
}

function dirFromEvent(e){
  const k = e.key;
  if (k === 'ArrowDown' || e.keyCode === 20) return 'down';
  if (k === 'ArrowUp' || e.keyCode === 19) return 'up';
  if (k === 'ArrowLeft' || e.keyCode === 21) return 'left';
  if (k === 'ArrowRight' || e.keyCode === 22) return 'right';
  return null;
}
function isOkKey(e){
  const k = e.key;
  return k === 'Enter' || k === ' ' || e.keyCode === 23 || e.keyCode === 66;
}

// Open dropdown menus (sort/settings/notif) — linear nav within (notif-item'lar div, tabIndex verilir)
function openMenuItems(){
  const menus = ['#sort-menu','#settings-menu','#notif-menu'];
  const out = [];
  for (const s of menus){
    const m = document.querySelector(s);
    if (!m || !isVisible(m)) continue;
    const items = Array.from(m.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"]), .notif-item')).filter(el=>isVisible(el)&&!el.disabled);
    items.forEach((el)=>{
      if (el.classList && el.classList.contains('notif-item')){ try{ el.tabIndex = 0; }catch(_){} }
    });
    out.push(...items);
  }
  return out;
}

// Bildirim menüsü özel turu: açılışta aşağı ilk mesaj; mesajlar kendi içinde
// döngü (son aşağı → ilk); ilk mesajdan yukarı header (önce mark-all).
// Header içi yatay: mark-all <-> clear; header'dan aşağı msg1, yukarı msgN.
function notifMenuOpen(){
  try{
    const m = document.querySelector('#notif-menu');
    return !!(m && m.classList.contains('open') && isVisible(m));
  }catch{ return false; }
}
function notifChainParts(){
  let mark = null, clear = null, items = [];
  try{
    mark = document.querySelector('#notif-mark-all');
    if (mark && (!isVisible(mark) || mark.disabled)) mark = null;
    clear = document.querySelector('#notif-clear');
    if (clear && (!isVisible(clear) || clear.disabled)) clear = null;
    const list = document.querySelector('#notif-list');
    if (list) items = Array.from(list.querySelectorAll('.notif-item')).filter(el=>isVisible(el)&&!el.disabled);
    items.forEach((el)=>{ try{ el.tabIndex = 0; }catch(_){} });
  }catch{}
  return { mark, clear, items };
}
function handleNotifMenuNav(e, dir){
  if (!notifMenuOpen()) return false;
  // sort/settings aynı anda açıksa jenerik akışa bırak
  try{
    const s = document.querySelector('#sort-menu');
    const g = document.querySelector('#settings-menu');
    if ((s && s.classList.contains('open') && isVisible(s)) || (g && g.classList.contains('open') && isVisible(g))) return false;
  }catch{}
  const { mark, clear, items } = notifChainParts();
  const headers = [mark, clear].filter(Boolean);
  if (!items.length){
    // boş liste: yalnız header lineer tur
    if (!headers.length) return false;
    const ae0 = document.activeElement;
    let i0 = headers.indexOf(ae0);
    if (i0 === -1){ e.preventDefault(); focusEl(headers[0]); return true; }
    const n0 = (dir==='right'||dir==='down') ? (i0+1)%headers.length : (i0-1+headers.length)%headers.length;
    e.preventDefault(); focusEl(headers[n0]); return true;
  }
  const ae = document.activeElement;
  const isMark = ae === mark, isClear = ae === clear;
  const idx = items.indexOf(ae);
  const first = items[0], last = items[items.length-1];
  const go = (el)=>{ e.preventDefault(); focusEl(el); return true; };
  if (isMark || isClear){
    if (dir === 'left' || dir === 'right'){
      if (headers.length > 1) return go(isMark ? clear : mark);
      return go(ae);
    }
    if (dir === 'down') return go(first);
    // header'dan yukarı: son mesaj (dairesellik)
    return go(last);
  }
  if (idx !== -1){
    if (dir === 'right' || dir === 'down'){
      // son mesajdan aşağı ilk mesaja (header'a değil)
      if (idx === items.length-1) return go(first);
      return go(items[idx+1]);
    }
    // yukarı/sol: ilk mesajdan yukarı mark-all (yoksa clear / son)
    if (idx === 0) return go(mark || clear || last);
    return go(items[idx-1]);
  }
  // Zincir dışı odaktan (örn. #tab-notif): aşağı/sağ ilk mesaj, yukarı/sol son mesaj
  if (dir === 'down' || dir === 'right') return go(first);
  return go(last);
}

function isMenuOpen(sel){
  try{
    const m = document.querySelector(sel);
    return !!(m && m.classList.contains('open') && isVisible(m));
  }catch{ return false; }
}
function closeOpenMenus(){
  const pairs = [['#sort-menu','#tab-sort'],['#settings-menu','#tab-settings'],['#notif-menu','#tab-notif']];
  for (const [sel, tabSel] of pairs){
    const m = document.querySelector(sel);
    if (m) m.classList.remove('open');
    const b = document.querySelector(tabSel);
    if (b) b.classList.remove('active');
  }
}

document.addEventListener("keydown", (e)=>{
  if (!isTvMode()) return;
  const top = topModal();
  const dir = dirFromEvent(e);
  if (top){
    if (!dir) return;
    // Sonuç modalı: 2 seviyeli — kart seviyesinde 2D kart navigasyonu,
    // buton modunda kart-içi butonlar (modal kapanmaz)
    if (top.id === 'search-results-modal'){
      if (buttonMode && !(buttonMode.card && top.contains(buttonMode.card))) buttonMode = null;
      if (buttonMode && buttonMode.card) {
        const liveR = resolveLiveCard(buttonMode.card);
        if (liveR) buttonMode.card = liveR;
        const btns = cardButtons(buttonMode.card);
        if (!btns.length){ exitButtonMode(); e.preventDefault(); return; }
        if (dir === 'left') buttonMode.idx = (buttonMode.idx - 1 + btns.length) % btns.length;
        else buttonMode.idx = (buttonMode.idx + 1) % btns.length;
        e.preventDefault(); focusEl(btns[buttonMode.idx]); return;
      }
      if (resultsModalMove(top, dir, e)) return;
      // kart yoksa jenerik cycle'a düş (X vb.)
    }
    // Releases/Unwatched/Anime schedule: custom X <-> episode cycle, disabled atlanir
    const isScheduleModal = top.id === 'releases-modal' || top.id === 'unwatched-modal' || (top.querySelector('.anime-watch') && top.id === 'releases-modal');
    if (isScheduleModal || top.id === 'releases-modal' || top.id === 'unwatched-modal'){
      const isReleases = top.id === 'releases-modal';
      const episodeSel = isReleases ? '.watch-btn:not([disabled]), .anime-watch:not([disabled])' : '.uw-watch:not([disabled])';
      const closeSel = isReleases ? '#releases-close' : '#unwatched-close';
      const episodeBtns = Array.from(top.querySelectorAll(episodeSel)).filter(isVisible);
      const closeBtn = top.querySelector(closeSel);
      if (episodeBtns.length || closeBtn){
        const cycleList = closeBtn ? [...episodeBtns, closeBtn] : [...episodeBtns];
        // Filter visible only
        const visibleCycle = cycleList.filter(isVisible);
        if (visibleCycle.length){
          const ae = document.activeElement;
          // Special X handling: X down -> first, X up -> lastTarget (son izlenmemis/son izlenen)
          if (ae === closeBtn){
            if (dir === 'down' || dir === 'right'){
              const first = episodeBtns[0];
              if (first){ e.preventDefault(); focusEl(first); return; }
            } else if (dir === 'up' || dir === 'left'){
              // lastTarget: son izlenmemis yoksa son izlenen (components.js'deki mantiga paralel)
              let lastTarget = null;
              // try to find last unwatched else last watched among episodeBtns
              // Use data attributes to detect watched state: .on class or data-w
              let firstUnwatched = null, lastWatched = null;
              episodeBtns.forEach(btn=>{
                const isWatched = btn.classList.contains('on') || btn.dataset.w === '1' || btn.classList.contains('watched');
                if (!isWatched && !firstUnwatched) firstUnwatched = btn;
                if (isWatched) lastWatched = btn;
              });
              if (!firstUnwatched && !lastWatched && episodeBtns.length) lastWatched = episodeBtns[0];
              lastTarget = firstUnwatched || lastWatched || episodeBtns[0];
              if (lastTarget){ e.preventDefault(); focusEl(lastTarget); return; }
            }
          }
          // Normal linear cycle within visibleCycle (episodes + X)
          let i = visibleCycle.indexOf(ae);
          if (i === -1){
            // If focus is on disabled or outside, go to lastTarget or first
            let firstUnwatched = null, lastWatched = null;
            episodeBtns.forEach(btn=>{
              const isWatched = btn.classList.contains('on') || btn.dataset.w === '1';
              if (!isWatched && !firstUnwatched) firstUnwatched = btn; if (isWatched) lastWatched = btn;
            });
            const start = firstUnwatched || lastWatched || visibleCycle[0];
            e.preventDefault(); focusEl(start); return;
          }
          let n = (dir==='right'||dir==='down') ? (i+1)%visibleCycle.length : (i-1+visibleCycle.length)%visibleCycle.length;
          e.preventDefault(); focusEl(visibleCycle[n]); return;
        }
      }
    }
    const list = Array.from(top.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')).filter(isVisible);
    if (!list.length) return;
    let i = list.indexOf(document.activeElement);
    let n = (dir==='right'||dir==='down') ? (i===-1?0:(i+1)%list.length) : (i===-1?list.length-1:(i-1+list.length)%list.length);
    focusEl(list[n]);
    return;
  }
  if (!dir) return;
  e.preventDefault();
  if (handleNotifMenuNav(e, dir)) return;
  const menuItems = openMenuItems();
  if (menuItems.length){
    let i = menuItems.indexOf(document.activeElement);
    if (i === -1){ focusEl(menuItems[0]); return; }
    const n = (dir==='right'||dir==='down') ? (i+1)%menuItems.length : (i-1+menuItems.length)%menuItems.length;
    focusEl(menuItems[n]);
    return;
  }
  if (buttonMode){
    const liveDir = resolveLiveCard(buttonMode.card);
    if (liveDir) buttonMode.card = liveDir;
    const btns = cardButtons(buttonMode.card);
    if (!btns.length){ exitButtonMode(); return; }
    if (dir === 'left'){
      buttonMode.idx = (buttonMode.idx - 1 + btns.length) % btns.length;
    } else if (dir === 'right'){
      buttonMode.idx = (buttonMode.idx + 1) % btns.length;
    } else if (dir === 'up' || dir === 'down'){
      buttonMode.idx = (buttonMode.idx + 1) % btns.length;
    }
    focusEl(btns[buttonMode.idx]);
    return;
  }
  if (handleSearchViewNav(e, dir)) return;
  if (handleLoginViewNav(e, dir)) return;
  gridMove(dir);
});

// ---- view-search D-pad (TV): dikey cycle + yatay gruplar ----
const SEARCH_MEDIA_IDS = ['#media-dizi','#media-film','#media-anime'];
const SEARCH_FILTER_IDS = ['#filter-media-movie','#filter-media-tv','#filter-actor','#filter-genre','#filter-year','#filter-score'];
function isSearchViewActive(){
  try { const v = document.getElementById('view-search'); return !!(v && v.classList.contains('active')); } catch { return false; }
}
function searchVisible(sel){
  try { const el = document.querySelector(sel); return (el && isVisible(el) && !el.disabled) ? el : null; } catch { return null; }
}
function searchChipXList(){
  try {
    const box = document.getElementById('filter-chips');
    if (!box) return [];
    return Array.from(box.querySelectorAll('.chip-x')).filter(el=>isVisible(el)&&!el.disabled);
  } catch { return []; }
}
function searchVerticalChain(){
  const chain = [];
  const x = searchVisible('#search-close'); if (x) chain.push(x);
  const dizi = searchVisible('#media-dizi'); if (dizi) chain.push(dizi);
  const inp = searchVisible('#normal-search-input'); if (inp) chain.push(inp);
  const nbtn = searchVisible('#normal-search-btn'); if (nbtn) chain.push(nbtn);
  const fmovie = searchVisible('#filter-media-movie'); if (fmovie) chain.push(fmovie);
  const xs = searchChipXList(); if (xs.length) chain.push(xs[0]);
  const sbtn = searchVisible('#search-btn'); if (sbtn) chain.push(sbtn);
  return chain;
}
function handleSearchViewNav(e, dir){
  if (!isSearchViewActive()) return false;
  const ae = document.activeElement;
  if (dir === 'left' || dir === 'right'){
    const media = SEARCH_MEDIA_IDS.map(searchVisible).filter(Boolean);
    if (ae && media.includes(ae) && media.length){
      const n = dir === 'right' ? (media.indexOf(ae)+1)%media.length : (media.indexOf(ae)-1+media.length)%media.length;
      e.preventDefault(); focusEl(media[n]); return true;
    }
    const filters = SEARCH_FILTER_IDS.map(searchVisible).filter(Boolean);
    if (ae && filters.includes(ae) && filters.length){
      const n = dir === 'right' ? (filters.indexOf(ae)+1)%filters.length : (filters.indexOf(ae)-1+filters.length)%filters.length;
      e.preventDefault(); focusEl(filters[n]); return true;
    }
    const xs = searchChipXList();
    if (ae && xs.includes(ae) && xs.length){
      const n = dir === 'right' ? (xs.indexOf(ae)+1)%xs.length : (xs.indexOf(ae)-1+xs.length)%xs.length;
      e.preventDefault(); focusEl(xs[n]); return true;
    }
  }
  const chain = searchVerticalChain();
  if (!chain.length) return false;
  let i = chain.indexOf(ae);
  if (i === -1){
    const media = SEARCH_MEDIA_IDS.map(searchVisible).filter(Boolean);
    if (ae && media.includes(ae)) i = chain.indexOf(searchVisible('#media-dizi'));
    else {
      const filters = SEARCH_FILTER_IDS.map(searchVisible).filter(Boolean);
      if (ae && filters.includes(ae)) i = chain.indexOf(searchVisible('#filter-media-movie'));
      else {
        const xs = searchChipXList();
        if (ae && xs.includes(ae)) i = chain.findIndex(el=>el && el.classList && el.classList.contains('chip-x'));
      }
    }
    if (i === -1){ e.preventDefault(); focusEl(chain[0]); return true; }
  }
  const n = (dir === 'down' || dir === 'right') ? (i+1)%chain.length : (i-1+chain.length)%chain.length;
  e.preventDefault(); focusEl(chain[n]); return true;
}

// ---- Faz 30 login view D-pad: dikey lineer zincir (oturum yokken nav gizli) ----
function isLoginViewActive(){
  try { const v = document.getElementById('view-login'); return !!(v && v.classList.contains('active')); } catch { return false; }
}
function loginChain(){
  // Dil secici en basta; gözler satır-içi: inputtan hemen sonra (pass→göz→pass2→göz2→...).
  const seq = ['#login-lang-btn','#login-user','#login-pass','.pw-eye[data-for="login-pass"]','#login-pass2','.pw-eye[data-for="login-pass2"]','#login-go','#login-register','#login-exit','#login-reset-go','#login-new','.pw-eye[data-for="login-new"]','#login-save','#login-forgot','#login-reset-back'];
  const out = [];
  for (const sel of seq){
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !el.disabled) out.push(el);
    } catch {}
  }
  return out;
}
function handleLoginViewNav(e, dir){
  if (!isLoginViewActive()) return false;
  const ae = document.activeElement;
  // Dil listesi aciksa YALNIZ yukari/asagi satirda gezer (sol/sag yutulur).
  try {
    const LL = window.__NX_langList;
    if (LL && LL.isOpen && LL.isOpen()){
      if (dir === 'up' || dir === 'down'){ e.preventDefault(); e.stopPropagation(); LL.move(dir); return true; }
      if (dir === 'left' || dir === 'right'){ e.preventDefault(); e.stopPropagation(); return true; }
    }
  } catch {}
  try {
    // Sifre-2'den yukari: once kendi gozu, sonra sifre-1 (istek).
    if (ae && ae.id === 'login-pass2' && (dir === 'up' || dir === 'left')){
      const eye = document.querySelector('.pw-eye[data-for="login-pass2"]');
      if (eye && isVisible(eye) && !eye.disabled){ e.preventDefault(); focusEl(eye); return true; }
    }
    if (ae && ae.classList && ae.classList.contains('pw-eye') && ae.dataset.for === 'login-pass2'){
      if (dir === 'up' || dir === 'left'){
        const p1 = searchVisible('#login-pass');
        if (p1){ e.preventDefault(); focusEl(p1); return true; }
      } else {
        const p2 = searchVisible('#login-pass2');
        if (p2){ e.preventDefault(); focusEl(p2); return true; }
      }
    }
    // Zorunlu-şifre ekranı: yeni-şifre gözü aynı desen (kendi gözü → üst satır).
    if (ae && ae.id === 'login-new' && (dir === 'up' || dir === 'left')){
      const eye = document.querySelector('.pw-eye[data-for="login-new"]');
      if (eye && isVisible(eye) && !eye.disabled){ e.preventDefault(); focusEl(eye); return true; }
    }
    if (ae && ae.classList && ae.classList.contains('pw-eye') && ae.dataset.for === 'login-new'){
      if (dir === 'up' || dir === 'left'){
        const p0 = searchVisible('#login-pass');
        if (p0){ e.preventDefault(); focusEl(p0); return true; }
      } else {
        const pn = searchVisible('#login-new');
        if (pn){ e.preventDefault(); focusEl(pn); return true; }
      }
    }
    // Ana şifre gözü: gözden yukarı/sola kutuya, kutudan sonra zincir zaten göze gider.
    if (ae && ae.classList && ae.classList.contains('pw-eye') && ae.dataset.for === 'login-pass'){
      if (dir === 'up' || dir === 'left'){
        const p = searchVisible('#login-pass');
        if (p){ e.preventDefault(); focusEl(p); return true; }
      }
    }
  } catch {}
  const chain = loginChain();
  if (!chain.length) return false;
  // Dil secici: asagi/sag → kullanici, yukari/sol → forgot (alttan sarma).
  try {
    const lb = document.getElementById('login-lang-btn');
    if (ae && lb && ae === lb && chain.includes(lb)){
      const go = (el) => { e.preventDefault(); focusEl(el); return true; };
      const user = document.getElementById('login-user');
      const forgot0 = document.getElementById('login-forgot');
      if (dir === 'down' || dir === 'right') return go((user && chain.includes(user)) ? user : chain[0]);
      if (forgot0 && chain.includes(forgot0)) return go(forgot0);
      return go(chain[chain.length - 1]);
    }
  } catch {}
  // Buton satırı satır-duyarlı: yatay satır içinde, dikey satırlar arası.
  try {
    const btnIds = ['login-go', 'login-register', 'login-exit'];
    const btns = btnIds.map((id) => document.getElementById(id)).filter((el) => el && chain.includes(el));
    const forgot = document.getElementById('login-forgot');
    const forgotOn = !!(forgot && chain.includes(forgot));
    if (ae && btns.includes(ae)){
      const go = (el) => { e.preventDefault(); focusEl(el); return true; };
      if (dir === 'left' || dir === 'right'){
        const step = dir === 'right' ? 1 : -1;
        return go(btns[(btns.indexOf(ae) + step + btns.length) % btns.length]);
      }
      if (dir === 'up'){
        // Satır üstü: zincirde ilk butondan önceki görünür öğe.
        const firstIdx = chain.indexOf(btns[0]);
        for (let k = firstIdx - 1; k >= 0; k--){ return go(chain[k]); }
        return go(chain[chain.length - 1]);
      }
      // down: forgot açıksa ona, yoksa başa sar.
      if (forgotOn) return go(forgot);
      return go(chain[0]);
    }
    if (ae === forgot && forgotOn){
      const go = (el) => { e.preventDefault(); focusEl(el); return true; };
      if (dir === 'up' || dir === 'left') return go(btns.length ? btns[0] : chain[0]);
      return go(chain[0]);
    }
  } catch {}
  let i = chain.indexOf(ae);
  if (i === -1){ e.preventDefault(); focusEl(chain[0]); return true; }
  const n = (dir === 'down' || dir === 'right') ? (i+1)%chain.length : (i-1+chain.length)%chain.length;
  e.preventDefault(); focusEl(chain[n]); return true;
}

// OK/Enter: header butonunu / buton modunda kart butonunu CALISTIRIR; kart odakliyken buton moduna girer
document.addEventListener("keydown", (e)=>{
  if (!isTvMode()) return;
  if (!isOkKey(e)) return;
  const tm = topModal();
  // Sonuç modalında kart OK'i buton moduna girer (detay info butonundan açılır)
  if (tm && tm.id === 'search-results-modal'){
    if (buttonMode && !(buttonMode.card && tm.contains(buttonMode.card))) buttonMode = null;
    const ae0 = document.activeElement;
    const card0 = ae0 && (isCard(ae0) ? ae0 : (ae0.closest && ae0.closest('.card'))) || null;
    if (!buttonMode && card0 && tm.contains(card0)){
      e.preventDefault(); e.stopPropagation();
      enterButtonMode(card0);
      return;
    }
    if (buttonMode) {
      const liveM = resolveLiveCard(buttonMode.card);
      if (liveM) buttonMode.card = liveM;
      const btns = cardButtons(buttonMode.card);
      const b = btns[buttonMode.idx];
      if (b){ e.preventDefault(); e.stopPropagation(); b.click(); }
      return;
    }
    return;
  }
  if (tm) return;
  if (buttonMode){
    const liveOk = resolveLiveCard(buttonMode.card);
    if (liveOk) buttonMode.card = liveOk;
    const btns = cardButtons(buttonMode.card);
    const b = btns[buttonMode.idx];
    if (b){ e.preventDefault(); e.stopPropagation(); b.click(); }
    return;
  }
  const menuItems = openMenuItems();
  if (menuItems.length){
    const ae = document.activeElement;
    if (ae && menuItems.includes(ae)){ e.preventDefault(); e.stopPropagation(); ae.click(); }
    return;
  }
  // Login görünümü: göz ve butonlarda OK doğrudan çalışır (DPAD_CENTER native click üretmez).
  try{
    if (isLoginViewActive()){
      const la = document.activeElement;
      try {
        const LL = window.__NX_langList;
        if (LL && LL.isOpen && LL.isOpen()){
          if (la && la.classList && la.classList.contains('provider-cell')){ e.preventDefault(); e.stopPropagation(); la.click(); return; }
          if (la && la.id === 'login-lang-btn'){ e.preventDefault(); e.stopPropagation(); la.click(); return; }
          e.preventDefault(); e.stopPropagation(); LL.pick(); return;
        }
      } catch {}
      if (la && la.id === 'login-lang-btn'){ e.preventDefault(); e.stopPropagation(); la.click(); return; }
      if (la && la.classList && la.classList.contains('pw-eye')){ e.preventDefault(); e.stopPropagation(); la.click(); return; }
      if (la && la.tagName === 'BUTTON' && la.id && (la.id === 'login-go' || la.id === 'login-register' || la.id === 'login-exit' || la.id === 'login-reset-go' || la.id === 'login-reset-back' || la.id === 'login-save' || la.id === 'login-forgot')){ e.preventDefault(); e.stopPropagation(); la.click(); return; }
      return;
    }
  }catch{}
  const ae = document.activeElement;
  if (ae && ae.closest && ae.closest('.unwatched-section-title')){
    e.preventDefault(); e.stopPropagation(); ae.click(); return;
  }
  if (ae && isCard(ae)){
    e.preventDefault(); e.stopPropagation();
    enterButtonMode(ae);
  }
}, true);

// Safety: keyboard-synthesized click on a card element (detail===0) must not open info
document.addEventListener("click", (e)=>{
  if (!isTvMode()) return;
  if (e.detail !== 0) return;
  const t = e.target;
  const tm2 = topModal();
  if (t && isCard(t) && (!tm2 || (tm2.id === 'search-results-modal' && tm2.contains(t)))){
    e.preventDefault(); e.stopPropagation();
    enterButtonMode(t);
  }
}, true);

// Exit button (TV navbar) -> close the Android app via bridge
try {
  const exitBtn = document.getElementById("tab-exit");
  if (exitBtn){
    exitBtn.onclick = (e)=>{ e.stopPropagation(); try { if (window.NextEpTV && typeof window.NextEpTV.exitApp === "function") window.NextEpTV.exitApp(); } catch(_) {} };
  }
} catch(_) {}

function ensureTvFocus(){
  try { if (topModal()) return; } catch {}
  if (document.activeElement && document.activeElement !== document.body) return;
  const rows = buildGrid();
  for (const row of rows){ if (row.length){ focusEl(row[0]); return; } }
}
document.addEventListener("DOMContentLoaded", ()=>{
  if (isAndroidTV()) setTimeout(ensureTvFocus, 900);
});
window.addEventListener("load", ()=>{
  if (isAndroidTV()) setTimeout(ensureTvFocus, 1200);
});
// re-focus after view switches (keep current focus if any)
document.addEventListener("app:viewchange", ()=>{ if (isAndroidTV()) setTimeout(ensureTvFocus, 400); });
