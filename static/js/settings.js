// Faz 4: settings — ayarlar menüsü, zaman dilimi / saat seçicileri, favori listeleri, otomatik kaydetme, bildirim anahtarları.
import { state } from "./state.js";
import { t, checkTmdbKey, applyLang, errText } from "./i18n.js?v=523";
import { toast, escAttr, HEART_SVG, ROLE_X_SVG, ROLE_PAUSE_SVG, ROLE_PLAY_SVG } from "./utils.js?v=519";
import { activateUtilityTab } from "./views.js?v=524";
import { openStremioDisconnectConfirm, openRemoteDisconnectConfirm, openRemotePeerDeleteConfirm, openStremioInstallModal, closeStremioInstallModal, openStremioTunnelRemoveConfirm, openRemoteResetConfirm } from "./components.js?v=524";

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
  const rsPass = document.getElementById("s-backup-rsync-pass");
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
  const smPass = document.getElementById("s-backup-samba-pass");
  if (smPass) smPass.value = "";
  document.getElementById("s-ntfy").value = s.ntfy_topic || "";
  document.getElementById("s-discord-webhook").value = s.discord_webhook_url || "";
  document.getElementById("s-brevo-key").value = s.brevo_api_key || "";
  document.getElementById("s-email-from").value = s.email_from || "";
  document.getElementById("s-email-to").value = s.email_to || "";
  document.getElementById("s-email-provider").value = s.email_provider || "brevo";
  document.getElementById("s-smtp-host").value = s.smtp_host || "";
  document.getElementById("s-smtp-port").value = s.smtp_port || "";
  document.getElementById("s-smtp-user").value = s.smtp_user || "";
  document.getElementById("s-smtp-pass").value = "";
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
    backup_rsync_pass: ["s-backup-rsync-pass"],
    backup_rsync_key: ["s-backup-rsync-key-text"],
    backup_samba_host: ["s-backup-samba-host"],
    backup_samba_port: ["s-backup-samba-port"],
    backup_samba_share: ["s-backup-samba-share"],
    backup_samba_user: ["s-backup-samba-user"],
    backup_samba_pass: ["s-backup-samba-pass"],
    app_auto_update: ["s-appupdate-auto"],
    cache_ttl: ["s-cache-ttl"],
    early_watched_days: ["s-early-watched-days"],
    brevo_api_key: ["s-brevo-key"],
    email_from: ["s-email-from"],
    email_provider: ["s-email-provider"],
    smtp_preset: ["s-smtp-preset"],
    smtp_host: ["s-smtp-host"],
    smtp_port: ["s-smtp-port"],
    smtp_user: ["s-smtp-user"],
    smtp_pass: ["s-smtp-pass"],
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
  const discordUrl = (document.getElementById("s-discord-webhook").value || "").trim();
  const brevoKey = (document.getElementById("s-brevo-key").value || "").trim();
  const emailFrom = (document.getElementById("s-email-from").value || "").trim();
  const emailTo = (document.getElementById("s-email-to").value || "").trim();
  const provider = document.getElementById("s-email-provider").value;
  const smtpHost = (document.getElementById("s-smtp-host").value || "").trim();
  const smtpPort = (document.getElementById("s-smtp-port").value || "").trim();
  const smtpUser = (document.getElementById("s-smtp-user").value || "").trim();
  const smtpPassEntered = (document.getElementById("s-smtp-pass").value || "").trim();
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
      const { errText: _err } = await import("./i18n.js?v=523");
      body.innerHTML = `<div class="releases-error">${_err(data.error) || t("data_failed")}</div>`;
      return;
    }
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty">${t("no_credits")}</div>`;
      return;
    }
    const { posterHTML, scoreTag, typeLabel, applyTitleHint, resultCardRows, cardDateLine } = await import("./utils.js?v=519");
    const { openDetails } = await import("./components.js?v=524");
    const { loadFollowed } = await import("./views.js?v=524");
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
        const { t: _t } = await import("./i18n.js?v=523");
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

(function initFavListingModal() {
  const modal = document.getElementById("fav-listing-modal");
  if (!modal) return;
  const close = () => { modal.style.display = "none"; };
  const btn = document.getElementById("fav-listing-close");
  if (btn) btn.onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.style.display !== "none") close(); });
})();

// Yedekleme: sabit çerçeve 2 switch (biri açılırsa diğeri kapanır) + Rsync/Samba akordeonları
(function initBackupSwitches() {
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
(function initBackupAccordion() {
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
  ["s-backup-rsync-pass", "s-backup-samba-pass"].forEach((id) => {
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
  const cur = safe(lastAppVer.local);
  let html = `${t("app_version_current")} ${cur}`;
  if (lastAppVer.available && lastAppVer.remote) {
    html += ` -&gt; <span class="new-version">${t("app_version_new")} ${safe(lastAppVer.remote)}</span>`;
  }
  el.innerHTML = html;
  runBtn.disabled = !lastAppVer.available;
}
async function checkAppUpdate(showToast) {
  const checkBtn = document.getElementById("appupdate-check");
  if (checkBtn) checkBtn.disabled = true;
  try {
    const r = await fetch("/api/app-update/check");
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
    if (checkBtn) checkBtn.disabled = false;
  }
}
(function initAppUpdate() {
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
  // Modal açılırken güncel durumu çek
  const menuItem = document.querySelector('.settings-menu-item[data-target="settings-appupdate-modal"]');
  if (menuItem) menuItem.addEventListener("click", () => setTimeout(() => checkAppUpdate(false), 0));
  document.addEventListener("app:langchange", () => {
    renderAppVersion();
    const dm = document.getElementById("appupdate-detail-modal");
    if (dm && dm.style.display === "flex") fillAppUpdateDetail(lastDetailEntries);
  });
})();

// Favoriler: 3 kutu doğrudan modal-body'de alt alta, dış çerçeve yok
(function initFavoritesAccordion() {
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
bindAutoSave("s-discord-webhook", "discord_webhook_url", (v) => v.trim());
bindAutoSave("s-brevo-key", "brevo_api_key", (v) => v.trim());
bindAutoSave("s-email-from", "email_from", (v) => v.trim());
bindAutoSave("s-email-to", "email_to", (v) => v.trim());
bindAutoSave("s-smtp-host", "smtp_host", (v) => v.trim());
bindAutoSave("s-smtp-port", "smtp_port", (v) => v.trim());
bindAutoSave("s-smtp-user", "smtp_user", (v) => v.trim());
bindAutoSave("s-smtp-pass", "smtp_pass", (v) => v);

["s-token", "s-chat", "s-ntfy", "s-discord-webhook", "s-brevo-key", "s-email-from", "s-email-to", "s-smtp-host", "s-smtp-port", "s-smtp-user", "s-smtp-pass"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("blur", () => {
    if (id === "s-smtp-pass" && el.value.trim()) state.hasSmtpPass = true;
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
  runChannelTest({ channel: "discord", discord_webhook_url: fieldVal("s-discord-webhook") });
};

document.getElementById("test-email").onclick = async () => {
  const body = {
    channel: "email",
    email_provider: document.getElementById("s-email-provider").value,
    email_from: fieldVal("s-email-from"),
    email_to: fieldVal("s-email-to"),
  };
  if (body.email_provider === "brevo") {
    body.brevo_api_key = fieldVal("s-brevo-key");
  } else {
    body.smtp_host = fieldVal("s-smtp-host");
    body.smtp_port = fieldVal("s-smtp-port");
    body.smtp_user = fieldVal("s-smtp-user");
    const pass = document.getElementById("s-smtp-pass").value;
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

(function initAccordions() {
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
(function initChannelsAccordion() {
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
  import("./notification.js?v=535").then((m) => {
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
let tpBaseUrl = "";
let tpIsAdmin = false;
let tpAskBeforeWatched = true;
// Uzak Bağlantı (VPS): profil + Uzak Bağlantı kartı + telefon peer'leri.
let tpVpsOpen = false;
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
  } catch (_) {
    tpBaseUrl = "";
    tpIsAdmin = false;
    tpAskBeforeWatched = true;
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
  if (!apps.length) {
    wrap.innerHTML = vpsHtml + `<div class="fav-empty">${t("tp_empty")}</div>`;
    bindThirdPartyEvents();
    restoreView();
    return;
  }
  wrap.innerHTML = vpsHtml + apps
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
    const _watch = tpWatchDetail(app);
    const rootOk = vpsRootReady();
    const cardDisabled = tpIsAdmin && !rootOk;
    const stremioInstalled = !!(vpsProfile && vpsProfile.stremioInstalled);
    const installBtnDisabled = !(tpIsAdmin && rootOk && vpsGate.connected && (!stremioInstalled || !app.tunnelOk));
    const tunnelRemoveDisabled = !rootOk;
    const stremioInstallLabel = app.installUrl ? `
        <label><span class="settings-label-head"><span data-i18n="tp_install_url">${t("tp_install_url")}</span></span>
          <div class="tp-url-box"><input id="tp-stremio-url" type="text" readonly value="${escAttr(app.installUrl)}" /><button id="tp-stremio-copy" class="tab" data-i18n="tp_copy">${t("tp_copy")}</button></div>
        </label>` : "";
    return `
    <div class="channel-box accordion-box notif-type-box${tpStremioOpen ? " accordion-open" : ""}${cardDisabled ? " tp-card-disabled" : ""}" id="tp-app-stremio"${cardDisabled ? ` title="${t("vps_gate_tooltip")}"` : ""}>
      <div class="notif-type-head">
        <span class="notif-type-title"><i class="fa-solid fa-cubes"></i> ${escAttr(app.name || "Stremio")}</span>
      </div>
      <div class="notif-type-body" style="display:${tpStremioOpen ? "block" : "none"}">
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name"><span data-i18n="ask_before_watched_label">${t("ask_before_watched_label")}</span></span>
            <span class="ask-switch-area"><span class="saved-hint" id="ask-saved-hint" data-i18n="saved">${t("saved")}</span><label class="switch"><input type="checkbox" id="s-ask-before-watched" ${tpAskBeforeWatched ? "checked" : ""} /><span class="slider"></span></label></span>
          </div>
        </div>
        <div class="tp-sub-box">
          <div class="tp-status-row">
            <span class="notify-name">${t("tp_status")}</span>
            <span class="tp-status-value ${tpStatusClass(app)}">${tpStatusText(app)}</span>
          </div>
          ${_note ? `<div class="tp-frame-note">${_note}</div>` : ""}
        </div>
        ${app.lastSignal ? `
        <div class="tp-sub-box">
          <div class="tp-status-row"><span class="notify-name">${t("tp_last_signal")}</span><span class="tp-last-signal">${formatSignalTime(app.lastSignal)}</span></div>
          ${_watch ? `<div class="tp-frame-note tp-watch-detail" title="${_watch}">${_watch}</div>` : ""}
        </div>` : ""}
        ${tpIsAdmin ? `
        <div class="tp-sub-box">
          <label><span class="settings-label-head"><span data-i18n="tp_base_url">${t("tp_base_url")}</span><span class="saved-hint" data-i18n="saved">${t("saved")}</span></span>
            <div class="tp-url-box"><input id="tp-base-input" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" inputmode="url" placeholder="https://…" value="${escAttr(tpBaseUrl)}" /></div>
          </label>
          ${stremioInstallLabel}
        </div>` : (tpBaseUrl || app.installUrl ? `
        <div class="tp-sub-box">
          ${tpBaseUrl ? `
          <label><span class="settings-label-head"><span data-i18n="tp_base_url">${t("tp_base_url")}</span></span>
            <div class="tp-url-box"><a id="tp-base-link" href="${escAttr(tpBaseUrl)}" target="_blank" rel="noopener">${escAttr(tpBaseUrl)}</a></div>
          </label>` : ""}
          ${stremioInstallLabel}
        </div>` : "")}
        <div class="test-row" style="margin-top:12px; justify-content:center; display:flex; gap:12px; flex-wrap:wrap;">
          ${vpsBtnOrTip(`<button id="tp-stremio-install" class="tab"${installBtnDisabled ? " disabled aria-disabled=\"true\"" : ""}>${stremioInstalled && !app.tunnelOk ? t("stremio_install_repair") : t("install_on_vps")}</button>`, installBtnDisabled, app.status === "connected")}
          <button id="tp-stremio-refresh" class="tab" data-i18n="tp_refresh_uuid">${t("tp_refresh_uuid")}</button>
          ${tpIsAdmin && app.tunnelInstalled ? vpsBtnOrTip(`<button id="tp-stremio-tunnel-remove" class="tab" data-i18n="tunnel_remove_btn"${tunnelRemoveDisabled ? " disabled aria-disabled=\"true\"" : ""}>${t("tunnel_remove_btn")}</button>`, tunnelRemoveDisabled, app.status === "connected") : ""}
          ${app.installUrl ? `<button id="tp-stremio-disconnect" class="tab" data-i18n="tp_disconnect">${t("tp_disconnect")}</button>` : ""}
        </div>
        ${tpIsAdmin ? `<pre id="tp-stremio-joblog" class="tp-joblog" style="display:none"></pre>` : ""}
      </div>
    </div>`;
  },
  remote: (app) => {
    const isConn = app.status === "connected";
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

function tpStatusClass(app) {
  if (app.status === "connected") return "tp-connected";
  if (app.status === "ready") return "tp-ready";
  return "tp-not-connected";
}

function tpStatusText(app) {
  if (app.status === "connected") return t("tp_connected");
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

function tpWatchDetail(app) {
  const w = app.lastWatch;
  if (!w || !w.title) return "";
  if (w.kind === "tv" && w.season != null && w.episode != null)
    return escAttr(t("tp_watch_tv", { title: w.title, s: w.season, e: w.episode }));
  if (w.kind === "anime" && w.episode != null)
    return escAttr(t("tp_watch_anime", { title: w.title, e: w.episode }));
  return escAttr(t("tp_watch_movie", { title: w.title }));
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
  // Tek-açık akordeon: VPS / Stremio / Uzak Bağlantı kartları.
  ["vps-info-box", "tp-app-stremio", "tp-app-remote"].forEach((id) => {
    const box = document.getElementById(id);
    if (!box) return;
    const head = box.querySelector(".notif-type-head");
    const body = box.querySelector(".notif-type-body");
    if (!head || !body) return;
    head.addEventListener("click", (e) => {
      if (box.classList.contains("tp-card-disabled")) return;
      if (e.target.closest("input") || e.target.closest("button") || e.target.closest("select") || e.target.closest("a") || e.target.closest(".provider-list")) return;
      setTpAccordion(id === "vps-info-box" ? "vps" : id === "tp-app-remote" ? "remote" : "stremio");
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
  const askToggle = document.getElementById("s-ask-before-watched");
  if (askToggle) {
    askToggle.addEventListener("change", async (e) => {
      const hint = document.getElementById("ask-saved-hint");
      const ok = await saveSettingsPartial({ ask_before_watched: e.target.checked ? "1" : "0" }, hint);
      tpAskBeforeWatched = e.target.checked;
      if (window.setAskEnabled) window.setAskEnabled(e.target.checked);
    });
  }
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
}

function setTpAccordion(which) {
  const boxes = [
    { id: "vps-info-box", get: () => tpVpsOpen, set: (v) => { tpVpsOpen = v; } },
    { id: "tp-app-stremio", get: () => tpStremioOpen, set: (v) => { tpStremioOpen = v; } },
    { id: "tp-app-remote", get: () => tpRemoteOpen, set: (v) => { tpRemoteOpen = v; } },
  ];
  const cur = boxes.find((b) => b.id === (which === "vps" ? "vps-info-box" : which === "stremio" ? "tp-app-stremio" : "tp-app-remote"));
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
        <label style="margin-top:6px"><span class="settings-label-head"><span>${escAttr(t("vps_port"))}</span><span class="saved-hint" id="vps-port-saved" data-i18n="saved">${t("saved")}</span></span>
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
        <label style="margin-top:6px"><span class="settings-label-head"><span id="vps-pass-label">${escAttr(passLabel)}</span><span class="saved-hint" id="vps-pass-saved" data-i18n="saved">${t("saved")}</span></span>
          <div class="tp-url-box"><input id="vps-pass" type="password" autocomplete="new-password" value="" placeholder="${escAttr(passPlaceholder)}" data-has="${passStored ? "1" : "0"}" /></div>
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
  const passEl = document.getElementById("vps-pass");
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
  const passEl = document.getElementById("vps-pass");
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
      const pe = document.getElementById("vps-pass");
      secret = pe ? pe.value : "";
      fieldEmpty = (secret === "" || secret === "••••••••")
        && (!pe || pe.getAttribute("data-has") !== "1");
    }
    // sudo parolasi: root'ta tutulmaz; key modunda ayri, parola modunda login parolasi.
    let sudoSecret = null;   // null = dokunma, "" = temizle
    if (isRoot && saved && saved.sudoHasSecret) sudoSecret = "";
    else if (!isRoot && vpsAuth === "key") {
      const pe = document.getElementById("vps-pass");
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
    const lbl = document.getElementById("vps-pass-label");
    if (lbl) lbl.textContent = mode === "key" ? t("vps_sudo_pass") : t("vps_auth_pass");
    const pe = document.getElementById("vps-pass");
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

async function openInstallWizard() {
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
    start.textContent = (det.installed && !det.tunnelActive)
      ? t("stremio_install_repair") : t("stremio_install_start");
    start.disabled = !!det.blocked || !(det.options && det.options.length);
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
      body: JSON.stringify({ kind: "stremio", params: { domain, web_server: siState.chosen } }),
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
    "vps-pass": "vps-pass-saved",
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
