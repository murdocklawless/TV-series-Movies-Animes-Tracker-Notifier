// Faz 4: settings — ayarlar menüsü, zaman dilimi / saat seçicileri, favori listeleri, otomatik kaydetme, bildirim anahtarları.
import { state } from "./state.js";
import { t, checkTmdbKey, applyLang } from "./i18n.js";
import { toast, escAttr, HEART_SVG } from "./utils.js";
import { sortMenu, activateUtilityTab, closeSortMenu } from "./views.js";

// ---- Search ----
// ---- Settings ----

// Bildirim tipleri — py/scheduler.py NOTIF_TYPES ile birebir aynı
const NOTIF_TYPES = [
  ["episode_today", "tv"], ["season_start", "tv"], ["season_planned", "tv"],
  ["season_production", "tv"], ["status_ended", "tv"], ["status_canceled", "tv"],
  ["status_pilot", "tv"], ["status_returning", "tv"], ["season_upcoming", "tv"],
  ["unwatched_bulk", "tv"], ["vote_threshold", "tv"],
  ["movie_today", "movie"], ["movie_rescheduled", "movie"], ["networks_changed", "movie"],
  ["anime_episode_today", "anime"], ["anime_hiatus", "anime"], ["anime_cancelled", "anime"],
  ["anime_finished", "anime"], ["anime_releasing", "anime"], ["anime_episodes", "anime"],
  ["anime_unwatched_bulk", "anime"],
];
const NOTIF_GROUPS = [["tv", "notif_group_tv"], ["movie", "notif_group_movie"], ["anime", "notif_group_anime"]];

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
            <label class="switch"><input type="checkbox" id="s-notif-${k}" checked /><span class="slider"></span></label>
          </div>`).join("")}
      </div>
    </div>`).join("");
  const hint = document.getElementById("notify-saved-hint");
  NOTIF_TYPES.forEach(([k]) => {
    document.getElementById(`s-notif-${k}`).addEventListener("change", (e) => {
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

  function applyPick(val) {
    input.value = val;
    lastHourValue = val;
    picks++;
    if (picks >= 2) {
      list.style.display = "none";
      open = false;
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
    if (!open) {
      picks = 0;
      render();
      list.style.display = "flex";
      scrollSelectedIntoView();
      open = true;
      list.scrollIntoView({ block: "nearest" });
    } else {
      list.style.display = "none";
      open = false;
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
    if (!e.target.closest(".time-combobox")) {
      list.style.display = "none";
      open = false;
    }
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

async function loadSettings() {
  const res = await fetch("/api/settings");
  const s = await res.json();
  document.getElementById("s-tmdb").value = s.tmdb_api_key || "";
  document.getElementById("s-token").value = s.telegram_bot_token || "";
  document.getElementById("s-chat").value = s.telegram_chat_id || "";
  document.getElementById("s-notification-hour").value = s.notification_hour || "09:05";
  document.getElementById("s-hour").value = s.notify_hour || "09:00";
  document.getElementById("s-sync-hour").value = s.sync_hour || "09:00";
  document.getElementById("s-genre-hour").value = s.genre_hour || "05:00";
  document.getElementById("s-data-hour").value = s.data_hour || "05:10";
  document.getElementById("s-anime-hour").value = s.anime_notification_hour || "09:05";
  document.getElementById("s-rec-hour").value = s.rec_hour || "05:25";
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
  initPulldownCombobox("s-notif-limit", "s-notif-limit-list");
  initTimePicker("s-notification-hour");
  initTimePicker("s-hour");
  initTimePicker("s-sync-hour");
  initTimePicker("s-genre-hour");
  initTimePicker("s-data-hour");
  initTimePicker("s-anime-hour");
  initTimePicker("s-rec-hour");
  state.currentTz = s.timezone || "Europe/Istanbul";
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
  syncAutoSaveBaselines();
  applyLang((s.language || "tr-TR").split("-")[0]);
  updateNotifyToggleStates();
}

function showMsg(text, ok) {
  toast(text, !ok);
}

function closeSettingsMenu() {
  const m = document.getElementById("settings-menu");
  if (m) m.classList.remove("open");
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
  document.querySelectorAll(".settings-modal-overlay").forEach((el) => {
    el.style.display = el.id === id ? "flex" : "none";
  });
  if (id === "settings-favorites-modal") {
    renderFavActorsList();
    renderFavGenresList();
  }
  if (id === "settings-notify-modal") updateNotifyToggleStates();
  closeSettingsMenu();
}

function closeSettingsModals() {
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
    else url = `/api/favorites/genre?name=${encodeURIComponent(ident)}&media=all`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      const { errText: _err } = await import("./i18n.js");
      body.innerHTML = `<div class="releases-error">${_err(data.error) || t("data_failed")}</div>`;
      return;
    }
    const items = data.items || [];
    if (!items.length) {
      body.innerHTML = `<div class="empty">${t("no_credits")}</div>`;
      return;
    }
    const { posterHTML, scoreTag, typeLabel, formatDate, applyTitleHint } = await import("./utils.js");
    const { openDetails } = await import("./components.js");
    const { loadFollowed } = await import("./views.js");
    const grid = document.createElement("div");
    grid.className = "poster-grid person-grid";
    for (const item of items) {
      const div = document.createElement("div");
      div.className = "card";
      const mediaType = item.media_type || (kind === "actor" ? "tv" : "movie");
      div.innerHTML = `
        ${posterHTML(item.poster_path, item.title)}
        <div class="info">
          <div class="title">${escAttr(item.title)}</div>
          <div class="meta">
            <span class="badge badge-${mediaType}">${typeLabel(mediaType)}</span>
            ${scoreTag(item.vote_average)}
            ${item.release_date ? `<div class="next-ep muted">${formatDate(item.release_date).text}</div>` : ""}
            ${item.character ? `<div class="next-ep muted">${escAttr(item.character)}</div>` : ""}
          </div>
        </div>
        <button class="remove" style="display:block" data-tip="${t("follow")}">+</button>
      `;
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
        const { t: _t } = await import("./i18n.js");
        toast(r.ok ? _t("added", { name: item.title }) : j.error || _t("error"));
        if (r.ok) {
          loadFollowed(mediaType === "tv" ? "dizi" : "film");
          modal.style.display = "none";
        }
      };
      div.onclick = () => {
        openDetails(mediaType, item.tmdb_id, item.title);
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

// Favoriler: 2 kutu doğrudan modal-body'de alt alta, dış çerçeve yok
(function initFavoritesAccordion() {
  [["fav-actors-box", "fav-actors-body"], ["fav-genres-box", "fav-genres-body"]].forEach(([boxId, bodyId]) => {
    const box = document.getElementById(boxId);
    const body = document.getElementById(bodyId);
    if (!box || !body) return;
    box.addEventListener("click", (e) => {
      if (e.target.closest("button") && e.target.closest(".fav-heart")) return;
      if (e.target.closest(".fav-item")) return;
      if (e.target.closest(".switch") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a") || e.target.closest(".provider-list")) return;
      const isOpen = body.style.display !== "none";
      document.getElementById("fav-actors-body").style.display = "none";
      document.getElementById("fav-genres-body").style.display = "none";
      document.getElementById("fav-actors-box").classList.remove("accordion-open");
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
  closeSortMenu();
  const menu = document.getElementById("settings-menu");
  const open = menu.classList.contains("open");
  if (open) {
    closeSettingsMenu();
  } else {
    activateUtilityTab(document.getElementById("tab-settings"));
    menu.classList.add("open");
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
    const ov = btn.closest(".settings-modal-overlay");
    if (ov) ov.style.display = "none";
  });
});
document.querySelectorAll(".settings-modal-overlay").forEach((ov) => {
  ov.addEventListener("click", (e) => {
    if (e.target === ov) ov.style.display = "none";
  });
});

function showSavedHint(el) {
  if (!el) return;
  clearTimeout(el._savedTimer);
  el.classList.add("show");
  el._savedTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

async function saveSettingsPartial(patch, hintEl) {
  try {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
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

document.getElementById("s-hour").addEventListener("change", () => {
  const el = document.getElementById("s-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ notify_hour: el.value }, hint);
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
document.getElementById("s-anime-hour").addEventListener("change", () => {
  const el = document.getElementById("s-anime-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ anime_notification_hour: el.value }, hint);
});
document.getElementById("s-rec-hour").addEventListener("change", () => {
  const el = document.getElementById("s-rec-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ rec_hour: el.value }, hint);
});

document.getElementById("s-telegram-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ telegram_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});
document.getElementById("s-ntfy-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ ntfy_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});
document.getElementById("s-discord-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ discord_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});
document.getElementById("s-email-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ email_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});
document.getElementById("s-center-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ notif_center_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});

renderNotifTypes();

document.getElementById("s-cache-ttl").addEventListener("change", () => {
  const el = document.getElementById("s-cache-ttl");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ cache_ttl: el.value }, hint);
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
  import("./notification.js").then((m) => {
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

export { loadSettings, renderFavActorsList, renderFavGenresList, saveSettingsPartial,
         updateNotifyToggleStates, closeSettingsMenu, showSettingsSubmodal, closeSettingsModals };
