// Faz 30: kimlik — giris/kayit ekranı, oturum boot, admin modalı, rol kapıları.
import { t } from "./i18n.js";
import { toast } from "./utils.js";
import { showConfirm } from "./components.js";
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
    title.textContent = t("login_register_title");
    go.querySelector("span").textContent = t("login_go");
    reg.querySelector("span").textContent = t("login_register_btn");
    forgot.style.display = "none";
    userH.style.display = "";
    passH.style.display = "";
    if (pass2W) pass2W.style.display = "";
  } else if (mode === "force") {
    frame.classList.remove("register-mode");
    title.textContent = t("login_force_title");
    go.style.display = "none";
    reg.style.display = "none";
    forgot.style.display = "none";
    userH.style.display = "none";
    passH.style.display = "none";
    note.style.display = "none";
    ensureForceRow();
  } else {
    frame.classList.remove("register-mode");
    title.textContent = t("login_title");
    go.querySelector("span").textContent = t("login_go");
    reg.querySelector("span").textContent = t("login_register_btn");
    go.style.display = "";
    reg.style.display = "";
    forgot.style.display = "";
    userH.style.display = "";
    passH.style.display = "";
    if (pass2W) {
      pass2W.style.display = "none";
      const p2 = document.getElementById("login-pass2");
      if (p2) {
        p2.value = "";
        p2.type = "password";
      }
    }
    hideForceRow();
  }
}

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
  eye.dataset.for = "login-new";
  eye.setAttribute("data-i18n-title", "login_show_pw");
  eye.innerHTML = '<i class="fa-solid fa-eye"></i>';
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
  document.querySelectorAll(".view.active").forEach((v) => v.classList.remove("active"));
  const lv = document.getElementById("view-login");
  if (lv) lv.classList.add("active");
  setMode("login");
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
  if (isAdmin()) refreshAdminBadge();
  document.dispatchEvent(new CustomEvent("auth:ready"));
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
  if (meRes.ok) enterApp(me);
  else showLogin();
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
    body: JSON.stringify({ username: u, password: p, password2: p2 }),
  });
  if (!res.ok) {
    toast(t(data.error || "auth_taken"), true);
    return;
  }
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

async function doForgot() {
  const u = document.getElementById("login-user").value.trim();
  const err = checkUser(u);
  if (err) {
    toast(t(err), true);
    return;
  }
  await apiJson("/api/auth/forgot", {
    method: "POST",
    body: JSON.stringify({ username: u }),
  });
  toast(t("login_sent"));
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
  if (loginMode !== "register") return;
  const u = document.getElementById("login-user").value.trim();
  const note = document.getElementById("login-exists-note");
  const reg = document.getElementById("login-register");
  if (checkUser(u)) {
    note.style.display = "none";
    reg.disabled = false;
    return;
  }
  try {
    const { res, data } = await apiJson("/api/auth/exists?u=" + encodeURIComponent(u));
    const taken = res.ok && data.exists;
    note.style.display = taken ? "" : "none";
    reg.disabled = !!taken;
  } catch (_) {}
}

// ---- admin ----
async function refreshAdminBadge() {
  const badge = document.getElementById("admin-badge");
  if (!badge || !isAdmin()) return;
  try {
    const { res, data } = await apiJson("/api/auth/pending");
    if (!res.ok) return;
    const n = (data.pending || []).length + (data.resets || []).length;
    badge.style.display = n ? "" : "none";
    badge.textContent = n;
  } catch (_) {}
}

function adminRow(name, sub, buttons) {
  const d = document.createElement("div");
  d.className = "admin-row";
  const left = document.createElement("div");
  const nm = document.createElement("div");
  nm.className = "admin-name";
  nm.textContent = name;
  left.appendChild(nm);
  if (sub) {
    const sb = document.createElement("div");
    sb.className = "admin-sub";
    sb.textContent = sub;
    left.appendChild(sb);
  }
  const act = document.createElement("div");
  act.className = "admin-actions";
  buttons.forEach(([label, fn, danger]) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.textContent = label;
    if (danger) b.style.borderColor = "#ef4444";
    b.addEventListener("click", fn);
    act.appendChild(b);
  });
  d.appendChild(left);
  d.appendChild(act);
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
  const { res, data } = await apiJson("/api/auth/pending");
  const pl = document.getElementById("admin-pending-list");
  const rl = document.getElementById("admin-resets-list");
  pl.innerHTML = "";
  rl.innerHTML = "";
  if (res.ok) {
    (data.pending || []).forEach((u) => {
      pl.appendChild(
        adminRow(u.username, u.created_at, [
          [t("admin_approve"), () => adminCall("/api/auth/approve", u.id)],
          [t("admin_reject"), () => adminConfirm(() => adminCall("/api/auth/reject", u.id)), true],
        ])
      );
    });
    if (!(data.pending || []).length) pl.appendChild(adminEmpty());
    (data.resets || []).forEach((r) => {
      rl.appendChild(
        adminRow(r.username, r.created_at, [
          [t("admin_temp"), () => adminTemp(r.user_id)],
        ])
      );
    });
    if (!(data.resets || []).length) rl.appendChild(adminEmpty());
  }
  const { res: mres, data: mdata } = await apiJson("/api/auth/members");
  const ml = document.getElementById("admin-members-list");
  ml.innerHTML = "";
  if (mres.ok) {
    (mdata.members || []).forEach((u) => {
      if (u.id === 1) {
        ml.appendChild(adminRow(u.username, t("admin_role_admin"), []));
        return;
      }
      const role = u.role === "admin" ? t("admin_role_admin") : t("admin_role_member");
      const st =
        u.status === "active" ? t("admin_status_active") : u.status === "pending" ? t("admin_status_pending") : t("admin_status_passive");
      const btns = [];
      if (u.status === "pending") btns.push([t("admin_approve"), () => adminCall("/api/auth/approve", u.id)]);
      if (u.status === "active") {
        btns.push([t("admin_deactivate"), () => adminConfirm(() => adminCall("/api/auth/deactivate", u.id)), true]);
        btns.push([t("admin_kick"), () => adminCall("/api/auth/kick", u.id)]);
      }
      if (u.status !== "active") btns.push([t("admin_activate"), () => adminCall("/api/auth/activate", u.id)]);
      ml.appendChild(adminRow(u.username, `${role} · ${st}`, btns));
    });
  }
  refreshAdminBadge();
}

async function adminCall(path, id) {
  const { res } = await apiJson(path, { method: "POST", body: JSON.stringify({ id }) });
  if (res.ok) loadAdminLists();
}
function adminConfirm(fn) {
  showConfirm(t("logout_confirm"), fn, { danger: true });
}
async function adminTemp(userId) {
  const { res, data } = await apiJson("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ id: userId }),
  });
  if (!res.ok || !data.temp) return;
  const rl = document.getElementById("admin-resets-list");
  const box = document.createElement("div");
  box.className = "admin-temp";
  const sp = document.createElement("span");
  sp.textContent = `${t("admin_temp")}: ${data.temp}`;
  const cp = document.createElement("button");
  cp.className = "tab";
  cp.textContent = t("admin_copied");
  cp.style.visibility = "hidden";
  const real = document.createElement("button");
  real.className = "tab";
  real.textContent = t("admin_copied");
  real.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(data.temp);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = data.temp;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (_) {}
      ta.remove();
    }
    toast(t("admin_copied"));
  });
  box.appendChild(sp);
  box.appendChild(real);
  rl.prepend(box);
  loadAdminLists();
}

// ---- çıkış ----
function doLogout() {
  showConfirm(
    t("logout_confirm"),
    async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      location.reload();
    },
    { danger: true }
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
  [user, pass].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (loginMode === "register") doRegister();
        else doLogin();
      }
    });
  });
  const pass2 = document.getElementById("login-pass2");
  if (pass2) {
    pass2.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doRegister();
    });
  }
  // Göz ikonu: ilgili kutunun type'ını çevirir (dinamik satırlar dahil — delegasyon)
  document.getElementById("view-login").addEventListener("click", (e) => {
    const eye = e.target.closest(".pw-eye");
    if (!eye) return;
    const inp = document.getElementById(eye.dataset.for);
    if (!inp) return;
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    const icon = eye.querySelector("i");
    if (icon) icon.className = show ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
    eye.setAttribute("data-tip", t(show ? "login_hide_pw" : "login_show_pw"));
  });
  user.addEventListener("input", () => {
    clearTimeout(existsTimer);
    existsTimer = setTimeout(checkExists, 400);
  });
  document.addEventListener("app:langchange", () => {
    if (document.body.classList.contains("logged-out")) setMode(loginMode);
  });
  const lo = document.getElementById("menu-logout-item");
  if (lo) lo.addEventListener("click", doLogout);
  const adm = document.getElementById("menu-admin-item");
  if (adm) adm.addEventListener("click", () => setTimeout(loadAdminLists, 30));
}

export async function bootAuth() {
  wireLogin();
  try {
    const { res, data } = await apiJson("/api/auth/me");
    if (res.ok) {
      enterApp(data);
      return;
    }
    showLogin();
  } catch (_) {
    showLogin();
  }
}
