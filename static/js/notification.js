// notification.js — bildirim merkezi (buton, pencere, liste, rozet)
import { state } from "./state.js";
import { t } from "./i18n.js?v=523";
import { escAttr, tzLocale } from "./utils.js?v=519";
import { openNotifClearConfirm } from "./components.js?v=524";
import { closeSettingsMenu, showSettingsSubmodal } from "./settings.js?v=542";
import { isAdmin, loadAdminLists } from "./auth.js?v=520";

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

// Tam tarih ve saat: secili tz'nin ULKE YERELINE gore (tarih sirasi + saat bicimi;
// 12/24 saat zorlanmaz -> AM/PM kullanan ulkeler kendi bicimini gorur).
function formatAbsolute(d) {
  const loc = tzLocale();
  const tz = state.currentTz;
  const mk = (o) => (tz ? Object.assign({ timeZone: tz }, o) : o);
  try {
    const dv = new Intl.DateTimeFormat(loc, mk({ day: "2-digit", month: "2-digit", year: "numeric" })).format(d);
    const tm = new Intl.DateTimeFormat(loc, mk({ hour: "2-digit", minute: "2-digit" })).format(d);
    return `${dv}-${tm}`;
  } catch (_) {
    try { return d.toLocaleString(); } catch (_) { return ""; }
  }
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (state.notifTimeFormat === "absolute") {
    try {
      return formatAbsolute(d);
    } catch {}
    return d.toLocaleString();
  }
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

// ---- Tip kimligi: bildirim/ask satirlarinin hapi, ismi ve mesaj renkleri ----
// tv | movie | doc | anime
export function notifMediaKind(row, typeName) {
  const mt = ((row && row.media_type) || "").toLowerCase();
  const tn = String(typeName || "");
  if (mt === "anime") return "anime";
  if (tn.indexOf("doc_") === 0) return "doc";
  if (row && row.is_doc) return "doc";
  return mt === "movie" ? "movie" : "tv";
}

function notifKindLabel(kind) {
  if (kind === "doc") return t("type_doc");
  if (kind === "anime") return t("tab_anime");
  if (kind === "movie") return t("type_movie");
  return t("type_tv");
}

// Posterin 5px altinda, postere gore ortalanan tip hapi (CSS: .notif-type-pill)
export function notifTypePill(kind) {
  return `<span class="notif-type-pill pill-${kind}">${escAttr(notifKindLabel(kind))}</span>`;
}

// Mesaj metni: yapim ismi + "N. Sezon / N. Bölüm" renklenir; S02E08 -> "2. Sezon 8. Bölüm".
// Eski ve yeni kayitlar ayni sekilde gorunur (veri gocu gerekmez).
export function notifMsgHTML(text, title, stampLine) {
  let s = String(text == null ? "" : text);
  const tRaw = String(title || "").trim();
  // 1) Yapim ismini mesajdan kaldir: isim yalnizca .notif-title satirinda gosterilir.
  //    a) "<isim> isimli dizi(nin)/film(i)/belgesel(in)/anime(yi) ..." -> parca (+ varsa " de ") silinir
  //    b) basdaki "<isim> " (bildirim merkezi) silinir
  if (tRaw) {
    const idx = s.indexOf(tRaw);
    if (idx >= 0) {
      const after = s.slice(idx + tRaw.length);
      let cut = 0;
      // "isimli dizinin/belgeselin/animenin <N>. Sezon ..." -> tur de silinir (tam parca)
      const poss = after.match(/^\s+isimli\s+(dizinin|belgeselin|animenin)\s+(?=\d+\.\s)/i);
      if (poss) cut = poss[0].length;
      else {
        // "... isimli filmi/diziyi/animeyi/belgeseli ..." -> yalniz "isimli" silinir, tur kalir
        const any = after.match(/^\s+isimli\s+/i);
        if (any) cut = any[0].length;
      }
      if (cut > 0) {
        let head = s.slice(0, idx);
        head = head.replace(/\s+de\s+$/i, " ");
        s = head + after.slice(cut);
      } else if (idx === 0) {
        s = after.replace(/^\s+/, "");
      }
    }
  }
  // 2) S02E08 -> 2. Sezon 8. Bölüm (ham metinde; push sablonlarina dokunulmaz)
  s = s.replace(/\bS(\d{1,2})\s?E(\d{1,2})\b/g, (_m, a, b) => `${Number(a)}. Sezon ${Number(b)}. Bölüm`);
  // 3) Ask damgasi (varsa): ilk satir verilen yerel bicimle degistirilir ve metin
  //    2 satira ayrilir -> "<tarih> - <gun> - <saat>" / "<govde> izlediniz mi?"
  let lines = null;
  const mStamp = s.match(/^(\d{2}\.\d{2}\.\d{4})(?:\s+tarihinde\s+saat\s+| - )(\d{2}:\d{2})(?:\s+de)?\s*/);
  if (mStamp) {
    const line1 = stampLine || `${mStamp[1]} - ${mStamp[2]}`;
    // "İzlendi bilgisi eklensin mi?" cumlesi kaldirilir (govde zaten soruya cevrilir)
    let rest = s.slice(mStamp[0].length).replace(/İzlendi bilgisi eklensin mi\?\s*$/, "").trim();
    // Satirlar tek govdeye indirgenir (yeni backend formati tek satir verir)
    let body = rest.split(/\n+/).map((x) => x.trim()).filter((x) => x).join(" ").trim();
    // "izlediniz." -> "izlediniz mi?" (yeni format zaten "mi?" ile biter, dokunulmaz)
    body = body.replace(/izlediniz\.?\s*$/, "izlediniz mi?");
    lines = body ? [line1, body] : [line1];
  }
  // 4) kacis (HTML enjeksiyonu yok) + satirlar <br> ile birlestirilir
  let srcLines;
  if (lines) srcLines = lines;
  else if (s.indexOf("\n") >= 0) srcLines = s.split(/\n+/).map((x) => x.trim()).filter((x) => x);
  else srcLines = [s];
  let html = srcLines.map((x) => escAttr(x)).join("<br>");
  // 5) mesajda kalinti isim varsa tip rengiyle isaretle (nadir; isim normalde ust satirda)
  const tEsc = title ? escAttr(String(title)) : "";
  if (tEsc) {
    const i = html.indexOf(tEsc);
    if (i >= 0) html = html.slice(0, i) + `<span class="hl-title">${tEsc}</span>` + html.slice(i + tEsc.length);
  }
  // 6) "N. Sezon" teal + "N. Bölüm(ü/ünü...)" violet (kart rozet renkleriyle ayni;
  //    anime mesajindaki kucuk harfli "4. bölümünü" de kapsar)
  html = html.replace(/(\d+\.\s*Sezon[\wÇĞİÖŞÜçğıöşü]*)/gi, `<span class="hl-season">$1</span>`);
  html = html.replace(/(\d+\.\s*Bölüm[\wÇĞİÖŞÜçğıöşü]*)/gi, `<span class="hl-ep">$1</span>`);
  return html;
}

// Yapim ismi satiri (bildirim merkezi + ask karti ayni stili paylasir)
export function notifTitleLine(title) {
  const s = String(title || "");
  return s ? `<div class="notif-title">${escAttr(s)}</div>` : "";
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
    const limit = Number(state.notifCenterLimit) > 0 ? Number(state.notifCenterLimit) : 50;
    // hide-read acikken filtre sunucuda yapilir: limit = gorunen okunmamis sayisi
    const url = state.notifCenterHideRead
      ? `/api/notifications?limit=${limit}&unread=1`
      : `/api/notifications?limit=${limit}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!Array.isArray(data)) {
      list.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    const rows = data;
    if (!rows.length) {
      list.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";
    list.innerHTML = "";
    rows.forEach((n) => {
      const div = document.createElement("div");
      div.className = "notif-item" + (n.is_read ? "" : " unread");
      div.dataset.id = n.id;
      if (n.type) div.dataset.ntype = n.type;
      // Tip kimligi (hap + isim rengi): belgesel = doc_ tipleri veya is_doc
      const kind = notifMediaKind(n, n.type);
      const hasMedia = !!(n.media_type || String(n.type || "").indexOf("doc_") === 0);
      if (hasMedia) div.dataset.media = kind;
      let thumbHtml = "";
      if (state.notifCenterPoster) {
        const thumb = n.thumbnail_local || n.poster_local || "";
        if (thumb) {
          thumbHtml = `<img class="notif-thumb" src="${thumb}" alt="" loading="lazy" onerror="this.style.display='none'" />`;
        } else if (n.type === "role_admin" || n.type === "role_member" || n.type === "password_reset" || n.type === "member_pending") {
          thumbHtml = `<img class="notif-thumb notif-thumb-logo" src="/static/images/nextep_web_ui_logo.png" alt="" loading="lazy" onerror="this.style.display='none'" />`;
        } else {
          thumbHtml = `<div class="notif-thumb-fallback"><i class="fa-solid fa-image"></i></div>`;
        }
      }
      // Poster + tip hapi (hap, poster kapaliyken de gosterilir; postere gore ortali)
      const pillHtml = hasMedia ? notifTypePill(kind) : "";
      const colHtml = (thumbHtml || pillHtml) ? `<div class="notif-thumbcol">${thumbHtml}${pillHtml}</div>` : "";
      div.innerHTML = `
        ${colHtml}
        <div class="notif-content">
          <div class="notif-title">${escAttr(n.title||"")}</div>
          <div class="notif-message">${notifMsgHTML(n.message||"", n.title||"")}</div>
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
        // Uyelik bildirimi + admin: dogrudan onay bloguna (modal en alta kayar).
        try {
          if ((n.type === "member_pending" || n.type === "password_reset") && isAdmin()) {
            closeMenu();
            try { closeSortMenu(); } catch (_) {}
            try { closeSettingsMenu(); } catch (_) {}
            await showSettingsSubmodal("settings-admin-modal");
            setTimeout(() => { try { loadAdminLists(); } catch (_) {} }, 30);
            setTimeout(() => {
              try {
                const w = document.getElementById("admin-pending-wrap");
                if (w) w.scrollIntoView({ block: "nearest" });
              } catch (_) {}
            }, 120);
          }
        } catch (_) {}
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
  try {
    if (window.closeAskMenu) window.closeAskMenu();
  } catch (_) {}
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
      openNotifClearConfirm(t("notif_clear_confirm") || "Tüm bildirimler silinsin mi?", async () => {
        await fetch("/api/notifications", { method: "DELETE" });
        fetchList();
        fetchCount();
      });
    };
  }
  // capture fazında: stopPropagation'lı butonlarda (tab-sort, tab-settings vb.) bile dış tık paneli kapatır
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".notif-wrap") && !e.target.closest("#notif-menu")) closeMenu();
  }, true);
  window.addEventListener("resize", () => {
    if (menu.classList.contains("open")) alignMenu();
  });
  // Sekmeye donunce/odaklaninca rozeti (ve acik panel listesini) aninda tazele
  const refreshOnReturn = () => {
    if (document.hidden) return;
    fetchCount();
    if (menu.classList.contains("open")) fetchList();
  };
  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);
  fetchCount();
  // poll every 30s
  setInterval(fetchCount, 30000);
}

// auto init when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export { fetchCount, fetchList, closeMenu };
