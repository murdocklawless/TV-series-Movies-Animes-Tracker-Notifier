// Faz 30: kimlik — giris/kayit ekranı, oturum boot, admin modalı, rol kapıları.
import { t, applyLang } from "./i18n.js?v=448";
import { state } from "./state.js";
import { toast, ROLE_CHECK_SVG, ROLE_X_SVG, ROLE_PLAY_SVG, ROLE_PAUSE_SVG, ROLE_STOP_SVG } from "./utils.js";
import { openRejectConfirm, openMemberDeleteConfirm, openMemberDeactivateConfirm, openLogoutConfirm } from "./components.js";
import { switchView } from "./views.js";

let currentUser = null;
let loginMode = "login"; // login | register | force
let existsTimer = null;
let loginShown = false;

export function getCurrentUser() {
  return currentUser;
}
export function isAdmin() {
  return !!(currentUser && currentUser.role === "admin");
}

// ---- fetch sarmalama: /api çağrılarına çerez ekle, 401'de girişe düşür ----
const _rawFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const u = typeof url === "string" ? url : (url && url.url) || "";
  if (u.startsWith("/api/")) {
    opts = { ...opts, credentials: "include" };
  }
  return _rawFetch(url, opts).then((res) => {
    if (res.status === 401 && u.startsWith("/api/") && !u.startsWith("/api/auth/")) {
      showLogin();
    }
    return res;
  });
};

function api(path, opts = {}) {
  return _rawFetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
}
async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  let data = {};
  try {
    data = await res.json();
  } catch (_) {}
  return { res, data };
}

// ---- frontend kural denetimi (backend ile birebir) ----
const USER_RE = /^[A-Za-z0-9]{3,20}$/;
function checkUser(u) {
  if (!u || u.length < 3) return "auth_user_min";
  if (u.length > 20) return "auth_user_max";
  if (!USER_RE.test(u)) return "auth_user_chars";
  return null;
}
function checkPw(p) {
  if (!p || p.length < 10) return "auth_pw_min";
  if (!/[A-Z]/.test(p)) return "auth_pw_upper";
  if (!/[a-z]/.test(p)) return "auth_pw_lower";
  if (!/[0-9]/.test(p)) return "auth_pw_digit";
  if (!/[^A-Za-z0-9]/.test(p)) return "auth_pw_symbol";
  return null;
}

// ---- görünüm ----
function setMode(mode) {
  loginMode = mode;
  const frame = document.getElementById("login-frame");
  const title = document.getElementById("login-title");
  const go = document.getElementById("login-go");
  const reg = document.getElementById("login-register");
  const forgot = document.getElementById("login-forgot");
  const userH = document.getElementById("login-user-hint");
  const passH = document.getElementById("login-pass-hint");
  const pass2W = document.getElementById("login-pass2-wrap");
  const note = document.getElementById("login-exists-note");
  if (!frame) return;
  if (mode === "register") {
    frame.classList.add("register-mode");
    frame.classList.remove("reset-mode");
    title.textContent = t("login_register_title");
    go.querySelector("span").textContent = t("login_go");
    reg.querySelector("span").textContent = t("login_register_btn");
    forgot.style.display = "none";
    userH.style.display = "";
    passH.style.display = "";
    if (pass2W) pass2W.style.display = "";
    syncEyeIcon("login-pass");
    syncEyeIcon("login-pass2");
  } else if (mode === "force") {
    frame.classList.remove("register-mode");
    frame.classList.remove("reset-mode");
    title.textContent = t("login_force_title");
    go.style.display = "none";
    reg.style.display = "none";
    forgot.style.display = "none";
    userH.style.display = "none";
    passH.style.display = "none";
    note.style.display = "none";
    try {
      const rg = document.getElementById("login-reset-go");
      if (rg) rg.style.display = "none";
      const rb = document.getElementById("login-reset-back");
      if (rb) rb.style.display = "none";
    } catch (_) {}
    ensureForceRow();
  } else if (mode === "reset") {
    // Sifre Degistirme: ad kutusu yok, 2 kutu + en sagda kaydet; mavi cerceve.
    frame.classList.remove("register-mode");
    frame.classList.add("reset-mode");
    title.textContent = t("reset_title");
    go.style.display = "none";
    reg.style.display = "none";
    forgot.style.display = "none";
    userH.style.display = "none";
    passH.style.display = "none";
    note.style.display = "none";
    try {
      const user = document.getElementById("login-user");
      if (user) user.style.display = "none";
      const pass = document.getElementById("login-pass");
      if (pass) {
        pass.value = "";
        pass.type = "password";
        pass.placeholder = t("login_new_ph");
      }
      if (pass2W) {
        pass2W.style.display = "";
        const p2 = document.getElementById("login-pass2");
        if (p2) {
          p2.value = "";
          p2.type = "password";
          p2.placeholder = t("login_pass2_ph");
        }
      }
      const rg = document.getElementById("login-reset-go");
      if (rg) {
        rg.style.display = "";
        rg.querySelector("span").textContent = t("reset_save");
      }
      const rb = document.getElementById("login-reset-back");
      if (rb) {
        rb.style.display = "";
        rb.querySelector("span").textContent = t("login_back");
      }
    } catch (_) {}
    syncEyeIcon("login-pass");
    syncEyeIcon("login-pass2");
    hideForceRow();
  } else {
    frame.classList.remove("register-mode");
    frame.classList.remove("reset-mode");
    title.textContent = t("login_title");
    go.querySelector("span").textContent = t("login_go");
    reg.querySelector("span").textContent = t("login_register_btn");
    go.style.display = "";
    reg.style.display = "";
    forgot.style.display = "";
    try {
      const user = document.getElementById("login-user");
      if (user) user.style.display = "";
      const pass = document.getElementById("login-pass");
      if (pass) pass.placeholder = t("login_pass_ph");
      const rg = document.getElementById("login-reset-go");
      if (rg) rg.style.display = "none";
      const rb = document.getElementById("login-reset-back");
      if (rb) rb.style.display = "none";
    } catch (_) {}
    userH.style.display = "none";
    passH.style.display = "none";
    reg.disabled = false;
    note.style.display = "none";
    if (pass2W) {
      pass2W.style.display = "none";
      const p2 = document.getElementById("login-pass2");
      if (p2) {
        p2.value = "";
        p2.type = "password";
      }
      syncEyeIcon("login-pass2");
    }
    syncEyeIcon("login-pass");
    hideForceRow();
  }
  // Mod degisiminde ad yaziliysa varlik durumunu tazele (login: kayitli ad = kayit kapali).
  try { checkExists(); } catch (_) {}
  try { syncLoginLangSelect(); } catch (_) {}
}

// ---- login dil secici: ad→dil eslesmesi (kullanici bazli, cihaza damga yok) ----
const LANGMAP_KEY = "nx-langmap";
const LANGMAP_CAP = 20;
function loadLangMap() {
  try {
    const o = JSON.parse(localStorage.getItem(LANGMAP_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (_) {
    return {};
  }
}
function mapGet(u) {
  try {
    const v = loadLangMap()[u];
    return typeof v === "string" && v ? v : null;
  } catch (_) {
    return null;
  }
}
function mapSet(u, lang) {
  if (!u || !lang) return;
  try {
    const m = loadLangMap();
    m[u] = lang;
    const ks = Object.keys(m).slice(-LANGMAP_CAP);
    const o = {};
    ks.forEach((k) => { o[k] = m[k]; });
    localStorage.setItem(LANGMAP_KEY, JSON.stringify(o));
  } catch (_) {}
}
function loginLangValue() {
  try {
    const s = document.getElementById("login-lang");
    return (s && s.value) || "en-US";
  } catch (_) {
    return "en-US";
  }
}
function syncLoginLangSelect() {
  try {
    const s = document.getElementById("login-lang");
    if (!s) return;
    const cur = (state.currentLang || "en") + "-";
    const opt = Array.from(s.options).find((o) => o.value === state.currentLang) ||
      Array.from(s.options).find((o) => o.value.startsWith(cur)) || null;
    if (opt) s.value = opt.value;
    else if (!s.value) s.value = "en-US";
  } catch (_) {}
}
// Provider-deseni: satirlar gizli select'ten uretilir, secim change ile dile doner.
let _langHl = -1;
function langRows() {
  try {
    return Array.from(document.querySelectorAll("#login-lang-list .provider-cell"));
  } catch (_) {
    return [];
  }
}
function loginLangListOpen() {
  try {
    const l = document.getElementById("login-lang-list");
    return !!(l && l.style.display !== "none" && l.style.display !== "");
  } catch (_) {
    return false;
  }
}
function setLangHl(i) {
  const rs = langRows();
  if (!rs.length) { _langHl = -1; return; }
  _langHl = ((i % rs.length) + rs.length) % rs.length;
  rs.forEach((r, idx) => r.classList.toggle("hl", idx === _langHl));
  try { rs[_langHl].scrollIntoView({ block: "nearest" }); } catch (_) {}
}
function renderLoginLangRows() {
  const list = document.getElementById("login-lang-list");
  const sel = document.getElementById("login-lang");
  if (!list || !sel) return;
  list.innerHTML = "";
  Array.from(sel.options).forEach((opt) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "provider-cell" + (opt.value === sel.value ? " selected" : "");
    row.dataset.value = opt.value;
    row.textContent = opt.textContent;
    row.addEventListener("click", (e) => {
      try { e.stopPropagation(); } catch (_) {}
      pickLoginLang(opt.value);
    });
    list.appendChild(row);
  });
}
function toggleLoginLangList(on) {
  const list = document.getElementById("login-lang-list");
  if (!list) return;
  const open = typeof on === "boolean" ? on : !loginLangListOpen();
  if (open) {
    renderLoginLangRows();
    list.style.display = "flex";
    const rs = langRows();
    const cur = rs.findIndex((r) => r.dataset.value === loginLangValue());
    setLangHl(cur >= 0 ? cur : 0);
  } else {
    list.style.display = "none";
    _langHl = -1;
  }
}
function pickLoginLang(code) {
  const sel = document.getElementById("login-lang");
  if (!sel) return;
  toggleLoginLangList(false);
  if (sel.value !== code) {
    sel.value = code;
    // Oturumluk secim: ekrani cevirir, cihaza damga vurmaz (harita giris/kayitta yazilir).
    try { applyLang(code.split("-")[0]); } catch (_) {}
    try { syncEyeIcon("login-pass"); syncEyeIcon("login-pass2"); } catch (_) {}
  }
  try {
    const b = document.getElementById("login-lang-btn");
    if (b) b.focus({ preventScroll: true });
  } catch (_) {}
}
// Dil butonuna nereden gelindiyse Geri ile oraya donulur (koken takibi).
let langOrigin = null;
function loginElVisible(el) {
  try {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch (_) { return false; }
}
function trackLangOrigin() {
  try {
    const v = document.getElementById("view-login");
    if (!v || trackLangOrigin._wired) return;
    trackLangOrigin._wired = true;
    let last = null;
    v.addEventListener("focusin", (e) => {
      try {
        const t0 = e.target;
        const lb = document.getElementById("login-lang-btn");
        if (t0 && lb && (t0 === lb || (t0.closest && t0.closest("#login-lang-wrap")))) {
          if (last) langOrigin = last;
          return;
        }
        last = t0;
      } catch (_) {}
    });
  } catch (_) {}
}
function exitLangBtnToOrigin() {
  try {
    const o = langOrigin;
    if (o && document.contains(o) && !o.disabled && loginElVisible(o)) {
      o.focus({ preventScroll: true });
      return true;
    }
  } catch (_) {}
  try {
    const user = document.getElementById("login-user");
    if (user && !user.disabled && loginElVisible(user)) {
      user.focus({ preventScroll: true });
      return true;
    }
  } catch (_) {}
  return false;
}
// tv.js D-pad koprusu (liste acikken yon/OK/Geri yonetimi).
try {
  window.__NX_langList = {
    isOpen: loginLangListOpen,
    move(d) {
      if (d === "up" || d === "left") setLangHl(_langHl - 1);
      else setLangHl(_langHl + 1);
    },
    pick() {
      const rs = langRows();
      const r = rs[_langHl] || rs.find((x) => x.dataset.value === loginLangValue());
      if (r) pickLoginLang(r.dataset.value);
    },
    close() { toggleLoginLangList(false); },
    exitToOrigin() { return exitLangBtnToOrigin(); },
  };
} catch (_) {}

function ensureForceRow() {
  if (document.getElementById("login-new")) return;
  const frame = document.getElementById("login-frame");
  const btns = document.querySelector(".login-btns");
  const wrap = document.createElement("div");
  wrap.className = "pw-wrap";
  wrap.id = "login-new-wrap";
  const np = document.createElement("input");
  np.id = "login-new";
  np.type = "password";
  np.autocomplete = "new-password";
  np.maxLength = 64;
  np.placeholder = t("login_new_ph");
  const eye = document.createElement("button");
  eye.type = "button";
  eye.className = "pw-eye";
  eye.tabIndex = -1;
  eye.dataset.for = "login-new";
  eye.setAttribute("data-i18n-title", "login_show_pw");
  eye.innerHTML = EYE_CLOSED_SVG;
  wrap.appendChild(np);
  wrap.appendChild(eye);
  const sv = document.createElement("button");
  sv.id = "login-save";
  sv.className = "tab";
  sv.style.justifyContent = "center";
  sv.innerHTML = "<span></span>";
  sv.querySelector("span").textContent = t("login_save");
  sv.addEventListener("click", doChangePassword);
  frame.insertBefore(wrap, btns);
  frame.insertBefore(sv, btns);
  const pass = document.getElementById("login-pass");
  if (pass) pass.placeholder = t("login_old_ph");
}
function hideForceRow() {
  const wrap = document.getElementById("login-new-wrap");
  if (wrap) wrap.remove();
  const np = document.getElementById("login-new");
  if (np) np.remove();
  const sv = document.getElementById("login-save");
  if (sv) sv.remove();
  const pass = document.getElementById("login-pass");
  if (pass) pass.placeholder = t("login_pass_ph");
}

export function showLogin() {
  if (loginShown) return;
  loginShown = true;
  currentUser = null;
  document.body.classList.add("logged-out");
  try { langOrigin = null; } catch (_) {}
  try {
    const tb = document.getElementById("tmdb-key-banner");
    if (tb) tb.style.display = "none";
  } catch (_) {}
  document.querySelectorAll(".view.active").forEach((v) => v.classList.remove("active"));
  const lv = document.getElementById("view-login");
  if (lv) lv.classList.add("active");
  setMode("login");
  // Geri-yuklenen (acik kalmis) dil listesiyle baslanmaz.
  try { toggleLoginLangList(false); } catch (_) {}
  try { syncLoginLangSelect(); } catch (_) {}
  setTimeout(() => {
    const u = document.getElementById("login-user");
    if (u) u.focus({ preventScroll: true });
  }, 60);
}

function enterApp(user) {
  currentUser = user;
  loginShown = false;
  document.body.classList.remove("logged-out");
  const lv = document.getElementById("view-login");
  if (lv) lv.classList.remove("active");
  applyRoleGates();
  let v = "dizi";
  try {
    v = localStorage.getItem("activeView") || "dizi";
  } catch (_) {}
  switchView(v);
  document.dispatchEvent(new CustomEvent("auth:ready"));
  startHeartbeat();
}

// ---- Faz 31d kalp-atisi: acilista aninda + 30 sn'de bir; kapanista veda sinyali ----
let beatTimer = null;
function sendPing() {
  if (!currentUser) return;
  api("/api/auth/ping", { method: "POST" }).catch(() => {});
}
function startHeartbeat() {
  sendPing();
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = setInterval(sendPing, 30000);
  if (!startHeartbeat._wired) {
    startHeartbeat._wired = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sendPing();
    });
    window.addEventListener("pagehide", () => {
      if (!currentUser) return;
      try {
        const blob = new Blob([JSON.stringify({})], { type: "application/json" });
        navigator.sendBeacon("/api/auth/exit", blob);
      } catch (_) {}
    });
  }
}

function applyRoleGates() {
  const adminItem = document.getElementById("menu-admin-item");
  if (adminItem) adminItem.style.display = isAdmin() ? "" : "none";
  if (!isAdmin()) {
    // Faz 30 ara durum: uye yalniz kendine-ait ayarlari gorur (Faz 31'de update tek satira iner).
    ["settings-appupdate-modal", "settings-cache-modal", "settings-backup-modal", "settings-update-modal"].forEach(
      (id) => {
        const b = document.querySelector(`.settings-menu-item[data-target="${id}"]`);
        if (b) b.style.display = "none";
      }
    );
  }
}

// ---- akışlar ----
async function doLogin() {
  const u = document.getElementById("login-user").value.trim();
  const p = document.getElementById("login-pass").value;
  const err = checkUser(u) || checkPw(p);
  if (err) {
    toast(t(err), true);
    return;
  }
  const { res, data } = await apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: u, password: p }),
  });
  if (!res.ok) {
    toast(t(data.error || "auth_bad"), true);
    return;
  }
  if (data.force_pw_change) {
    const { res: meRes, data: me } = await apiJson("/api/auth/me");
    if (meRes.ok) {
      currentUser = { username: me.username, role: me.role };
      setMode("force");
    }
    return;
  }
  const { res: meRes, data: me } = await apiJson("/api/auth/me");
  if (meRes.ok) {
    try { mapSet(u, state.currentLang); } catch (_) {}
    enterApp(me);
  } else showLogin();
}

async function doRegister() {
  const u = document.getElementById("login-user").value.trim();
  const p = document.getElementById("login-pass").value;
  const p2el = document.getElementById("login-pass2");
  const p2 = p2el ? p2el.value : p;
  const err = checkUser(u) || checkPw(p);
  if (err) {
    toast(t(err), true);
    return;
  }
  if (p !== p2) {
    toast(t("auth_pw_mismatch"), true);
    return;
  }
  const { res, data } = await apiJson("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username: u, password: p, password2: p2, language: loginLangValue() }),
  });
  if (!res.ok) {
    toast(t(data.error || "auth_taken"), true);
    return;
  }
  try { mapSet(u, loginLangValue().split("-")[0]); } catch (_) {}
  if (data.status === "active") {
    const { res: meRes, data: me } = await apiJson("/api/auth/me");
    if (meRes.ok) {
      enterApp(me);
      return;
    }
  }
  toast(t("login_sent"));
  setMode("login");
}

let forgotBusy = false;
let forgotSeq = 0;
let resetUser = "";
let resetCheckTimer = null;
async function checkResetStatus() {
  // Etkin sifirlama istegi varsa reset moduna al, yoksa login moduna dondur.
  if (loginMode !== "login" && loginMode !== "reset") return;
  let u = "";
  try {
    u = document.getElementById("login-user").value.trim();
  } catch (_) {}
  if (checkUser(u)) {
    if (loginMode === "reset") setMode("login");
    return;
  }
  try {
    const { res, data } = await apiJson("/api/auth/reset-status?u=" + encodeURIComponent(u));
    if (!res.ok) return;
    if (data.active) {
      resetUser = u;
      if (loginMode !== "reset") setMode("reset");
    } else {
      if (loginMode === "reset") {
        resetUser = "";
        setMode("login");
      }
      // Acik istegi olan kullanicida Sifremi Unuttum gizlenir (tekrar istek yok).
      try {
        const fg = document.getElementById("login-forgot");
        if (fg && loginMode === "login") fg.style.display = data.pending ? "none" : "";
      } catch (_) {}
    }
  } catch (_) {}
}
async function doResetChange() {
  const u = resetUser || "";
  const p = document.getElementById("login-pass").value;
  const p2el = document.getElementById("login-pass2");
  const p2 = p2el ? p2el.value : p;
  if (!u || checkUser(u)) {
    setMode("login");
    return;
  }
  const err = checkPw(p);
  if (err) {
    toast(t(err), true);
    return;
  }
  if (p !== p2) {
    toast(t("auth_pw_mismatch"), true);
    return;
  }
  const { res, data } = await apiJson("/api/auth/reset-change", {
    method: "POST",
    body: JSON.stringify({ username: u, new: p, new2: p2 }),
  });
  if (!res.ok) {
    toast(t(data.error || "auth_nouser"), true);
    if (loginMode === "reset") setMode("login");
    return;
  }
  toast(t("reset_done"));
  resetUser = "";
  if (data.status === "active") {
    try { mapSet(u, state.currentLang); } catch (_) {}
    const { res: meRes, data: me } = await apiJson("/api/auth/me");
    if (meRes.ok) {
      enterApp(me);
      return;
    }
  } else {
    toast(t("auth_pending"));
  }
  setMode("login");
}
async function doForgot() {
  if (forgotBusy) return;
  const u = document.getElementById("login-user").value.trim();
  const err = checkUser(u);
  if (err) {
    toast(t(err), true);
    return;
  }
  const btn = document.getElementById("login-forgot");
  forgotBusy = true;
  const seq = ++forgotSeq;
  try {
    if (btn) btn.disabled = true;
    // Kayıt-ol mantığının tersi: sistemde yoksa istek gönderilmez, kırmızı toast.
    // (exists ucu zaten herkese açık — kayıt akışı kullanıyor, yeni sızıntı yok.)
    try {
      const { res, data } = await apiJson("/api/auth/exists?u=" + encodeURIComponent(u));
      if (seq !== forgotSeq) return; // bayat uçuş: yeni basış varken sus.
      if (res.ok && !data.exists) {
        toast(t("auth_user_not_found"), true);
        return;
      }
    } catch (_) {
      if (seq !== forgotSeq) return;
      // Ağ hatasında eski davranışa düş (backend hep-ok).
    }
    await apiJson("/api/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ username: u }),
    });
    if (seq !== forgotSeq) return;
    toast(t("login_sent"));
  } finally {
    if (seq === forgotSeq) {
      forgotBusy = false;
      if (btn) btn.disabled = false;
    }
  }
}

async function doChangePassword() {
  const old = document.getElementById("login-pass").value;
  const np = document.getElementById("login-new");
  const nw = np ? np.value : "";
  const err = checkPw(nw);
  if (err) {
    toast(t(err), true);
    return;
  }
  const { res, data } = await apiJson("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ old, new: nw }),
  });
  if (!res.ok) {
    toast(t(data.error || "auth_bad_old"), true);
    return;
  }
  const { res: meRes, data: me } = await apiJson("/api/auth/me");
  if (meRes.ok) enterApp(me);
}

async function checkExists() {
  if (loginMode !== "register" && loginMode !== "login") return;
  const u = document.getElementById("login-user").value.trim();
  const note = document.getElementById("login-exists-note");
  const reg = document.getElementById("login-register");
  const bad = !!checkUser(u);
  // Biçim-kapısı: boş/geçersiz adken forgot da kapalı (toast yolu düğmeden kapanır).
  try {
    const fg = document.getElementById("login-forgot");
    if (fg && !forgotBusy) fg.disabled = bad;
  } catch (_) {}
  if (bad) {
    if (loginMode === "register") note.style.display = "none";
    reg.disabled = false;
    return;
  }
  try {
    const { res, data } = await apiJson("/api/auth/exists?u=" + encodeURIComponent(u));
    const taken = res.ok && data.exists;
    if (loginMode === "register") note.style.display = taken ? "" : "none";
    reg.disabled = !!taken;
  } catch (_) {}
}

// ---- admin ----
// İyimser satır silme + 0.5sn kare gizleme (bekleyen + sıfırlama kareleri).
// Satır anında kalkar, POST arkada koşar; son satırdan 0.5sn sonra boş kare
// gizlenir. Arada imza poll'u yeni veri getirirse timer iptal olur.
const frameHideTimers = {};
function scheduleFrameHide(frameSel, listSel) {
  try {
    if (frameHideTimers[frameSel]) clearTimeout(frameHideTimers[frameSel]);
    frameHideTimers[frameSel] = setTimeout(() => {
      try {
        delete frameHideTimers[frameSel];
        const list = document.querySelector(listSel);
        const frame = document.querySelector(frameSel);
        if (!list || !frame) return;
        if (!list.querySelector(".member-chip")) frame.style.display = "none";
      } catch (_) {}
    }, 500);
  } catch (_) {}
}
function cancelFrameHide(frameSel) {
  try {
    if (frameSel) {
      if (frameHideTimers[frameSel]) clearTimeout(frameHideTimers[frameSel]);
      delete frameHideTimers[frameSel];
      return;
    }
    Object.keys(frameHideTimers).forEach((k) => {
      try { clearTimeout(frameHideTimers[k]); } catch (_) {}
      delete frameHideTimers[k];
    });
  } catch (_) {}
}
function optimisticRemoveChip(listSel, uid) {
  try {
    const row = document.querySelector(`${listSel} .member-chip[data-uid="${uid}"]`);
    if (row && row.parentNode) row.parentNode.removeChild(row);
  } catch (_) {}
}
function pendingChip(u) {
  const d = document.createElement("div");
  d.className = "member-chip";
  try { d.dataset.uid = u.id; } catch (_) {}
  const left = document.createElement("div");
  left.className = "member-text";
  const nm = document.createElement("div");
  nm.className = "member-name";
  nm.textContent = u.username;
  nm.title = u.username;
  left.appendChild(nm);
  const sb = document.createElement("div");
  sb.className = "member-sub";
  sb.textContent = u.created_at || "";
  left.appendChild(sb);
  d.appendChild(left);
  const icons = document.createElement("div");
  icons.className = "member-icons";
  const call = (path, id) => async () => {
    optimisticRemoveChip("#admin-pending-list", id);
    scheduleFrameHide("#admin-pending-frame", "#admin-pending-list");
    try {
      const { res } = await apiJson(path, { method: "POST", body: JSON.stringify({ id }) });
      cancelFrameHide("#admin-pending-frame");
      loadAdminLists();
    } catch (_) {
      cancelFrameHide("#admin-pending-frame");
      loadAdminLists();
    }
  };
  icons.appendChild(roleIcon(ROLE_CHECK_SVG, "admin_approve", "c-green", call("/api/auth/approve", u.id), false, true));
  icons.appendChild(roleIcon(ROLE_X_SVG, "admin_reject", "c-red", () => openRejectConfirm(`${t("admin_reject")} — ${u.username}`, call("/api/auth/reject", u.id)), false, true));
  d.appendChild(icons);
  return d;
}

// Sifirlama cipi anahtar simgesi (gecici sifre anlami; 10px stroke deseniyle).
const ROLE_KEY_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="12" r="4"></circle><line x1="11" y1="12" x2="20" y2="12"></line><line x1="17" y1="12" x2="17" y2="16"></line><line x1="20" y1="12" x2="20" y2="15"></line></svg>`;

// Sifre-goz simgeleri (satir-ici SVG; FA fontuna bagimsiz — TV WebView dahil):
// ACIK goz = text gorunur, CIZILI goz = masked (standart eslesme).
const EYE_OPEN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_CLOSED_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>`;
function syncEyeIcon(inputId) {
  try {
    const inp = document.getElementById(inputId);
    const eye = document.querySelector(`.pw-eye[data-for="${inputId}"]`);
    if (!inp || !eye) return;
    eye.innerHTML = inp.type === "password" ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
  } catch (_) {}
}

function resetChip(r) {
  const d = document.createElement("div");
  d.className = "member-chip";
  try { d.dataset.uid = r.user_id; } catch (_) {}
  const left = document.createElement("div");
  left.className = "member-text";
  const nm = document.createElement("div");
  nm.className = "member-name";
  nm.textContent = r.username;
  nm.title = r.username;
  left.appendChild(nm);
  const sb = document.createElement("div");
  sb.className = "member-sub";
  sb.textContent = r.created_at || "";
  left.appendChild(sb);
  d.appendChild(left);
  const icons = document.createElement("div");
  icons.className = "member-icons";
  icons.appendChild(roleIcon(ROLE_KEY_SVG, "reset_activate_tip", "c-white", () => adminActivate(r.user_id), false, true));
  d.appendChild(icons);
  return d;
}

function adminEmpty() {
  const d = document.createElement("div");
  d.className = "admin-empty";
  d.textContent = t("admin_empty");
  return d;
}

export async function loadAdminLists() {
  if (!isAdmin()) return;
  // İskelet hemen (kutu boş kalmaz); fetch+poll SONDA (modal display:flex
  // showSettingsSubmodal'daki await'ten sonra bitiyor — başta çağrılırsa
  // adminModalOpen() false görüp sessiz ölüyordu, rate hiç atılmıyordu).
  paintRateSkeleton();
  const { res, data } = await apiJson("/api/auth/pending");
  const pl = document.getElementById("admin-pending-list");
  const rl = document.getElementById("admin-resets-list");
  pl.innerHTML = "";
  rl.innerHTML = "";
  pl.classList.add("member-chips");
  rl.classList.add("member-chips");
  let pendingCount = 0, resetsCount = 0;
  if (res.ok) {
    (data.pending || []).forEach((u) => {
      pl.appendChild(pendingChip(u));
    });
    if (!(data.pending || []).length) pl.appendChild(adminEmpty());
    (data.resets || []).forEach((r) => {
      rl.appendChild(resetChip(r));
    });
    if (!(data.resets || []).length) rl.appendChild(adminEmpty());
    pendingCount = (data.pending || []).length;
    resetsCount = (data.resets || []).length;
    try { lastAdminSig = adminSig(data); } catch (_) {}
  }
  // Kareler bagimsiz: bossa gizlenir; ikisi de bossa blok kalkar
  // (modal: rate + Uyeler). Yeniden veri gelirse ayni kod geri acar.
  try {
    const pf = document.getElementById("admin-pending-frame");
    if (pf) pf.style.display = pendingCount ? "" : "none";
    const rf = document.getElementById("admin-resets-frame");
    if (rf) rf.style.display = resetsCount ? "" : "none";
    const wrap = document.getElementById("admin-pending-wrap");
    if (wrap) wrap.style.display = (pendingCount || resetsCount) ? "" : "none";
  } catch (_) {}
  const { res: mres, data: mdata } = await apiJson("/api/auth/members");
  const ml = document.getElementById("admin-members-list");
  ml.innerHTML = "";
  if (mres.ok) {
    const actives = (mdata.members || []).filter((x) => x.role === "admin" && x.status === "active");
    // Bekleyenler yalniz ust cercevede (pendingChip); uyelerde tekrar gosterilmez.
    (mdata.members || []).filter((u) => u.status !== "pending").forEach((u) => {
      ml.appendChild(memberChip(u, actives.length));
    });
  }
  armAdminRefresh();
  armAdminSig();
  // Modal bu noktada açık (pending+members await'leri display:flex'e zaman
  // tanıdı) — rate fetch+poll burada başlar (eski çalışan sıra).
  loadRateBars();
  armRateRefresh();
}

// Bekleyen imza poll'u (5sn, hafif): id listesi degisince tam reload.
// Dusmus istek modal acikken kendiliginden belirir (refresh yok).
let adminSigTimer = null;
let lastAdminSig = "";
function adminSig(data) {
  try {
    const p = (data.pending || []).map((u) => u.id).join(",");
    const r = (data.resets || []).map((x) => x.id).join(",");
    return p + "|" + r;
  } catch (_) { return ""; }
}
function armAdminSig() {
  if (adminSigTimer) clearInterval(adminSigTimer);
  adminSigTimer = null;
  if (!adminModalOpen()) return;
  adminSigTimer = setInterval(async () => {
    try {
      if (!adminModalOpen() || !isAdmin()) {
        clearInterval(adminSigTimer);
        adminSigTimer = null;
        return;
      }
      const { res, data } = await apiJson("/api/auth/pending");
      if (!res.ok) return;
      const sig = adminSig(data);
      if (lastAdminSig && sig !== lastAdminSig) {
        cancelFrameHide();
        loadAdminLists();
      }
      lastAdminSig = sig;
    } catch (_) {}
  }, 5000);
}

// Faz 31d: admin modali acikken 30 sn'de bir sessiz yenileme (F5 yok).
let adminTimer = null;
function adminModalOpen() {
  try {
    const ov = document.getElementById("settings-admin-modal");
    return !!(ov && ov.style.display !== "none" && isVisibleEl(ov));
  } catch (_) {
    return false;
  }
}
function isVisibleEl(el) {
  try {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  } catch (_) {
    return false;
  }
}
function armAdminRefresh() {
  if (adminTimer) clearInterval(adminTimer);
  adminTimer = null;
  if (!adminModalOpen()) return;
  adminTimer = setInterval(() => {
    if (!adminModalOpen() || !isAdmin()) {
      clearInterval(adminTimer);
      adminTimer = null;
      return;
    }
    loadAdminLists();
  }, 30000);
}

// limit.md: API hiz gostergesi — etiket satiri + 3 bar + 1 sn poll (armAdminRefresh ikizi).
// Teshis durumu: window.__NX_RATE ({polls, lastOk, lastErr, rows}).
let rateTimer = null;
let rateFails = 0;
const RATE_SERVICES = ["tmdb", "anilist", "tvmaze"];
function rateLabel(s) {
  return s === "tmdb" ? "TMDB" : s === "anilist" ? "AniList" : "TVMaze";
}
function ratePct(n) {
  // tr öne ekler (%75), diğer diller sona ekler (75%).
  try {
    if (state.currentLang === "tr") return "%" + n;
  } catch (_) {}
  return n + "%";
}
function rateSep() {
  const sp = document.createElement("span");
  sp.className = "rate-sep";
  sp.textContent = "·";
  return sp;
}
function rateScale() {
  // Bar alti cetvel: 0 25 50 75 100 (0.5rem, sonuk; % olcegiyle hizali).
  const sc = document.createElement("div");
  sc.className = "rate-scale";
  [0, 25, 50, 75, 100].forEach((v) => {
    const s = document.createElement("span");
    s.textContent = String(v);
    if (v === 0) s.className = "tick-0";
    else if (v === 100) s.className = "tick-100";
    else s.style.left = v + "%";
    sc.appendChild(s);
  });
  return sc;
}
function fmtTotal(n) {
  // Gunluk toplam: dile gore binlik grup (tr 1.250, en 1,250).
  const v = Math.max(0, Math.floor(n || 0));
  try {
    const lang = (state && state.currentLang) || "tr";
    return new Intl.NumberFormat(lang === "tr" ? "tr-TR" : lang).format(v);
  } catch (_) {
    const s = String(v);
    const sep = ((state && state.currentLang) || "tr") === "tr" ? "." : ",";
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
}
function paintRateSkeleton() {
  // Fetch beklenmeden iskelet satirlar: kutu asla bos kalmaz.
  try {
    const box = document.getElementById("admin-rate-bars");
    if (!box || box.dataset.skel) return;
    box.dataset.skel = "1";
    box.innerHTML = "";
    RATE_SERVICES.forEach((s) => {
      const row = document.createElement("div");
      row.className = "rate-row";
      const lab = document.createElement("span");
      lab.className = "rate-label";
      lab.textContent = rateLabel(s);
      row.appendChild(lab);
      const track = document.createElement("div");
      track.className = "rate-track";
      row.appendChild(track);
      row.appendChild(rateScale());
      box.appendChild(row);
    });
  } catch (_) {}
}
function paintRateError() {
  try {
    const box = document.getElementById("admin-rate-bars");
    if (!box || box.querySelector(".rate-err")) return;
    const d = document.createElement("div");
    d.className = "rate-err";
    d.textContent = t("rate_failed");
    box.appendChild(d);
  } catch (_) {}
}
async function loadRateBars() {
  window.__NX_RATE = window.__NX_RATE || { polls: 0, lastOk: 0, lastErr: "", rows: 0 };
  window.__NX_RATE.polls += 1;
  if (!isAdmin() || !adminModalOpen()) {
    window.__NX_RATE.lastErr = "guard-closed";
    return;
  }
  const box = document.getElementById("admin-rate-bars");
  if (!box) {
    window.__NX_RATE.lastErr = "nobox";
    return;
  }
  let data = null;
  try {
    const { res, data: d } = await apiJson("/api/admin/rate");
    if (!res.ok) {
      window.__NX_RATE.lastErr = "http" + res.status;
      throw new Error("rate http " + res.status);
    }
    data = d;
  } catch (e) {
    window.__NX_RATE.lastErr = String((e && e.message) || e);
    console.warn("[rate] fetch failed:", window.__NX_RATE.lastErr);
    rateFails += 1;
    if (rateFails >= 3) paintRateError();
    return;
  }
  if (!adminModalOpen()) return;
  rateFails = 0;
  window.__NX_RATE.lastOk = Date.now();
  window.__NX_RATE.lastErr = "";
  try {
    delete box.dataset.skel;
  } catch (_) {}
  const errEl = box.querySelector(".rate-err");
  if (errEl) errEl.remove();
  box.innerHTML = "";
  RATE_SERVICES.forEach((s) => {
    const st = (data && data[s]) || { pct: 0, peak: 0, total: 0 };
    const pct = Math.max(0, Math.min(100, st.pct || 0));
    const peak = Math.max(0, Math.min(100, st.peak || 0));
    const row = document.createElement("div");
    row.className = "rate-row";
    const top = document.createElement("div");
    top.className = "rate-topline";
    const lab = document.createElement("span");
    lab.className = "rate-label";
    lab.textContent = rateLabel(s);
    top.appendChild(lab);
    const stats = document.createElement("span");
    stats.className = "rate-stats-inline";
    const nowEl = document.createElement("span");
    nowEl.className = "rate-now";
    nowEl.textContent = t("rate_now") + " " + ratePct(pct);
    stats.appendChild(nowEl);
    stats.appendChild(rateSep());
    const peakEl = document.createElement("span");
    peakEl.className = "rate-peak-t";
    peakEl.textContent = t("rate_peak") + " " + ratePct(peak);
    peakEl.setAttribute("data-i18n-title", "rate_peak_tip");
    peakEl.setAttribute("data-tip", t("rate_peak_tip"));
    stats.appendChild(peakEl);
    stats.appendChild(rateSep());
    const totEl = document.createElement("span");
    totEl.className = "rate-total";
    totEl.textContent = t("rate_total") + " " + fmtTotal(st.total);
    totEl.setAttribute("data-i18n-title", "rate_peak_tip");
    totEl.setAttribute("data-tip", t("rate_peak_tip"));
    stats.appendChild(totEl);
    top.appendChild(stats);
    row.appendChild(top);
    const track = document.createElement("div");
    track.className = "rate-track";
    const fill = document.createElement("div");
    fill.className = "rate-fill";
    fill.style.width = pct + "%";
    track.appendChild(fill);
    if (peak > 0) {
      const pk = document.createElement("div");
      pk.className = "rate-peak";
      pk.style.left = "calc(" + peak + "% - 1px)";
      track.appendChild(pk);
    }
    row.appendChild(track);
    row.appendChild(rateScale());
    box.appendChild(row);
  });
  window.__NX_RATE.rows = box.childElementCount;
}
function armRateRefresh() {
  if (rateTimer) clearInterval(rateTimer);
  rateTimer = null;
  if (!isAdmin()) return;
  if (!adminModalOpen()) {
    // Modal henüz açılmadıysa (showSettingsSubmodal await yarışı) pes etme:
    // kısa gecikmeyle birkaç kez tekrar dene, sonra tick içinde guard'lı poll kur.
    window.__NX_RATE = window.__NX_RATE || { polls: 0, lastOk: 0, lastErr: "", rows: 0 };
    window.__NX_RATE.lastErr = "guard-closed-retry";
    let tries = 0;
    const retry = setInterval(() => {
      tries += 1;
      if (adminModalOpen() && isAdmin()) {
        clearInterval(retry);
        loadRateBars();
        armRateRefresh();
      } else if (tries >= 10) {
        clearInterval(retry);
      }
    }, 300);
    return;
  }
  rateTimer = setInterval(() => {
    if (!adminModalOpen() || !isAdmin()) {
      clearInterval(rateTimer);
      rateTimer = null;
      return;
    }
    loadRateBars();
  }, 1000);
}
// Konsoldan elle tetikleme + modal-sonrası kick: __NX_kickRate()
try {
  window.__NX_kickRate = () => {
    paintRateSkeleton();
    loadRateBars();
    armRateRefresh();
  };
} catch (_) {}

function roleIcon(inner, tipKey, colorCls, fn, dead, isSvg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "role-icon " + colorCls + (dead ? " dead" : "");
  b.innerHTML = isSvg ? inner : `<i class="fa-regular ${inner}"></i>`;
  b.setAttribute("data-i18n-title", tipKey);
  b.setAttribute("data-tip", t(tipKey));
  if (dead) {
    b.setAttribute("aria-disabled", "true");
    b.tabIndex = -1;
  } else {
    b.addEventListener("click", fn);
  }
  return b;
}

function memberChip(u, activeAdmins) {
  const d = document.createElement("div");
  d.className = "member-chip";
  const left = document.createElement("div");
  left.className = "member-text";
  const nm = document.createElement("div");
  nm.className = "member-name" + (u.online ? " online" : "");
  nm.textContent = u.username;
  nm.title = u.username;
  left.appendChild(nm);
  const role = u.role === "admin" ? t("admin_role_admin") : t("admin_role_member");
  const st =
    u.status === "active" ? t("admin_status_active") : u.status === "pending" ? t("admin_status_pending") : t("admin_status_passive");
  const sb = document.createElement("div");
  sb.className = "member-sub" + (u.online ? " online" : "");
  sb.textContent = `${role} · ${st}`;
  left.appendChild(sb);
  d.appendChild(left);
  const icons = document.createElement("div");
  icons.className = "member-icons";
  const call = (path, id) => async () => {
    const { res } = await apiJson(path, { method: "POST", body: JSON.stringify({ id }) });
    if (res.ok) loadAdminLists();
  };
  if (u.id !== 1) {
    if (u.status === "passive") {
      icons.appendChild(roleIcon(ROLE_PLAY_SVG, "admin_activate", "c-orange", call("/api/auth/activate", u.id), false, true));
      icons.appendChild(roleIcon(ROLE_X_SVG, "tip_delete", "c-red", () => openMemberDeleteConfirm(t("del_confirm", { name: u.username }), call("/api/auth/delete", u.id)), false, true));
    } else if (u.role === "admin") {
      const lastOne = activeAdmins <= 1;
      icons.appendChild(roleIcon("fa-gem", "tip_demote", "c-red", call("/api/auth/demote", u.id), lastOne));
      icons.appendChild(roleIcon(ROLE_PAUSE_SVG, "admin_deactivate", "c-orange", () => openMemberDeactivateConfirm(`${t("admin_deactivate")} — ${u.username}`, call("/api/auth/deactivate", u.id)), false, true));
      icons.appendChild(roleIcon(ROLE_STOP_SVG, "admin_kick", "c-gray", call("/api/auth/kick", u.id), false, true));
      icons.appendChild(roleIcon(ROLE_X_SVG, "tip_delete", "c-red", () => openMemberDeleteConfirm(t("del_confirm", { name: u.username }), call("/api/auth/delete", u.id)), false, true));
    } else {
      icons.appendChild(roleIcon("fa-user", "tip_promote", "c-green", call("/api/auth/promote", u.id)));
      icons.appendChild(roleIcon(ROLE_PAUSE_SVG, "admin_deactivate", "c-orange", () => openMemberDeactivateConfirm(`${t("admin_deactivate")} — ${u.username}`, call("/api/auth/deactivate", u.id)), false, true));
      icons.appendChild(roleIcon(ROLE_STOP_SVG, "admin_kick", "c-gray", call("/api/auth/kick", u.id), false, true));
      icons.appendChild(roleIcon(ROLE_X_SVG, "tip_delete", "c-red", () => openMemberDeleteConfirm(t("del_confirm", { name: u.username }), call("/api/auth/delete", u.id)), false, true));
    }
  } else {
    const admins = activeAdmins;
    icons.appendChild(roleIcon("fa-gem", "tip_demote", "c-red", call("/api/auth/demote", u.id), admins <= 1));
  }
  if (icons.children.length) d.appendChild(icons);
  return d;
}

async function adminCall(path, id) {
  const { res } = await apiJson(path, { method: "POST", body: JSON.stringify({ id }) });
  if (res.ok) loadAdminLists();
}
async function adminActivate(userId) {
  // Istegi etkinlestirir (sifre uretmez); satir anında kalkar, 0.5sn sonra
  // bossa kare gizlenir; POST arkada kosar, hata olursa liste geri gelir.
  optimisticRemoveChip("#admin-resets-list", userId);
  scheduleFrameHide("#admin-resets-frame", "#admin-resets-list");
  try {
    const { res, data } = await apiJson("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ id: userId }),
    });
    cancelFrameHide("#admin-resets-frame");
    if (!res.ok) {
      toast(t(data.error || "auth_nouser"), true);
      loadAdminLists();
      return;
    }
    toast(t("reset_activated"));
    loadAdminLists();
  } catch (_) {
    cancelFrameHide("#admin-resets-frame");
    loadAdminLists();
  }
}

// ---- çıkış ----
function doLogout() {
  openLogoutConfirm(
    t("logout_confirm"),
    async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      location.reload();
    }
  );
}

// ---- boot ----
function wireLogin() {
  const go = document.getElementById("login-go");
  const reg = document.getElementById("login-register");
  const forgot = document.getElementById("login-forgot");
  const user = document.getElementById("login-user");
  const pass = document.getElementById("login-pass");
  if (!go) return;
  go.addEventListener("click", () => (loginMode === "register" ? setMode("login") : doLogin()));
  reg.addEventListener("click", () => (loginMode === "register" ? doRegister() : setMode("register")));
  forgot.addEventListener("click", doForgot);
  // TV'ye özel Çıkış butonu (oturum yok — doğrudan bridge; onay/API yok).
  try {
    const lx = document.getElementById("login-exit");
    if (lx) lx.addEventListener("click", (e) => {
      try { e.stopPropagation(); } catch (_) {}
      try { if (window.NextEpTV && typeof window.NextEpTV.exitApp === "function") window.NextEpTV.exitApp(); } catch (_) {}
    });
  } catch (_) {}
  [user, pass].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (loginMode === "reset") doResetChange();
        else if (loginMode === "register") doRegister();
        else doLogin();
      }
    });
  });
  const pass2 = document.getElementById("login-pass2");
  if (pass2) {
    pass2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (loginMode === "reset") doResetChange();
        else doRegister();
      }
    });
  }
  const rgo = document.getElementById("login-reset-go");
  if (rgo) rgo.addEventListener("click", doResetChange);
  const rback = document.getElementById("login-reset-back");
  if (rback) {
    rback.addEventListener("click", () => {
      resetUser = "";
      setMode("login");
    });
  }
  // Göz ikonu: ilgili kutunun type'ını çevirir (dinamik satırlar dahil — delegasyon).
  // Standart eşleşme: çizili göz = masked (password), açık göz = açık text.
  document.getElementById("view-login").addEventListener("click", (e) => {
    const eye = e.target.closest(".pw-eye");
    if (!eye) return;
    const inp = document.getElementById(eye.dataset.for);
    if (!inp) return;
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    eye.innerHTML = show ? EYE_OPEN_SVG : EYE_CLOSED_SVG;
    eye.setAttribute("data-tip", t(show ? "login_hide_pw" : "login_show_pw"));
  });
  user.addEventListener("input", () => {
    clearTimeout(existsTimer);
    existsTimer = setTimeout(checkExists, 400);
    clearTimeout(resetCheckTimer);
    resetCheckTimer = setTimeout(checkResetStatus, 400);
    // Ad→dil eslesmesi: kutuya birebir kayitli ad yazilinca ekran o dile doner.
    try {
      const v = user.value.trim();
      const hit = v ? mapGet(v) : null;
      if (hit && hit !== state.currentLang) {
        applyLang(hit);
        syncLoginLangSelect();
      }
    } catch (_) {}
  });
  // Dil secici: buton acar/kapar, dis tik kapatir.
  try {
    const lb = document.getElementById("login-lang-btn");
    if (lb) {
      lb.addEventListener("click", (e) => {
        try { e.stopPropagation(); } catch (_) {}
        // Aciksa vurgulu satiri sec (toggle yok); kapaliyken OK acar.
        if (loginLangListOpen()) {
          const rs = langRows();
          const r = rs[_langHl] || rs.find((x) => x.dataset.value === loginLangValue());
          if (r) pickLoginLang(r.dataset.value);
          else toggleLoginLangList(false);
        } else {
          toggleLoginLangList(true);
        }
      });
      lb.addEventListener("keydown", (e) => {
        if (loginLangListOpen()) return;
        // Yalniz OK acar (asagi-ok degil — o kullaniciya gider).
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleLoginLangList(true);
        }
      });
    }
    document.addEventListener("click", (e) => {
      try {
        if (loginLangListOpen() && !e.target.closest("#login-lang-wrap")) toggleLoginLangList(false);
      } catch (_) {}
    });
    document.addEventListener("keydown", (e) => {
      try {
        if (e.key !== "Escape") return;
        if (!document.body.classList.contains("logged-out")) return;
        if (loginLangListOpen()) return; // acikken asagidaki kapatir
        const ae = document.activeElement;
        const lb2 = document.getElementById("login-lang-btn");
        if (ae && lb2 && ae === lb2) { e.preventDefault(); exitLangBtnToOrigin(); }
      } catch (_) {}
    });
    document.addEventListener("keydown", (e) => {
      try {
        if (!loginLangListOpen()) return;
        if (!document.body.classList.contains("logged-out")) return;
        // TV'de yonlar tv.js'e ait (stopPropagation'lu); cift adimi onlemek icin atla.
        if (e.defaultPrevented) return;
        if (e.key === "Escape") { e.preventDefault(); toggleLoginLangList(false); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setLangHl(_langHl + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setLangHl(_langHl - 1); }
        else if (e.key === "Enter" || e.key === " ") {
          const t0 = e.target;
          if (t0 && t0.closest && t0.closest("#login-lang-list")) {
            e.preventDefault();
            const rs = langRows();
            const r = rs[_langHl];
            if (r) pickLoginLang(r.dataset.value);
          }
        }
      } catch (_) {}
    });
    try { trackLangOrigin(); } catch (_) {}
  } catch (_) {}
  document.addEventListener("app:langchange", () => {
    if (document.body.classList.contains("logged-out")) setMode(loginMode);
    else {
      // Girisli dil degisimi haritayi tazeler (bir dahaki login ayni dilde acilir).
      try {
        if (currentUser && currentUser.username) mapSet(currentUser.username, state.currentLang);
      } catch (_) {}
    }
  });
  const lo = document.getElementById("menu-logout-item");
  if (lo) lo.addEventListener("click", doLogout);
  const adm = document.getElementById("menu-admin-item");
  if (adm) adm.addEventListener("click", () => setTimeout(loadAdminLists, 30));
}

export async function bootAuth() {
  wireLogin();
  // WebView geri-yuklemede (bfcache/restore) load yeniden kosmayabilir;
  // donmus acik liste varsa kapat.
  try {
    window.addEventListener("pageshow", (e) => {
      try { if (e && e.persisted) toggleLoginLangList(false); } catch (_) {}
    });
  } catch (_) {}
  try {
    const { res, data } = await apiJson("/api/auth/me");
    if (res.ok) {
      enterApp(data);
      return;
    }
  } catch (_) {}
  // Oturumsuz: varsayilan İngilizce, sonra geo-IP ulke dili (gecmis yoksa).
  try { applyLang("en"); } catch (_) {}
  try { syncLoginLangSelect(); } catch (_) {}
  showLogin();
  try {
    let geo = null;
    try { geo = JSON.parse(sessionStorage.getItem("nx-geo") || "null"); } catch (_) { geo = null; }
    if (!geo) {
      const r = await api("/api/auth/geo");
      if (r.ok) {
        geo = await r.json();
        try { sessionStorage.setItem("nx-geo", JSON.stringify(geo)); } catch (_) {}
      }
    }
    if (geo && geo.lang && document.body.classList.contains("logged-out")) {
      applyLang(geo.lang);
      syncLoginLangSelect();
    }
  } catch (_) {}
}
