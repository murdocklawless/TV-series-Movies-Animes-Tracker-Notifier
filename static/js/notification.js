// notification.js — bildirim merkezi (buton, pencere, liste, rozet)
import { state } from "./state.js";
import { t } from "./i18n.js";
import { escAttr } from "./utils.js";
import { showConfirm } from "./components.js";
import { closeSortMenu } from "./views.js";
import { closeSettingsMenu } from "./settings.js";

const badgeEl = () => document.getElementById("notif-badge");
const menuEl = () => document.getElementById("notif-menu");
const listEl = () => document.getElementById("notif-list");
const emptyEl = () => document.getElementById("notif-empty");
const btnEl = () => document.getElementById("tab-notif");

function alignMenu() {
  const menu = menuEl();
  if (!menu) return;
  // utils sağ kenarı = #tab-settings sağ border kenarı, menu right:0 ile hizalı (desktop + mobil)
  menu.style.right = "0";
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return t("notif_just_now") || "Az önce";
  if (diffMins < 60) return `${diffMins} dk`;
  const diffH = Math.floor(diffMins / 60);
  if (diffH < 24) return t("notif_hours_ago") ? t("notif_hours_ago").replace("{n}", diffH) : `${diffH} saat önce`;
  try {
    const loc = (state.currentTz && state.currentLang) ? state.currentLang : "tr-TR";
    return new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch { return d.toLocaleString(); }
}

async function fetchCount() {
  try {
    const r = await fetch("/api/notifications/count?unread=1");
    const j = await r.json();
    const c = j.count || 0;
    const b = badgeEl();
    if (!b) return;
    if (c > 0) {
      b.textContent = c > 99 ? "99+" : String(c);
      b.style.display = "";
    } else {
      b.style.display = "none";
    }
  } catch {}
}

async function fetchList() {
  const list = listEl();
  const empty = emptyEl();
  if (!list) return;
  list.innerHTML = `<div style="padding:12px;text-align:center;color:#6b7180">${t("loading")||"Yükleniyor..."}</div>`;
  try {
    const r = await fetch("/api/notifications?limit=50");
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) {
      list.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";
    list.innerHTML = "";
    data.forEach((n) => {
      const div = document.createElement("div");
      div.className = "notif-item" + (n.is_read ? "" : " unread");
      div.dataset.id = n.id;
      const thumb = n.thumbnail_local || n.poster_local || "";
      const thumbHtml = thumb ? `<img class="notif-thumb" src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none'" />` : `<div class="notif-thumb-fallback"><i class="fa-solid fa-image"></i></div>`;
      div.innerHTML = `
        ${thumbHtml}
        <div class="notif-content">
          <div class="notif-title">${escAttr(n.title||"")}</div>
          <div class="notif-message">${escAttr(n.message||"")}</div>
          <div class="notif-time">${formatTime(n.created_at)}</div>
        </div>
      `;
      div.onclick = async () => {
        if (!n.is_read) {
          await fetch(`/api/notifications/${n.id}/read`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({is_read:1}) });
          n.is_read = 1;
          div.classList.remove("unread");
          fetchCount();
        }
      };
      list.appendChild(div);
    });
  } catch (e) {
    list.innerHTML = `<div style="padding:12px;color:#f87171">${t("data_failed")||"Veri alınamadı"}</div>`;
  }
}

function closeMenu() {
  const m = menuEl();
  if (m) m.classList.remove("open");
  const btn = btnEl();
  if (btn) btn.classList.remove("active");
}

function openMenu() {
  const m = menuEl();
  const btn = btnEl();
  if (!m || !btn) return;
  const isOpen = m.classList.contains("open");
  // close others
  try {
    closeSortMenu();
    closeSettingsMenu();
  } catch {}
  if (isOpen) {
    m.classList.remove("open");
    btn.classList.remove("active");
  } else {
    btn.classList.add("active");
    m.classList.add("open");
    alignMenu();
    fetchList();
  }
}

function init() {
  const btn = btnEl();
  const menu = menuEl();
  if (!btn || !menu) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    openMenu();
  };
  // mark all read
  const markBtn = document.getElementById("notif-mark-all");
  if (markBtn) {
    markBtn.onclick = async (e) => {
      e.stopPropagation();
      await fetch("/api/notifications/read-all", { method: "POST" });
      // update UI
      document.querySelectorAll(".notif-item.unread").forEach(el=>el.classList.remove("unread"));
      fetchCount();
    };
  }
  const clearBtn = document.getElementById("notif-clear");
  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      showConfirm(t("notif_clear_confirm") || "Tüm bildirimler silinsin mi?", async () => {
        await fetch("/api/notifications", { method: "DELETE" });
        fetchList();
        fetchCount();
      }, { title: t("notif_clear_title") });
    };
  }
  // capture fazında: stopPropagation'lı butonlarda (tab-sort, tab-settings vb.) bile dış tık paneli kapatır
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".notif-wrap") && !e.target.closest("#notif-menu")) closeMenu();
  }, true);
  window.addEventListener("resize", () => {
    if (menu.classList.contains("open")) alignMenu();
  });
  fetchCount();
  // poll every 60s
  setInterval(fetchCount, 60000);
}

// auto init when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export { fetchCount, fetchList, closeMenu };
