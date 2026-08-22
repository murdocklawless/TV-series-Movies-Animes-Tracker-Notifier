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
    ? state.allTimezones.filter((z) => z.value.toLowerCase().includes(q)).slice(0, 100)
    : state.allTimezones.slice(0, 100);
  list.innerHTML = matches.map((z) => `<div data-tz="${z.value}">${z.value}</div>`).join("");
  list.style.display = matches.length ? "block" : "none";
  list.querySelectorAll("div").forEach((el) => {
    el.onclick = () => {
      document.getElementById("s-tz").value = el.dataset.tz;
      list.style.display = "none";
      document.getElementById("s-tz").dispatchEvent(new Event("change"));
    };
  });
}

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

function initTzCombo() {
  const input = document.getElementById("s-tz");
  const list = document.getElementById("s-tz-list");
  input.addEventListener("focus", () => renderTzList(input.value));
  input.addEventListener("input", () => renderTzList(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && list.style.display === "block") {
      const first = list.querySelector("div[data-tz]");
      if (first) {
        input.value = first.dataset.tz;
        list.style.display = "none";
        input.dispatchEvent(new Event("change"));
        e.preventDefault();
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tz-combobox")) list.style.display = "none";
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
  document.getElementById("s-notification-hour").value = s.notification_hour || "09:05";
  document.getElementById("s-ntfy").value = s.ntfy_topic || "";
  await loadTimezones();
  initTzCombo();
  initTimePicker("s-hour");
  initTimePicker("s-sync-hour");
  initTimePicker("s-genre-hour");
  initTimePicker("s-data-hour");
  initTimePicker("s-notification-hour");
  state.currentTz = s.timezone || "Europe/Istanbul";
  document.getElementById("s-tz").value = state.currentTz;
  document.getElementById("s-lang").value = s.language || "tr-TR";
  document.getElementById("s-telegram-enabled").checked = (s.telegram_enabled || "1") !== "0";
  document.getElementById("s-ntfy-enabled").checked = (s.ntfy_enabled || "1") !== "0";
  document.getElementById("s-center-enabled").checked = (s.notif_center_enabled || "1") !== "0";
  NOTIF_TYPES.forEach(([k]) => {
    const el = document.getElementById(`s-notif-${k}`);
    if (el) el.checked = (s[`notif_${k}`] || "1") !== "0";
  });
  document.getElementById("s-cache-ttl").value = s.cache_ttl || "90";
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
  const tg = document.getElementById("s-telegram-enabled");
  const nf = document.getElementById("s-ntfy-enabled");
  const tgWrap = tg.closest(".switch");
  const nfWrap = nf.closest(".switch");
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

function bindAutoSave(id, key, transform) {
  const el = document.getElementById(id);
  const hint = el.closest("label").querySelector(".saved-hint");
  el.addEventListener("blur", () => {
    const patch = {};
    patch[key] = transform ? transform(el.value) : el.value;
    saveSettingsPartial(patch, hint);
  });
}

bindAutoSave("s-tmdb", "tmdb_api_key", (v) => v.trim());
bindAutoSave("s-token", "telegram_bot_token", (v) => v.trim());
bindAutoSave("s-chat", "telegram_chat_id", (v) => v.trim());
bindAutoSave("s-ntfy", "ntfy_topic", (v) => v.trim());

document.getElementById("s-lang").addEventListener("change", () => {
  const el = document.getElementById("s-lang");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ language: el.value }, hint).then((ok) => {
    if (ok) applyLang(el.value.split("-")[0]);
  });
});

document.getElementById("s-tz").addEventListener("change", () => {
  const el = document.getElementById("s-tz");
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

document.getElementById("s-notification-hour").addEventListener("change", () => {
  const el = document.getElementById("s-notification-hour");
  const hint = el.closest("label").querySelector(".saved-hint");
  saveSettingsPartial({ notification_hour: el.value }, hint);
});

document.getElementById("s-telegram-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ telegram_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
});
document.getElementById("s-ntfy-enabled").addEventListener("change", (e) => {
  saveSettingsPartial({ ntfy_enabled: e.target.checked ? "1" : "0" }, document.getElementById("notify-saved-hint"));
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

document.getElementById("test-settings").onclick = async () => {
  const body = {
    telegram_bot_token: document.getElementById("s-token").value.trim(),
    telegram_chat_id: document.getElementById("s-chat").value.trim(),
    ntfy_topic: document.getElementById("s-ntfy").value.trim(),
  };
  const r = await fetch("/api/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  showMsg(r.ok ? t("test_sent") : j.error || t("error"), r.ok);
};


export { loadSettings, renderFavActorsList, renderFavGenresList, saveSettingsPartial,
         updateNotifyToggleStates, closeSettingsMenu, showSettingsSubmodal, closeSettingsModals };
