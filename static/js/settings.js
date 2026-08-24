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
];
const NOTIF_GROUPS = [["tv", "notif_group_tv"], ["movie", "notif_group_movie"], ["anime", "notif_group_anime"]];

function renderNotifTypes() {
  const wrap = document.getElementById("notif-types-groups");
  if (!wrap) return;
  wrap.innerHTML = NOTIF_GROUPS.map(([g, label]) => `
    <div class="notif-group-title" data-i18n="${label}">${escAttr(t(label))}</div>
    ${NOTIF_TYPES.filter(([, gg]) => gg === g).map(([k]) => `
      <div class="notify-row notify-type-row">
        <span class="notify-name"><span data-i18n="notif_type_${k}">${escAttr(t("notif_type_" + k))}</span></span>
        <label class="switch"><input type="checkbox" id="s-notif-${k}" checked /><span class="slider"></span></label>
      </div>`).join("")}
  `).join("");
  const hint = document.getElementById("notify-saved-hint");
  NOTIF_TYPES.forEach(([k]) => {
    document.getElementById(`s-notif-${k}`).addEventListener("change", (e) => {
      saveSettingsPartial({ [`notif_${k}`]: e.target.checked ? "1" : "0" }, hint);
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
  document.getElementById("s-hour").value = s.notify_hour || "09:00";
  document.getElementById("s-sync-hour").value = s.sync_hour || "09:00";
  document.getElementById("s-genre-hour").value = s.genre_hour || "05:00";
  document.getElementById("s-data-hour").value = s.data_hour || "05:10";
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
  initTimePicker("s-hour");
  initTimePicker("s-sync-hour");
  initTimePicker("s-genre-hour");
  initTimePicker("s-data-hour");
  state.currentTz = s.timezone || "Europe/Istanbul";
  document.getElementById("s-tz").value = state.currentTz;
  document.getElementById("s-lang").value = s.language || "tr-TR";
  document.getElementById("s-telegram-enabled").checked = (s.telegram_enabled || "1") !== "0";
  document.getElementById("s-ntfy-enabled").checked = (s.ntfy_enabled || "1") !== "0";
  document.getElementById("s-discord-enabled").checked = (s.discord_enabled || "1") !== "0";
  document.getElementById("s-email-enabled").checked = (s.email_enabled || "1") !== "0";
  document.getElementById("s-center-enabled").checked = (s.notif_center_enabled || "1") !== "0";
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
  if (id === "settings-favactors-modal") renderFavActorsList();
  if (id === "settings-favgenres-modal") renderFavGenresList();
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
        (a) => `<div class="fav-item"><span class="fav-name">${escAttr(a.name)}</span><button class="fav-heart" data-id="${escAttr(a.person_id)}" data-name="${escAttr(a.name)}" data-tip="${t("fav_actor_remove")}">${HEART_SVG}</button></div>`
      )
      .join("");
    list.querySelectorAll(".fav-heart").forEach((btn) => {
      btn.onclick = async () => {
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
        (g) => `<div class="fav-item"><span class="fav-name">${escAttr(g)}</span><button class="fav-heart" data-name="${escAttr(g)}" data-tip="${t("fav_genre_remove")}">${HEART_SVG}</button></div>`
      )
      .join("");
    list.querySelectorAll(".fav-heart").forEach((btn) => {
      btn.onclick = async () => {
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
  } catch (e) {}
}

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

["s-brevo-key", "s-email-from", "s-email-to", "s-smtp-host", "s-smtp-port", "s-smtp-user", "s-smtp-pass", "s-discord-webhook"].forEach((id) => {
  document.getElementById(id).addEventListener("blur", () => {
    const el = document.getElementById(id);
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
const emailCombobox = emailProvSelect.closest(".provider-combobox");
document.addEventListener("mousedown", (e) => {
  if (emailCombobox.contains(e.target)) return;
  const frame = document.getElementById("email-provider-frame");
  if (frame && frame.contains(e.target)) return;
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


export { loadSettings, renderFavActorsList, renderFavGenresList, saveSettingsPartial,
         updateNotifyToggleStates, closeSettingsMenu, showSettingsSubmodal, closeSettingsModals };
