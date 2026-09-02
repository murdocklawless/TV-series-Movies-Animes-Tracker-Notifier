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
  // TV: releases/unwatched takvimde ilk odak episode yuvarlaginda kalsin, X'e degil
  if (isTvMode() && (el.id === 'releases-modal' || el.id === 'unwatched-modal')) return;
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
    if (top && top._prevEl && top._prevEl.focus) focusNoScroll(top._prevEl);
    else if (top && top.dataset.prevFocus) {
      const p = document.getElementById(top.dataset.prevFocus);
      if (p) focusNoScroll(p);
    }
  } catch {}
  return top;
}
export function topModal() { return modalStack[modalStack.length - 1] || null; }
window._tvModalStack = modalStack;

// Hook existing modals: when display:flex, push; when none, pop
function hookModals() {
  const ids = ["releases-modal","details-modal","confirm-modal","person-modal","fav-listing-modal","picker-modal","value-modal","unwatched-modal","hidden-modal","settings-notify-modal","settings-form","notification-modal"];
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
  if (openMenuItems().length) {
    e.preventDefault(); e.stopPropagation();
    closeOpenMenus();
    return;
  }
  const top = topModal();
  if (top) {
    const isCardModal = top.id === 'releases-modal' || top.id === 'details-modal';
    if (isCardModal && buttonMode && buttonMode.card) {
      const prev = top._prevEl;
      e.preventDefault(); e.stopPropagation();
      try { top.style.display = "none"; } catch {}
      popModal(top);
      try {
        const btns = cardButtons(buttonMode.card);
        let idx = -1;
        if (prev) idx = btns.indexOf(prev);
        if (idx === -1) {
          if (top.id === 'releases-modal') idx = btns.findIndex(b=>b.classList.contains('calendar-btn'));
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
    e.preventDefault(); e.stopPropagation();
    try { top.style.display = "none"; } catch {}
    popModal(top);
    return;
  }
  if (buttonMode) {
    e.preventDefault(); e.stopPropagation();
    exitButtonMode();
    return;
  }
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
  try{ el.focus(); }catch(_){}
  try{
    if (el.closest && el.closest('.modal-overlay')){
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
  buttonMode = { card, idx: 0 };
  focusEl(btns[0]);
}
function exitButtonMode(){
  if (!buttonMode) return;
  const card = buttonMode.card;
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
              let firstUnwatched = null, firstWatched = null;
              episodeBtns.forEach(btn=>{
                const isWatched = btn.classList.contains('on') || btn.dataset.w === '1' || btn.classList.contains('watched');
                if (!isWatched && !firstUnwatched) firstUnwatched = btn;
                else if (isWatched && !firstWatched) firstWatched = btn;
              });
              // For releases/unwatched, fallback to first element if no watched marker
              if (!firstUnwatched && !firstWatched && episodeBtns.length) firstWatched = episodeBtns[0];
              lastTarget = firstUnwatched || firstWatched || episodeBtns[0];
              if (lastTarget){ e.preventDefault(); focusEl(lastTarget); return; }
            }
          }
          // Normal linear cycle within visibleCycle (episodes + X)
          let i = visibleCycle.indexOf(ae);
          if (i === -1){
            // If focus is on disabled or outside, go to lastTarget or first
            let firstUnwatched = null, firstWatched = null;
            episodeBtns.forEach(btn=>{
              const isWatched = btn.classList.contains('on') || btn.dataset.w === '1';
              if (!isWatched && !firstUnwatched) firstUnwatched = btn; else if (isWatched && !firstWatched) firstWatched = btn;
            });
            const start = firstUnwatched || firstWatched || visibleCycle[0];
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
  const menuItems = openMenuItems();
  if (menuItems.length){
    let i = menuItems.indexOf(document.activeElement);
    if (i === -1){ focusEl(menuItems[0]); return; }
    const n = (dir==='right'||dir==='down') ? (i+1)%menuItems.length : (i-1+menuItems.length)%menuItems.length;
    focusEl(menuItems[n]);
    return;
  }
  if (buttonMode){
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
  gridMove(dir);
});

// OK/Enter: header butonunu / buton modunda kart butonunu CALISTIRIR; kart odakliyken buton moduna girer
document.addEventListener("keydown", (e)=>{
  if (!isTvMode()) return;
  if (!isOkKey(e)) return;
  if (topModal()) return;
  if (buttonMode){
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
  if (t && isCard(t) && !topModal()){
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
