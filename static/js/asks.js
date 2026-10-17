// asks.js — "Izlendi Bilgisi Sor" paneli (navbar utils, canin solunda).
// ask_before_watched ON iken buton + rozet + panel gorunur; OFF iken hepsi kapali.
import { t, errText } from "./i18n.js?v=523";
import { escAttr, toast, CHECK_SVG } from "./utils.js?v=519";
import { closeMenu as closeNotifMenu, notifMediaKind, notifTypePill, notifMsgHTML, notifTitleLine } from "./notification.js?v=534";
import { openAskClearConfirm } from "./components.js?v=523";

let askEnabled = true;
let askTimer = null;
let askCache = [];

const ASK_X_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const wrapEl = () => document.getElementById("watched-ask-wrap");
const badgeEl = () => document.getElementById("watched-ask-badge");
const menuEl = () => document.getElementById("watched-ask-menu");
const listEl = () => document.getElementById("watched-ask-list");
const emptyEl = () => document.getElementById("watched-ask-empty");
const btnEl = () => document.getElementById("tab-watched-ask");

function askMenuOpen() {
  const m = menuEl();
  return !!(m && m.classList.contains("open"));
}

function alignAskMenu() {
  const m = menuEl();
  if (!m) return;
  m.style.right = "0";
}

function closeAskMenu() {
  const m = menuEl();
  if (m) {
    m.classList.remove("open");
    m.classList.remove("active");
  }
  const btn = btnEl();
  if (btn) btn.classList.remove("active");
}

function openAskMenu() {
  const m = menuEl();
  const btn = btnEl();
  if (!m || !btn) return;
  try {
    closeNotifMenu();
  } catch (_) {}
  btn.classList.add("active");
  m.classList.add("open");
  m.classList.add("active");
  alignAskMenu();
  fetchAskList();
}

function stopAskPolling() {
  if (askTimer) {
    clearInterval(askTimer);
    askTimer = null;
  }
}

function startAskPolling() {
  stopAskPolling();
  fetchAskCount();
  askTimer = setInterval(fetchAskCount, 30000);
}

function applyAskBeforeWatchedUi() {
  const wrap = wrapEl();
  if (!wrap) return;
  if (askEnabled) {
    wrap.style.display = "";
    startAskPolling();
  } else {
    wrap.style.display = "none";
    closeAskMenu();
    stopAskPolling();
    const b = badgeEl();
    if (b) b.style.display = "none";
  }
}

async function fetchAskCount() {
  if (!askEnabled) return;
  try {
    const r = await fetch("/api/asks/count", { cache: "no-store" });
    const j = await r.json();
    const c = (j && j.count) || 0;
    const b = badgeEl();
    if (!b) return;
    b.textContent = c > 99 ? "99+" : String(c);
    b.style.display = c > 0 ? "" : "none";
  } catch (_) {}
}

function askThumb(a) {
  const src = a.thumbnail_local || a.poster_local || "";
  if (src) return `<img class="ask-poster-img" src="${escAttr(src)}" alt="" loading="lazy" onerror="this.style.display='none'" />`;
  const first = (a.title || "?").trim().charAt(0).toUpperCase();
  return `<div class="ask-poster-fallback">${escAttr(first || "?")}</div>`;
}

function askItem(a) {
  const resolved = Number(a.resolved || 0);
  const unread = resolved === 0;
  const kind = notifMediaKind(a, null);
  const marker = resolved === 1
    ? `<span class="ask-mark ask-mark-yes">${CHECK_SVG}</span>`
    : resolved === 2
      ? `<span class="ask-mark ask-mark-no">${ASK_X_SVG}</span>`
      : "";
  const pill = notifTypePill(kind);
  // Bekleyen kart (v1.76 duzeni): hap posterin 5px altinda, Evet/Hayir ortada.
  const thumb = unread ? `${askThumb(a)}${pill}` : askThumb(a);
  // Cozumlenmis kart: tip hapi ile tick/x AYNI alt seritte (hap solda = poster hizasi,
  // isaret sagda) -> kart yuksekligi artmaz, satirlar hizali gorunur.
  const foot = unread
    ? `<div class="ask-actions"><button class="ask-btn ask-yes" data-id="${a.id}">${t("ask_yes")}</button><button class="ask-btn ask-no" data-id="${a.id}">${t("ask_no")}</button></div>`
    : `<div class="ask-foot">${pill}<span class="ask-actions ask-resolved">${marker}</span></div>`;
  return `
    <div class="notif-item ask-item${unread ? " unread" : ""}" data-id="${a.id}" data-resolved="${resolved}" data-media="${kind}">
      <div class="ask-poster">${thumb}</div>
      <div class="ask-content">
        ${notifTitleLine(a.title)}
        <div class="ask-msg">${notifMsgHTML(a.message || "", a.title || "")}</div>
        ${unread ? foot : ""}
      </div>
      ${unread ? "" : foot}
    </div>`;
}

function renderAskList() {
  const list = listEl();
  const empty = emptyEl();
  if (!list) return;
  if (!askCache.length) {
    list.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }
  if (empty) empty.style.display = "none";
  list.innerHTML = askCache.map(askItem).join("");
  list.querySelectorAll(".ask-btn").forEach((b) => {
    b.addEventListener("click", () => resolveAsk(Number(b.dataset.id), b.classList.contains("ask-yes")));
  });
}

async function fetchAskList() {
  const list = listEl();
  if (!list) return;
  list.innerHTML = `<div style="padding:12px;text-align:center;color:#6b7180">${t("loading") || "Yükleniyor..."}</div>`;
  try {
    const r = await fetch("/api/asks", { cache: "no-store" });
    const j = await r.json();
    askCache = (j && j.asks) || [];
  } catch (_) {
    askCache = [];
  }
  renderAskList();
}

async function resolveAsk(id, yes) {
  const url = yes ? `/api/asks/${id}/approve` : `/api/asks/${id}/reject`;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    let j = {};
    try { j = await r.json(); } catch (_) { j = {}; }
    if (!r.ok) {
      toast((j && j.error) || t("error"), true);
      return;
    }
    fetchAskList();
    fetchAskCount();
  } catch (e) {
    toast(t("error"), true);
  }
}

async function refreshAskEnabled() {
  try {
    const r = await fetch("/api/settings", { cache: "no-store" });
    const j = await r.json();
    askEnabled = !!((j && (j.ask_before_watched || "1")) !== "0");
  } catch (_) {
    askEnabled = true;
  }
  applyAskBeforeWatchedUi();
}

function init() {
  const btn = btnEl();
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (askMenuOpen()) closeAskMenu();
    else openAskMenu();
  });
  const clearBtn = document.getElementById("ask-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAskClearConfirm(t("ask_clear_confirm") || "Tüm izlendi bilgileri silinsin mi?", async () => {
        try { await fetch("/api/asks", { method: "DELETE" }); } catch (_) {}
        fetchAskList();
        fetchAskCount();
      });
    });
  }
  document.addEventListener("click", (e) => {
    if (askMenuOpen() && !e.target.closest(".watched-ask-wrap") && !e.target.closest("#watched-ask-menu")) {
      closeAskMenu();
    }
  }, true);
  window.addEventListener("resize", () => {
    if (askMenuOpen()) alignAskMenu();
  });
  // Sekmeye donunce/odaklaninca rozeti (ve acik panel listesini) aninda tazele
  const refreshOnReturn = () => {
    if (document.hidden || !askEnabled) return;
    fetchAskCount();
    if (askMenuOpen()) fetchAskList();
  };
  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);
  refreshAskEnabled();
}

// settings.js ve tv.js icin kucuk kuresel kopru
window.applyAskBeforeWatchedUi = applyAskBeforeWatchedUi;
window.setAskEnabled = (v) => { askEnabled = !!v; applyAskBeforeWatchedUi(); };
window.askMenuOpen = askMenuOpen;
window.openAskMenu = openAskMenu;
window.closeAskMenu = closeAskMenu;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export { askMenuOpen, openAskMenu, closeAskMenu, applyAskBeforeWatchedUi };