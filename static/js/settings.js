// Faz 4: settings — ayarlar menüsü, zaman dilimi / saat seçicileri, favori listeleri, otomatik kaydetme, bildirim anahtarları.
import { state } from "./state.js";
import { t, checkTmdbKey, applyLang, errText } from "./i18n.js?v=660";
import { toast, escAttr, CHECK_SVG, HEART_SVG, ROLE_X_SVG, ROLE_PAUSE_SVG, ROLE_PLAY_SVG } from "./utils.js?v=660";
import { activateUtilityTab } from "./views.js?v=660";
import { openStremioDisconnectConfirm, openRemoteDisconnectConfirm, openRemotePeerDeleteConfirm, openStremioInstallModal, closeStremioInstallModal, openStremioTunnelRemoveConfirm, openRemoteResetConfirm, openCalendarDisconnectConfirm, openPlexDisconnectConfirm, openJellyfinDisconnectConfirm, openEmbyDisconnectConfirm } from "./components.js?v=660";

// 2.18: cift modul yuklemesine karsi tek-seferlik baglama korumasi.
// Ayni modul iki farkli ?v= URL'si ile yuklenirse (cache-buster zinciri kirilirsa)
// modul govdesindeki toggle dinleyicileri iki kez baglaniyor ve birbirini iptal
// ediyordu (disli menusu / akordeonlar acilip aninda kapaniyordu). nxOnce ayni
// anahtarin yalniz bir kez baglanmasini garanti eder.
function nxOnce(key) {
  try {
    const k = "__nx_" + key;
    if (window[k]) {
      try { console.warn("[nx] cift modul yuklemesi: " + key); } catch (_) {}
      return false;
    }
    window[k] = 1;
  } catch (_) {}
  return true;
}

// ---- Search ----
// ---- Settings ----

// Bildirim tipleri — py/scheduler.py NOTIF_TYPES ile birebir aynı
const NOTIF_TYPES = [
  ["episode_today", "tv"], ["season_start", "tv"], ["season_planned", "tv"],
  ["season_production", "tv"], ["status_ended", "tv"], ["status_canceled", "tv"],
  ["status_pilot", "tv"], ["status_returning", "tv"], ["season_upcoming", "tv"],
  ["unwatched_bulk", "tv"], ["vote_threshold", "tv"],
  ["movie_today", "movie"], ["movie_rescheduled", "movie"], ["networks_changed", "movie"],
  ["doc_movie_today", "belgesel"], ["doc_movie_rescheduled", "belgesel"], ["doc_networks_changed", "belgesel"],
  ["doc_episode_today", "belgesel"], ["doc_season_start", "belgesel"], ["doc_season_planned", "belgesel"],
  ["doc_season_production", "belgesel"], ["doc_status_ended", "belgesel"], ["doc_status_canceled", "belgesel"],
  ["doc_status_pilot", "belgesel"], ["doc_status_returning", "belgesel"], ["doc_season_upcoming", "belgesel"],
  ["doc_unwatched_bulk", "belgesel"], ["doc_vote_threshold", "belgesel"],
  ["anime_episode_today", "anime"], ["anime_hiatus", "anime"], ["anime_cancelled", "anime"],
  ["anime_finished", "anime"], ["anime_releasing", "anime"],   ["anime_episodes", "anime"],
  ["anime_unwatched_bulk", "anime"],
  ["member_pending", "member"], ["password_reset", "member"],
];
const NOTIF_GROUPS = [["tv", "notif_group_tv"], ["movie", "notif_group_movie"], ["belgesel", "notif_group_belgesel"], ["anime", "notif_group_anime"], ["member", "notif_group_member"]];

function setNotifTypeVisible(group, on) {
  const box = document.getElementById(`notif-type-box-${group}`);
  if (!box) return;
  const body = box.querySelector(".notif-type-body");
  if (!body) return;
  body.style.display = on ? "" : "none";
  box.classList.toggle("accordion-open", on);
}

function renderNotifTypes() {
  const wrap = document.getElementById("notif-types-groups");
  if (!wrap) return;
  wrap.innerHTML = NOTIF_GROUPS.map(([g, label]) => `
    <div class="channel-box accordion-box notif-type-box" id="notif-type-box-${g}">
      <div class="notif-type-head">
        <span class="notif-type-title" data-i18n="${label}">${escAttr(t(label))}</span>
      </div>
      <div class="notif-type-body" style="display:none">
        ${NOTIF_TYPES.filter(([, gg]) => gg === g).map(([k]) => `
          <div class="notify-row notify-type-row">
            <span class="notify-name"><span data-i18n="notif_type_${k}">${escAttr(t("notif_type_" + k))}</span></span>
            <span class="notif-switch-area"><span class="saved-hint" data-i18n="saved">${escAttr(t("saved"))}</span><label class="switch"><input type="checkbox" id="s-notif-${k}" checked /><span class="slider"></span></label></span>
          </div>`).join("")}
      </div>
    </div>`).join("");
  NOTIF_TYPES.forEach(([k]) => {
    document.getElementById(`s-notif-${k}`).addEventListener("change", (e) => {
      const hint = e.target.closest(".notify-row").querySelector(".saved-hint");
      saveSettingsPartial({ [`notif_${k}`]: e.target.checked ? "1" : "0" }, hint);
    });
  });
  // Tek grup açık: bir head'e tiklaninca digerleri kapanir
  NOTIF_GROUPS.forEach(([g]) => {
    const box = document.getElementById(`notif-type-box-${g}`);
    if (!box) return;
    box.addEventListener("click", (e) => {
      if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("button") || e.target.closest("a")) return;
      const isOpen = box.querySelector(".notif-type-body").style.display !== "none";
      NOTIF_GROUPS.forEach(([gg]) => setNotifTypeVisible(gg, !isOpen && gg === g));
    });
  });
}

async function loadTimezones() {
  try {
    const res = await fetch("/api/timezones");
    state.allTimezones = await res.json();
  } catch (e) {
    console.error("timezone yükleme hatası", e);
  }
}

function renderTzList(query) {
  const list = document.getElementById("s-tz-list");
  const q = (query || "").toLowerCase().trim();
  const matches = q
    ? state.allTimezones.filter((z) => z.value.toLowerCase().includes(q))
    : state.allTimezones;
  list.innerHTML = matches
    .map((z) => `<button type="button" class="tz-cell" data-tz="${z.value}">${z.value}</button>`)
    .join("");
  list.style.display = matches.length ? "block" : "none";
  if (matches.length) {
    ensureModalRoom(list, list.scrollHeight + 16);
  } else {
    releaseModalRoom(list);
  }
  tzHlIndex = -1;
  // mousedown + preventDefault: input focus'u korunur (blur -> native change ile
  // ham filtre metninin kaydedilmesi engellenir), click yutulma riski olmaz
  list.querySelectorAll("[data-tz]").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pickTz(el);
    });
  });
}

let tzHlIndex = -1;
// Aktif saat penceresi (tek seferde yalniz bir saat picker acik kalir)
let activeTimeList = null;

function initTimePicker(base) {
  const input = document.getElementById(base);
  const box = input.closest(".time-combobox");
  const list = box.querySelector(".time-list");
  const cols = list.querySelectorAll(".time-col");
  const hourBody = cols[0].querySelector(".time-col-body");
  const minuteBody = cols[1].querySelector(".time-col-body");
  const clock = box.querySelector(".time-clock");
  let open = false;
  let lastHourValue = input.value || "09:00";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function render() {
    const cur = input.value || "09:00";
    const parts = cur.split(":");
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    if (isNaN(m) || m < 0 || m > 59) m = 0;

    hourBody.innerHTML = "";
    for (let i = 0; i < 24; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time-cell" + (i === h ? " selected" : "");
      const span = document.createElement("span");
      span.className = "time-num";
      span.textContent = pad(i);
      btn.appendChild(span);
      btn.onclick = (e) => {
        e.stopPropagation();
        pickHour(i);
      };
      hourBody.appendChild(btn);
    }
    minuteBody.innerHTML = "";
    for (let i = 0; i < 60; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time-cell" + (i === m ? " selected" : "");
      const span = document.createElement("span");
      span.className = "time-num";
      span.textContent = pad(i);
      btn.appendChild(span);
      btn.onclick = (e) => {
        e.stopPropagation();
        pickMinute(i);
      };
      minuteBody.appendChild(btn);
    }
  }

  function scrollSelectedIntoView() {
    const cur = input.value || "09:00";
    const parts = cur.split(":");
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    const sh = hourBody.children[h];
    if (sh) sh.scrollIntoView({ block: "center" });
    const sm = minuteBody.children[m];
    if (sm) sm.scrollIntoView({ block: "center" });
  }

  let picks = 0;

  function closeList() {
    list.style.display = "none";
    open = false;
    try {
      if (list.closest("#feed-schedule-body") && typeof releaseModalRoom === "function") {
        releaseModalRoom(list);
      }
    } catch (_) {}
    if (activeTimeList && activeTimeList.list === list) activeTimeList = null;
  }

  function applyPick(val) {
    input.value = val;
    lastHourValue = val;
    picks++;
    if (picks >= 2) {
      closeList();
      input.dispatchEvent(new Event("change"));
    } else {
      render();
      scrollSelectedIntoView();
    }
  }

  function pickHour(i) {
    const parts = input.value.split(":");
    let m = parseInt(parts[1], 10);
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    applyPick(pad(i) + ":" + pad(m));
  }

  function pickMinute(i) {
    const parts = input.value.split(":");
    let h = parseInt(parts[0], 10);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    applyPick(pad(h) + ":" + pad(i));
  }

  function toggle() {
    if (input.disabled) return;
    if (!open) {
      // Acik olan baska bir saat penceresi varsa once onu kapat
      if (activeTimeList && activeTimeList.list !== list && typeof activeTimeList.close === "function") {
        try { activeTimeList.close(); } catch (_) {}
      }
      picks = 0;
      render();
      list.style.display = "flex";
      scrollSelectedIntoView();
      open = true;
      list.scrollIntoView({ block: "nearest" });
      try {
        if (list.closest("#feed-schedule-body") && typeof ensureModalRoom === "function") {
          ensureModalRoom(list, list.scrollHeight + 16);
        }
      } catch (_) {}
      activeTimeList = { list: list, close: closeList };
    } else {
      closeList();
    }
  }

  clock.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  input.addEventListener("blur", () => {
    const v = input.value.trim();
    const m = v.match(/^(\d{1,2}):(\d{1,2})$/);
    if (m) {
      const h = parseInt(m[1], 10);
      const mn = parseInt(m[2], 10);
      if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) {
        const norm = pad(h) + ":" + pad(mn);
        if (norm !== input.value) input.value = norm;
        lastHourValue = norm;
      } else {
        input.value = lastHourValue;
      }
    } else {
      input.value = lastHourValue;
    }
  });
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target)) closeList();
  });
}

function pickTz(el) {
  const input = document.getElementById("s-tz");
  const list = document.getElementById("s-tz-list");
  if (!el || !el.dataset || !el.dataset.tz || list.style.display === "none") return;
  input.value = el.dataset.tz;
  closeTzList();
  input.dispatchEvent(new Event("change"));
}

function closeTzList() {
  const list = document.getElementById("s-tz-list");
  if (list.style.display !== "none") {
    list.style.display = "none";
    releaseModalRoom(list);
  }
}

// MERKEZLİ BÜYÜME: liste açılınca modal iki yöne büyür ve overlay'in doğal
// align-items:center'ı ile dikey ortalanır (eski flex-start anchor + marginTop
// dengelemesi kaldırıldı — aşağı-büyü modeli ekran altından taşıyordu).
// Hedef yükseklik ekranın üst/alt boşluğuna clamp'lenir; taşan kısım listenin
// kendi içi scroll'una kalır (inline maxHeight, her açılışta taze hesaplanır).
// TEK AKTİF PULLDOWN: yeni liste açılınca öncekinin odası tabana indirilir;
// kapanınca body minHeight overlay'in kaydettiği TABAN değere döner.
let activePdList = null;

function ensureModalRoom(list, desired) {
  const body = list.closest(".modal-body");
  const overlay = list.closest(".modal-overlay");
  if (!body || !overlay) return;
  if (activePdList && activePdList !== list) {
    delete activePdList.dataset.pdAnchored;
    activePdList = null;
    body.style.minHeight = overlay.dataset.pdBaseMinH || "";
  }
  if (!activePdList) {
    // taban yalnızca overlay TAMAMEN serbestken yakalanır (takeover kirlenmesi)
    if (!overlay.dataset.pdRoomOpen) {
      overlay.dataset.pdBaseMinH = body.style.minHeight || "";
      overlay.dataset.pdRoomOpen = "1";
    }
    list.dataset.pdAnchored = "1";
    activePdList = list;
  }
  // MOBIL: s-tz-list modal alt sınırına kadar uzasın (desktop gMax clamp'i atla)
  if (window.innerWidth <= 768 && list.id === "s-tz-list") {
    const relTopM = Math.round(list.getBoundingClientRect().top - body.getBoundingClientRect().top);
    const viewportAvail = window.innerHeight - list.getBoundingClientRect().top - 24;
    const avail = Math.max(160, viewportAvail);
    const h = Math.max(160, Math.min(avail, desired));
    list.style.maxHeight = h + "px";
    const neededM = relTopM + h;
    if (neededM > body.offsetHeight) body.style.minHeight = neededM + "px";
    return;
  }
  // DESKTOP: s-tz-list alt border'ı modal alt sınırına yapışsın (mobil gibi)
  if (window.innerWidth > 768 && list.id === "s-tz-list") {
    const relTopD = Math.round(list.getBoundingClientRect().top - body.getBoundingClientRect().top);
    const viewportAvailD = window.innerHeight - list.getBoundingClientRect().top - 24;
    const availD = Math.max(160, viewportAvailD);
    const hD = Math.max(160, Math.min(availD, desired));
    list.style.maxHeight = hD + "px";
    const neededD = relTopD + hD;
    if (neededD > body.offsetHeight) body.style.minHeight = neededD + "px";
    return;
  }
  const bodyRect = body.getBoundingClientRect();
  // merkezleme büyümeyi iki yarıya böldüğü için her yönün payı 2 kat sayılır
  const gMax = Math.max(120, Math.min(
    2 * (window.innerHeight - 24 - bodyRect.bottom),
    2 * (bodyRect.top - 24)
  ));
  const target = Math.min(Math.max(desired, 0), gMax);
  if (target <= 0) return;
  list.style.maxHeight = Math.max(120, target - 16) + "px";
  // relTop merkezlemeden etkilenmez (body içi göreç konum)
  const relTop = Math.round(list.getBoundingClientRect().top - bodyRect.top);
  const needed = relTop + target;
  if (needed > body.offsetHeight) {
    body.style.minHeight = needed + "px";
  }
}

function releaseModalRoom(list) {
  if (!list || !list.dataset.pdAnchored) return;
  const overlay = list.closest(".modal-overlay");
  const body = list.closest(".modal-body");
  delete list.dataset.pdAnchored;
  if (activePdList === list) activePdList = null;
  if (!body || !overlay) return;
  body.style.minHeight = overlay.dataset.pdBaseMinH || "";
  delete overlay.dataset.pdBaseMinH;
  delete overlay.dataset.pdRoomOpen;
}

function initTzCombo() {
  const input = document.getElementById("s-tz");
  const list = document.getElementById("s-tz-list");
  input.addEventListener("focus", () => renderTzList(input.value));
  input.addEventListener("input", () => renderTzList(input.value));
  function tzRows() {
    return Array.from(list.querySelectorAll("[data-tz]"));
  }
  function setTzHl(i) {
    const rs = tzRows();
    if (!rs.length) { tzHlIndex = -1; return; }
    tzHlIndex = ((i % rs.length) + rs.length) % rs.length;
    rs.forEach((r, idx) => r.classList.toggle("hl", idx === tzHlIndex));
    rs[tzHlIndex].scrollIntoView({ block: "nearest" });
  }
  // Tab ile listeye giris: turuncu vurgu ilk satirdan (Africa/Abidjan) baslar
  input.addEventListener("keydown", (e) => {
    const open = list.style.display === "block" && list.querySelector("[data-tz]");
    if (!open) return;
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setTzHl(0);
      tzRows()[0].focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setTzHl(tzHlIndex < 0 ? 0 : tzHlIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setTzHl(tzHlIndex < 0 ? 0 : tzHlIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const rs = tzRows();
      const el = tzHlIndex >= 0 ? rs[tzHlIndex] : rs[0];
      pickTz(el);
    }
  });
  // Liste icinde klavye: oklar vurguyu tasir, Enter/Space secer, Tab listeyi
  // kapayip dogal odak akisina devam eder, Escape listeyi kapatir
  list.addEventListener("keydown", (e) => {
    const rs = tzRows();
    if (!rs.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setTzHl(e.key === "ArrowDown" ? (tzHlIndex < 0 ? 0 : tzHlIndex + 1) : (tzHlIndex < 0 ? 0 : tzHlIndex - 1));
      rs[tzHlIndex].focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickTz(rs[tzHlIndex >= 0 ? tzHlIndex : 0]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      closeTzList();
      input.focus();
    } else if (e.key === "Tab") {
      closeTzList();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tz-combobox")) {
      closeTzList();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTzList();
    }
  });
}

// pulldown-menu.md deseni: select tabanli ozel acilir pencere (native dropdown engellenir)
function initPulldownCombobox(selectId, listId) {
  const select = document.getElementById(selectId);
  const list = document.getElementById(listId);
  if (!select || !list) return;
  // Idempotent: ayni select'e ikinci kez baglanma (cift mousedown -> ac/kapa bug'i)
  if (select.dataset.pdInit === "1") return;
  select.dataset.pdInit = "1";

  let hlIndex = -1;
  function pdRows() {
    return Array.from(list.querySelectorAll(".provider-cell"));
  }
  function setHl(i) {
    const rs = pdRows();
    if (!rs.length) { hlIndex = -1; return; }
    hlIndex = ((i % rs.length) + rs.length) % rs.length;
    rs.forEach((r, idx) => r.classList.toggle("hl", idx === hlIndex));
    rs[hlIndex].scrollIntoView({ block: "nearest" });
  }
  function pickRow(row) {
    toggleList(false);
    const v = row.dataset.value;
    if (select.value !== v) {
      select.value = v;
      select.dispatchEvent(new Event("change"));
    }
  }

  function renderRows() {
    list.innerHTML = "";
    Array.from(select.options).forEach((opt) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "provider-cell" + (opt.value === select.value ? " selected" : "");
      row.dataset.value = opt.value;
      row.textContent = opt.textContent;
      row.onclick = (e) => {
        e.stopPropagation();
        pickRow(row);
      };
      list.appendChild(row);
    });
  }

  function toggleList(on) {
    const open = typeof on === "boolean" ? on : list.style.display !== "flex";
    if (open) {
      renderRows();
      list.style.display = "flex";
      ensureModalRoom(list, list.scrollHeight + 16);
      const rs = pdRows();
      const cur = rs.findIndex((r) => r.dataset.value === select.value);
      setHl(cur >= 0 ? cur : 0);
      select.focus();
    } else {
      list.style.display = "none";
      releaseModalRoom(list);
    }
  }

  select.addEventListener("mousedown", (e) => {
    e.preventDefault();
    toggleList();
  });
  select.addEventListener("keydown", (e) => {
    if (list.style.display !== "flex") {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        toggleList(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl(hlIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl(hlIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const rs = pdRows();
      if (hlIndex >= 0 && rs[hlIndex]) pickRow(rs[hlIndex]);
      else toggleList(false);
    } else if (e.key === "Escape") {
      toggleList(false);
    }
  });
  // kapanma karari basma aninda: modal kaymasindan etkilenmez (click kullanilmaz)
  document.addEventListener("mousedown", (e) => {
    if (!list.parentElement.contains(e.target)) toggleList(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggleList(false);
  });
}
// Oneriler beslemesi (feed) pulldown'lari icin views.js'e kopru
window.initPulldownCombobox = initPulldownCombobox;

// ---- Oneriler beslemesi (feed) haftalik zamanlama (kaynak basina gun+saat) ----
const FEED_SCHED_SOURCES = ["trend", "popular", "top_rated", "netflix", "hbo_max", "disney_plus", "paramount", "apple_tv", "prime_video", "amc", "random"];
const FEED_SCHED_DAYS = ["weekday_monday", "weekday_tuesday", "weekday_wednesday", "weekday_thursday", "weekday_friday", "weekday_saturday", "weekday_sunday"];
const FEED_SCHED_DEFAULT = {
  trend: { dow: 0, time: "04:00" }, popular: { dow: 0, time: "04:20" }, top_rated: { dow: 1, time: "04:00" },
  netflix: { dow: 1, time: "04:20" }, hbo_max: { dow: 2, time: "04:00" }, disney_plus: { dow: 2, time: "04:20" },
  paramount: { dow: 3, time: "04:00" }, apple_tv: { dow: 3, time: "04:20" }, prime_video: { dow: 4, time: "04:00" },
  amc: { dow: 4, time: "04:20" }, random: { dow: 5, time: "04:00" },
};
let feedScheduleBuilt = false;
function initFeedSchedule(scheduleJson) {
  const body = document.getElementById("feed-schedule-body");
  const toggle = document.getElementById("feed-schedule-toggle");
  if (!body || !toggle) return;
  let data = {};
  try { data = scheduleJson ? JSON.parse(scheduleJson) : {}; } catch (_) { data = {}; }
  if (!feedScheduleBuilt) {
    let html = "";
    FEED_SCHED_SOURCES.forEach((src) => {
      const dayOpts = FEED_SCHED_DAYS.map((k, i) => `<option value="${i}" data-i18n="${k}">${t(k)}</option>`).join("");
      html += `<div class="feed-sched-row" data-src="${src}">`
        + `<span class="feed-sched-name" data-i18n="feed_src_${src}">${t("feed_src_" + src)}</span>`
        + `<div class="provider-combobox feed-sched-day"><select id="feed-day-${src}" class="feed-select">${dayOpts}</select>`
        + `<div id="feed-day-${src}-list" class="provider-list" style="display:none"></div></div>`
        + `<div class="time-combobox feed-sched-time">`
        + `<input id="feed-time-${src}" type="text" value="04:00" autocomplete="off" spellcheck="false" data-lpignore="true" inputmode="numeric" />`
        + `<i class="fa-solid fa-clock time-clock"></i>`
        + `<div id="feed-time-${src}-list" class="time-list" style="display:none">`
        + `<div class="time-col"><div class="time-col-title" data-i18n="time_hour">${t("time_hour")}</div><div class="time-col-body" id="feed-time-${src}-hour-list"></div></div>`
        + `<div class="time-col"><div class="time-col-title" data-i18n="time_minute">${t("time_minute")}</div><div class="time-col-body" id="feed-time-${src}-minute-list"></div></div>`
        + `</div></div></div>`;
    });
    body.innerHTML = html;
    const commit = () => saveFeedSchedule();
    FEED_SCHED_SOURCES.forEach((src) => {
      initPulldownCombobox(`feed-day-${src}`, `feed-day-${src}-list`);
      initTimePicker(`feed-time-${src}`);
      const daySel = document.getElementById(`feed-day-${src}`);
      const timeEl = document.getElementById(`feed-time-${src}`);
      if (daySel) daySel.addEventListener("change", commit);
      if (timeEl) timeEl.addEventListener("change", commit);
    });
    toggle.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      const icon = toggle.querySelector("i");
      if (icon) icon.style.transform = open ? "" : "rotate(180deg)";
    });
    feedScheduleBuilt = true;
  }
  FEED_SCHED_SOURCES.forEach((src) => {
    const cfg = (data && data[src]) || FEED_SCHED_DEFAULT[src] || { dow: 0, time: "04:00" };
    const daySel = document.getElementById(`feed-day-${src}`);
    const timeEl = document.getElementById(`feed-time-${src}`);
    if (daySel) daySel.value = String(cfg.dow != null ? cfg.dow : 0);
    if (timeEl) timeEl.value = cfg.time || "04:00";
  });
}
function saveFeedSchedule() {
  const obj = {};
  FEED_SCHED_SOURCES.forEach((src) => {
    const daySel = document.getElementById(`feed-day-${src}`);
    const timeEl = document.getElementById(`feed-time-${src}`);
    obj[src] = { dow: daySel ? (parseInt(daySel.value, 10) || 0) : 0, time: timeEl ? timeEl.value : "04:00" };
  });
  const block = document.getElementById("feed-schedule-block");
  const hint = block ? (block.closest("label") || {}).querySelector ? block.closest("label").querySelector(".saved-hint") : null : null;
  saveSettingsPartial({ feed_schedule: JSON.stringify(obj) }, hint);
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  const s = await res.json();
  document.getElementById("s-tmdb").value = s.tmdb_api_key || "";
  document.getElementById("s-token").value = s.telegram_bot_token || "";
  document.getElementById("s-chat").value = s.telegram_chat_id || "";
  document.getElementById("s-notification-hour").value = s.notification_hour || "09:05";
  document.getElementById("s-sync-hour").value = s.sync_hour || "09:00";
  document.getElementById("s-genre-hour").value = s.genre_hour || "05:00";
  document.getElementById("s-data-hour").value = s.data_hour || "05:10";
  document.getElementById("s-backup-hour").value = s.backup_hour || "03:00";
  document.getElementById("s-appupdate-hour").value = s.app_update_hour || "04:00";
  document.getElementById("s-maint-hour").value = s.maint_hour || "05:45";
  const appAuto = document.getElementById("s-appupdate-auto");
  if (appAuto) appAuto.checked = (s.app_auto_update || "0") === "1";
  // yedekleme: mod (db/full) ve rsync/samba alanlari
  const bm = s.backup_mode || "";
  const dbSw = document.getElementById("s-backup-db");
  const fullSw = document.getElementById("s-backup-full");
  if (dbSw) dbSw.checked = bm === "db";
  if (fullSw) fullSw.checked = bm === "full";
  const rsH = document.getElementById("s-backup-rsync-host");
  if (rsH) rsH.value = s.backup_rsync_host || "";
  const rsP = document.getElementById("s-backup-rsync-port");
  if (rsP) rsP.value = s.backup_rsync_port || "";
  const rsPath = document.getElementById("s-backup-rsync-path");
  if (rsPath) rsPath.value = s.backup_rsync_path || "";
  const rsU = document.getElementById("s-backup-rsync-user");
  if (rsU) rsU.value = s.backup_rsync_user || "";
  const rsPass = document.getElementById("s-backup-rsync-cred");
  if (rsPass) rsPass.value = "";
  const rsKey = document.getElementById("s-backup-rsync-key-text");
  if (rsKey) rsKey.value = s.has_backup_key ? "••••••••" : "";
  rsKey.dataset.hasKey = s.has_backup_key ? "1" : "0";
  const smH = document.getElementById("s-backup-samba-host");
  if (smH) smH.value = s.backup_samba_host || "";
  const smP = document.getElementById("s-backup-samba-port");
  if (smP) smP.value = s.backup_samba_port || "";
  const smShare = document.getElementById("s-backup-samba-share");
  if (smShare) smShare.value = s.backup_samba_share || "";
  const smU = document.getElementById("s-backup-samba-user");
  if (smU) smU.value = s.backup_samba_user || "";
  const smPass = document.getElementById("s-backup-samba-cred");
  if (smPass) smPass.value = "";
  document.getElementById("s-ntfy").value = s.ntfy_topic || "";
  document.getElementById("s-discord-hook").value = s.discord_webhook_url || "";
  document.getElementById("s-brevo-cred").value = s.brevo_api_key || "";
  document.getElementById("s-email-from").value = s.email_from || "";
  document.getElementById("s-email-to").value = s.email_to || "";
  document.getElementById("s-email-provider").value = s.email_provider || "brevo";
  document.getElementById("s-smtp-host").value = s.smtp_host || "";
  document.getElementById("s-smtp-port").value = s.smtp_port || "";
  document.getElementById("s-smtp-user").value = s.smtp_user || "";
  document.getElementById("s-smtp-cred").value = "";
  state.hasSmtpPass = !!s.has_smtp_pass;
  applyEmailProviderUI();
  await loadTimezones();
  initTzCombo();
  initPulldownCombobox("s-lang", "s-lang-list");
  initPulldownCombobox("s-cache-ttl", "s-cache-ttl-list");
  initPulldownCombobox("s-early-watched-days", "s-early-watched-days-list");
  initPulldownCombobox("s-notif-limit", "s-notif-limit-list");
  initTimePicker("s-notification-hour");
  initTimePicker("s-sync-hour");
  initTimePicker("s-genre-hour");
  initTimePicker("s-data-hour");
  initTimePicker("s-backup-hour");
  initTimePicker("s-appupdate-hour");
  initTimePicker("s-maint-hour");
  initFeedSchedule(s.feed_schedule);
  state.currentTz = s.timezone || "Europe/Istanbul";
  state.serverToday = s.server_today || null;
  document.getElementById("s-tz").value = state.currentTz;
  document.getElementById("s-lang").value = s.language || "tr-TR";
  document.getElementById("s-telegram-enabled").checked = (s.telegram_enabled || "1") !== "0";
  document.getElementById("s-ntfy-enabled").checked = (s.ntfy_enabled || "1") !== "0";
  document.getElementById("s-discord-enabled").checked = (s.discord_enabled || "1") !== "0";
  document.getElementById("s-email-enabled").checked = (s.email_enabled || "1") !== "0";
  document.getElementById("s-center-enabled").checked = (s.notif_center_enabled || "1") !== "0";
  // Bildirim Merkezi ayarlari
  state.notifTimeFormat = s.notif_center_time === "absolute" ? "absolute" : "relative";
  state.notifCenterPoster = (s.notif_center_poster || "1") !== "0";
  state.notifCenterHideRead = s.notif_center_hide_read === "1";
  const lim = parseInt(s.notif_center_limit, 10);
  state.notifCenterLimit = [20, 50, 100].includes(lim) ? lim : 50;
  document.getElementById("s-notif-relative").checked = state.notifTimeFormat === "relative";
  document.getElementById("s-notif-absdate").checked = state.notifTimeFormat === "absolute";
  document.getElementById("s-notif-poster").checked = state.notifCenterPoster;
  document.getElementById("s-notif-hideread").checked = state.notifCenterHideRead;
  document.getElementById("s-notif-limit").value = String(state.notifCenterLimit);
  NOTIF_TYPES.forEach(([k]) => {
    const el = document.getElementById(`s-notif-${k}`);
    if (el) el.checked = (s[`notif_${k}`] || "1") !== "0";
  });
  document.getElementById("s-cache-ttl").value = s.cache_ttl || "90";
  document.getElementById("s-early-watched-days").value = s.early_watched_days || "14";
  syncAutoSaveBaselines();
  applyLang((s.language || "tr-TR").split("-")[0]);
  updateNotifyToggleStates();
  if (window.updateBackupButtonsState) window.updateBackupButtonsState();
  try { applyReadonlyGlobals(s); } catch (e) {}
}


function applyReadonlyGlobals(s) {
  // Faz 32: uye global anahtarlari salt-okunur gorur (admin yonetir).
  // notification_hour kisisel oldugundan haric — uye duzenleyebilir.
  const keyToIds = {
    tmdb_api_key: ["s-tmdb"],
    telegram_bot_token: ["s-token"],
    sync_hour: ["s-sync-hour"],
    genre_hour: ["s-genre-hour"],
    data_hour: ["s-data-hour"],
    backup_hour: ["s-backup-hour"],
    app_update_hour: ["s-appupdate-hour"],
    maint_hour: ["s-maint-hour"],
    maint_hour: ["s-maint-hour"],
    backup_mode: ["s-backup-db", "s-backup-full"],
    backup_rsync_host: ["s-backup-rsync-host"],
    backup_rsync_port: ["s-backup-rsync-port"],
    backup_rsync_path: ["s-backup-rsync-path"],
    backup_rsync_user: ["s-backup-rsync-user"],
    backup_rsync_pass: ["s-backup-rsync-cred"],
    backup_rsync_key: ["s-backup-rsync-key-text"],
    backup_samba_host: ["s-backup-samba-host"],
    backup_samba_port: ["s-backup-samba-port"],
    backup_samba_share: ["s-backup-samba-share"],
    backup_samba_user: ["s-backup-samba-user"],
    backup_samba_pass: ["s-backup-samba-cred"],
    app_auto_update: ["s-appupdate-auto"],
    cache_ttl: ["s-cache-ttl"],
    early_watched_days: ["s-early-watched-days"],
    brevo_api_key: ["s-brevo-cred"],
    email_from: ["s-email-from"],
    email_provider: ["s-email-provider"],
    smtp_preset: ["s-smtp-preset"],
    smtp_host: ["s-smtp-host"],
    smtp_port: ["s-smtp-port"],
    smtp_user: ["s-smtp-user"],
    smtp_pass: ["s-smtp-cred"],
  };
  const ro = new Set(s && s.readonly_global ? s.readonly_global : []);
  Object.entries(keyToIds).forEach(([key, ids]) => {
    if (!ro.has(key)) {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.disabled = false; el.title = ""; }
      });
      return;
    }
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = true;
        el.title = t("admin_managed");
      }
    });
  });
}

function showMsg(text, ok) {
  toast(text, !ok);
}

function closeSettingsMenu() {
  const m = document.getElementById("settings-menu");
  if (m) {
    m.classList.remove("open");
    m.style.right = "";
    m.style.width = "";
  }
  const btn = document.getElementById("tab-settings");
  if (btn) btn.classList.remove("active");
}

function updateNotifyToggleStates() {
  const token = (document.getElementById("s-token").value || "").trim();
  const chat = (document.getElementById("s-chat").value || "").trim();
  const ntfy = (document.getElementById("s-ntfy").value || "").trim();
  const discordUrl = (document.getElementById("s-discord-hook").value || "").trim();
  const brevoKey = (document.getElementById("s-brevo-cred").value || "").trim();
  const emailFrom = (document.getElementById("s-email-from").value || "").trim();
  const emailTo = (document.getElementById("s-email-to").value || "").trim();
  const provider = document.getElementById("s-email-provider").value;
  const smtpHost = (document.getElementById("s-smtp-host").value || "").trim();
  const smtpPort = (document.getElementById("s-smtp-port").value || "").trim();
  const smtpUser = (document.getElementById("s-smtp-user").value || "").trim();
  const smtpPassEntered = (document.getElementById("s-smtp-cred").value || "").trim();
  const tg = document.getElementById("s-telegram-enabled");
  const nf = document.getElementById("s-ntfy-enabled");
  const dc = document.getElementById("s-discord-enabled");
  const em = document.getElementById("s-email-enabled");
  const tgWrap = tg.closest(".switch");
  const nfWrap = nf.closest(".switch");
  const dcWrap = dc.closest(".switch");
  const emWrap = em.closest(".switch");
  if (!(token && chat)) {
    if (tg.checked) {
      tg.checked = false;
      saveSettingsPartial({ telegram_enabled: "0" });
    }
    tg.disabled = true;
    const tip = !token && !chat ? t("need_bot_chat") : token ? t("need_chat_id") : t("need_bot_token");
    tgWrap.setAttribute("data-tip", tip);
  } else {
    tg.disabled = false;
    tgWrap.removeAttribute("data-tip");
  }
  if (!ntfy) {
    if (nf.checked) {
      nf.checked = false;
      saveSettingsPartial({ ntfy_enabled: "0" });
    }
    nf.disabled = true;
    nfWrap.setAttribute("data-tip", t("need_ntfy_topic"));
  } else {
    nf.disabled = false;
    nfWrap.removeAttribute("data-tip");
  }
  if (!discordUrl) {
    if (dc.checked) {
      dc.checked = false;
      saveSettingsPartial({ discord_enabled: "0" });
    }
    dc.disabled = true;
    dcWrap.setAttribute("data-tip", t("need_discord_webhook"));
  } else {
    dc.disabled = false;
    dcWrap.removeAttribute("data-tip");
  }
  let emTip = "";
  if (provider === "brevo") {
    if (!brevoKey) emTip = t("need_brevo_key");
    else if (!emailFrom || !emailTo) emTip = t("need_sender_recipient");
  } else {
    if (!smtpHost || !smtpPort) emTip = t("need_smtp_host_port");
    else if (!smtpUser || (!smtpPassEntered && !state.hasSmtpPass)) emTip = t("need_smtp_user_pass");
    else if (!emailFrom || !emailTo) emTip = t("need_sender_recipient");
  }
  if (emTip) {
    if (em.checked) {
      em.checked = false;
      saveSettingsPartial({ email_enabled: "0" });
    }
    em.disabled = true;
    emWrap.setAttribute("data-tip", emTip);
  } else {
    em.disabled = false;
    emWrap.removeAttribute("data-tip");
  }
}

async function showSettingsSubmodal(id) {
  if (!state.settingsLoaded) {
    state.settingsLoaded = true;
    try {
      await loadSettings();
    } catch (e) {
      console.error(e);
    }
  }
  // Modal acilirken e-posta blogunda sarkan bir odak varsa temizle -> cerceve kapali baslar
  const emailFrame = document.getElementById("email-provider-frame");
  if (emailFrame && document.activeElement && emailFrame.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  updateEmailFocusUI();
  setEmailFrameVisible(false);
  const tpOv = document.getElementById("settings-thirdparty-modal");
  if (tpOv && tpOv.style.display !== "none" && id !== "settings-thirdparty-modal") { flushTpBaseUrl(); flushVpsProfile(); }
  document.querySelectorAll(".settings-modal-overlay").forEach((el) => {
    el.style.display = el.id === id ? "flex" : "none";
  });
  if (id === "settings-favorites-modal") {
    renderFavActorsList();
    renderFavDirectorsList();
    renderFavGenresList();
  }
  if (id === "settings-notify-modal") updateNotifyToggleStates();
  if (id === "settings-thirdparty-modal") renderThirdPartyApps();
  closeSettingsMenu();
}

function closeSettingsModals() {
  flushTpBaseUrl();
  flushVpsProfile();
  document.querySelectorAll(".settings-modal-overlay").forEach((el) => {
    el.style.display = "none";
  });
}

async function renderFavActorsList() {
  const list = document.getElementById("fav-actors-list");
  if (!list) return;
  try {
    const r = await fetch("/api/fav_actors");
    const j = await r.json();
    const actors = j.actors || [];
    if (!actors.length) {
      list.innerHTML = `<div class="fav-empty">${t("no_fav_actor")}</div>`;
      return;
    }
    list.innerHTML = actors
      .map(
        (a) => `<div class="fav-item fav-item-clickable" data-id="${escAttr(a.person_id)}" data-name="${escAttr(a.name)}"><span class="fav-name">${escAttr(a.name)}</span><button class="fav-heart" data-id="${escAttr(a.person_id)}" data-name="${escAttr(a.name)}" data-tip="${t("fav_actor_remove")}">${HEART_SVG}</button></div>`
      )
      .join("");
    list.querySelectorAll(".fav-heart").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/fav_actors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person_id: btn.dataset.id, name: btn.dataset.name }),
        });
        const j = await r.json();
        if (r.ok) {
          state.favActors.delete(String(btn.dataset.id));
          renderFavActorsList();
          toast(t("fav_actor_removed", { name: btn.dataset.name }));
        }
      };
    });
    list.querySelectorAll(".fav-item-clickable").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".fav-heart")) return;
        openFavListing("actor", row.dataset.id, row.dataset.name);
      });
    });
  } catch (e) {}
}

async function renderFavDirectorsList() {
  const list = document.getElementById("fav-directors-list");
  if (!list) return;
  try {
    const r = await fetch("/api/fav_directors");
    const j = await r.json();
    const directors = j.directors || [];
    if (!directors.length) {
      list.innerHTML = `<div class="fav-empty">${t("no_fav_director")}</div>`;
      return;
    }
    list.innerHTML = directors
      .map(
        (a) => `<div class="fav-item fav-item-clickable" data-id="${escAttr(a.person_id)}" data-name="${escAttr(a.name)}" data-source="${escAttr(a.source || "tmdb")}"><span class="fav-name">${escAttr(a.name)}</span><button class="fav-heart" data-id="${escAttr(a.person_id)}" data-name="${escAttr(a.name)}" data-tip="${t("fav_director_remove")}">${HEART_SVG}</button></div>`
      )
      .join("");
    list.querySelectorAll(".fav-heart").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/fav_directors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person_id: btn.dataset.id, name: btn.dataset.name }),
        });
        const j = await r.json();
        if (r.ok) {
          state.favDirectors.delete(String(btn.dataset.id));
          renderFavDirectorsList();
          toast(t("fav_director_removed", { name: btn.dataset.name }));
        }
      };
    });
    list.querySelectorAll(".fav-item-clickable").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".fav-heart")) return;
        if ((row.dataset.source || "tmdb") !== "tmdb") return;
        openFavListing("director", row.dataset.id, row.dataset.name);
      });
    });
  } catch (e) {}
}

async function renderFavGenresList() {
  const list = document.getElementById("fav-genres-list");
  if (!list) return;
  try {
    const r = await fetch("/api/fav_genres");
    const j = await r.json();
    const genres = j.genres || [];
    if (!genres.length) {
      list.innerHTML = `<div class="fav-empty">${t("no_fav_genre")}</div>`;
      return;
    }
    list.innerHTML = genres
      .map(
        (g) => `<div class="fav-item fav-item-clickable" data-name="${escAttr(g)}"><span class="fav-name">${escAttr(g)}</span><button class="fav-heart" data-name="${escAttr(g)}" data-tip="${t("fav_genre_remove")}">${HEART_SVG}</button></div>`
      )
      .join("");
    list.querySelectorAll(".fav-heart").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/fav_genres", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genre: btn.dataset.name }),
        });
        const j = await r.json();
        if (r.ok) {
          state.favGenres.delete(btn.dataset.name);
          renderFavGenresList();
          toast(t("fav_genre_removed", { name: btn.dataset.name }));
        }
      };
    });
    list.querySelectorAll(".fav-item-clickable").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".fav-heart")) return;
        openFavListing("genre", row.dataset.name, row.dataset.name);
      });
    });
  } catch (e) {}
}

// Favori liste modalı — person-modal ile aynı boyut/grid, cache'li
async function openFavListing(kind, ident, title) {
  const modal = document.getElementById("fav-listing-modal");
  const body = document.getElementById("fav-listing-body");
  const ttl = document.getElementById("fav-listing-title");
  if (!modal || !body) return;
  ttl.textContent = title || "";
  body.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  modal.style.display = "flex";
  try {
    let url = "";
    if (kind === "actor") url = `/api/favorites/actor/${encodeURIComponent(ident)}`;
    else if (kind === "director") url = `/api/favorites/director/${encodeURIComponent(ident)}`;
    else url = `/api/favorites/genre?name=${encodeURIComponent(ident)}&media=all`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      const { errText: _err } = await import("./i18n.js?v=660");
      body.innerHTML = `<div class="releases-error">${_err(data.error) || t("data_failed")}</div>`;
      return;
    }
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty">${t("no_credits")}</div>`;
      return;
    }
    const { posterHTML, scoreTag, typeLabel, applyTitleHint, resultCardRows, cardDateLine } = await import("./utils.js?v=660");
    const { openDetails } = await import("./components.js?v=660");
    const { loadFollowed } = await import("./views.js?v=660");
    const grid = document.createElement("div");
    grid.className = "poster-grid person-grid";
    for (const item of items) {
      const div = document.createElement("div");
      div.className = "card";
      const mediaType = item.media_type || (kind === "actor" ? "tv" : "movie");
      div.innerHTML = `
        ${posterHTML(item.poster_path, item.title, false, undefined, undefined, true)}
        <div class="info">
          <div class="title">${escAttr(item.title)}</div>
          <div class="meta">
            ${resultCardRows({
              type: `<span class="badge badge-${mediaType}">${typeLabel(mediaType)}</span>`,
              score: scoreTag(item.vote_average),
              status: cardDateLine(mediaType, item),
            })}
          </div>
        </div>
        <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
      const ibFav = div.querySelector(".info-btn");
      if (ibFav) ibFav.onclick = (ev) => { ev.stopPropagation(); div.click(); };
      div.querySelector(".remove").onclick = async (e) => {
        e.stopPropagation();
        const r = await fetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdb_id: item.tmdb_id,
            media_type: mediaType,
            title: item.title,
            poster_path: item.poster_path,
          }),
        });
        const j = await r.json();
        const { t: _t } = await import("./i18n.js?v=660");
        toast(r.ok ? _t("added", { name: item.title }) : j.error || _t("error"));
        if (r.ok) {
          loadFollowed(mediaType === "tv" ? "dizi" : "film");
          modal.style.display = "none";
        }
      };
      div.onclick = () => {
        openDetails(mediaType, item.tmdb_id, item.title, undefined, undefined, undefined, true);
        modal.style.display = "none";
      };
      grid.appendChild(div);
      applyTitleHint(div);
    }
    body.innerHTML = "";
    body.appendChild(grid);
  } catch (e) {
    body.innerHTML = `<div class="releases-error">${t("conn_error")}</div>`;
  }
}

if (nxOnce("fav_listing_modal")) (function initFavListingModal() {
  const modal = document.getElementById("fav-listing-modal");
  if (!modal) return;
  const close = () => { modal.style.display = "none"; };
  const btn = document.getElementById("fav-listing-close");
  if (btn) btn.onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.style.display !== "none") close(); });
})();

// Yedekleme: sabit çerçeve 2 switch (biri açılırsa diğeri kapanır) + Rsync/Samba akordeonları
if (nxOnce("backup_switches")) (function initBackupSwitches() {
  const dbSw = document.getElementById("s-backup-db");
  const fullSw = document.getElementById("s-backup-full");
  if (!dbSw || !fullSw) return;
  dbSw.addEventListener("change", () => {
    if (dbSw.checked) {
      fullSw.checked = false;
      saveSettingsPartial({ backup_mode: "db" }, dbSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    } else if (!fullSw.checked) {
      saveSettingsPartial({ backup_mode: "" }, dbSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    } else {
      saveSettingsPartial({ backup_mode: "full" }, dbSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    }
  });
  fullSw.addEventListener("change", () => {
    if (fullSw.checked) {
      dbSw.checked = false;
      saveSettingsPartial({ backup_mode: "full" }, fullSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    } else if (!dbSw.checked) {
      saveSettingsPartial({ backup_mode: "" }, fullSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    } else {
      saveSettingsPartial({ backup_mode: "db" }, fullSw.closest(".channel-frame").querySelector(".saved-hint") || document.getElementById("notify-saved-hint"));
    }
  });
  // switch tıklaması akordeonu tetiklemesin
  [dbSw, fullSw].forEach((sw) => sw.addEventListener("click", (e) => e.stopPropagation()));
})();

// Yedekleme Rsync/Samba akordeonları + port autofill + SSH key textarea/file
if (nxOnce("backup_accordion")) (function initBackupAccordion() {
  [["backup-rsync-box", "backup-rsync-body", "s-backup-rsync-port", "22"], ["backup-samba-box", "backup-samba-body", "s-backup-samba-port", "445"]].forEach(([boxId, bodyId, portId, defPort]) => {
    const box = document.getElementById(boxId);
    const body = document.getElementById(bodyId);
    const portEl = document.getElementById(portId);
    if (!box || !body) return;
    box.addEventListener("click", (e) => {
      if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("button") || e.target.closest("a") || e.target.closest(".provider-list") || e.target.closest("textarea")) return;
      const isOpen = body.style.display !== "none";
      document.getElementById("backup-rsync-body").style.display = "none";
      document.getElementById("backup-samba-body").style.display = "none";
      document.getElementById("backup-rsync-box").classList.remove("accordion-open");
      document.getElementById("backup-samba-box").classList.remove("accordion-open");
      if (!isOpen) {
        body.style.display = "";
        box.classList.add("accordion-open");
        if (portEl && !portEl.value.trim()) {
          portEl.value = defPort;
          const hint = portEl.closest("label").querySelector(".saved-hint");
          saveSettingsPartial({ [portEl.id.replace("s-", "").replace(/-/g, "_")]: defPort }, hint);
        }
      }
    });
  });
  // SSH key textarea autosave (bulanıklaşınca)
  const keyText = document.getElementById("s-backup-rsync-key-text");
  if (keyText) {
    // placeholder key gösteriliyorsa ilk odaklanmada temizle
    keyText.addEventListener("focus", () => {
      if (keyText.dataset.hasKey === "1" && keyText.value === "••••••••") {
        keyText.value = "";
        keyText.dataset.hasKey = "0";
      }
    });
    keyText.addEventListener("blur", async () => {
      const v = keyText.value.trim();
      if (!v || v === "••••••••") return;
      // OpenSSH format kontrolü (başlık)
      if (!v.includes("BEGIN") || !v.includes("PRIVATE KEY")) {
        toast("OpenSSH formatında olmalı (-----BEGIN OPENSSH PRIVATE KEY-----)", true);
        return;
      }
      const hint = keyText.closest("label").querySelector(".saved-hint");
      const ok = await saveSettingsPartial({ backup_rsync_key: v }, hint);
      if (ok) keyText.dataset.hasKey = "1";
    });
  }
  const keyFile = document.getElementById("s-backup-rsync-key-file");
  const keyUpload = document.getElementById("s-backup-rsync-key-upload");
  const keyClear = document.getElementById("s-backup-rsync-key-clear");
  if (keyUpload && keyFile) {
    keyUpload.addEventListener("click", (e) => {
      e.stopPropagation();
      keyFile.click();
    });
    keyFile.addEventListener("change", () => {
      const f = keyFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        if (keyText) {
          keyText.value = text;
          keyText.focus();
        }
      };
      reader.readAsText(f);
      keyFile.value = "";
    });
  }
  if (keyClear && keyText) {
    keyClear.addEventListener("click", async (e) => {
      e.stopPropagation();
      keyText.value = "";
      keyText.dataset.hasKey = "0";
      const hint = keyText.closest("label").querySelector(".saved-hint");
      await saveSettingsPartial({ backup_rsync_key: "" }, hint);
    });
  }
  // backup alanları autosave (blur)
  [
    ["s-backup-rsync-host", "backup_rsync_host"],
    ["s-backup-rsync-port", "backup_rsync_port"],
    ["s-backup-rsync-path", "backup_rsync_path"],
    ["s-backup-rsync-user", "backup_rsync_user"],
    ["s-backup-samba-host", "backup_samba_host"],
    ["s-backup-samba-port", "backup_samba_port"],
    ["s-backup-samba-share", "backup_samba_share"],
    ["s-backup-samba-user", "backup_samba_user"],
  ].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", async () => {
      const v = el.value.trim();
      const hint = el.closest("label").querySelector(".saved-hint");
      await saveSettingsPartial({ [key]: v }, hint);
    });
  });
  // şifreler: boş bırakılırsa gönderme, doluysa kaydet
  ["s-backup-rsync-cred", "s-backup-samba-cred"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = id.replace("s-", "").replace(/-/g, "_");
    el.addEventListener("blur", async () => {
      const v = el.value;
      if (!v) return;
      const hint = el.closest("label").querySelector(".saved-hint");
      const ok = await saveSettingsPartial({ [key]: v }, hint);
      if (ok) el.value = "";
    });
  });
  // Yedekle / Geri Yükle butonları - hedef mantığı (tablo)
  function isRsyncDolu() {
    const v = document.getElementById("s-backup-rsync-host")?.value.trim();
    return !!v;
  }
  function isSambaDolu() {
    const h = document.getElementById("s-backup-samba-host")?.value.trim();
    const s = document.getElementById("s-backup-samba-share")?.value.trim();
    return !!(h && s);
  }
  function getOpenBackupTarget() {
    const rs = document.getElementById("backup-rsync-body");
    const sm = document.getElementById("backup-samba-body");
    if (rs && rs.style.display !== "none") return "rsync";
    if (sm && sm.style.display !== "none") return "samba";
    return null;
  }
  function updateBackupButtonsState() {
    const nowBtn = document.getElementById("backup-now");
    const restoreBtn = document.getElementById("backup-restore");
    if (!nowBtn || !restoreBtn) return;
    const rDolu = isRsyncDolu();
    const sDolu = isSambaDolu();
    const open = getOpenBackupTarget();
    let target = null;
    let tipKey = null;
    let disabled = false;
    // Tek taraf dolu -> hedef belli, seçim/tooltip yok
    if (rDolu && !sDolu) {
      target = "rsync";
    } else if (!rDolu && sDolu) {
      target = "samba";
    } else if (rDolu && sDolu) {
      // İkisi dolu -> açık akordeon belirler
      if (!open) {
        disabled = true;
        tipKey = "tip_backup_choose";
      } else {
        target = open;
        tipKey = target === "rsync" ? "tip_backup_rsync" : "tip_backup_samba";
      }
    } else {
      // Hiçbiri dolu değil
      disabled = true;
      tipKey = "tip_backup_empty";
    }
    // Yedekle butonu
    nowBtn.disabled = disabled;
    restoreBtn.disabled = disabled;
    // Güncelleme modalındaki Yedekleme Saati: hedef yoksa kapalı + bilgi tooltip'i
    // (data-tip satırın tamamına yazılır: disabled input fare olayı üretmez,
    //  başlık span'i ise input üzerinden hover'da atlanır; satır kapsayınca
    //  özel tooltip her noktada çalışır)
    const backupHourInput = document.getElementById("s-backup-hour");
    if (backupHourInput) {
      const hourBlocked = !rDolu && !sDolu;
      backupHourInput.disabled = hourBlocked;
      const hourRow = backupHourInput.closest("label");
      const hourTip = t(hourBlocked ? "tip_backup_hour_empty" : "tip_backup_hour");
      if (hourRow) {
        if (hourBlocked) hourRow.setAttribute("data-tip", hourTip);
        else hourRow.removeAttribute("data-tip");
      }
      const hourLabel = hourRow?.querySelector('[data-i18n="label_backup_hour"]');
      if (hourLabel) hourLabel.setAttribute("data-tip", hourTip);
    }
    if (target === "rsync") {
      nowBtn.setAttribute("data-i18n", "backup_now_rsync");
      nowBtn.textContent = t("backup_now_rsync");
      restoreBtn.setAttribute("data-i18n", "backup_restore_rsync");
      restoreBtn.textContent = t("backup_restore_rsync");
    } else if (target === "samba") {
      nowBtn.setAttribute("data-i18n", "backup_now_samba");
      nowBtn.textContent = t("backup_now_samba");
      restoreBtn.setAttribute("data-i18n", "backup_restore_samba");
      restoreBtn.textContent = t("backup_restore_samba");
    } else {
      nowBtn.setAttribute("data-i18n", "backup_now");
      nowBtn.textContent = t("backup_now");
      restoreBtn.setAttribute("data-i18n", "backup_restore");
      restoreBtn.textContent = t("backup_restore");
    }
    // Tooltip - sadece gerektiğinde
    if (tipKey) {
      const tip = t(tipKey);
      nowBtn.setAttribute("data-tip", tip);
      restoreBtn.setAttribute("data-tip", tip);
    } else {
      nowBtn.removeAttribute("data-tip");
      restoreBtn.removeAttribute("data-tip");
    }
    // dataset target for click handler
    nowBtn.dataset.target = target || "";
    restoreBtn.dataset.target = target || "";
  }
  // Akordeon toggle sonrası güncelle (port autofill sonrası da)
  const _origBoxes = ["backup-rsync-box", "backup-samba-box"].map((id) => document.getElementById(id)).filter(Boolean);
  _origBoxes.forEach((box) => box.addEventListener("click", () => setTimeout(updateBackupButtonsState, 0)));
  // Host/share input blur sonrası (dolu değişebilir)
  ["s-backup-rsync-host", "s-backup-samba-host", "s-backup-samba-share"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("blur", () => setTimeout(updateBackupButtonsState, 300));
    if (el) el.addEventListener("input", () => setTimeout(updateBackupButtonsState, 0));
  });
  // Modal açılırken ve ayarlar yüklenince
  const backupMenuItem = document.querySelector('.settings-menu-item[data-target="settings-backup-modal"]');
  if (backupMenuItem) backupMenuItem.addEventListener("click", () => setTimeout(updateBackupButtonsState, 0));
  // loadSettings sonrası için global hook
  window.updateBackupButtonsState = updateBackupButtonsState;
  // İlk durum + dil değişiminde güncelle
  setTimeout(updateBackupButtonsState, 0);
  document.addEventListener("app:langchange", updateBackupButtonsState);

  const nowBtn = document.getElementById("backup-now");
  if (nowBtn) nowBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const target = nowBtn.dataset.target || getOpenBackupTarget() || (isRsyncDolu() && !isSambaDolu() ? "rsync" : !isRsyncDolu() && isSambaDolu() ? "samba" : "");
    if (!target) return;
    const r = await fetch("/api/backup/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
    const j = await r.json().catch(() => ({}));
    showMsg(r.ok ? (j.msg || t("saved")) : j.error || t("error"), r.ok);
  });
  const restoreBtn = document.getElementById("backup-restore");
  if (restoreBtn) restoreBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const target = restoreBtn.dataset.target || getOpenBackupTarget() || (isRsyncDolu() && !isSambaDolu() ? "rsync" : !isRsyncDolu() && isSambaDolu() ? "samba" : "");
    if (!target) return;
    const r = await fetch("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) });
    const j = await r.json().catch(() => ({}));
    showMsg(r.ok ? (j.msg || t("saved")) : j.error || t("error"), r.ok);
  });
})();

// NextEp Güncelleme: versiyon satırı + ayrıntı modalı + kontrol/güncelle butonları
let lastAppVer = { local: "", remote: "", available: false, changes: [] };
let lastDetailEntries = [];
function fillAppUpdateDetail(entries) {
  const verEl = document.getElementById("appupdate-detail-ver");
  const ul = document.getElementById("appupdate-detail-list");
  if (!verEl || !ul) return;
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lang = (document.documentElement.lang || "tr").toLowerCase().startsWith("tr") ? "tr" : "en";
  if (!entries || !entries.length) {
    verEl.textContent = "";
    ul.innerHTML = `<li>${esc(t("appupdate_no_notes"))}</li>`;
    return;
  }
  verEl.textContent = "";
  ul.innerHTML = entries.map((entry) => {
    const items = (entry[lang] && entry[lang].length ? entry[lang] : entry.tr || []);
    const head = entry.date ? `VERSION ${entry.version} · ${entry.date}` : `VERSION ${entry.version}`;
    return `<li class="app-change-ver">${esc(head)}</li>` +
      (items.length
        ? items.map((it) => `<li>${esc(it)}</li>`).join("")
        : `<li>${esc(t("appupdate_no_notes"))}</li>`);
  }).join("");
}
function openAppUpdateDetail(entries) {
  const modal = document.getElementById("appupdate-detail-modal");
  if (!modal) return;
  lastDetailEntries = Array.isArray(entries) ? entries : [];
  fillAppUpdateDetail(lastDetailEntries);
  modal.style.display = "flex";
}
function renderAppVersion() {
  const el = document.getElementById("appupdate-version-text");
  const runBtn = document.getElementById("appupdate-run");
  if (!el || !runBtn) return;
  const safe = (v) => String(v || "").replace(/[^0-9.]/g, "");
  const cur = safe(lastAppVer.local) || "—";
  let html = `${t("app_version_current")} ${cur}`;
  if (lastAppVer.available && lastAppVer.remote) {
    html += ` -&gt; <span class="new-version">${t("app_version_new")} ${safe(lastAppVer.remote)}</span>`;
  }
  el.innerHTML = html;
  runBtn.disabled = !lastAppVer.available;
}
async function loadAppVersionFast() {
  // 1.87: AG YOK ucu — "Mevcut surum" satiri ANINDA yazilsin, butonlar dogru duruma gelsin.
  try {
    const r = await fetch("/api/app-update/version", { cache: "no-store" });
    const j = await r.json();
    lastAppVer = { local: j.local || "", remote: j.remote || "", available: !!j.available, changes: lastAppVer.changes || [] };
  } catch (e) { /* sessiz: satir yine cizilir */ }
  renderAppVersion();
}

async function checkAppUpdate(showToast) {
  const checkBtn = document.getElementById("appupdate-check");
  if (checkBtn) { checkBtn.disabled = true; checkBtn.classList.add("loading"); }
  try {
    const r = await fetch("/api/app-update/check?force=1");
    const j = await r.json();
    lastAppVer = { local: j.local || "", remote: j.remote || "", available: !!j.available, changes: [] };
    renderAppVersion();
    if (lastAppVer.available) {
      try {
        const rc = await fetch("/api/app-update/changelog");
        const jc = await rc.json().catch(() => ({}));
        if (Array.isArray(jc.changes)) lastAppVer.changes = jc.changes;
      } catch (e) {
        lastAppVer.changes = [];
      }
      // Sistem sürümünden sonraki TÜM sürümlerin notları, yalnız kullanıcı kontrol istediyse
      if (showToast) openAppUpdateDetail(lastAppVer.changes);
    }
    if (showToast) showMsg(j.available ? t("appupdate_found", { ver: j.remote }) : t("appupdate_none"), true);
  } catch (e) {
    if (showToast) showMsg(t("error"), false);
  } finally {
    if (checkBtn) { checkBtn.disabled = false; checkBtn.classList.remove("loading"); }
  }
}
if (nxOnce("app_update")) (function initAppUpdate() {
  const checkBtn = document.getElementById("appupdate-check");
  if (checkBtn) checkBtn.addEventListener("click", () => checkAppUpdate(true));
  const runBtn = document.getElementById("appupdate-run");
  if (runBtn) runBtn.addEventListener("click", async () => {
    if (runBtn.disabled) return;
    runBtn.disabled = true;
    try {
      const r = await fetch("/api/app-update/run", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.updated) {
        showMsg(t("appupdate_started", { ver: j.to }), true);
        lastAppVer = { local: j.to || lastAppVer.remote, remote: j.to || "", available: false, changes: [] };
        renderAppVersion();
      } else {
        showMsg(j.error || t("error"), false);
        runBtn.disabled = !!lastAppVer.available;
      }
    } catch (e) {
      showMsg(t("error"), false);
      runBtn.disabled = !!lastAppVer.available;
    }
  });
  // Modal acilirken: ONCE agsiz hizli durum (aninda "Mevcut surum"), aga YALNIZ "Kontrol Et" ile cikilir.
  const menuItem = document.querySelector('.settings-menu-item[data-target="settings-appupdate-modal"]');
  if (menuItem) menuItem.addEventListener("click", () => setTimeout(() => loadAppVersionFast(), 0));
  document.addEventListener("app:langchange", () => {
    renderAppVersion();
    const dm = document.getElementById("appupdate-detail-modal");
    if (dm && dm.style.display === "flex") fillAppUpdateDetail(lastDetailEntries);
  });
})();

// Favoriler: 3 kutu doğrudan modal-body'de alt alta, dış çerçeve yok
if (nxOnce("fav_accordion")) (function initFavoritesAccordion() {
  [["fav-actors-box", "fav-actors-body"], ["fav-directors-box", "fav-directors-body"], ["fav-genres-box", "fav-genres-body"]].forEach(([boxId, bodyId]) => {
    const box = document.getElementById(boxId);
    const body = document.getElementById(bodyId);
    if (!box || !body) return;
    box.addEventListener("click", (e) => {
      if (e.target.closest("button") && e.target.closest(".fav-heart")) return;
      if (e.target.closest(".fav-item")) return;
      if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a") || e.target.closest(".provider-list")) return;
      const isOpen = body.style.display !== "none";
      document.getElementById("fav-actors-body").style.display = "none";
      document.getElementById("fav-directors-body").style.display = "none";
      document.getElementById("fav-genres-body").style.display = "none";
      document.getElementById("fav-actors-box").classList.remove("accordion-open");
      document.getElementById("fav-directors-box").classList.remove("accordion-open");
      document.getElementById("fav-genres-box").classList.remove("accordion-open");
      if (!isOpen) {
        body.style.display = "";
        box.classList.add("accordion-open");
      }
    });
  });
})();

if (nxOnce("settings_menu")) {
document.getElementById("tab-settings").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = document.getElementById("settings-menu");
  const open = menu.classList.contains("open");
  if (open) {
    closeSettingsMenu();
  } else {
    activateUtilityTab(document.getElementById("tab-settings"));
    menu.classList.add("open");
    // Desktop: pencere-sol bildirim butonu soluna, pencere-sağ dişli butonu sağına dayanır
    // (pencere = dişliSağ - bildirimSol kadar genişler). Mesafe dile/yakınlaştırmaya bağlı
    // olduğundan açılış anında ölçülür; mobil/TV'de menü dişli altında dar kalır.
    if (window.matchMedia("(min-width: 769px)").matches && !document.documentElement.classList.contains("is-tv") && !document.documentElement.classList.contains("tv-mode")) {
      const notif = document.getElementById("tab-notif");
      const wrap = document.querySelector(".settings-wrap");
      if (notif && wrap) {
        menu.style.right = "";
        menu.style.width = "";
        // Icerik (orn. "Guncelleme Saatleri") olculenden uzunsa tasmamasi icin
        // buyuk olani yaz: scrollWidth = yazi + padding (border 1px*2 eklenir).
        const need = Math.ceil(menu.scrollWidth) + 2;
        const span = wrap.getBoundingClientRect().right - notif.getBoundingClientRect().left;
        menu.style.width = Math.max(span, need) + "px";
      }
    } else {
      menu.style.right = "";
      menu.style.width = "";
    }
  }
});
document.querySelectorAll(".settings-menu-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("locked")) return;
    showSettingsSubmodal(btn.dataset.target);
  });
});
document.addEventListener("click", (e) => {
  const wrap = document.querySelector(".settings-wrap");
  if (wrap && !wrap.contains(e.target)) closeSettingsMenu();
});
}
if (nxOnce("settings_modals")) {
document.querySelectorAll(".settings-modal-close").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    flushTpBaseUrl();
    flushVpsProfile();
    const ov = btn.closest(".settings-modal-overlay");
    if (ov) ov.style.display = "none";
  });
});
document.querySelectorAll(".settings-modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target === ov) { flushTpBaseUrl(); flushVpsProfile(); ov.style.display = "none"; }
  });
});
}

function showSavedHint(el) {
  if (!el) return;
  clearTimeout(el._savedTimer);
  el.classList.add("show");
  el._savedTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

async function saveSettingsPartial(patch, hintEl) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      signal: ctl.signal,
    });
    if (r.ok) {
      showSavedHint(hintEl);
      if ("tmdb_api_key" in patch) checkTmdbKey(patch.tmdb_api_key);
      return true;
    }
    toast(t("save_failed"), true);
    return false;
  } catch (e) {
    toast(t("save_failed"), true);
    return false;
  } finally {
    clearTimeout(to);
  }
}

const AUTO_SAVE_BASELINES = {};
const AUTO_SAVE_FIELDS = [];

function syncAutoSaveBaselines() {
  AUTO_SAVE_FIELDS.forEach(({ id, transform }) => {
    const el = document.getElementById(id);
    if (!el) return;
    AUTO_SAVE_BASELINES[id] = transform ? transform(el.value) : el.value;
  });
}

function bindAutoSave(id, key, transform) {
  const el = document.getElementById(id);
  const hint = el.closest("label").querySelector(".saved-hint");
  AUTO_SAVE_FIELDS.push({ id, transform });
  el.addEventListener("blur", async () => {
    const val = transform ? transform(el.value) : el.value;
    // deger degismediyse kaydetme ve "Kaydedildi" gostermme
    if (AUTO_SAVE_BASELINES[id] !== undefined && val === AUTO_SAVE_BASELINES[id]) return;
    const ok = await saveSettingsPartial({ [key]: val }, hint);
    if (ok) AUTO_SAVE_BASELINES[id] = val;
  });
}

bindAutoSave("s-tmdb", "tmdb_api_key", (v) => v.trim());
bindAutoSave("s-token", "telegram_bot_token", (v) => v.trim());
bindAutoSave("s-chat", "telegram_chat_id", (v) => v.trim());
bindAutoSave("s-ntfy", "ntfy_topic", (v) => v.trim());
bindAutoSave("s-discord-hook", "discord_webhook_url", (v) => v.trim());
bindAutoSave("s-brevo-cred", "brevo_api_key", (v) => v.trim());
bindAutoSave("s-email-from", "email_from", (v) => v.trim());
bindAutoSave("s-email-to", "email_to", (v) => v.trim());
bindAutoSave("s-smtp-host", "smtp_host", (v) => v.trim());
bindAutoSave("s-smtp-port", "smtp_port", (v) => v.trim());
bindAutoSave("s-smtp-user", "smtp_user", (v) => v.trim());
bindAutoSave("s-smtp-cred", "smtp_pass", (v) => v);

["s-token", "s-chat", "s-ntfy", "s-discord-hook", "s-brevo-cred", "s-email-from", "s-email-to", "s-smtp-host", "s-smtp-port", "s-smtp-user", "s-smtp-cred"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("blur", () => {
    if (id === "s-smtp-cred" && el.value.trim()) state.hasSmtpPass = true;
    updateNotifyToggleStates();
  });
});

const EMAIL_PRESETS = {
  gmail:   { host: "smtp.gmail.com",      port: 587, appPassword: true },
  outlook: { host: "smtp.office365.com",  port: 587 },
  yahoo:   { host: "smtp.mail.yahoo.com", port: 465 },
  yandex:  { host: "smtp.yandex.com",     port: 465 },
  icloud:  { host: "smtp.mail.me.com",    port: 587, appPassword: true },
  zoho:    { host: "smtp.zoho.com",       port: 465 },
};

function updateEmailFocusUI() {
  const provSelect = document.getElementById("s-email-provider");
  const frame = document.getElementById("email-provider-frame");
  if (!provSelect || !frame) return;
  const active =
    providerList.style.display === "flex" ||
    document.activeElement === provSelect ||
    (frame.contains(document.activeElement) && document.activeElement !== frame);
  frame.classList.toggle("email-lit", active);
  provSelect.classList.toggle("email-lit", active);
}

["s-email-provider", "email-provider-frame"].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener("focusin", updateEmailFocusUI);
  el.addEventListener("focusout", (e) => {
    // odak cerceve icindeki baska bir alana tasiyorsa sonuk gostermeyelim
    setTimeout(updateEmailFocusUI, 0);
  });
});

// Akordeon: e-posta detaylari yalnizca pulldown'a dokununca acilir
function setEmailFrameVisible(on) {
  const frame = document.getElementById("email-provider-frame");
  if (frame) frame.style.display = on ? "" : "none";
}
const emailProvSelect = document.getElementById("s-email-provider");
["mousedown", "focus", "change", "keydown"].forEach((ev) => {
  emailProvSelect.addEventListener(ev, () => setEmailFrameVisible(true));
});
// akordeon: pulldown + cerceve disina mousedown -> cerceve kapansin
// istisna: e-posta alt modal acikken modal ici tiklamalar "dis" sayilmaz
const emailCombobox = emailProvSelect.closest(".provider-combobox");
const emailChannelModalEl = document.getElementById("channel-email-modal");
document.addEventListener("mousedown", (e) => {
  if (emailCombobox.contains(e.target)) return;
  const frame = document.getElementById("email-provider-frame");
  if (frame && frame.contains(e.target)) return;
  if (
    emailChannelModalEl &&
    emailChannelModalEl.style.display !== "none" &&
    emailChannelModalEl.contains(e.target)
  ) {
    return;
  }
  setEmailFrameVisible(false);
  updateEmailFocusUI();
});

// Ozel pulldown penceresi (saat secici .time-list stilinde): native dropdown engellenir
const providerList = document.getElementById("email-provider-list");
let provHlIndex = -1;
function provRows() {
  return Array.from(providerList.querySelectorAll(".provider-cell"));
}
function setProvHl(i) {
  const rs = provRows();
  if (!rs.length) { provHlIndex = -1; return; }
  provHlIndex = ((i % rs.length) + rs.length) % rs.length;
  rs.forEach((r, idx) => r.classList.toggle("hl", idx === provHlIndex));
  rs[provHlIndex].scrollIntoView({ block: "nearest" });
}

function renderProviderList() {
  providerList.innerHTML = "";
  Array.from(emailProvSelect.options).forEach((opt) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "provider-cell" + (opt.value === emailProvSelect.value ? " selected" : "");
    row.dataset.value = opt.value;
    row.textContent = opt.textContent;
    row.onclick = (e) => {
      e.stopPropagation();
      closeProviderList();
      if (emailProvSelect.value !== opt.value) {
        emailProvSelect.value = opt.value;
        emailProvSelect.dispatchEvent(new Event("change"));
      }
      // secim sonrasi pulldown aktif kalsin
      emailProvSelect.focus();
      updateEmailFocusUI();
    };
    providerList.appendChild(row);
  });
}

function openProviderList() {
  renderProviderList();
  providerList.style.display = "flex";
  const rs = provRows();
  const cur = rs.findIndex((r) => r.dataset.value === emailProvSelect.value);
  setProvHl(cur >= 0 ? cur : 0);
  emailProvSelect.focus();
  updateEmailFocusUI();
}

function closeProviderList() {
  providerList.style.display = "none";
  updateEmailFocusUI();
}

emailProvSelect.addEventListener("mousedown", (e) => {
  // native dropdown acilmasin; ozel pencere acilsin
  e.preventDefault();
  if (providerList.style.display === "flex") closeProviderList();
  else openProviderList();
});
emailProvSelect.addEventListener("keydown", (e) => {
  if (providerList.style.display !== "flex") {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openProviderList();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setProvHl(provHlIndex + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setProvHl(provHlIndex - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const rs = provRows();
    if (provHlIndex >= 0 && rs[provHlIndex]) rs[provHlIndex].click();
    else closeProviderList();
  } else if (e.key === "Escape") {
    closeProviderList();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".provider-combobox")) closeProviderList();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeProviderList();
});

function applyEmailProviderUI() {
  const prov = document.getElementById("s-email-provider").value || "brevo";
  document.getElementById("email-brevo-group").style.display = prov === "brevo" ? "" : "none";
  document.getElementById("email-smtp-group").style.display = prov === "brevo" ? "none" : "";
  const preset = EMAIL_PRESETS[prov];
  const manual = document.getElementById("email-smtp-manual");
  manual.style.display = preset ? "none" : "";
  if (preset) {
    document.getElementById("s-smtp-host").value = preset.host;
    document.getElementById("s-smtp-port").value = String(preset.port);
  }
  document.getElementById("email-app-password-hint").style.display =
    preset && preset.appPassword ? "" : "none";
}

document.getElementById("s-email-provider").addEventListener("change", () => {
  const el = document.getElementById("s-email-provider");
  applyEmailProviderUI();
  const hint = el.closest("label") && el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial(
    {
      email_provider: el.value,
      smtp_preset: el.value === "brevo" ? "" : el.value,
      ...(EMAIL_PRESETS[el.value]
        ? { smtp_host: EMAIL_PRESETS[el.value].host, smtp_port: String(EMAIL_PRESETS[el.value].port) }
        : {}),
    },
    hint
  );
  updateNotifyToggleStates();
});

document.getElementById("s-lang").addEventListener("change", () => {
  const el = document.getElementById("s-lang");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ language: el.value }, hint).then((ok) => {
    if (ok) {
      applyLang(el.value.split("-")[0]);
      // toast yeni secilen dilde gosterilir
      const opt = el.options[el.selectedIndex];
      toast(t("lang_selected", { name: opt ? opt.textContent : el.value }));
    }
  });
});

// yalnizca gecerli timezone degerleri kaydedilir; blur'da tetiklenen native
// change ile ham filtre metninin (orn. "istan") DB'ye yazilmasi engellenir
document.getElementById("s-tz").addEventListener("change", () => {
  const el = document.getElementById("s-tz");
  if (!state.allTimezones.some((z) => z.value === el.value)) {
    el.value = state.currentTz;
    return;
  }
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ timezone: el.value }, hint).then((ok) => {
    if (ok) state.currentTz = el.value;
  });
});

document.getElementById("s-notification-hour").addEventListener("change", () => {
  const el = document.getElementById("s-notification-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ notification_hour: el.value }, hint);
});

document.getElementById("s-sync-hour").addEventListener("change", () => {
  const el = document.getElementById("s-sync-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ sync_hour: el.value }, hint);
});
document.getElementById("s-genre-hour").addEventListener("change", () => {
  const el = document.getElementById("s-genre-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ genre_hour: el.value }, hint);
});
document.getElementById("s-data-hour").addEventListener("change", () => {
  const el = document.getElementById("s-data-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ data_hour: el.value }, hint);
});

document.getElementById("s-backup-hour").addEventListener("change", () => {
  const el = document.getElementById("s-backup-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ backup_hour: el.value }, hint);
});

document.getElementById("s-appupdate-hour").addEventListener("change", () => {
  const el = document.getElementById("s-appupdate-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ app_update_hour: el.value }, hint);
});

document.getElementById("s-maint-hour").addEventListener("change", () => {
  const el = document.getElementById("s-maint-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ maint_hour: el.value }, hint);
});

document.getElementById("s-appupdate-auto").addEventListener("change", (e) => {
  saveSettingsPartial({ app_auto_update: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});

document.getElementById("s-telegram-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ telegram_enabled: e.target.checked ? "1" : "0" }, e.target.closest(".notify-row").querySelector(".saved-hint"));
});
document.getElementById("s-ntfy-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ ntfy_enabled: e.target.checked ? "1" : "0" }, e.target.closest(".notify-row").querySelector(".saved-hint"));
});
document.getElementById("s-discord-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ discord_enabled: e.target.checked ? "1" : "0" }, e.target.closest(".notify-row").querySelector(".saved-hint"));
});
document.getElementById("s-email-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ email_enabled: e.target.checked ? "1" : "0" }, e.target.closest(".notify-row").querySelector(".saved-hint"));
});
document.getElementById("s-center-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ notif_center_enabled: e.target.checked ? "1" : "0" }, e.target.closest(".notify-row").querySelector(".saved-hint"));
});

renderNotifTypes();

document.getElementById("s-cache-ttl").addEventListener("change", () => {
  const el = document.getElementById("s-cache-ttl");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ cache_ttl: el.value }, hint);
});

document.getElementById("s-early-watched-days").addEventListener("change", () => {
  const el = document.getElementById("s-early-watched-days");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ early_watched_days: el.value }, hint);
});

async function runChannelTest(body) {
  const r = await fetch("/api/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  showMsg(r.ok ? t("test_sent") : j.error || t("error"), r.ok);
}

function fieldVal(id) {
  return document.getElementById(id).value.trim();
}

document.getElementById("test-telegram").onclick = () => {
  runChannelTest({
    channel: "telegram",
    telegram_bot_token: fieldVal("s-token"),
    telegram_chat_id: fieldVal("s-chat"),
  });
};

document.getElementById("test-ntfy").onclick = () => {
  runChannelTest({ channel: "ntfy", ntfy_topic: fieldVal("s-ntfy") });
};

document.getElementById("test-discord").onclick = () => {
  runChannelTest({ channel: "discord", discord_webhook_url: fieldVal("s-discord-hook") });
};

document.getElementById("test-email").onclick = async () => {
  const body = {
    channel: "email",
    email_provider: document.getElementById("s-email-provider").value,
    email_from: fieldVal("s-email-from"),
    email_to: fieldVal("s-email-to"),
  };
  if (body.email_provider === "brevo") {
    body.brevo_api_key = fieldVal("s-brevo-cred");
  } else {
    body.smtp_host = fieldVal("s-smtp-host");
    body.smtp_port = fieldVal("s-smtp-port");
    body.smtp_user = fieldVal("s-smtp-user");
    const pass = document.getElementById("s-smtp-cred").value;
    if (pass) body.smtp_pass = pass;
  }
  await runChannelTest(body);
};

// Akordeonlar: tum kanal ayarlari Bildirim Ayarlari kutularinin icine tasindi (modal -> kutu ici)
function setTelegramVisible(on) {
  const box = document.getElementById("telegram-box");
  const inner = document.getElementById("telegram-credentials");
  if (!box || !inner) return;
  inner.style.display = on ? "" : "none";
  box.classList.toggle("telegram-open", on);
  box.classList.toggle("accordion-open", on);
}
function setNtfyVisible(on) {
  const box = document.getElementById("ntfy-box");
  const inner = document.getElementById("ntfy-credentials");
  if (!box || !inner) return;
  inner.style.display = on ? "" : "none";
  box.classList.toggle("accordion-open", on);
}
function setDiscordVisible(on) {
  const box = document.getElementById("discord-box");
  const inner = document.getElementById("discord-credentials");
  if (!box || !inner) return;
  inner.style.display = on ? "" : "none";
  box.classList.toggle("accordion-open", on);
}
function setEmailVisible(on) {
  const box = document.getElementById("email-box");
  const inner = document.getElementById("email-credentials");
  if (!box || !inner) return;
  inner.style.display = on ? "" : "none";
  box.classList.toggle("accordion-open", on);
  if (on) setEmailFrameVisible(true);
}
function setCenterVisible(on) {
  const box = document.getElementById("center-box");
  const inner = document.getElementById("center-credentials");
  if (!box || !inner) return;
  inner.style.display = on ? "" : "none";
  box.classList.toggle("accordion-open", on);
}

if (nxOnce("notif_accordions")) (function initAccordions() {
  [
    ["telegram-box", "telegram-credentials", "s-telegram-enabled", setTelegramVisible],
    ["ntfy-box", "ntfy-credentials", "s-ntfy-enabled", setNtfyVisible],
    ["discord-box", "discord-credentials", "s-discord-enabled", setDiscordVisible],
    ["email-box", "email-credentials", "s-email-enabled", setEmailVisible],
    ["center-box", "center-credentials", "s-center-enabled", setCenterVisible],
  ].forEach(([boxId, innerId, switchId, setter]) => {
    const box = document.getElementById(boxId);
    const inner = document.getElementById(innerId);
    if (!box || !inner) return;
    box.addEventListener("click", (e) => {
      if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("button") || e.target.closest("a") || e.target.closest(".provider-list")) return;
      const isOpen = inner.style.display !== "none";
      setter(!isOpen);
    });
    const sw = document.getElementById(switchId);
    if (sw) sw.addEventListener("click", (e) => e.stopPropagation());
  });
})();

// Faz 24b: Bildirim Kanallari dis akordeonu — 5 kanal kutusunu saran cerceve.
// Ic kanal akordeonlari (initAccordions) aynen korunur; ic kutu tiklamalari dis akordeonu tetiklemez.
if (nxOnce("channels_accordion")) (function initChannelsAccordion() {
  const box = document.getElementById("channels-accordion");
  const body = document.getElementById("channels-body");
  if (!box || !body) return;
  box.addEventListener("click", (e) => {
    if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("button") || e.target.closest("a") || e.target.closest(".provider-list")) return;
    // Ic kanal kutularina tiklaninca dis akordeon kapanmasin (katman 2 kendi handler'inda)
    if (e.target.closest(".channel-box:not(#channels-accordion)")) return;
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "";
    box.classList.toggle("accordion-open", !isOpen);
  });
})();

// Bildirim Merkezi ayarlari: degisimde state + kayit + menu aciksa liste tazele
function refreshNotifMenuIfOpen() {
  import("./notification.js?v=660").then((m) => {
    const menu = document.getElementById("notif-menu");
    if (menu && menu.classList.contains("open")) m.fetchList();
  }).catch(() => {});
}

function setCenterTime(mode) {
  const rel = document.getElementById("s-notif-relative");
  const abs = document.getElementById("s-notif-absdate");
  const hint = document.querySelector("#center-credentials .saved-hint") || document.querySelector("#channel-center-modal .saved-hint");
  // tam biri daima acik: aktif olan kapatilamaz, digerine gecilir
  if (!rel.checked && !abs.checked) {
    if (mode === "relative") rel.checked = true; else abs.checked = true;
    return;
  }
  state.notifTimeFormat = mode;
  saveSettingsPartial({ notif_center_time: mode }, hint);
  refreshNotifMenuIfOpen();
}

document.getElementById("s-notif-relative").addEventListener("change", () => {
  const rel = document.getElementById("s-notif-relative");
  const abs = document.getElementById("s-notif-absdate");
  if (rel.checked) {
    abs.checked = false;
    setCenterTime("relative");
  } else {
    abs.checked = true;
    setCenterTime("absolute");
  }
});

document.getElementById("s-notif-absdate").addEventListener("change", () => {
  const rel = document.getElementById("s-notif-relative");
  const abs = document.getElementById("s-notif-absdate");
  if (abs.checked) {
    rel.checked = false;
    setCenterTime("absolute");
  } else {
    rel.checked = true;
    setCenterTime("relative");
  }
});

document.getElementById("s-notif-poster").addEventListener("change", (e) => {
  state.notifCenterPoster = e.target.checked;
  saveSettingsPartial({ notif_center_poster: e.target.checked ? "1" : "0" }, document.querySelector("#center-credentials .saved-hint") || document.querySelector("#channel-center-modal .saved-hint"));
  refreshNotifMenuIfOpen();
});

document.getElementById("s-notif-hideread").addEventListener("change", (e) => {
  state.notifCenterHideRead = e.target.checked;
  saveSettingsPartial({ notif_center_hide_read: e.target.checked ? "1" : "0" }, document.querySelector("#center-credentials .saved-hint") || document.querySelector("#channel-center-modal .saved-hint"));
  refreshNotifMenuIfOpen();
});

document.getElementById("s-notif-limit").addEventListener("change", () => {
  const el = document.getElementById("s-notif-limit");
  const v = parseInt(el.value, 10);
  if (![20, 50, 100].includes(v)) return;
  state.notifCenterLimit = v;
  saveSettingsPartial({ notif_center_limit: String(v) });
  refreshNotifMenuIfOpen();
});

document.querySelectorAll(".channel-sub-close").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const ov = btn.closest(".modal-overlay");
    if (!ov) return;
    ov.style.display = "none";
    if (ov.id === "channel-email-modal") setEmailFrameVisible(false);
  });
});

document.querySelectorAll(".channel-sub-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target !== ov) return;
    ov.style.display = "none";
    if (ov.id === "channel-email-modal") setEmailFrameVisible(false);
  });
});

// e-posta akordeonu kapsami yukarida Faz 19c dinleyicisine eklendi

// ---- Third Party Apps (Faz 29): genisletilebilir uygulama kartlari ----
// Yeni uygulama = backend THIRDPARTY_APPS'e satir + buraya renderer. Cekirdek donguye dokunulmaz.

let tpStremioOpen = false;
let tpCalendarOpen = false;
// 1.86: webhook uygulamalari (Plex / Jellyfin / Emby) kartlari.
let tpPlexOpen = false;
let tpJellyfinOpen = false;
let tpEmbyOpen = false;
let tpTraktOpen = false;
let tpTraktClientId = "";
// 1.87: Emby kartinin IC akordeonlari (Webhook / API Key / Access Token) — biri acilinca digeri kapanir.
let tpEmbySection = "";
// 1.87: Emby API alanlarinin SON KAYITLI degerleri. Sistem geneli kural: kutularda
// DEGISIKLIK YOKSA kaydetme (bkz. flushTpBaseUrl deseni). Kart cizilirken sunucu
// durumundan, basarili kayittan sonra POST yanitindan guncellenir.
let tpEmbyApiUrl = "";
let tpEmbyApiUser = "";
let tpEmbyApiHasKey = false;
let tpEmbyApiSaving = false;
// 1.94: Access Token alanlari. Token yalnizca POST yanitindan/elle girişten
// sonra gorunur; sayfa yenilenince GET token dondurmedigi icin bos gelir.
let tpEmbyTokenVisible = "";
let tpEmbyTokenHas = false;
let tpEmbyTokenUser = "";
let tpEmbyTokenSaving = false;
let tpEmbyTokenDirty = false;
let tpBaseUrl = "";
let tpIsAdmin = false;
let tpAskBeforeWatched = true;
// 1.88: kaynak bazli "izlendi bilgisi sor" degerleri ("" = genel ayar gecerli).
let tpAskSrc = { plex: "", jellyfin: "", emby: "" };
// Uzak Bağlantı (VPS): profil + Uzak Bağlantı kartı + telefon peer'leri.
let tpVpsOpen = false;
// 1.87: Public Adres kendi akordeonunda (Stremio karti icinden cikarildi).
let tpPublicOpen = false;
let tpRemoteOpen = false;
let vpsProfile = null;
let vpsGate = { configured: false, connected: false, everConnected: false, rootReady: false, rootVerified: false, loginUser: "" };
let vpsAuth = "key";
let vpsSecretMasked = false;
let remoteJobTimer = null;

async function renderThirdPartyApps(opts = {}) {
  const wrap = document.getElementById("thirdparty-apps");
  if (!wrap) return;
  // silent: aksiyon sonrasi yenileme -> yukleme placeholder'i basilmaz; veriler
  // gelene kadar mevcut DOM ekranda kalir (modal bosalip yeniden kurulmus gibi
  // gorunmez). Kaydirma konumu ve odak da korunur.
  const silent = !!opts.silent;
  const scroller = wrap.closest(".modal-body") || wrap.parentElement;
  const keepScroll = silent && scroller ? scroller.scrollTop : 0;
  const focusId = silent && document.activeElement && document.activeElement.id ? document.activeElement.id : "";
  const restoreView = () => {
    if (silent && scroller) scroller.scrollTop = keepScroll;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    }
  };
  if (!silent) wrap.innerHTML = `<div class="releases-loading">${t("loading")}</div>`;
  let apps = [];
  try {
    const r = await fetch("/api/thirdparty/status", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "status");
    apps = j.apps || [];
  } catch (e) {
    wrap.innerHTML = `<div class="releases-error">${errText((e && e.message) || "") || t("data_failed")}</div>`;
    return;
  }
  try {
    const s = await fetch("/api/settings", { cache: "no-store" });
    const sj = await s.json();
    tpBaseUrl = (s.ok && sj && sj.tp_base_url ? String(sj.tp_base_url) : "").trim();
    tpIsAdmin = !!(s.ok && sj && sj.is_admin);
    tpAskBeforeWatched = !!(s.ok && sj && (sj.ask_before_watched || "1") !== "0");
    tpAskSrc = {
      plex: String((s.ok && sj && sj.ask_before_watched_plex) || ""),
      jellyfin: String((s.ok && sj && sj.ask_before_watched_jellyfin) || ""),
      emby: String((s.ok && sj && sj.ask_before_watched_emby) || ""),
    };
  } catch (_) {
    tpBaseUrl = "";
    tpIsAdmin = false;
    tpAskBeforeWatched = true;
    tpAskSrc = { plex: "", jellyfin: "", emby: "" };
  }
  let vpsHtml = "";
  if (tpIsAdmin) {
    try {
      const vs = await fetch("/api/remote/vps-status", { cache: "no-store" });
      const vj = await vs.json();
      if (vs.ok && vj && vj.ok) {
        vpsProfile = vj;
        vpsGate = { configured: !!vj.configured, connected: !!(vj.connected && vj.configured), everConnected: !!vj.everConnected,
                    rootReady: !!vj.rootReady, rootVerified: !!vj.rootVerified, loginUser: vj.loginUser || vj.username || "" };
        vpsAuth = vj.auth_type === "password" ? "password" : "key";
      }
    } catch (_) {
      vpsProfile = null;
      vpsGate = { configured: false, connected: false, rootReady: false, rootVerified: false, loginUser: "" };
    }
    vpsHtml = renderVpsSection();
  }
  // 1.87: Public Adres karti — Sunucu Baglanti Ayarlari ile Stremio arasinda.
  const publicHtml = renderPublicBaseCard();
  if (!apps.length) {
    wrap.innerHTML = vpsHtml + publicHtml + `<div class="fav-empty">${t("tp_empty")}</div>`;
    bindThirdPartyEvents();
    restoreView();
    return;
  }
  wrap.innerHTML = vpsHtml + publicHtml + apps
    .map((app) => {
      const renderer = thirdPartyAppRenderers[app.id];
      try {
        return renderer ? renderer(app) : `<div class="channel-box notif-type-box"><div class="notif-type-head"><span class="notif-type-title">${escAttr(app.name || app.id)}</span></div></div>`;
      } catch (e) {
        return `<div class="channel-box notif-type-box"><div class="notif-type-head"><span class="notif-type-title">${escAttr(app.name || app.id)}</span></div></div>`;
      }
    })
    .join("");
  bindThirdPartyEvents();
  restoreView();
}

const thirdPartyAppRenderers = {
  stremio: (app) => {
    const _note = tpStatusNote(app);
    const rootOk = vpsRootReady();
    const cardDisabled = tpIsAdmin && !rootOk;
    const stremioInstalled = !!(vpsProfile && vpsProfile.stremioInstalled);
    const installBtnDisabled = !(tpIsAdmin && rootOk && vpsGate.connected && (!stremioInstalled || !app.tunnelOk));
    const tunnelRemoveDisabled = !rootOk;
    // 1.87: "Kurulum Baglantisi (URL)" yalniz PUBLIC adresten uretilir; public adres
    // tanimli degilse LAN adresi YAZILMAZ, "Public adres tanimli degil" notu gosterilir.
    const stremioInstallLabel = (app.installUrl || app.installed) ? `
        <label><span class="settings-label-head"><span data-i18n="tp_install_url_pub">${t("tp_install_url_pub")}</span></span>
          ${app.installUrl ? `<div class="tp-url-box"><input id="tp-stremio-url" type="text" readonly value="${escAttr(app.installUrl)}" /><button id="tp-stremio-copy" class="tab" data-i18n="tp_copy">${t("tp_copy")}</button></div>`
            : `<div class="tp-frame-note tp-warn">${t("tp_public_missing")}</div>`}
        </label>` : "";
    return `
    <div class="channel-box accordion-box notif-type-box${tpStremioOpen ? " accordion-open" : ""}${cardDisabled ? " tp-card-disabled" : ""}" id="tp-app-stremio"${cardDisabled ? ` title="${t("vps_gate_tooltip")}"` : ""}>
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-cubes"></i> ${escAttr(app.name || "Stremio")}</span>
      </div>
      <div class="notif-type-body" style="display:${tpStremioOpen ? "block" : "none"}">
        ${tpAskToggle("stremio")}
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${tpStatusClass(app)}">${tpStatusText(app)}</span>
          </div>
          ${_note ? `<div class="tp-frame-note">${_note}</div>` : ""}
        </div>
        ${tpSignalBox(app.lastSignal, app.lastWatch)}
        ${stremioInstallLabel ? `
        <div class="tp-sub-box">
          ${stremioInstallLabel}
        </div>` : ""}
        <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${vpsBtnOrTip(`<button id="tp-stremio-install" class="tab"${installBtnDisabled ? " disabled aria-disabled=\"true\"" : ""}>${stremioInstalled && !app.tunnelOk ? t("stremio_install_repair") : t("install_on_vps")}</button>`, installBtnDisabled, app.status === "connected")}
          <button id="tp-stremio-refresh" class="tab" data-i18n="tp_refresh_uuid">${t("tp_refresh_uuid")}</button>
          ${tpIsAdmin && app.tunnelInstalled ? vpsBtnOrTip(`<button id="tp-stremio-tunnel-remove" class="tab" data-i18n="tunnel_remove_btn"${tunnelRemoveDisabled ? " disabled aria-disabled=\"true\"" : ""}>${t("tunnel_remove_btn")}</button>`, tunnelRemoveDisabled, app.status === "connected") : ""}
          ${app.installed ? `<button id="tp-stremio-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>` : ""}
        </div>
        ${tpIsAdmin ? `<pre id="tp-stremio-joblog" class="tp-joblog" style="display:none"></pre>` : ""}
      </div>
    </div>`;
  },
  calendar: (app) => {
    const url = app.installUrl || "";
    return `
    <div class="channel-box accordion-box notif-type-box${tpCalendarOpen ? " accordion-open" : ""}" id="tp-app-calendar">
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-calendar-days"></i> ${escAttr(app.name || "Takvim (ICS)")}</span>
      </div>
      <div class="notif-type-body" style="display:${tpCalendarOpen ? "block" : "none"}">
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${tpStatusClass(app)}">${tpStatusText(app)}</span>
          </div>
          <div class="tp-frame-note">${t("tp_calendar_note")}</div>
        </div>
        ${app.installed ? `
        <div class="tp-sub-box">
          <label><span class="settings-label-head"><span data-i18n="tp_install_url_pub">${t("tp_install_url_pub")}</span></span>
            ${url ? `<div class="tp-url-box"><input id="tp-calendar-url" type="text" readonly value="${escAttr(url)}" /><button id="tp-calendar-copy" class="tab" data-i18n="tp_copy">${t("tp_copy")}</button></div>`
              : `<div class="tp-frame-note tp-warn">${t("tp_public_missing")}</div>`}
          </label>
        </div>` : ""}
        <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${tpVpsInstallBtn(app)}
          <button id="tp-calendar-refresh" class="tab" data-i18n="tp_refresh_uuid">${t("tp_refresh_uuid")}</button>
          ${app.installed ? `<button id="tp-calendar-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>` : ""}
        </div>
      </div>
    </div>`;
  },
  // 1.86: Plex / Jellyfin / Emby — webhook ile izleme sinyali (aynı iskelet).
  plex: (app) => tpWebhookCard(app, tpPlexOpen, "fa-circle-play", null),
  jellyfin: (app) => tpWebhookCard(app, tpJellyfinOpen, "fa-clapperboard", null),
  emby: (app) => tpWebhookCard(app, tpEmbyOpen, "fa-photo-film", null),
  // 2.03: Trakt — OAuth device code; tek/çift yön; per-user yoklama.
  trakt: (app) => {
    const configured = !!app.traktConfigured;
    const connected = !!app.traktConnected;
    tpTraktClientId = app.traktClientId || "";
    const urlAvail = !!String(app.traktRedirectUriUrl || "").trim();
    const lanActive = urlAvail ? (String(app.traktRedirectMode || "lan") === "lan") : true;
    const urlActive = urlAvail && !lanActive;
    const user = app.traktUser || "";
    const twoWay = !!app.traktTwoWay;
    // 2.19.7: yon (both|out|in|none) — eski tek switch alanindan turetilir.
    const dir = String(app.traktDirection || (twoWay ? "both" : "in"));
    const pollMin = (typeof app.traktPollMin === "number") ? app.traktPollMin : 10;
    const st = String(app.traktStatus || "not-connected");
    const stCls = st === "connected" ? "tp-connected" : (st === "ready" ? "tp-ready" : "tp-not-connected");
    const stTxt = t("tp_trakt_status_" + st.replace(/-/g, "_"));
    const err = String(app.traktError || "");
    const errTxt = err ? tpTraktErrText(err) : "";
    // 2.19.6: senkron havuzu durumu (kuyruk + yoklama araligi).
    const poolPending = Number(app.traktPoolPending || 0);
    const poolFailed = Number(app.traktPoolFailed || 0);
    const poolInterval = Number(app.traktPoolInterval || 0);
    const poolActive = !!app.traktPoolActive;
    const poolLast = app.traktPoolLastTs
      ? new Date(Number(app.traktPoolLastTs) * 1000).toLocaleTimeString() : "";
    let poolTxt = poolPending
      ? t("tp_trakt_pool_pending", { n: poolPending })
      : t("tp_trakt_pool_idle");
    if (poolFailed) poolTxt += " · " + t("tp_trakt_pool_failed", { n: poolFailed });
    const poolIntTxt = poolInterval > 0
      ? (poolActive
          ? t("tp_trakt_pool_active", { n: poolInterval })
          : t("tp_trakt_pool_passive", { n: Math.max(1, Math.round(poolInterval / 60)) }))
      : t("tp_trakt_poll_off");
    const pollOpts = [0, 1, 5, 10, 15, 30, 60].map((n) => {
      const label = n === 0 ? t("tp_trakt_poll_off") : (n + " " + t("tp_trakt_min"));
      return `<option value="${n}"${pollMin === n ? " selected" : ""}>${escAttr(label)}</option>`;
    }).join("");
    const redirRow = (mode, labelKey, uri, active) => {
      const tip = escAttr(t(active ? "tp_trakt_redirect_active" : "tp_trakt_redirect_activate", { mode: mode.toUpperCase() }));
      return `<label><span class="settings-label-head"><span data-i18n="${labelKey}">${t(labelKey)}</span></span>
            <div class="tp-url-box"><input id="tp-trakt-redirect-${mode}" type="text" readonly value="${escAttr(uri || "")}"${active ? "" : " disabled"} /><button type="button" class="tp-redir-btn ${active ? "on" : "off"}" data-mode="${mode}" data-tip="${tip}">${active ? CHECK_SVG : ROLE_X_SVG}</button><button id="tp-trakt-redirect-${mode}-copy" class="tab" data-i18n="tp_copy"${active ? "" : " disabled"}>${t("tp_copy")}</button></div>
          </label>`;
    };
    return `
    <div class="channel-box accordion-box notif-type-box${tpTraktOpen ? " accordion-open" : ""}" id="tp-app-trakt">
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-clapperboard"></i> ${escAttr(app.name || "Trakt")}</span>
      </div>
      <div class="notif-type-body" style="display:${tpTraktOpen ? "block" : "none"}">
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${stCls}">${escAttr(stTxt)}</span>
          </div>
          ${user ? `<div class="tp-status-row"><span class="notify-name">${t("tp_trakt_user")}</span><span class="tp-status-value">${escAttr(user)}</span></div>` : ""}
          ${connected ? `<div class="tp-status-row"><span class="notify-name">${t("tp_trakt_last_check")}</span><span class="tp-last-signal">${app.traktCheckedTs ? formatSignalTime(app.traktCheckedTs) : "—"}</span></div>` : ""}
          ${connected ? `
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_trakt_pool")}</span>
            <span class="tp-last-signal">${escAttr(poolTxt)}</span>
          </div>
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_trakt_poll_effective")}</span>
            <span class="tp-last-signal">${escAttr(poolIntTxt)}</span>
          </div>
          ${poolLast ? `<div class="tp-status-row"><span class="notify-name">${t("tp_trakt_pool_last")}</span><span class="tp-last-signal">${escAttr(poolLast)}</span></div>` : ""}` : ""}
          ${errTxt ? `<div class="tp-frame-note tp-warn">${escAttr(errTxt)}</div>` : ""}
          ${app.traktPoolLastError ? `<div class="tp-frame-note tp-warn">${escAttr(tpTraktErrText(String(app.traktPoolLastError)))}</div>` : ""}
        </div>
        ${tpSignalBox(app.traktLastSignal, app.traktLastWatch)}
        ${connected ? `
        <div class="tp-sub-box">
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_both")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="both" ${dir === "both" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_out")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="out" ${dir === "out" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_in")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="in" ${dir === "in" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="tp-frame-note">${t("tp_trakt_dir_note_" + dir)}</div>
        </div>
        <label><span class="settings-label-head"><span data-i18n="tp_trakt_poll">${t("tp_trakt_poll")}</span></span>
          <div class="provider-combobox">
            <select id="tp-trakt-poll">${pollOpts}</select>
            <div id="tp-trakt-poll-list" class="provider-list" style="display:none"></div>
          </div>
        </label>` : ""}
        <div class="tp-sub-box">
          ${redirRow("lan", "tp_trakt_redirect_lan", app.traktRedirectUriLan, lanActive)}
          ${urlAvail ? redirRow("url", "tp_trakt_redirect_url", app.traktRedirectUriUrl, urlActive) : ""}
        </div>
        <div class="tp-sub-box">
          <label><span class="settings-label-head"><span data-i18n="tp_trakt_client_id">${t("tp_trakt_client_id")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-trakt-client-id" type="text" autocomplete="off" spellcheck="false" placeholder="Client ID" value="${escAttr(tpTraktClientId)}" /></div>
          </label>
          <label><span class="settings-label-head"><span data-i18n="tp_trakt_client_secret">${t("tp_trakt_client_secret")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-trakt-client-cred" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" data-protonpass-ignore="true" placeholder="Client Secret" /></div>
          </label>
        </div>
        ${connected ? `
        <div class="tp-sub-box">
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_both")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="both" ${dir === "both" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_out")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="out" ${dir === "out" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="notify-row">
            <span class="notify-name">${t("tp_trakt_dir_in")}</span>
            <label class="switch"><input type="checkbox" class="tp-trakt-dir" data-mode="in" ${dir === "in" ? "checked" : ""} /><span class="slider"></span></label>
          </div>
          <div class="tp-frame-note">${t("tp_trakt_dir_note_" + dir)}</div>
        </div>
        <label><span class="settings-label-head"><span data-i18n="tp_trakt_poll">${t("tp_trakt_poll")}</span></span>
          <div class="provider-combobox">
            <select id="tp-trakt-poll">${pollOpts}</select>
            <div id="tp-trakt-poll-list" class="provider-list" style="display:none"></div>
          </div>
        </label>
        <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${tpVpsInstallBtn(app)}
          <button id="tp-trakt-check" class="tab">${t("tp_trakt_sync_now")}</button>
          <button id="tp-trakt-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>
        </div>` : (configured ? `
        <label><span class="settings-label-head"><span data-i18n="tp_trakt_callback_uri">${t("tp_trakt_callback_uri")}</span></span>
          <div class="tp-url-box"><input id="tp-trakt-callback-uri" type="text" readonly value="${escAttr(app.traktAuthRedirectUri || "")}" /><button id="tp-trakt-callback-copy" class="tab" data-i18n="tp_copy">${t("tp_copy")}</button></div>
        </label>
        <div class="tp-frame-note">${t("tp_trakt_callback_note")}</div>
        <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${tpVpsInstallBtn(app)}
          <button id="tp-trakt-connect" class="tab">${t("tp_trakt_connect")}</button>
        </div>
        <div id="tp-trakt-device" class="tp-sub-box" style="display:none"></div>` : "")}
      </div>
    </div>`;
  },
  remote: (app) => {    const isConn = app.status === "connected";
    const cls = isConn ? "tp-connected" : "tp-not-connected";
    const txt = isConn ? t("tp_connected") : t("tp_not_connected");
    const gate = vpsGate.connected;
    const rootOk = vpsRootReady();
    const cardDisabled = tpIsAdmin && !rootOk;
    const installOff = !gate || !rootOk || !!app.installed;
    const installBtn = vpsBtnOrTip(`<button id="tp-remote-install" class="tab"${installOff ? " disabled aria-disabled=\"true\"" : ""}>${t("install_on_vps")}</button>`, installOff, isConn);
    let actionBtn = "";
    if (isConn) {
      actionBtn = `<button id="tp-remote-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>`;
    } else if (app.installed) {
      actionBtn = `<button id="tp-remote-connect" class="tab">${t("remote_connect")}</button>`;
    }
    return `
    <div class="channel-box accordion-box notif-type-box${tpRemoteOpen ? " accordion-open" : ""}${cardDisabled ? " tp-card-disabled" : ""}" id="tp-app-remote"${cardDisabled ? ` title="${t("vps_gate_tooltip")}"` : ""}>
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-network-wired"></i> ${escAttr(app.name || "Uzak Bağlantı")}</span>
      </div>
      <div class="notif-type-body" style="display:${tpRemoteOpen ? "block" : "none"}">
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${cls}">${escAttr(txt)}</span>
          </div>
          ${app.lastSignal ? `<div class="tp-status-row"><span class="notify-name">${t("vps_last_test")}</span><span class="tp-last-signal">${formatSignalTime(app.lastSignal)}</span></div>` : ""}
        </div>
        ${tpIsAdmin ? `
        <div class="test-row" style="justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${installBtn}
          ${actionBtn}
          ${vpsBtnOrTip(`<button id="tp-peer-add" class="tab"${(gate && rootOk) ? "" : " disabled aria-disabled=\"true\""}>${t("peer_add")}</button>`, !(gate && rootOk), isConn)}
        </div>
        <pre id="tp-remote-joblog" class="tp-joblog" style="display:none"></pre>
        <div class="tp-sub-box" id="tp-peer-box">
          <span class="notif-type-title" data-i18n="peer_list_title">${t("peer_list_title")}</span>
          <div class="member-chips" id="tp-peer-list"></div>
        </div>` : ""}
      </div>
    </div>`;
  },
};

// 1.87: "Sunucuya Kur" (stremio | calendar | webhook).
// Etiket her zaman "Sunucuya Kur". Durum "Bagli" ise daha once kurulmus demektir ->
// dugme DISABLED kalir ve tooltip NEREDEN bagli oldugunu soyler:
//   "Bagli (LAN)" -> "{app} Webhook LAN uzerinden bagli"
//   "Bagli (URL)" -> "{app} Webhook URL uzerinden bagli"
// Henuz olay gelmemis (kurulu + tunel saglam) -> disabled, tooltip "Kurulu".
// Yol yok -> kurulum · yol var + tunel kopuk -> "Onar".
function tpVpsInstallBtn(app) {
  if (!tpIsAdmin || !app || !app.vpsProfile) return "";
  const aid = String(app.id || "");
  const routeOk = !!app.vpsRouteOk;
  const tunOk = app.vpsTunnelOk !== false;
  const isHook = app.vpsProfile === "webhook";
  const via = String(app.verifiedVia || "").toLowerCase();
  const nm = app.name || aid;
  const repair = routeOk && !tunOk;
  const connected = !!app.connected;
  const idle = !repair && ((routeOk && tunOk) || (isHook && connected));
  const label = repair ? t("stremio_install_repair") : t("install_on_vps");
  let ttl = "";
  if (!repair && isHook && connected && via === "lan") ttl = t("tp_lan_connected", { app: nm });
  else if (!repair && isHook && connected && via === "url") ttl = t("tp_url_connected", { app: nm });
  else if (routeOk && tunOk) ttl = t("vps_installed");
  const dis = idle ? " disabled aria-disabled=\"true\"" : "";
  const ttlAttr = ttl ? ` title="${escAttr(ttl)}"` : "";
  return `<button id="tp-vps-install-${escAttr(aid)}" class="tab"${dis}${ttlAttr}>${label}</button>`;
}

function tpWebhookCard(app, open, icon, noteKey) {
  const aid = String(app.id || "");
  const url = app.installUrl || "";
  const isEmby = aid === "emby";
  // 1.87: baslik eki — Plex webhook'u Plex Pass gerektirir (PLEX (PLEX PASS)).
  const titleSuffix = aid === "plex" ? " (" + t("tp_plex_pass") + ")" : "";
  // 1.87: Emby kartinda IC akordeonlar (Webhook / API Key) — biri acilinca digeri kapanir.
  const secOpen = (which) => isEmby && tpEmbySection === which;
  if (isEmby) {
    // Cizilen kutular = kayitli durum (degisiklik yoksa kaydetmeme kuralinin temeli).
    tpEmbyApiUrl = app.apiUrl || "";
    tpEmbyApiUser = app.apiUser || "";
    tpEmbyApiHasKey = !!app.apiHasKey;
    tpEmbyTokenHas = !!app.apiHasToken;
    tpEmbyTokenUser = app.apiTokenUser || app.apiUser || "";
  }
  // Durum kutusu: Emby'de webhook cercevesinin en ustunde; diger (Plex/Jellyfin)
  // kartlarda kart basliginin altinda kalir.
  const statusSub = (extra = "") => `
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${tpStatusClass(app)}">${tpStatusText(app)}</span>
          </div>
          ${extra}
        </div>`;
  const notesHtml = noteKey ? `
          <div class="tp-frame-note">${t(noteKey)}</div>` : "";
  // 1.87: LAN cercevesi — yalnizca kartin TAM LAN linki (taban adres kutusu YOK).
  // Baslik, URL cercevesiyle BIREBIR ayni markup/stilde (sola yasli) — istek #3/#4.
  const lanUrl = app.lanInstallUrl || "";
  // 2.07: kurulum linki tercihi — aktif satir yesil tick, pasif satir kirmizi x (tiklayinca gecirir).
  const lanAvail = !!lanUrl;
  const urlAvail = !!(url && app.installed);
  let linkMode = String(app.linkMode || "lan").toLowerCase() === "url" ? "url" : "lan";
  if (!lanAvail && urlAvail) linkMode = "url";
  if (!urlAvail) linkMode = "lan";
  const lanActive = linkMode === "lan";
  const urlActive = linkMode === "url";
  const linkBtn = (mode, active) => `<button type="button" class="tp-redir-btn ${active ? "on" : "off"}" data-link-app="${escAttr(aid)}" data-link-mode="${mode}" data-tip="${escAttr(t(active ? "tp_install_link_active" : "tp_install_link_activate", { mode: mode.toUpperCase() }))}">${active ? CHECK_SVG : ROLE_X_SVG}</button>`;
  const lanLabel = lanUrl ? `
            <label><span class="settings-label-head"><span data-i18n="tp_install_url_lan">${t("tp_install_url_lan")}</span></span>
              <div class="tp-url-box"><input id="tp-${escAttr(aid)}-lanurl" type="text" readonly value="${escAttr(lanUrl)}"${lanActive ? "" : " disabled"} />${linkBtn("lan", lanActive)}<button id="tp-${escAttr(aid)}-lancopy" class="tab" data-i18n="tp_copy"${lanActive ? "" : " disabled"}>${t("tp_copy")}</button></div>
            </label>` : "";
  const urlLabel = app.installed ? `
            <label><span class="settings-label-head"><span data-i18n="tp_install_url_pub">${t("tp_install_url_pub")}</span></span>
              ${url ? `<div class="tp-url-box"><input id="tp-${escAttr(aid)}-url" type="text" readonly value="${escAttr(url)}"${urlActive ? "" : " disabled"} />${linkBtn("url", urlActive)}<button id="tp-${escAttr(aid)}-copy" class="tab" data-i18n="tp_copy"${urlActive ? "" : " disabled"}>${t("tp_copy")}</button></div>`
                : `<div class="tp-frame-note tp-warn">${t("tp_public_missing")}</div>`}
            </label>` : "";
  // 2.05: LAN + URL kurulum cerceveleri TEK kutu icinde.
  const linksHtml = (lanLabel || urlLabel) ? `
          <div class="tp-sub-box">
            ${lanLabel}
            ${urlLabel}
          </div>` : "";
  const webhookHtml = `
          ${tpSignalBox(app.lastSignal, app.lastWatch)}
          ${linksHtml}
          <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
            ${tpVpsInstallBtn(app)}
            <button id="tp-${escAttr(aid)}-refresh" class="tab" data-i18n="tp_refresh_uuid">${t("tp_refresh_uuid")}</button>
            ${app.installed ? `<button id="tp-${escAttr(aid)}-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>` : ""}
          </div>`;
  // 1.87: API cercevesinin EN USTUNDE durum kutusu (yapilandirilmamis -> "Bagli degil",
  // yapilandirilmis ama senkron yok -> "Hazir", senkron var -> "Bagli").
  // "API modu" gostergesi kaldirildi; WebSocket/yoklama bilgisi son senkron detayinda kalir.
  const apiCls = app.lastSync ? "tp-connected" : (app.apiConfigured ? "tp-ready" : "tp-not-connected");
  // 1.87: API durumu da nereden bagli oldugunu gosterir ("Bagli (LAN)"/"Bagli (URL)").
  const apiViaTxt = app.apiVia === "lan" ? " " + t("tp_via_lan") : (app.apiVia === "url" ? " " + t("tp_via_url") : "");
  const apiTxt = app.lastSync ? t("tp_connected") + apiViaTxt
                : (app.apiConfigured ? t("tp_ready") : t("tp_not_connected"));
  // 1.87: durum cercevesi + "Son sinyal" (zaman + "xyz izlendi") + tasiyici satiri
  // (sol: Aninda/Kontrol(15 dk) · sag: {n} Izlenmis).
  // 1.94: yalnizca kullanici token'i ile bagli WS "Aninda" sayilir; API key
  // ile kurulan kullanici oturumsuz WS yedek yoklama sayilir.
  const apiMode = (app.apiWsConnected && app.apiWsAuth === "token")
    ? t("tp_emby_mode_ws") : t("tp_emby_mode_poll");
  const apiScan = (typeof app.apiScanCount === "number") ? t("tp_emby_scan_n", { n: app.apiScanCount }) : "—";
  const apiHtml = `
          <div class="tp-sub-box">
            <div class="tp-status-row">
              <span class="notify-name">${t("tp_status")}</span>
              <span class="tp-status-value ${apiCls}">${apiTxt}</span>
            </div>
          </div>
          ${tpSignalBox(app.apiLastSignal, app.apiLastWatch)}
          ${app.apiConfigured ? `<div class="tp-sub-box">
            <div class="tp-status-row">
              <span class="notify-name">${apiMode}</span>
              <span class="tp-status-value${typeof app.apiScanCount === "number" ? " tp-connected" : ""}">${apiScan}</span>
            </div>
          </div>` : ""}
          <label><span class="settings-label-head"><span data-i18n="tp_emby_api_url">${t("tp_emby_api_url")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-emby-api-url" type="text" placeholder="${escAttr(t("tp_emby_api_url_ph"))}" value="${escAttr(app.apiUrl || "")}" /></div>
          </label>
          <label><span class="settings-label-head"><span data-i18n="tp_emby_api_key">${t("tp_emby_api_key")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-emby-api-cred" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" data-protonpass-ignore="true" placeholder="${app.apiHasKey ? "*******" : "API Key"}" /></div>
          </label>
          <label><span class="settings-label-head"><span data-i18n="tp_emby_api_user">${t("tp_emby_api_user")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-emby-api-user" type="text" value="${escAttr(app.apiUser || "")}" /></div>
          </label>
          <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
            <button id="tp-emby-api-test" class="tab">${t("tp_emby_api_test")}</button>
            ${app.apiConfigured ? `<button id="tp-emby-api-sync" class="tab">${t("tp_emby_sync_now")}</button>` : ""}
          </div>`;
  // 1.94: Access Token — kullaniciya bagli WebSocket icin. API Key yedek
  // yoklama olarak kalir. Token/parola GET'te donmez; yalnizca var/yok bilgisi.
  const tokStatus = String(app.apiTokenStatus || "off");
  const tokCls = tokStatus === "connected" ? "tp-connected"
    : (tokStatus === "ready" ? "tp-ready" : "tp-not-connected");
  const tokTxt = t("tp_emby_token_status_" + tokStatus.replace(/-/g, "_"));
  const tokErr = tpEmbyTokenErrText(app);
  const tokNext = Number(app.apiTokenNextTry || 0);
  const tokBackoff = tokNext && tokNext > Math.floor(Date.now() / 1000)
    ? `<div class="tp-frame-note">${escAttr(t("tp_emby_token_backoff", { time: formatSignalTime(tokNext) }))}</div>`
    : "";
  const tokLastCheck = app.apiTokenLastCheck ? formatSignalTime(app.apiTokenLastCheck) : "—";
  const tokLastRenew = app.apiTokenLastRenew ? formatSignalTime(app.apiTokenLastRenew) : "—";
  const tokUserName = tpEmbyTokenUser || app.apiTokenUser || app.apiUser || "";
  const tokenHtml = `
          <div class="tp-sub-box">
            <div class="tp-status-row">
              <span class="notify-name">${t("tp_status")}</span>
              <span class="tp-status-value ${tokCls}">${tokTxt}</span>
            </div>
            ${tokErr ? `<div class="tp-frame-note tp-warn">${escAttr(tokErr)}</div>` : ""}
            ${tokBackoff}
          </div>
          ${tpSignalBox(app.apiTokenLastSignal, app.apiTokenLastWatch)}
          <div class="tp-sub-box">
            <div class="tp-status-row"><span class="notify-name">${t("tp_emby_token_last_check")}</span><span class="tp-last-signal">${tokLastCheck}</span></div>
            <div class="tp-status-row"><span class="notify-name">${t("tp_emby_token_last_renew")}</span><span class="tp-last-signal">${tokLastRenew}</span></div>
          </div>
          <label><span class="settings-label-head"><span data-i18n="tp_emby_auth_user">${t("tp_emby_auth_user")}</span></span>
            <div class="tp-url-box"><input id="tp-emby-auth-name" type="text" autocomplete="off" data-form-type="other" value="${escAttr(tokUserName)}" /></div>
          </label>
          <label><span class="settings-label-head"><span data-i18n="tp_emby_auth_pass">${t("tp_emby_auth_pass")}</span></span>
            <div class="tp-url-box"><input id="tp-emby-auth-cred" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" data-protonpass-ignore="true" placeholder="${app.apiHasPassword ? "*******" : escAttr(t("tp_emby_auth_pass"))}" /></div>
          </label>
          <label><span class="settings-label-head"><span data-i18n="tp_emby_access_token">${t("tp_emby_access_token")}</span></span>
            <div class="tp-url-box">
              <input id="tp-emby-access-cred" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" data-protonpass-ignore="true" placeholder="${tpEmbyTokenHas ? "*******" : escAttr(t("tp_emby_token_ph"))}" value="${escAttr(tpEmbyTokenVisible)}" />
              <button id="tp-emby-token-show" class="tab" type="button">${t("tp_emby_token_show")}</button>
            </div>
          </label>
          <div class="tp-frame-note">${t("tp_emby_token_note")}</div>
          <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
            <button id="tp-emby-token-get" class="tab">${t("tp_emby_token_get")}</button>
            ${(app.apiHasToken || app.apiHasPassword) ? `<button id="tp-emby-token-check" class="tab">${t("tp_emby_token_check")}</button>` : ""}
            ${(app.apiHasToken || app.apiHasPassword) ? `<button id="tp-emby-token-clear" class="tab">${t("tp_emby_token_clear")}</button>` : ""}
          </div>`;
  const frame = (which, titleKey, inner) => `
        <div class="channel-box accordion-box notif-type-box${secOpen(which) ? " accordion-open" : ""}" id="tp-emby-sec-${which}">
          <div class="notif-type-head">
            <span class="notif-type-title">${t(titleKey)}</span>
          </div>
          <div class="notif-type-body" style="display:${secOpen(which) ? "block" : "none"}">
${inner}
          </div>
        </div>`;
  return `
    <div class="channel-box accordion-box notif-type-box${open ? " accordion-open" : ""}" id="tp-app-${escAttr(aid)}">
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid ${escAttr(icon)}"></i> ${escAttr(app.name || aid)}${escAttr(titleSuffix)}</span>
      </div>
      <div class="notif-type-body" style="display:${open ? "block" : "none"}">
        ${tpAskToggle(aid)}
        ${isEmby ? "" : statusSub(notesHtml)}
        ${isEmby
          ? frame("webhook", "tp_emby_frame_webhook", statusSub() + notesHtml + webhookHtml)
            + (tpIsAdmin ? frame("api", "tp_emby_api_key", apiHtml) : "")
            + (tpIsAdmin ? frame("token", "tp_emby_frame_token", tokenHtml) : "")
          : webhookHtml}
      </div>
    </div>`;
}

async function tpCopyInput(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let ok = false;
  try {
    await navigator.clipboard.writeText(input.value);
    ok = true;
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    try {
      input.select();
      input.setSelectionRange(0, 99999);
      ok = document.execCommand("copy");
    } catch (e2) {
      ok = false;
    }
  }
  toast(ok ? t("tp_copied") : t("error"));
}

async function tpRefreshUuid(aid, btn) {
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  try {
    const r = await fetch(`/api/thirdparty/${encodeURIComponent(aid)}/refresh-uuid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "refresh");
    toast(t("tp_webhook_refreshed"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  }
}

// 1.87: Emby API alanlari odaktan cikinca otomatik kaydedilir; sagda yesil
// "Kaydedildi" (saved-hint) gosterilir. Bos anahtar = mevcut anahtar korunur.
// Sistem geneli kural: DEGISIKLIK YOKSA kaydetme (flushTpBaseUrl deseni).
function embyApiFocused() {
  const a = document.activeElement;
  return !!(a && a.id && a.id.indexOf("tp-emby-api-") === 0);
}

// Sunucunun normalize ettigi bicimle karsilastir (trim + sonda / + sema ekle).
function _normEmbyUrl(u) {
  let v = String(u || "").trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//i.test(v)) v = "http://" + v;
  return v;
}

async function flushEmbyApi(inputEl) {
  if (tpEmbyApiSaving) return;
  const url = ((document.getElementById("tp-emby-api-url") || {}).value || "").trim();
  const key = ((document.getElementById("tp-emby-api-cred") || {}).value || "").trim();
  const user = ((document.getElementById("tp-emby-api-user") || {}).value || "").trim();
  // Degisiklik kapisi: uc alan da kayitli degerle ayniysa HIC kaydetme (sessiz cikis).
  const urlChanged = _normEmbyUrl(url) !== _normEmbyUrl(tpEmbyApiUrl);
  const userChanged = user !== (tpEmbyApiUser || "");
  const keyChanged = key !== "";
  if (!urlChanged && !userChanged && !keyChanged) return;
  tpEmbyApiSaving = true;
  const hint = (inputEl && inputEl.closest("label")) ? inputEl.closest("label").querySelector(".saved-hint") : null;
  try {
    const r = await fetch("/api/thirdparty/emby/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, key, user }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "save");
    // Kayitli degerleri yanittan tazele (ardisi blur'lar bosuna kaydetmesin).
    tpEmbyApiUrl = j.apiUrl || url;
    tpEmbyApiUser = j.apiUser || user;
    tpEmbyApiHasKey = !!j.apiHasKey;
    showSavedHint(hint);
    // Durum kutusu tazelensin; ama yazarken araya girilmesin (odakta alan varsa atla).
    setTimeout(() => {
      try {
        if (embyApiFocused()) return;
        renderThirdPartyApps({ silent: true });
      } catch (_) {}
    }, 1500);
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  } finally {
    tpEmbyApiSaving = false;
  }
}

// 2.09: Trakt Client ID/Secret — odaktan cikinca OTOMATIK kayit (Emby API deseni).
let tpTraktClientSaving = false;
function traktClientFocused() {
  const a = document.activeElement;
  return !!(a && (a.id === "tp-trakt-client-id" || a.id === "tp-trakt-client-cred"));
}
async function flushTraktClient(inputEl) {
  if (tpTraktClientSaving) return;
  const cid = ((document.getElementById("tp-trakt-client-id") || {}).value || "").trim();
  const csec = ((document.getElementById("tp-trakt-client-cred") || {}).value || "").trim();
  // 2.10: Alanlar BAGIMSIZ kaydedilir (backend kismi kaydi destekler: if cid / if csec).
  // Tetikleyen alan bos ise; ya da id degismediyse kaydetme.
  const isSecret = !!(inputEl && inputEl.id === "tp-trakt-client-cred");
  if (isSecret) {
    if (!csec) return;
  } else {
    if (!cid || cid === (tpTraktClientId || "")) return;
  }
  tpTraktClientSaving = true;
  const hint = (inputEl && inputEl.closest("label")) ? inputEl.closest("label").querySelector(".saved-hint") : null;
  try {
    const r = await fetch("/api/thirdparty/trakt/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cid, client_secret: csec }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "client");
    if (cid) tpTraktClientId = cid;
    showSavedHint(hint);
    // Kaydedildi -> durum kutusu/akis tazelensin ama yazarken araya girme.
    setTimeout(() => {
      try {
        if (traktClientFocused()) return;
        renderThirdPartyApps({ silent: true });
      } catch (_) {}
    }, 1500);
  } catch (e) {
    toast(tpTraktErrText((e && e.message) || ""), true);
  } finally {
    tpTraktClientSaving = false;
  }
}

// 1.94: Access Token durum/hata metinleri.
function tpEmbyTokenErrText(app) {
  const e = String((app && app.apiTokenError) || "");
  if (!e) return "";
  if (e === "auth") return t("tp_emby_token_err_auth");
  if (e === "credentials-missing") return t("tp_emby_token_err_missing");
  if (e.indexOf("unreachable") === 0) return t("tp_emby_token_err_unreachable");
  if (e.indexOf("HTTP ") === 0) return t("tp_emby_token_err_http", { code: e.slice(5) });
  return t("tp_emby_token_err_generic");
}

function tpEmbyTokenErrMsg(code) {
  const c = String(code || "");
  if (c === "auth" || c === "token-gecersiz") return t("tp_emby_token_err_auth");
  if (c.indexOf("unreachable") === 0) return t("tp_emby_token_err_unreachable");
  if (c === "eksik" || c === "kullanici") return t("tp_emby_token_err_missing");
  if (c.indexOf("HTTP ") === 0) return t("tp_emby_token_err_http", { code: c.slice(5) });
  return errText(c) || t("tp_emby_token_err_generic");
}

function tpEmbyTokenInputs() {
  return {
    user: ((document.getElementById("tp-emby-auth-name") || {}).value || "").trim(),
    // Parola bas/son bosluk icerebilir; trim etme.
    pass: ((document.getElementById("tp-emby-auth-cred") || {}).value || ""),
    token: ((document.getElementById("tp-emby-access-cred") || {}).value || "").trim(),
    url: (((document.getElementById("tp-emby-api-url") || {}).value || "").trim() || tpEmbyApiUrl),
  };
}

async function tpEmbyTokenFetch(btn) {
  if (tpEmbyTokenSaving) return;
  const v = tpEmbyTokenInputs();
  if (!v.user) { toast(t("tp_emby_token_err_missing"), true); return; }
  if (!v.pass && !v.token) { toast(t("tp_emby_token_err_missing"), true); return; }
  tpEmbyTokenSaving = true;
  const old = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.classList.add("loading");
    btn.textContent = t("tp_emby_token_fetching");
  }
  try {
    const body = { url: v.url, user: v.user };
    if (v.pass) body.password = v.pass;
    else body.token = v.token;
    const r = await fetch("/api/thirdparty/emby/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "token");
    tpEmbyTokenVisible = j.accessToken || v.token || "";
    tpEmbyTokenHas = true;
    tpEmbyTokenUser = j.tokenUser || v.user;
    tpEmbyTokenDirty = false;
    const passEl = document.getElementById("tp-emby-auth-cred");
    if (passEl) passEl.value = "";
    toast(t("tp_emby_token_saved"));
    renderThirdPartyApps({ silent: true });
    // WS handshake birkac saniye surer; durum satirini tekrar tazele.
    // Kullanici bu sirada alana yaziyorsa DOM'u degistirme.
    setTimeout(() => {
      try {
        const a = document.activeElement;
        if (a && a.id && a.id.indexOf("tp-emby-") === 0) return;
        renderThirdPartyApps({ silent: true });
      } catch (_) {}
    }, 2500);
  } catch (e) {
    toast(tpEmbyTokenErrMsg((e && e.message) || ""), true);
  } finally {
    tpEmbyTokenSaving = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = old || t("tp_emby_token_get");
    }
  }
}

async function tpEmbyTokenCheck(btn) {
  if (tpEmbyTokenSaving) return;
  tpEmbyTokenSaving = true;
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  try {
    const r = await fetch("/api/thirdparty/emby/token/check", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "check");
    const res = j.result || {};
    if (res.renewed) tpEmbyTokenVisible = "";
    toast(res.ok ? t("tp_emby_token_check_ok") : tpEmbyTokenErrMsg(res.error || ""));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(tpEmbyTokenErrMsg((e && e.message) || ""), true);
  } finally {
    tpEmbyTokenSaving = false;
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  }
}

async function tpEmbyTokenClear(btn) {
  if (tpEmbyTokenSaving) return;
  if (!window.confirm(t("tp_emby_token_clear_confirm"))) return;
  tpEmbyTokenSaving = true;
  if (btn) { btn.disabled = true; btn.classList.add("loading"); }
  try {
    const r = await fetch("/api/thirdparty/emby/token/clear", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "clear");
    tpEmbyTokenVisible = "";
    tpEmbyTokenHas = false;
    tpEmbyTokenDirty = false;
    toast(t("tp_emby_token_cleared"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  } finally {
    tpEmbyTokenSaving = false;
    if (btn) { btn.disabled = false; btn.classList.remove("loading"); }
  }
}

async function tpWebhookDisconnect(aid) {
  try {
    const r = await fetch(`/api/thirdparty/${encodeURIComponent(aid)}/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "disconnect");
    toast(t("tp_disconnected"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

function tpStatusClass(app) {
  if (app.status === "connected") return "tp-connected";
  if (app.status === "ready") return "tp-ready";
  return "tp-not-connected";
}

function tpStatusText(app) {
  // 1.87: nereden bagli oldugunu goster: "Bagli (LAN)" / "Bagli (URL)".
  const via = String(app.verifiedVia || "").toLowerCase();
  const suffix = via === "lan" ? " " + t("tp_via_lan") : (via === "url" ? " " + t("tp_via_url") : "");
  if (app.status === "connected") return t("tp_connected") + suffix;
  if (app.status === "ready") return t("tp_ready");
  return t("tp_not_connected");
}

function tpStatusNote(app) {
  const note = app.note || "";
  if (note === "connected") return escAttr(t("tp_note_connected"));
  if (note === "ready_age" && app.lastSignal)
    return escAttr(t("tp_note_ready_age", { age: formatRelativeAge(app.lastSignal) }));
  if (note === "ready_none") return escAttr(t("tp_note_ready_none"));
  if (note === "tunnel") return escAttr(t("tp_note_tunnel"));
  return "";
}

function tpWatchDetail(w) {
  if (!w || !w.title) return "";
  if (w.kind === "tv" && w.season != null && w.episode != null)
    return escAttr(t("tp_watch_tv", { title: w.title, s: w.season, e: w.episode }));
  if (w.kind === "anime" && w.episode != null)
    return escAttr(t("tp_watch_anime", { title: w.title, e: w.episode }));
  return escAttr(t("tp_watch_movie", { title: w.title }));
}

function tpSignalBox(ts, watch) {
  // 1.87: "Son sinyal" cercevesi — HER ZAMAN gorunur (Stremio kartiyla ayni gorunum).
  // Sinyal yoksa: zaman yerine "—" ve altinda "Henuz sinyal yok".
  const w = tpWatchDetail(watch);
  return `
          <div class="tp-sub-box">
            <div class="tp-status-row"><span class="notify-name">${t("tp_last_signal")}</span><span class="tp-last-signal">${ts ? formatSignalTime(ts) : "—"}</span></div>
            ${ts && w ? `<div class="tp-frame-note tp-watch-detail" title="${w}">${w}</div>`
              : (ts ? "" : `<div class="tp-frame-note tp-watch-detail">${t("tp_no_signal_yet")}</div>`)}
          </div>`;
}

function tpAskToggle(aid) {
  // 1.88: "Izlendi bilgisi sor" anahtari — akordeon govdesinin EN USTUNDE.
  // Stremio = genel ayar (ask_before_watched), Plex/Jellyfin/Emby = kaynak bazli
  // (kaynak degeri bos ise genel ayar gosterilir).
  const src = String(aid || "");
  const raw = src === "stremio" ? "" : String((tpAskSrc && tpAskSrc[src]) || "");
  const eff = raw !== "" ? raw !== "0" : tpAskBeforeWatched;
  return `
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name"><span data-i18n="ask_before_watched_label">${t("ask_before_watched_label")}</span></span>
            <span class="ask-switch-area"><span class="saved-hint" id="ask-saved-hint-${escAttr(src)}" data-i18n="saved">${t("saved")}</span><label class="switch"><input type="checkbox" id="s-ask-before-watched-${escAttr(src)}" data-ask-src="${escAttr(src)}" ${eff ? "checked" : ""} /><span class="slider"></span></label></span>
          </div>
        </div>`;
}

function formatRelativeAge(ts) {
  try {
    const now = Date.now() / 1000;
    const d = Math.max(0, Math.floor(now - Number(ts)));
    if (d < 90) return t("tp_age_now");
    const m = Math.floor(d / 60);
    if (m < 90) return t("tp_age_minute", { n: m });
    const h = Math.floor(m / 60);
    if (h < 48) return t("tp_age_hour", { n: h });
    return t("tp_age_day", { n: Math.floor(h / 24) });
  } catch (e) {
    return "";
  }
}

function formatSignalTime(ts) {
  try {
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch (e) {
    return "—";
  }
}

// Public Adres tek kayit yolu (blur/Enter/modal-kapanis hepsi buraya gelir).
// blur tek basina yetmez (odak bazi tiklamalarda ayrilmaz) -> modal
// kapanirken flush edilir. Kayit sonrasi kutu tazelenir (kurulum
// baglantisi yeni adresten gelir), "Kaydedildi" YENI elemanda gosterilir.
let tpSaving = false;
async function flushTpBaseUrl() {
  const baseInput = document.getElementById("tp-base-input");
  if (!baseInput) return;
  if (tpSaving) { console.debug("[tp-base] already saving"); return; }
  tpSaving = true;
  try {
    const raw = baseInput.value || "";
    console.debug("[tp-base] flush", { raw });
    const v = raw.trim().replace(/\/+$/, "");
    if (v === tpBaseUrl) { console.debug("[tp-base] unchanged"); return; }
    if (v !== "" && !/^https:\/\/[^/:?#\s]+\.[^/:?#\s]+(:\d+)?\/?$/.test(v)) {
      toast(t("tp_bad_url"), true);
      baseInput.value = tpBaseUrl;
      return;
    }
      if (v !== "") {
        const host = v.replace(/^https:\/\//i, "").split(/[/:?#]/)[0].toLowerCase();
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 15000);
        try {
          const cr = await fetch("/api/thirdparty/check-host?host=" + encodeURIComponent(host), { cache: "no-store", signal: ctl.signal });
          const cj = await cr.json();
          if (cr.ok && cj && cj.ok === false) {
            toast(t("tp_bad_url"), true);
            baseInput.value = tpBaseUrl;
            return;
          }
        } catch (_) { /* backend kapisi esastir, devam et */ }
        finally { clearTimeout(to); }
      }
    const ok = await saveSettingsPartial({ tp_base_url: v }, null);
    if (!ok) { baseInput.value = tpBaseUrl; return; }
    tpBaseUrl = v;
    await renderThirdPartyApps({ silent: true });
    const ni = document.getElementById("tp-base-input");
    const nh = ni && ni.closest("label").querySelector(".saved-hint");
    showSavedHint(nh);
    console.debug("[tp-base] saved");
  } catch (err) {
    console.debug("[tp-base] error", err);
    toast(t("error"), true);
    baseInput.value = tpBaseUrl;
  } finally {
    tpSaving = false;
  }
}

function bindThirdPartyEvents() {
  // Tek-açık akordeon: VPS / Stremio / Takvim / Plex / Jellyfin / Emby / Uzak Bağlantı.
  [["vps-info-box", "vps"], ["tp-public-box", "public"], ["tp-app-stremio", "stremio"], ["tp-app-calendar", "calendar"],
   ["tp-app-plex", "plex"], ["tp-app-jellyfin", "jellyfin"], ["tp-app-emby", "emby"], ["tp-app-trakt", "trakt"],
   ["tp-app-remote", "remote"]].forEach(([id, which]) => {
    const box = document.getElementById(id);
    if (!box) return;
    const head = box.querySelector(".notif-type-head");
    const body = box.querySelector(".notif-type-body");
    if (!head || !body) return;
    head.addEventListener("click", (e) => {
      if (box.classList.contains("tp-card-disabled")) return;
      if (e.target.closest("input") || e.target.closest("button") || e.target.closest("select") || e.target.closest("a") || e.target.closest(".provider-list")) return;
      setTpAccordion(which);
    });
  });
  bindVpsRemoteEvents();
  // Public Adres: odaktan cikis/Enter -> tek kayit yolu (flushTpBaseUrl).
  const baseInput = document.getElementById("tp-base-input");
  if (baseInput) {
    console.debug("[tp-base] bound");
    baseInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); baseInput.blur(); }
    });
    baseInput.addEventListener("blur", () => {
      console.debug("[tp-base] blur");
      flushTpBaseUrl();
    });
  }
  // 1.88: "Izlendi bilgisi sor" anahtarlari — Stremio genel, Plex/Jellyfin/Emby kaynak bazli.
  document.querySelectorAll("input[data-ask-src]").forEach((el) => {
    el.addEventListener("change", async (e) => {
      const src = e.target.getAttribute("data-ask-src") || "stremio";
      const val = e.target.checked ? "1" : "0";
      const payload = src === "stremio" ? { ask_before_watched: val } : { ["ask_before_watched_" + src]: val };
      const hint = document.getElementById("ask-saved-hint-" + src);
      const ok = await saveSettingsPartial(payload, hint);
      if (!ok) { e.target.checked = !e.target.checked; return; }
      if (src === "stremio") {
        tpAskBeforeWatched = e.target.checked;
        if (window.setAskEnabled) window.setAskEnabled(e.target.checked);
      } else if (tpAskSrc) {
        tpAskSrc[src] = val;
      }
    });
  });
  const copyBtn = document.getElementById("tp-stremio-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const input = document.getElementById("tp-stremio-url");
      if (!input) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(input.value);
        ok = true;
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        try {
          input.select();
          input.setSelectionRange(0, 99999);
          ok = document.execCommand("copy");
        } catch (e2) {
          ok = false;
        }
      }
      toast(ok ? t("tp_copied") : t("error"));
    });
  }
  const refreshBtn = document.getElementById("tp-stremio-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.classList.add("loading");
      try {
        const r = await fetch("/api/thirdparty/stremio/refresh-uuid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "refresh");
        toast(t("tp_uuid_refreshed"));
        renderThirdPartyApps({ silent: true });
      } catch (e) {
        toast(errText((e && e.message) || "") || t("error"), true);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("loading");
      }
    });
  }
  const disconnectBtn = document.getElementById("tp-stremio-disconnect");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", () => {
      openStremioDisconnectConfirm(t("tp_confirm_disconnect"), async () => {
        try {
          const r = await fetch("/api/thirdparty/stremio/disconnect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "disconnect");
          toast(t("tp_disconnected"));
          renderThirdPartyApps({ silent: true });
        } catch (e) {
          toast(errText((e && e.message) || "") || t("error"), true);
        }
      }, { yes: t("confirm_yes") });
    });
  }
  // --- Takvim (ICS) — 1.85 ---
  const calCopy = document.getElementById("tp-calendar-copy");
  if (calCopy) {
    calCopy.addEventListener("click", async () => {
      const input = document.getElementById("tp-calendar-url");
      if (!input) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(input.value);
        ok = true;
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        try {
          input.select();
          input.setSelectionRange(0, 99999);
          ok = document.execCommand("copy");
        } catch (e2) {
          ok = false;
        }
      }
      toast(ok ? t("tp_copied") : t("error"));
    });
  }
  const calRefresh = document.getElementById("tp-calendar-refresh");
  if (calRefresh) {
    calRefresh.addEventListener("click", async () => {
      calRefresh.disabled = true;
      calRefresh.classList.add("loading");
      try {
        const r = await fetch("/api/thirdparty/calendar/refresh-uuid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "refresh");
        toast(t("tp_uuid_refreshed"));
        renderThirdPartyApps({ silent: true });
      } catch (e) {
        toast(errText((e && e.message) || "") || t("error"), true);
      } finally {
        calRefresh.disabled = false;
        calRefresh.classList.remove("loading");
      }
    });
  }
  const calDisconnect = document.getElementById("tp-calendar-disconnect");
  if (calDisconnect) {
    calDisconnect.addEventListener("click", () => {
      openCalendarDisconnectConfirm(async () => {
        try {
          const r = await fetch("/api/thirdparty/calendar/disconnect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "disconnect");
          toast(t("tp_disconnected"));
          renderThirdPartyApps({ silent: true });
        } catch (e) {
          toast(errText((e && e.message) || "") || t("error"), true);
        }
      });
    });
  }
  // --- Webhook uygulamaları (Plex / Jellyfin / Emby) — 1.86 ---
  [["plex", openPlexDisconnectConfirm], ["jellyfin", openJellyfinDisconnectConfirm], ["emby", openEmbyDisconnectConfirm]].forEach(([aid, confirmFn]) => {
    const copy = document.getElementById(`tp-${aid}-copy`);
    if (copy) copy.addEventListener("click", () => tpCopyInput(`tp-${aid}-url`));
    const lcopy = document.getElementById(`tp-${aid}-lancopy`);
    if (lcopy) lcopy.addEventListener("click", () => tpCopyInput(`tp-${aid}-lanurl`));
    // 2.07: kurulum linki tercihi (LAN/URL) — pasif satirdaki kirmizi x'e tiklayinca gecir.
    document.querySelectorAll(`#tp-app-${aid} .tp-redir-btn.off[data-link-app]`).forEach((b) => {
      b.addEventListener("click", async () => {
        const mode = b.getAttribute("data-link-mode") || "";
        b.disabled = true;
        try {
          const r = await fetch("/api/thirdparty/webhook-link-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: aid, mode }) });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "link-mode");
          toast(t("saved"));
          renderThirdPartyApps({ silent: true });
        } catch (e) { toast(errText((e && e.message) || "") || t("error"), true); b.disabled = false; }
      });
    });
    const refresh = document.getElementById(`tp-${aid}-refresh`);
    if (refresh) refresh.addEventListener("click", () => tpRefreshUuid(aid, refresh));
    const disc = document.getElementById(`tp-${aid}-disconnect`);
    if (disc) disc.addEventListener("click", () => confirmFn(() => tpWebhookDisconnect(aid)));
  });
  // --- 1.87: profil bazli "Sunucuya Kur" dugmeleri (calendar | webhook | trakt) ---
  // Kurulu/bagli durumda dugme disabled'dir (bilgi tooltip'te) -> tiklanamaz.
  [["calendar", "calendar"], ["trakt", "trakt"], ["plex", "webhook"],
   ["jellyfin", "webhook"], ["emby", "webhook"]].forEach(([aid, prof]) => {
    const b = document.getElementById(`tp-vps-install-${aid}`);
    if (b) b.addEventListener("click", () => openInstallWizard(prof));
  });
  // --- 1.87: Emby karti ic akordeonlari (Webhook / API Key / Access Token) — tek-acik ---
  ["webhook", "api", "token"].forEach((which) => {
    const f = document.getElementById(`tp-emby-sec-${which}`);
    if (!f) return;
    const head = f.querySelector(".notif-type-head");
    if (!head) return;
    head.addEventListener("click", (e) => {
      if (e.target.closest("input") || e.target.closest("button") || e.target.closest("a")) return;
      tpEmbySection = (tpEmbySection === which) ? "" : which;
      ["webhook", "api", "token"].forEach((w) => {
        const el = document.getElementById(`tp-emby-sec-${w}`);
        if (!el) return;
        const b = el.querySelector(".notif-type-body");
        const on = tpEmbySection === w;
        el.classList.toggle("accordion-open", on);
        if (b) b.style.display = on ? "block" : "none";
      });
    });
  });
  // --- 1.87: Emby API alanlari — odaktan cikinca OTOMATIK kayit (yesil "Kaydedildi") ---
  ["tp-emby-api-url", "tp-emby-api-cred", "tp-emby-api-user"].forEach((fid) => {
    const el = document.getElementById(fid);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
    el.addEventListener("blur", () => flushEmbyApi(el));
  });
  // --- 1.94: Access Token alanlari — parola blur / Enter ile otomatik token ---
  const authPassEl = document.getElementById("tp-emby-auth-cred");
  if (authPassEl) {
    authPassEl.addEventListener("input", () => { tpEmbyTokenDirty = true; });
    authPassEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        tpEmbyTokenDirty = false;
        tpEmbyTokenFetch(document.getElementById("tp-emby-token-get"));
      }
    });
    authPassEl.addEventListener("blur", (e) => {
      // Token bolumundeki dugmeye tiklandiysa blur otomatik islemi tetiklemesin;
      // dugmenin kendi islemi (kontrol/temizle) calissin.
      const rt = e && e.relatedTarget;
      if (rt && rt.id && rt.id.indexOf("tp-emby-token-") === 0) return;
      if (!tpEmbyTokenDirty) return;
      const v = tpEmbyTokenInputs();
      if (!v.user || !v.pass) return;
      tpEmbyTokenDirty = false;
      tpEmbyTokenFetch(document.getElementById("tp-emby-token-get"));
    });
  }
  const accessTokenEl = document.getElementById("tp-emby-access-cred");
  if (accessTokenEl) {
    accessTokenEl.addEventListener("input", () => { tpEmbyTokenDirty = true; });
    accessTokenEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); accessTokenEl.blur(); }
    });
    accessTokenEl.addEventListener("blur", (e) => {
      const rt = e && e.relatedTarget;
      if (rt && rt.id && rt.id.indexOf("tp-emby-token-") === 0) return;
      if (!tpEmbyTokenDirty) return;
      const v = tpEmbyTokenInputs();
      if (!v.token || v.token === tpEmbyTokenVisible) return;
      tpEmbyTokenDirty = false;
      tpEmbyTokenFetch(document.getElementById("tp-emby-token-get"));
    });
  }
  const tokenShowBtn = document.getElementById("tp-emby-token-show");
  if (tokenShowBtn && accessTokenEl) {
    tokenShowBtn.addEventListener("click", async () => {
      const showing = accessTokenEl.type === "text";
      // 1.97: kayitli token GET /api'de donmez. "Goster" acik istek uzerine
      // admin-only reveal ucundan cekilip kutuya doldurulur; sonra tip metne
      // cevrilir. Ayni oturumda token zaten bellekteyse istek yapilmaz.
      if (!showing && !accessTokenEl.value && tpEmbyTokenHas) {
        tokenShowBtn.disabled = true;
        try {
          const r = await fetch("/api/thirdparty/emby/token/reveal", { cache: "no-store" });
          const j = await r.json();
          if (r.ok && j && j.accessToken) {
            accessTokenEl.value = j.accessToken;
            tpEmbyTokenVisible = j.accessToken;
            tpEmbyTokenDirty = false;
          } else {
            toast(t("tp_emby_token_err_generic"), true);
            return;
          }
        } catch (_) {
          toast(t("tp_emby_token_err_generic"), true);
          return;
        } finally {
          tokenShowBtn.disabled = false;
        }
      }
      accessTokenEl.type = showing ? "password" : "text";
      tokenShowBtn.textContent = t(showing ? "tp_emby_token_show" : "tp_emby_token_hide");
      tokenShowBtn.setAttribute("aria-pressed", showing ? "false" : "true");
    });
  }
  const tokenGetBtn = document.getElementById("tp-emby-token-get");
  if (tokenGetBtn) tokenGetBtn.addEventListener("click", () => tpEmbyTokenFetch(tokenGetBtn));
  const tokenCheckBtn = document.getElementById("tp-emby-token-check");
  if (tokenCheckBtn) tokenCheckBtn.addEventListener("click", () => tpEmbyTokenCheck(tokenCheckBtn));
  const tokenClearBtn = document.getElementById("tp-emby-token-clear");
  if (tokenClearBtn) tokenClearBtn.addEventListener("click", () => tpEmbyTokenClear(tokenClearBtn));
  const embyTestBtn = document.getElementById("tp-emby-api-test");
  if (embyTestBtn) {
    embyTestBtn.addEventListener("click", async () => {
      embyTestBtn.disabled = true;
      try {
        const r = await fetch("/api/thirdparty/emby/test", { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "test");
        const info = j.info || {};
        toast(t("tp_emby_test_ok") + " · " + (info.serverName || "Emby") + (info.version ? " " + info.version : ""));
      } catch (e) {
        toast(errText((e && e.message) || "") || t("error"), true);
      } finally {
        embyTestBtn.disabled = false;
      }
    });
  }
  const embySyncBtn = document.getElementById("tp-emby-api-sync");
  if (embySyncBtn) {
    embySyncBtn.addEventListener("click", async () => {
      embySyncBtn.disabled = true;
      embySyncBtn.classList.add("loading");
      try {
        const r = await fetch("/api/thirdparty/emby/sync", { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "sync");
        toast(t("tp_emby_sync_done") + (j.summary ? " · " + j.summary : ""));
        renderThirdPartyApps({ silent: true });
      } catch (e) {
        toast(errText((e && e.message) || "") || t("error"), true);
      } finally {
        embySyncBtn.disabled = false;
        embySyncBtn.classList.remove("loading");
      }
    });
  }
  // --- 2.03 / 2.09: Trakt karti — Client ID/Secret odaktan cikinca OTOMATIK kayit ---
  ["tp-trakt-client-id", "tp-trakt-client-cred"].forEach((fid) => {
    const el = document.getElementById(fid);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
    el.addEventListener("blur", () => flushTraktClient(el));
    // 2.10: blur bazi durumlarda kacarsa change de yakalar (kilit cift kaydi engeller).
    el.addEventListener("change", () => flushTraktClient(el));
  });
  const traktRedirLanCopy = document.getElementById("tp-trakt-redirect-lan-copy");
  if (traktRedirLanCopy) traktRedirLanCopy.addEventListener("click", () => tpCopyInput("tp-trakt-redirect-lan"));
  const traktRedirUrlCopy = document.getElementById("tp-trakt-redirect-url-copy");
  if (traktRedirUrlCopy) traktRedirUrlCopy.addEventListener("click", () => tpCopyInput("tp-trakt-redirect-url"));
  document.querySelectorAll("#tp-app-trakt .tp-redir-btn.off").forEach((b) => {
    b.addEventListener("click", async () => {
      const mode = b.getAttribute("data-mode") || "";
      b.disabled = true;
      try {
        const r = await fetch("/api/thirdparty/trakt/redirect-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "redirect");
        toast(t("saved"));
        renderThirdPartyApps({ silent: true });
      } catch (e) { toast(tpTraktErrText((e && e.message) || ""), true); b.disabled = false; }
    });
  });
  const traktConnect = document.getElementById("tp-trakt-connect");
  if (traktConnect) {
    traktConnect.addEventListener("click", async () => {
      traktConnect.disabled = true;
      traktConnect.classList.add("loading");
      try {
        const r = await fetch("/api/thirdparty/trakt/authorize", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "authorize");
        const w = window.open(j.url, "_blank");
        if (!w) toast(t("tp_trakt_popup_blocked"), true);
        tpTraktAwaitConnect();
      } catch (e) { toast(tpTraktErrText((e && e.message) || ""), true); }
      finally { traktConnect.disabled = false; traktConnect.classList.remove("loading"); }
    });
  }
  const traktCallbackCopy = document.getElementById("tp-trakt-callback-copy");
  if (traktCallbackCopy) traktCallbackCopy.addEventListener("click", () => tpCopyInput("tp-trakt-callback-uri"));
  const traktDisconnect = document.getElementById("tp-trakt-disconnect");
  if (traktDisconnect) {
    traktDisconnect.addEventListener("click", async () => {
      traktDisconnect.disabled = true;
      try {
        const r = await fetch("/api/thirdparty/trakt/disconnect", { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "disconnect");
        toast(t("tp_disconnected"));
        renderThirdPartyApps({ silent: true });
      } catch (e) { toast(tpTraktErrText((e && e.message) || ""), true); }
      finally { traktDisconnect.disabled = false; }
    });
  }
  // 2.17: "Simdi kontrol et" — Trakt history'sini hemen cek. Manuel isaretleme
  // sayilir (direct=True): soru uretmeden dogrudan izlendi yazilir.
  const traktCheck = document.getElementById("tp-trakt-check");
  if (traktCheck) {
    traktCheck.addEventListener("click", async () => {
      traktCheck.disabled = true;
      traktCheck.classList.add("loading");
      try {
        const r = await fetch("/api/thirdparty/trakt/check", { method: "POST" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "check");
        toast(t("tp_trakt_check_done", { n: j.in || 0 }));
        renderThirdPartyApps({ silent: true });
      } catch (e) { toast(tpTraktErrText((e && e.message) || ""), true); }
      finally { traktCheck.disabled = false; traktCheck.classList.remove("loading"); }
    });
  }
  // 2.19.7: aktarim yonu - 3 switch, tek secim (acik olani kapatmak -> none).
  document.querySelectorAll("#tp-app-trakt .tp-trakt-dir").forEach((el) => {
    el.addEventListener("change", async () => {
      const mode = el.checked ? String(el.dataset.mode || "") : "none";
      document.querySelectorAll("#tp-app-trakt .tp-trakt-dir").forEach((o) => { o.disabled = true; });
      try {
        const r = await fetch("/api/thirdparty/trakt/direction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        if (!r.ok) throw new Error("direction");
        renderThirdPartyApps({ silent: true });
      } catch (e) {
        toast(tpTraktErrText((e && e.message) || ""), true);
        renderThirdPartyApps({ silent: true });
      }
    });
  });
  const traktPoll = document.getElementById("tp-trakt-poll");
  if (traktPoll) {
    try { if (window.initPulldownCombobox) window.initPulldownCombobox("tp-trakt-poll", "tp-trakt-poll-list"); } catch (_) {}
    traktPoll.addEventListener("change", async () => {
      const minutes = parseInt(traktPoll.value, 10);
      try {
        const r = await fetch("/api/thirdparty/trakt/poll-interval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes: isNaN(minutes) ? 10 : minutes }) });
        if (!r.ok) throw new Error("poll");
        toast(t("saved"));
      } catch (e) { toast(t("error"), true); }
    });
  }
}

async function tpTraktAwaitConnect() {
  const box = document.getElementById("tp-trakt-device");
  if (box) { box.style.display = ""; box.innerHTML = `<div class="tp-frame-note">${t("tp_trakt_waiting")}</div>`; }
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > 180000) {
      if (box) box.innerHTML = `<div class="tp-frame-note tp-warn">${t("tp_trakt_err_expired")}</div>`;
      return;
    }
    try {
      const r = await fetch("/api/thirdparty/status", { cache: "no-store" });
      const j = await r.json();
      const tr = ((j.apps || []).find((a) => a.id === "trakt") || {});
      if (tr.traktConnected) {
        toast(t("tp_trakt_connected", { user: tr.traktUser || "" }));
        renderThirdPartyApps({ silent: true });
        return;
      }
    } catch (_) {}
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

async function tpTraktDevicePoll(device) {
  const box = document.getElementById("tp-trakt-device");
  if (!box) return;
  const code = device.user_code || "";
  const url = device.verification_url || "https://trakt.tv/activate";
  const dc = device.device_code || "";
  const interval = Math.max(3, parseInt(device.interval, 10) || 5) * 1000;
  const expires = (parseInt(device.expires_in, 10) || 600) * 1000;
  box.style.display = "";
  box.innerHTML = `<div class="tp-status-row"><span class="notify-name">${t("tp_trakt_device_code")}</span><span class="tp-status-value tp-ready">${escAttr(code)}</span></div>
    <div class="tp-frame-note">${t("tp_trakt_device_note")} <a href="${escAttr(url)}" target="_blank" rel="noopener">${escAttr(url)}</a></div>`;
  const started = Date.now();
  const tick = async () => {
    if (Date.now() - started > expires) { box.innerHTML = `<div class="tp-frame-note tp-warn">${t("tp_trakt_err_expired")}</div>`; return; }
    try {
      const r = await fetch("/api/thirdparty/trakt/connect/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_code: dc }) });
      const j = await r.json();
      if (r.ok && j && j.pending) { setTimeout(tick, interval); return; }
      if (!r.ok) throw new Error(j.error || "poll");
      toast(t("tp_trakt_connected", { user: j.user || "" }));
      renderThirdPartyApps({ silent: true });
    } catch (e) {
      box.innerHTML = `<div class="tp-frame-note tp-warn">${escAttr(tpTraktErrText((e && e.message) || ""))}</div>`;
    }
  };
  setTimeout(tick, interval);
}

function tpTraktErrText(code) {
  const c = String(code || "");
  if (c === "auth" || c === "no-token") return t("tp_trakt_err_auth");
  if (c === "client-id") return t("tp_trakt_err_client");
  if (c === "busy") return t("tp_trakt_err_busy");
  if (c.indexOf("HTTP") === 0) return c;
  return t("tp_trakt_err_generic");
}

function setTpAccordion(which) {
  const boxes = [
    { id: "vps-info-box", get: () => tpVpsOpen, set: (v) => { tpVpsOpen = v; } },
    { id: "tp-public-box", get: () => tpPublicOpen, set: (v) => { tpPublicOpen = v; } },
    { id: "tp-app-stremio", get: () => tpStremioOpen, set: (v) => { tpStremioOpen = v; } },
    { id: "tp-app-calendar", get: () => tpCalendarOpen, set: (v) => { tpCalendarOpen = v; } },
    { id: "tp-app-plex", get: () => tpPlexOpen, set: (v) => { tpPlexOpen = v; } },
    { id: "tp-app-jellyfin", get: () => tpJellyfinOpen, set: (v) => { tpJellyfinOpen = v; } },
    { id: "tp-app-emby", get: () => tpEmbyOpen, set: (v) => { tpEmbyOpen = v; } },
    { id: "tp-app-trakt", get: () => tpTraktOpen, set: (v) => { tpTraktOpen = v; } },
    { id: "tp-app-remote", get: () => tpRemoteOpen, set: (v) => { tpRemoteOpen = v; } },
  ];
  const _idMap = { vps: "vps-info-box", public: "tp-public-box", stremio: "tp-app-stremio", calendar: "tp-app-calendar",
                   plex: "tp-app-plex", jellyfin: "tp-app-jellyfin", emby: "tp-app-emby", trakt: "tp-app-trakt", remote: "tp-app-remote" };
  const cur = boxes.find((b) => b.id === (_idMap[which] || ""));
  if (!cur) return;
  const willOpen = !cur.get();
  boxes.forEach((b) => {
    const open = (b.id === cur.id) && willOpen;
    b.set(open);
    const el = document.getElementById(b.id);
    if (el) {
      el.classList.toggle("accordion-open", open);
      const body = el.querySelector(".notif-type-body");
      if (body) body.style.display = open ? "block" : "none";
    }
  });
}

// Root kapisi: "Sunucuya Kur"/"Onar"/"Peer Ekle"/"Tuneli Kaldir" ancak root
// yetkisi dogrulanmissa calisir. root ile giris dogrudan root sayilir; root
// disi kullanicida Test Et (sudo -n) dogrulamasi sart.
function vpsRootReady() {
  if (!vpsGate || !vpsGate.configured || !vpsGate.connected) return false;
  if (typeof vpsGate.rootReady === "boolean") return !!vpsGate.rootReady;
  return !!(vpsGate.rootVerified || (vpsGate.loginUser || "root") === "root");
}

// Disabled "Sunucuya Kur" ipucu: kart bagliysa "Sunucuya baglisiniz", degilse
// "yapilandirilmamis veya root ile giris yapilmamis". Stremio "Hazir" durumu
// bagli SAYILMAZ (karar A) -> ikinci mesaj gosterilir.
function vpsInstallTip(cardConnected) {
  if (cardConnected && vpsRootReady()) return t("vps_btn_tip_connected");
  return t("vps_btn_tip_no_root");
}

// Disabled buton olay almaz -> ipucu sarmalayiciya konur.
function vpsBtnOrTip(html, disabled, cardConnected) {
  if (!disabled) return html;
  return `<span class="btn-tip" data-tip="${escAttr(vpsInstallTip(!!cardConnected))}">${html}</span>`;
}

function vpsStoredPass(mode) {
  const p = vpsProfile || {};
  if (mode === "key") return !!(p.sudoHasSecret);
  return !!(p.configured && (p.auth_type || "key") !== "key");
}

// 1.87: Public Adres (tp_base_url) kendi akordeon cercevesi — kurulum baglantilarinin
// (URL) cerceveleri bu adresten uretilir (LAN adresi ASLA buradan gelmez).
// "Sunucu Baglanti Ayarlari" ile "Stremio" arasinda durur; yalniz admin duzenleyebilir.
function renderPublicBaseCard() {
  if (!tpIsAdmin) return "";
  return `
    <div class="channel-box accordion-box notif-type-box${tpPublicOpen ? " accordion-open" : ""}" id="tp-public-box">
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-globe"></i> ${escAttr(t("tp_base_url"))}</span>
      </div>
      <div class="notif-type-body" style="display:${tpPublicOpen ? "block" : "none"}">
        <div class="tp-sub-box">
          <label><span class="settings-label-head"><span data-i18n="tp_base_url_field">${t("tp_base_url_field")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-base-input" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" inputmode="url" placeholder="https://…" value="${escAttr(tpBaseUrl)}" /></div>
          </label>
        </div>
      </div>
    </div>`;
}

function renderVpsSection() {
  const p = vpsProfile || { host: "", port: 22, username: "root", auth_type: "key", configured: false, connected: false, lastTestTs: null, fingerprint: "" };
  const stCls = p.connected && p.configured ? "tp-connected" : "tp-not-connected";
  const stTxt = !(p.configured) ? t("vps_unknown") : (p.connected ? t("tp_connected") : t("tp_not_connected"));
  const lastTs = p.lastTestTs ? formatSignalTime(p.lastTestTs) : "—";
  const hasSecret = !!p.configured;
  const showKey = vpsAuth === "key";
  const uname = p.username || "root";
  const isRoot = String(uname).trim().toLowerCase() === "root";
  // "Kiminle bagliyim + root yetkim var mi" rozeti (K2)
  const loginUser = String(p.loginUser || uname || "root");
  const connOk = !!p.configured && !!p.connected;
  const rootVerified = !!p.rootVerified || loginUser === "root";
  const reasonCode = String(p.lastReason || "");
  let rootCls = "tp-not-connected";
  let rootTxt = "—";
  if (connOk && rootVerified && loginUser === "root") {
    rootCls = "tp-connected";
    rootTxt = t("vps_root_direct");
  } else if (connOk && rootVerified) {
    rootCls = "tp-connected";
    rootTxt = t("vps_root_via_sudo", { user: loginUser });
  } else if (connOk || reasonCode.indexOf("sudo") === 0) {
    rootTxt = t("vps_root_missing", { user: loginUser });
  }
  const rootReasonKey = {
    "sudo-pass-required": "vps_sudo_required",
    "sudo-wrong-pass": "vps_sudo_wrong",
    "sudo-not-allowed": "vps_sudo_denied",
    "sudo-bootstrap-failed": "vps_sudo_denied",
  }[reasonCode];
  const rootReasonTxt = rootReasonKey ? t(rootReasonKey) : "";
  const passStored = vpsStoredPass(vpsAuth);
  const passPlaceholder = (showKey && isRoot) ? t("vps_pass_root_na") : (passStored ? "••••••••" : "");
  const passLabel = showKey ? t("vps_sudo_pass") : t("vps_auth_pass");
  return `
  <div class="channel-box accordion-box notif-type-box${tpVpsOpen ? " accordion-open" : ""}" id="vps-info-box">
    <div class="notif-type-head"><span class="notif-type-title"><i class="fa-solid fa-server"></i> ${escAttr(t("vps_conn_info"))}</span></div>
    <div class="notif-type-body" style="display:${tpVpsOpen ? "block" : "none"}">
      <div class="tp-status-row">
        <span class="notify-name">${escAttr(t("tp_status"))}</span>
        <span id="vps-status-value" class="tp-status-value ${stCls}">${escAttr(stTxt)}</span>
      </div>
      <div class="tp-status-row">
        <span class="notify-name">${escAttr(t("vps_last_test"))}</span>
        <span id="vps-last-test" class="tp-last-signal">${escAttr(lastTs)}</span>
      </div>
      <div class="tp-status-row">
        <span class="notify-name">${escAttr(t("vps_login_user"))}</span>
        <span id="vps-root-value" class="tp-status-value ${rootCls}">${escAttr(rootTxt)}</span>
      </div>
      ${rootReasonTxt ? `<div class="tp-frame-note">${escAttr(rootReasonTxt)}</div>` : ""}
      <div class="tp-sub-box">
        <label><span class="settings-label-head"><span>${escAttr(t("vps_host"))}</span><span class="saved-hint" id="vps-host-saved" data-i18n="saved">${t("saved")}</span></span>
          <div class="tp-url-box"><input id="vps-host" type="text" autocomplete="off" spellcheck="false" value="${escAttr(p.host || "")}" placeholder="80.211.22.203" /></div>
        </label>
        <label style="margin-top:3px"><span class="settings-label-head"><span>${escAttr(t("vps_port"))}</span><span class="saved-hint" id="vps-port-saved" data-i18n="saved">${t("saved")}</span></span>
          <div class="tp-url-box"><input id="vps-port" type="number" min="1" max="65535" value="${escAttr(String(p.port || 22))}" /></div>
        </label>
      </div>
      <div class="tp-sub-box">
        <span class="settings-label-head"><span>${escAttr(t("vps_auth"))}</span><span class="saved-hint" id="vps-auth-saved" data-i18n="saved">${t("saved")}</span></span>
        <div class="test-row" style="display:flex; gap:12px; margin:6px 0; justify-content:center;">
          <button id="vps-auth-key" class="tab${showKey ? " active" : ""}">${escAttr(t("vps_auth_key"))}</button>
          <button id="vps-auth-pass" class="tab${showKey ? "" : " active"}">${escAttr(t("vps_auth_pass"))}</button>
        </div>
        <label><span class="settings-label-head"><span>${escAttr(t("vps_user"))}</span><span class="saved-hint" id="vps-user-saved" data-i18n="saved">${t("saved")}</span></span>
          <div class="tp-url-box"><input id="vps-user" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" value="${escAttr(uname)}" placeholder="root" /></div>
        </label>
        <label style="margin-top:3px"><span class="settings-label-head"><span id="vps-cred-label">${escAttr(passLabel)}</span><span class="saved-hint" id="vps-cred-saved" data-i18n="saved">${t("saved")}</span></span>
          <div class="tp-url-box"><input id="vps-cred" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" data-protonpass-ignore="true" value="" placeholder="${escAttr(passPlaceholder)}" data-has="${passStored ? "1" : "0"}" /></div>
        </label>
        <div id="vps-key-wrap" style="display:${showKey ? "block" : "none"}; margin-top:6px">
          <label>
            <span class="settings-label-head"><span>${escAttr(t("vps_key"))}</span><span class="saved-hint" id="vps-key-saved" data-i18n="saved">${t("saved")}</span></span>
            <textarea id="vps-key" rows="12" spellcheck="false" data-lpignore="true" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" class="backup-ssh-textarea" data-has="${hasSecret && p.auth_type === "key" ? "1" : "0"}">${hasSecret && p.auth_type === "key" ? "••••••••" : ""}</textarea>
          </label>
          <div class="backup-key-actions">
            <input type="file" id="vps-key-file" accept=".pem,.key,.txt,*/*" style="display:none" />
            <button id="vps-key-clear" class="tab">${escAttr(t("clear"))}</button>
            <button id="vps-key-upload" class="tab">${escAttr(t("backup_upload_key"))}</button>
          </div>
        </div>
      </div>
      <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
        <span class="btn-tip" id="vps-test-tip"><button id="vps-test" class="tab" disabled aria-disabled="true">${escAttr(t("vps_test"))}</button></span>
        ${p.everConnected ? `<button id="vps-server-change" class="tab" data-i18n="server_change_btn">${escAttr(t("server_change_btn"))}</button>` : ""}
      </div>
    </div>
  </div>`;
}

// Test Et kapisi: host + (key + root ise ek yok / key + root disi ise parola / parola modu ise parola)
function vpsGateState() {
  const hostEl = document.getElementById("vps-host");
  if (!hostEl) return { canTest: false, reason: "host" };
  const host = (hostEl.value || "").trim();
  const userEl = document.getElementById("vps-user");
  const user = ((userEl && userEl.value) || "root").trim().toLowerCase() || "root";
  const isRoot = user === "root";
  const keyMode = vpsAuth === "key";
  const keyEl = document.getElementById("vps-key");
  const keyTxt = keyEl ? (keyEl.value || "").trim() : "";
  const keyOk = !!keyEl && (keyTxt !== "" || keyEl.getAttribute("data-has") === "1");
  const passEl = document.getElementById("vps-cred");
  const passTxt = passEl ? (passEl.value || "") : "";
  const passOk = (passTxt !== "" && passTxt !== "••••••••")
    || !!(passEl && passEl.getAttribute("data-has") === "1");
  if (!host) return { canTest: false, reason: "host" };
  if (keyMode) {
    if (!keyOk) return { canTest: false, reason: "key" };
    if (!isRoot && !passOk) return { canTest: false, reason: "pass" };
    return { canTest: true, reason: "" };
  }
  if (!passOk) return { canTest: false, reason: "pass" };
  return { canTest: true, reason: "" };
}

function updateVpsTestGate() {
  const st = vpsGateState();
  const btn = document.getElementById("vps-test");
  if (btn) {
    btn.disabled = !st.canTest;
    btn.setAttribute("aria-disabled", st.canTest ? "false" : "true");
    const tip = st.reason === "host" ? t("vps_need_host")
      : st.reason === "key" ? t("vps_need_key")
        : st.reason === "pass" ? t("vps_need_pass") : "";
    // disabled buton olay almaz: ipucu sarmalayiciya yazilir (varsa)
    const tipHost = document.getElementById("vps-test-tip") || btn;
    if (tip) tipHost.setAttribute("data-tip", tip); else tipHost.removeAttribute("data-tip");
    if (tipHost !== btn) btn.removeAttribute("data-tip");
  }
  const userEl = document.getElementById("vps-user");
  const isRoot = (((userEl && userEl.value) || "root").trim().toLowerCase() === "root");
  const passEl = document.getElementById("vps-cred");
  if (passEl) {
    const lockPass = vpsAuth === "key" && isRoot;   // root -> parola gerekmez
    passEl.disabled = lockPass;
    if (lockPass && passEl.value) passEl.value = "";
    passEl.placeholder = lockPass ? t("vps_pass_root_na")
      : (vpsStoredPass(vpsAuth) ? "••••••••" : "");
  }
}

const PEER_SVG = {
  suspend: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="9" y2="15"/><line x1="15" y1="9" x2="15" y2="15"/></svg>',
  resume: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10,8 16,12 10,16" fill="currentColor"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  dl: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><polyline points="6,11 12,17 18,11"/><path d="M4 21h16"/></svg>',
};

let vpsSaving = false;
async function flushVpsProfile(hintId) {
  const hostEl = document.getElementById("vps-host");
  if (!hostEl) return;
  if (vpsSaving) return;
  vpsSaving = true;
  try {
    const host = (hostEl.value || "").trim();
    let port = 22;
    try { port = parseInt(document.getElementById("vps-port")?.value || "22", 10); } catch (_) {}
    const userEl = document.getElementById("vps-user");
    const username = ((userEl && userEl.value) || "root").trim().toLowerCase() || "root";
    const isRoot = username === "root";
    const saved = vpsProfile || null;
    let secret = "";
    let fieldEmpty = true;
    if (vpsAuth === "key") {
      const k = document.getElementById("vps-key");
      secret = k ? k.value.trim() : "";
      fieldEmpty = secret === "" && (!k || k.getAttribute("data-has") !== "1");
    } else {
      const pe = document.getElementById("vps-cred");
      secret = pe ? pe.value : "";
      fieldEmpty = (secret === "" || secret === "••••••••")
        && (!pe || pe.getAttribute("data-has") !== "1");
    }
    // sudo parolasi: root'ta tutulmaz; key modunda ayri, parola modunda login parolasi.
    let sudoSecret = null;   // null = dokunma, "" = temizle
    if (isRoot && saved && saved.sudoHasSecret) sudoSecret = "";
    else if (!isRoot && vpsAuth === "key") {
      const pe = document.getElementById("vps-cred");
      const v = pe ? pe.value : "";
      if (v !== "" && v !== "••••••••") sudoSecret = v;
    }
    const secretChanged = secret !== "" && secret !== "••••••••";
    const willClear = fieldEmpty && !!(saved && saved.configured);
    const unchanged =
      !!saved &&
      host === (saved.host || "") &&
      port === (saved.port || 22) &&
      username === (saved.username || "root") &&
      vpsAuth === (saved.auth_type || "key") &&
      !secretChanged && !willClear && sudoSecret === null;
    if (unchanged) return;
    const body = { host, port, username, auth_type: vpsAuth };
    // Boş secret -> backend eskiyi korur; "••••••••" korunur; temizleme acikca "" ile.
    if (secret !== "" && secret !== "••••••••") body.secret = secret;
    else if (willClear) body.secret = "";
    if (sudoSecret !== null) body.sudo_secret = sudoSecret;
    const r = await fetch("/api/remote/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "save");
    vpsProfile = Object.assign({}, vpsProfile || {}, {
      host: body.host, port: body.port, username: body.username,
      auth_type: body.auth_type, configured: !!j.configured,
      sudoHasSecret: !!j.sudo_configured,
    });
    vpsGate = { configured: !!j.configured, connected: !!(vpsGate && vpsGate.connected && j.configured),
                everConnected: !!(vpsGate && vpsGate.everConnected) };
    if (hintId) showSavedHint(document.getElementById(hintId));
    updateVpsTestGate();
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  } finally {
    vpsSaving = false;
  }
}

async function testVpsConnection() {
  await flushVpsProfile();
  // SSH testi birkac saniye surebilir: butonda bekleme geri bildirimi ver.
  // Sonuc gelince renderThirdPartyApps butonu yeniden olusturur -> finally'de
  // buton tekrar sorgulanip etiket geri yazilir.
  const btn = document.getElementById("vps-test");
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = t("vps_test") + " …"; }
  try {
    const r = await fetch("/api/remote/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "test");
    if (j.connected) {
      toast(t("vps_test_ok") + (j.sudo ? " — " + t("vps_sudo_ok") : ""));
    } else {
      const reasonKey = {
        "sudo-pass-required": "vps_sudo_required",
        "sudo-wrong-pass": "vps_sudo_wrong",
        "sudo-not-allowed": "vps_sudo_denied",
        "sudo-bootstrap-failed": "vps_sudo_denied",
      }[j.reason];
      if (reasonKey) {
        toast(t(reasonKey) + (j.detail ? ` (${j.detail})` : ""), true);
      } else {
        const detail = j.reason ? ` (${j.reason}${j.detail ? ": " + j.detail : ""})` : "";
        toast(t("vps_test_fail") + detail, true);
      }
    }
    await renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
    await renderThirdPartyApps({ silent: true });
  } finally {
    const b2 = document.getElementById("vps-test");
    if (b2) { b2.textContent = t("vps_test"); b2.removeAttribute("aria-busy"); }
    updateVpsTestGate();
  }
}

function bindVpsAuthToggle() {
  const kb = document.getElementById("vps-auth-key");
  const pb = document.getElementById("vps-auth-pass");
  const set = (mode) => {
    if (vpsAuth === mode) return;
    vpsAuth = mode;
    const keyWrap = document.getElementById("vps-key-wrap");
    if (keyWrap) keyWrap.style.display = mode === "key" ? "block" : "none";
    if (kb) kb.classList.toggle("active", mode === "key");
    if (pb) pb.classList.toggle("active", mode !== "key");
    // Parola alani iki modda farkli anlam tasir: etiket + kayitli deger sifirlanir.
    const lbl = document.getElementById("vps-cred-label");
    if (lbl) lbl.textContent = mode === "key" ? t("vps_sudo_pass") : t("vps_auth_pass");
    const pe = document.getElementById("vps-cred");
    if (pe) {
      pe.value = "";
      pe.setAttribute("data-has", vpsStoredPass(mode) ? "1" : "0");
    }
    updateVpsTestGate();
  };
  if (kb) kb.addEventListener("click", () => set("key"));
  if (pb) pb.addEventListener("click", () => set("password"));
}

function bindVpsKeyActions() {
  const fileInput = document.getElementById("vps-key-file");
  const uploadBtn = document.getElementById("vps-key-upload");
  if (fileInput && uploadBtn) {
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const ta = document.getElementById("vps-key");
        if (ta) { ta.value = String(rd.result || "").trim(); ta.setAttribute("data-has", "0"); }
        updateVpsTestGate();
      };
      rd.readAsText(f);
      fileInput.value = "";
    });
  }
  const clearBtn = document.getElementById("vps-key-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const ta = document.getElementById("vps-key");
      if (ta) { ta.value = ""; ta.setAttribute("data-has", "0"); }
      updateVpsTestGate();
    });
  }
}

async function remoteTunnelConnect() {
  try {
    const r = await fetch("/api/remote/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "connect");
    toast(t("remote_connected"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

function remoteTunnelDisconnect() {
  openRemoteDisconnectConfirm(t("remote_disconnect_confirm"), async () => {
    try {
      const r = await fetch("/api/remote/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(errText(j.error) || j.error || "disconnect");
      toast(t("remote_disconnected"));
      renderThirdPartyApps({ silent: true });
    } catch (e) {
      toast(errText((e && e.message) || "") || t("error"), true);
    }
  });
}

async function startRemoteJob(kind, params) {
  try {
    const r = await fetch("/api/remote/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, params: params || {} }) });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "job");
    const log = document.getElementById(kind === "wg" ? "tp-remote-joblog" : "tp-stremio-joblog");
    if (log) { log.style.display = "block"; log.textContent = t("job_started") + "\n"; }
    pollRemoteJob(j.job_id, log);
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

function pollRemoteJob(jobId, logEl) {
  clearTimeout(remoteJobTimer);
  const tick = async () => {
    try {
      const r = await fetch("/api/remote/jobs/" + jobId, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "job");
      if (logEl) { logEl.style.display = "block"; logEl.textContent = stripSteps(j.log || ""); }
      if (j.status === "running") {
        remoteJobTimer = setTimeout(tick, 1500);
      } else {
        toast(j.status === "success" ? t("job_success") : t("job_failed"), j.status !== "success");
        renderThirdPartyApps({ silent: true });
      }
    } catch (_) {
      remoteJobTimer = setTimeout(tick, 2500);
    }
  };
  tick();
}

async function renderRemotePeers() {
  const list = document.getElementById("tp-peer-list");
  if (!list) return;
  let peers = [];
  try {
    const r = await fetch("/api/remote/peers", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "peers");
    peers = j.peers || [];
  } catch (_) { return; }
  if (!peers.length) {
    list.innerHTML = "";
    const box = document.getElementById("tp-peer-box");
    if (box) box.style.display = "none";
    return;
  }
  const box = document.getElementById("tp-peer-box");
  if (box) box.style.display = "";
  list.innerHTML = peers.map((p) => {
    const lbl = p.file.replace(/\.conf$/, "");
    return `
    <div class="member-chip${p.suspended ? " peer-suspended" : ""}" data-num="${p.num}">
      <div class="member-text">
        <div class="member-name" title="${escAttr(lbl)}">${escAttr(lbl)}</div>
        <input class="peer-name" data-num="${p.num}" value="${escAttr(p.name || "")}" placeholder="${escAttr(t("peer_real_name_ph"))}" autocomplete="off" spellcheck="false" />
      </div>
      <div class="member-icons">
        <button class="role-icon ${p.suspended ? "c-green" : "c-orange"} peer-suspend" data-num="${p.num}" data-suspended="${p.suspended ? "1" : "0"}" title="${escAttr(p.suspended ? t("peer_unsuspend") : t("peer_suspend"))}">${p.suspended ? ROLE_PLAY_SVG : ROLE_PAUSE_SVG}</button>
        <button class="role-icon c-red peer-delete" data-num="${p.num}" data-file="${escAttr(p.file)}" title="${escAttr(t("peer_delete"))}">${ROLE_X_SVG}</button>
        <button class="role-icon c-gray peer-dl" data-num="${p.num}" data-file="${escAttr(p.file)}" title="${escAttr(t("peer_download"))}">${PEER_SVG.dl}</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll(".peer-name").forEach((inp) => {
    inp.addEventListener("blur", () => {
      remotePeerRename(inp.dataset.num, inp.value);
    });
  });
  list.addEventListener("click", async (e) => {
    const sBtn = e.target.closest(".peer-suspend");
    const dBtn = e.target.closest(".peer-delete");
    const lBtn = e.target.closest(".peer-dl");
    if (sBtn) {
      const num = sBtn.dataset.num;
      const suspended = sBtn.dataset.suspended === "1";
      remotePeerSuspend(num, suspended);
    } else if (dBtn) {
      remotePeerDelete(dBtn.dataset.num, dBtn.dataset.file);
    } else if (lBtn) {
      remotePeerDownload(lBtn.dataset.num, lBtn.dataset.file);
    }
  });
}

async function addRemotePeer() {
  try {
    const r = await fetch("/api/remote/peers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "" }) });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "peer");
    toast(t("peer_added"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

async function remotePeerRename(num, value) {
  try {
    const r = await fetch("/api/remote/peers/" + num, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: value.trim() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "rename");
    toast(t("saved"));
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

async function remotePeerSuspend(num, currentSuspended) {
  try {
    const r = await fetch("/api/remote/peers/" + num, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suspended: !currentSuspended }) });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "suspend");
    toast(currentSuspended ? t("peer_resumed") : t("peer_suspended"));
    renderThirdPartyApps({ silent: true });
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
  }
}

function remotePeerDelete(num, file) {
  openRemotePeerDeleteConfirm(file + " " + t("peer_confirm_delete"), async () => {
    try {
      const r = await fetch("/api/remote/peers/" + num, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(errText(j.error) || j.error || "delete");
      toast(t("peer_deleted"));
      renderThirdPartyApps({ silent: true });
    } catch (e) {
      toast(errText((e && e.message) || "") || t("error"), true);
    }
  });
}

async function remotePeerDownload(num, file) {
  try {
    const a = document.createElement("a");
    a.href = "/api/remote/peers/" + num + "/conf/download";
    a.download = file || "nextep_remote.conf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Stremio "Sunucuya Kur" sihirbazi (adanmis modal; tek ekranda secim + adimlar + terminal)
// ---------------------------------------------------------------------------
const SI_STEP_ORDER = ["profile", "detect", "webserver", "landing", "tunnel", "verify"];
const SI_SERVERS = ["caddy", "nginx", "apache2"];
let siState = null;
let siJobId = null;
let siTimer = null;
// 1.87: kurulum profili (kart butonuna gore): stremio | calendar | webhook
let siProfile = "stremio";

function stripSteps(text) {
  return (text || "")
    .split("\n")
    .filter((l) => !/^\s*STEP:[a-z0-9-]+:(run|ok|fail)\s*$/.test(l))
    .join("\n");
}

function siStepLabel(name) {
  return t("step_" + name.replace(/-/g, "_"));
}

function siRenderSteps(steps) {
  const el = document.getElementById("si-steps");
  if (!el) return;
  el.innerHTML = SI_STEP_ORDER.map((n) => {
    const st = (steps && steps[n]) || "idle";
    const icon = st === "ok" ? "✔" : st === "fail" ? "✕" : st === "run" ? "…" : "○";
    return `<li class="si-step si-step-${st}"><span class="si-step-icon">${icon}</span><span>${siStepLabel(n)}</span></li>`;
  }).join("");
}

function siParseLog(text) {
  const steps = {};
  const term = [];
  (text || "").split("\n").forEach((line) => {
    const m = /^\s*STEP:([a-z0-9-]+):(run|ok|fail)\s*$/.exec(line);
    if (m) { steps[m[1]] = m[2]; return; }
    term.push(line);
  });
  return { steps, term: term.join("\n") };
}

function siRenderWs(det) {
  const list = document.getElementById("si-ws-list");
  const note = document.getElementById("si-ws-note");
  if (!list) return;
  const opts = det.options || [];
  const enabled = (s) => opts.indexOf(s) >= 0;
  let chosen = "";
  if (det.saved && enabled(det.saved)) chosen = det.saved;
  else if (det.server && enabled(det.server)) chosen = det.server;
  else chosen = opts[0] || "";
  siState = Object.assign({}, det, { chosen });
  list.innerHTML = SI_SERVERS.map((s) => {
    const on = enabled(s);
    const rec = on && !det.server && s === "caddy";
    const label = `${s}${rec ? ` <span class="si-rec">${t("stremio_install_recommended")}</span>` : ""}`;
    return `<button type="button" class="tab si-ws-opt${chosen === s ? " active" : ""}" data-ws="${s}" ${on ? "" : "disabled aria-disabled=\"true\""}>${label}</button>`;
  }).join("");
  list.querySelectorAll(".si-ws-opt").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      siState.chosen = b.getAttribute("data-ws");
      list.querySelectorAll(".si-ws-opt").forEach((x) => x.classList.toggle("active", x === b));
    });
  });
  if (note) {
    if (det.blocked) {
      note.textContent = t("stremio_install_blocked_text", { owner: det.blockedOwner || "?" });
      note.className = "si-note si-note-warn";
    } else if (det.server) {
      note.textContent = t("stremio_install_continue_existing", { server: det.server });
      note.className = "si-note";
    } else {
      note.textContent = t("stremio_install_port_free");
      note.className = "si-note";
    }
  }
}

async function openInstallWizard(profile) {
  siProfile = String(profile || "stremio").trim().toLowerCase();
  siJobId = null;
  clearTimeout(siTimer);
  let det = null;
  try {
    const r = await fetch("/api/remote/web-servers", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "web-servers");
    det = j;
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
    return;
  }
  siRenderWs(det);
  siRenderSteps({});
  const term = document.getElementById("si-term");
  if (term) { term.textContent = ""; term.style.display = "none"; }
  const tog = document.getElementById("si-term-toggle");
  if (tog) tog.classList.remove("active");
  const start = document.getElementById("si-start");
  if (start) {
    // 1.87: profil durumuna gore etiket (Onar / Sunucuya Kur)
    const routeOk = !!(det.routes && det.routes[siProfile]);
    const tunOk = det.tunnelActive !== false;
    start.textContent = (routeOk && !tunOk) ? t("stremio_install_repair") : t("install_on_vps");
    if (routeOk && tunOk) start.title = t("vps_installed"); else start.removeAttribute("title");
    start.disabled = !!det.blocked || !(det.options && det.options.length) || (routeOk && tunOk);
    start.onclick = siStart;
  }
  openStremioInstallModal();
}

async function siStart() {
  if (!siState || !siState.chosen) { toast(t("stremio_install_pick_server"), true); return; }
  const domain = (tpBaseUrl || "").replace(/^https?:\/\//i, "").split("/")[0].trim();
  if (!domain) { toast(t("stremio_install_no_domain"), true); return; }
  const start = document.getElementById("si-start");
  if (start) { start.disabled = true; start.classList.add("loading"); }
  siRenderSteps({});
  const term = document.getElementById("si-term");
  if (term) term.textContent = t("job_started") + "\n";
  try {
    const r = await fetch("/api/remote/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "stremio", params: { domain, web_server: siState.chosen, profile: siProfile } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(errText(j.error) || j.error || "job");
    siJobId = j.job_id;
    siPoll();
  } catch (e) {
    toast(errText((e && e.message) || "") || t("error"), true);
    if (start) { start.disabled = false; start.classList.remove("loading"); }
  }
}

function siPoll() {
  clearTimeout(siTimer);
  const tick = async () => {
    try {
      const r = await fetch("/api/remote/jobs/" + siJobId, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "job");
      const p = siParseLog(j.log || "");
      siRenderSteps(p.steps);
      const term = document.getElementById("si-term");
      if (term) term.textContent = p.term;
      if (j.status === "running") {
        siTimer = setTimeout(tick, 1500);
      } else {
        const start = document.getElementById("si-start");
        if (start) { start.disabled = false; start.classList.remove("loading"); }
        const ok = j.status === "success";
        toast(ok ? t("job_success") : t("job_failed"), !ok);
        renderThirdPartyApps({ silent: true });
        const st = document.getElementById("si-start");
        if (st) st.textContent = t("stremio_install_start");
      }
    } catch (_) {
      siTimer = setTimeout(tick, 2500);
    }
  };
  tick();
}

function stremioTunnelRemove() {
  openStremioTunnelRemoveConfirm(t("tunnel_remove_confirm"), async () => {
    try {
      const r = await fetch("/api/remote/tunnel/remove", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(errText(j.error) || j.error || "remove");
      toast(t("tunnel_removed"));
      renderThirdPartyApps({ silent: true });
    } catch (e) {
      toast(errText((e && e.message) || "") || t("error"), true);
    }
  });
}

function vpsServerChange() {
  openRemoteResetConfirm(t("server_change_confirm"), async () => {
    try {
      const r = await fetch("/api/remote/reset", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(errText(j.error) || j.error || "reset");
      toast(t("server_changed"));
      vpsProfile = null;
      vpsGate = { configured: false, connected: false, everConnected: false, rootReady: false, rootVerified: false, loginUser: "" };
      renderThirdPartyApps({ silent: true });
    } catch (e) {
      toast(errText((e && e.message) || "") || t("error"), true);
    }
  });
}

function bindVpsRemoteEvents() {
  const testBtn = document.getElementById("vps-test");
  if (testBtn) testBtn.addEventListener("click", testVpsConnection);
  bindVpsAuthToggle();
  bindVpsKeyActions();
  const flushMap = {
    "vps-host": "vps-host-saved",
    "vps-port": "vps-port-saved",
    "vps-user": "vps-user-saved",
    "vps-cred": "vps-cred-saved",
    "vps-key": "vps-key-saved",
  };
  Object.entries(flushMap).forEach(([id, hintId]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => flushVpsProfile(hintId));
    el.addEventListener("input", () => updateVpsTestGate());
    el.addEventListener("keyup", () => updateVpsTestGate());
    el.addEventListener("change", () => updateVpsTestGate());
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && id !== "vps-key") { e.preventDefault(); el.blur(); }
    });
  });
  updateVpsTestGate();
  const remoteInstall = document.getElementById("tp-remote-install");
  if (remoteInstall) remoteInstall.addEventListener("click", () => startRemoteJob("wg", {}));
  const remoteConnectBtn = document.getElementById("tp-remote-connect");
  if (remoteConnectBtn) remoteConnectBtn.addEventListener("click", remoteTunnelConnect);
  const remoteDisconnectBtn = document.getElementById("tp-remote-disconnect");
  if (remoteDisconnectBtn) remoteDisconnectBtn.addEventListener("click", remoteTunnelDisconnect);
  const peerAdd = document.getElementById("tp-peer-add");
  if (peerAdd) peerAdd.addEventListener("click", addRemotePeer);
  const stremioInstall = document.getElementById("tp-stremio-install");
  if (stremioInstall) stremioInstall.addEventListener("click", () => openInstallWizard());
  const tunnelRemove = document.getElementById("tp-stremio-tunnel-remove");
  if (tunnelRemove) tunnelRemove.addEventListener("click", stremioTunnelRemove);
  const serverChange = document.getElementById("vps-server-change");
  if (serverChange) serverChange.addEventListener("click", vpsServerChange);
  const termToggle = document.getElementById("si-term-toggle");
  if (termToggle) {
    termToggle.addEventListener("click", () => {
      const term = document.getElementById("si-term");
      if (!term) return;
      const show = term.style.display === "none";
      term.style.display = show ? "block" : "none";
      termToggle.classList.toggle("active", show);
    });
  }
  renderRemotePeers();
}

export { loadSettings, renderFavActorsList, renderFavGenresList, saveSettingsPartial,
         updateNotifyToggleStates, closeSettingsMenu, showSettingsSubmodal, closeSettingsModals, renderThirdPartyApps };
