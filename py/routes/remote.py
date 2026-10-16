"""Uzak baglanti (VPS) yonetimi — Faz: Baglantilar ekrani.

Uclar (hepsi admin):
  GET  /api/remote/vps-status  -> profil tamligi + TEST durumu (secret yok)
  POST /api/remote/profile     -> host/port/user/auth + secret kaydi (duzenlemede baglanti sifirlanir)
  POST /api/remote/test        -> SSH TEST (BAĞLI/BAĞLI DEĞİL + ts damgasi)
  GET  /api/remote/check       -> VPS genis --check (Caddy/Stremio/WG + 80-443 + hub)

Guvenlik: secret'lar encrypt_secret kasasinda, log'a yazilmaz, gecici
keyfile 600 + is sonu silinir. Sistem ssh/scp binary'si kullanilir
(backup_core.py deseni); yeni bagimlilik yok.
"""
import base64
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time

from flask import Blueprint, jsonify, request, Response

from db import get_db, get_setting, set_setting
from crypto_util import encrypt_secret, decrypt_secret
from auth import get_current_user
import vps_install

remote_bp = Blueprint("remote", __name__)

_HOST_RE = re.compile(r"^[A-Za-z0-9._-]{1,253}$")
_IPV4_RE = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,3}){3}$")
_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_SUDOERS_DIR = "/etc/sudoers.d"


def _sudoers_path(username):
    """root disi kullanici icin NOPASSWD drop-in yolu."""
    safe = re.sub(r"[^a-z0-9_-]", "", (username or "").strip().lower()) or "user"
    return f"{_SUDOERS_DIR}/99-nextep-{safe}"


def _is_admin():
    try:
        u = get_current_user()
        return bool(u and u.get("role") == "admin" and u.get("status") == "active")
    except Exception:
        return False


def _require_admin():
    if not _is_admin():
        return jsonify({"error": "auth_admin"}), 403
    return None


def ensure_remote_tables():
    """vps_hosts + wg_peers + remote_jobs (idempotent migration)."""
    conn = get_db()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS vps_hosts (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            host TEXT NOT NULL DEFAULT '',
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT NOT NULL DEFAULT 'root',
            auth_type TEXT NOT NULL DEFAULT 'key',
            secret_enc TEXT NOT NULL DEFAULT '',
            fingerprint TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    # root disi kullanici icin sudo parolasi + NOPASSWD dogrulama durumu.
    for _ddl in ("ALTER TABLE vps_hosts ADD COLUMN sudo_enc TEXT NOT NULL DEFAULT ''",
                 "ALTER TABLE vps_hosts ADD COLUMN sudo_nopasswd INTEGER NOT NULL DEFAULT 0"):
        try:
            conn.execute(_ddl)
        except Exception:
            pass
    conn.execute(
        """CREATE TABLE IF NOT EXISTS wg_peers (
            num INTEGER PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            pubkey TEXT NOT NULL DEFAULT '',
            privkey_enc TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            suspended INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS remote_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'running',
            log TEXT NOT NULL DEFAULT '',
            result TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    try:
        conn.commit()
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def _row_get(row, key, default=""):
    """sqlite3.Row guvenli okuma (migration eksikse varsayilan)."""
    try:
        v = row[key]
    except Exception:
        return default
    return default if v is None else v


def _get_profile():
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM vps_hosts WHERE id=1").fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return {"host": "", "port": 22, "username": "root", "auth_type": "key",
                    "has_secret": False, "sudo_has_secret": False, "sudo_nopasswd": 0,
                    "fingerprint": ""}
        return {"host": row["host"] or "", "port": int(row["port"] or 22),
                "username": row["username"] or "root",
                "auth_type": row["auth_type"] or "key",
                "has_secret": bool(row["secret_enc"]),
                "sudo_has_secret": bool(_row_get(row, "sudo_enc", "")),
                "sudo_nopasswd": int(_row_get(row, "sudo_nopasswd", 0) or 0),
                "fingerprint": row["fingerprint"] or ""}
    except Exception:
        return {"host": "", "port": 22, "username": "root", "auth_type": "key",
                "has_secret": False, "sudo_has_secret": False, "sudo_nopasswd": 0,
                "fingerprint": ""}


def _get_secret():
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT secret_enc FROM vps_hosts WHERE id=1").fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row or not row["secret_enc"]:
            return ""
        return decrypt_secret(row["secret_enc"]) or ""
    except Exception:
        return ""


def _get_sudo_secret():
    """root disi kullanicinin sudo parolasi (key modunda ayri saklanir)."""
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT sudo_enc FROM vps_hosts WHERE id=1").fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return ""
        enc = _row_get(row, "sudo_enc", "")
        if not enc:
            return ""
        return decrypt_secret(enc) or ""
    except Exception:
        return ""


def detect_key_format(key_text):
    """Notr format tespiti (kapi degil, bilgi)."""
    k = (key_text or "").strip()
    if not k:
        return "bilinmiyor"
    if "BEGIN OPENSSH PRIVATE KEY" in k:
        return "OpenSSH"
    if k.startswith("PuTTY-User-Key-File-"):
        return "PPK"
    if "BEGIN SSH2" in k:
        return "SSH2"
    if "BEGIN RSA PRIVATE KEY" in k or "BEGIN EC PRIVATE KEY" in k:
        return "PEM"
    if "PRIVATE KEY" in k:
        return "OpenSSH"
    return "bilinmiyor"


def _ssh_base(host, port, user):
    return ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-p", str(port)]


def _ssh_session(profile, secret):
    """(cmd_onay, key_file, env) — keyfile 600, cagiran temizler."""
    cmd = _ssh_base(profile["host"], profile["port"], profile["username"])
    key_file = None
    env = None
    if profile["auth_type"] == "key":
        kfd, key_file = tempfile.mkstemp(prefix="vps_key_")
        os.close(kfd)
        with open(key_file, "w") as kf:
            kf.write(secret if secret.endswith("\n") else secret + "\n")
        os.chmod(key_file, 0o600)
        cmd = cmd + ["-i", key_file]
    else:
        if not shutil.which("sshpass"):
            raise RuntimeError("no-sshpass")
        cmd = ["sshpass", "-p", secret] + cmd
    return cmd, key_file, env


def _ssh_cleanup(key_file):
    if key_file and os.path.exists(key_file):
        try:
            os.remove(key_file)
        except Exception:
            pass


def _sudo_wrap(profile, remote_cmd):
    """root disi kullanicida komutu sudo ile calistirir (parolasiz, -n).

    Parola sorulmaz: Test Et sirasinda NOPASSWD drop-in yazilir. `sudo -n`
    stdin'e dokunmadigi icin `cat > dosya` deseni bozulmaz.
    """
    user = (profile.get("username") or "root").strip() or "root"
    if user == "root":
        return remote_cmd
    return "sudo -n bash -lc " + shlex.quote(remote_cmd)


def _ssh_exec(profile, secret, remote_cmd, input_text=None, timeout=600):
    """SSH ile tek komut (sudo sarmalamasi YOK — test/bootstrap icin)."""
    cmd, key_file, env = _ssh_session(profile, secret)
    try:
        cmd = cmd + [f"{profile['username']}@{profile['host']}", remote_cmd]
        proc = subprocess.run(cmd, input=input_text, capture_output=True, text=True,
                              timeout=timeout, env=env)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    finally:
        _ssh_cleanup(key_file)


def _vps_run(profile, secret, remote_cmd, input_text=None, timeout=600):
    """Uzak komut (root disi kullanicida otomatik sudo ile)."""
    return _ssh_exec(profile, secret, _sudo_wrap(profile, remote_cmd), input_text, timeout)


def _sudo_login_secret(profile, secret, sudo_secret):
    """sudo parolasi: parola modunda login parolasi, key modunda ayri secret."""
    if (profile.get("auth_type") or "key") == "password":
        return secret or ""
    return sudo_secret or ""


def _sudo_needs_password(out):
    low = (out or "").lower()
    return ("a password is required" in low or "a terminal is required" in low
            or "no tty present" in low)


def _sudo_denied(out):
    low = (out or "").lower()
    return ("not in the sudoers" in low or "not allowed to execute" in low
            or "is not allowed" in low or "may not run sudo" in low)


def _bootstrap_sudoers(profile, secret, password):
    """Parolayi BIR KEZ kullanip NOPASSWD sudoers drop-in yazar. (ok, detail).

    Parola stdin'den yalnizca `sudo -S`'e gider; dosya icerigi komut metnine
    base64 olarak gomulur (stdin cakismasi yok).
    """
    user = profile["username"]
    path = _sudoers_path(user)
    content = f"{user} ALL=(ALL) NOPASSWD: ALL\n"
    b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")
    inner = (f"printf %s {shlex.quote(b64)} | base64 -d > {path} && "
             f"chown root:root {path} && chmod 440 {path} && "
             f"visudo -cf {path} >/dev/null 2>&1 && echo SUDOERS-OK")
    cmd = "sudo -S -p '' sh -c " + shlex.quote(inner)
    rc, out = _ssh_exec(profile, secret, cmd, input_text=password + "\n", timeout=30)
    if "SUDOERS-OK" in (out or ""):
        rc2, out2 = _ssh_exec(profile, secret, "sudo -n true && echo SUDO-NOPASS-OK",
                              timeout=20)
        if "SUDO-NOPASS-OK" in (out2 or ""):
            return True, ""
    # fail-safe: yarim yazilmis drop-in birakma
    try:
        _ssh_exec(profile, secret, f"sudo -S -p '' rm -f {shlex.quote(path)}",
                  input_text=password + "\n", timeout=20)
    except Exception:
        pass
    return False, (out or "").strip()[-300:]


def _store_test_state(connected, ts, nopass):
    """TEST sonucunu ayarlara + sudo_nopasswd bayragina yazar (fail-soft)."""
    try:
        set_setting("vps_status_connected", "1" if connected else "0")
        set_setting("vps_last_test_ts", str(ts))
    except Exception:
        pass
    try:
        conn = get_db()
        try:
            conn.execute("UPDATE vps_hosts SET sudo_nopasswd=? WHERE id=1", (int(nopass or 0),))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        pass


def _job_append(job_id, line):
    try:
        conn = get_db()
        try:
            conn.execute("UPDATE remote_jobs SET log=log||? WHERE id=?", (line + "\n", job_id))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        pass


def _job_finish(job_id, status, result=""):
    try:
        conn = get_db()
        try:
            conn.execute("UPDATE remote_jobs SET status=?, result=? WHERE id=?",
                         (status, result[:2000], job_id))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        pass


def _find_abort(output):
    m = re.search(r"ABORT:([A-Za-z0-9_-]+)", output or "")
    return m.group(1) if m else ""


def _job_step(job_id, name, state, human=None):
    """Adim kaydi: terminalde gizlenen STEP satiri + istege bagli insan satiri."""
    if human:
        _job_append(job_id, "==> " + human)
    _job_append(job_id, f"STEP:{name}:{state}")


def _mk_vps_run(profile, secret):
    """vps_install'in bekledigi vps_run(cmd, input_text, timeout) kapanisi."""
    def run(cmd, input_text=None, timeout=600):
        return _vps_run(profile, secret, cmd, input_text, timeout)
    return run


def _job_logger(job_id):
    def log(line):
        _job_append(job_id, str(line))
    return log


def _run_wg_job(job_id):
    from db import get_setting as _gs, set_setting as _ss
    _job_step(job_id, "profile", "run", "VPS profili dogrulaniyor")
    profile = _get_profile()
    secret = _get_secret()
    if not profile["host"] or not secret or (_gs("vps_status_connected") or "") != "1":
        _job_step(job_id, "profile", "fail")
        _job_append(job_id, "ABORT:no-vps-link")
        _job_finish(job_id, "aborted", "ABORT:no-vps-link")
        return
    if os.path.exists("/etc/wireguard/nextep.conf"):
        _job_step(job_id, "profile", "ok")
        _job_append(job_id, "ABORT:already-installed (Pi tüneli mevcut)")
        _job_finish(job_id, "aborted", "ABORT:already-installed")
        return
    _job_step(job_id, "profile", "ok")
    log = _job_logger(job_id)
    vrun = _mk_vps_run(profile, secret)
    _job_step(job_id, "webserver", "run", "VPS'te WireGuard kuruluyor (soru yok, otomatik)...")
    try:
        ok, err = vps_install.setup_vps_wg(vrun, log)
    except Exception as e:
        _job_append(job_id, f"HATA: VPS erisilemedi: {str(e)[:300]}")
        _job_finish(job_id, "aborted", "ABORT:ssh-failed")
        return
    if not ok:
        _job_step(job_id, "webserver", "fail")
        _job_append(job_id, f"ABORT:{err or 'vps-setup-failed'}")
        _job_finish(job_id, "aborted", f"ABORT:{err or 'vps-setup-failed'}")
        return
    _job_step(job_id, "webserver", "ok")
    _job_step(job_id, "landing", "run", "nextep.conf Pi'ye indiriliyor")
    try:
        rc2, conf_out = _vps_run(profile, secret, "cat /root/nextep.conf", timeout=60)
    except Exception as e:
        _job_append(job_id, f"HATA: conf indirilemedi: {str(e)[:200]}")
        _job_finish(job_id, "aborted", "ABORT:conf-download")
        return
    if rc2 != 0 or "[Interface]" not in conf_out:
        _job_step(job_id, "landing", "fail")
        _job_append(job_id, "ABORT:conf-download (VPS /root/nextep.conf yok)")
        _job_finish(job_id, "aborted", "ABORT:conf-download")
        return
    m_addr = re.search(r"Address\s*=\s*([0-9.]+)/", conf_out)
    pi_addr = m_addr.group(1) if m_addr else ""
    vps_tun = (pi_addr.rsplit(".", 1)[0] + ".1") if pi_addr else ""
    try:
        with open("/root/nextep.conf", "w") as f:
            f.write(conf_out if conf_out.endswith("\n") else conf_out + "\n")
        os.chmod("/root/nextep.conf", 0o600)
    except Exception as e:
        _job_append(job_id, f"HATA: /root/nextep.conf yazilamadi: {str(e)[:200]}")
        _job_finish(job_id, "aborted", "ABORT:local-write")
        return
    _job_step(job_id, "landing", "ok")
    _job_step(job_id, "tunnel", "run", "Pi istemcisi kuruluyor (tünel istemci)...")
    try:
        ok = vps_install.install_pi_wg_client(log)
        if not ok:
            _job_step(job_id, "tunnel", "fail")
            _job_append(job_id, "ABORT:pi-client-failed")
            _job_finish(job_id, "aborted", "ABORT:pi-client-failed")
            return
    except Exception as e:
        _job_append(job_id, f"HATA: istemci kurulamadi: {str(e)[:200]}")
        _job_finish(job_id, "aborted", "ABORT:pi-client-failed")
        return
    _job_step(job_id, "tunnel", "ok")
    degraded = ""
    if vps_tun:
        try:
            pg = subprocess.run(["ping", "-c2", "-W2", vps_tun],
                                capture_output=True, text=True, timeout=15)
            if pg.returncode == 0:
                try:
                    _ss("remote_last_handshake", str(int(time.time())))
                except Exception:
                    pass
            else:
                degraded = "DEGRADED:backend-unreachable"
                _job_append(job_id, f"UYARI: VPS tuneline ulasilamiyor ({vps_tun}) — Pi baglaninca duzelir")
        except Exception:
            degraded = "DEGRADED:backend-unreachable"
    _job_step(job_id, "verify", "run", "Doğrulanıyor")
    try:
        _vps_run(profile, secret, "shred -u /root/nextep.conf 2>/dev/null || rm -f /root/nextep.conf", timeout=30)
        _job_append(job_id, "==> VPS /root/nextep.conf imha edildi")
    except Exception:
        pass
    _job_step(job_id, "verify", "fail" if degraded else "ok")
    if degraded:
        _job_finish(job_id, "degraded", degraded)
    else:
        _job_finish(job_id, "success", "SUCCESS")
    _job_append(job_id, "Bitti: " + (degraded or "SUCCESS"))


def _run_stremio_job(job_id, params):
    from db import get_setting as _gs, set_setting as _ss
    _job_step(job_id, "profile", "run", "VPS profili dogrulaniyor")
    profile = _get_profile()
    secret = _get_secret()
    if not profile["host"] or not secret or (_gs("vps_status_connected") or "") != "1":
        _job_step(job_id, "profile", "fail")
        _job_append(job_id, "ABORT:no-vps-link")
        _job_finish(job_id, "aborted", "ABORT:no-vps-link")
        return
    if profile.get("auth_type") != "key":
        _job_step(job_id, "profile", "fail")
        _job_append(job_id, "ABORT:no-key-for-tunnel (ters tünel için anahtar kimlik doğrulaması gerekli)")
        _job_finish(job_id, "aborted", "ABORT:no-key-for-tunnel")
        return
    domain = str(params.get("domain") or "").strip().lower()
    if not domain:
        _job_step(job_id, "profile", "fail")
        _job_append(job_id, "ABORT:no-domain")
        _job_finish(job_id, "aborted", "ABORT:no-domain")
        return
    # F1: sihirbaz e-posta gondermiyor -> uygulamanin gonderen adresine dus
    email = str(params.get("email") or "").strip() or str(_gs("email_from") or "").strip()
    landing = str(params.get("landing") or "").strip() or "/var/www/stremio"
    logpath = str(params.get("logpath") or "").strip() or "/var/log/caddy/stremio-access.log"
    port = vps_install.read_pi_port()
    backend = str(params.get("backend") or "").strip() or f"127.0.0.1:{port}"
    _job_step(job_id, "profile", "ok")
    log = _job_logger(job_id)
    vrun = _mk_vps_run(profile, secret)

    # --- web sunucusu tespiti ---
    _job_step(job_id, "detect", "run", "Web sunucusu tespit ediliyor")
    try:
        det = vps_install.detect_web(vrun)
    except Exception as e:
        _job_append(job_id, f"HATA: VPS erisilemedi: {str(e)[:300]}")
        _job_finish(job_id, "aborted", "ABORT:ssh-failed")
        return
    _job_append(job_id, f"   port sahibi: :80={det.get('http') or '-'} :443={det.get('https') or '-'}")
    if det.get("blocked"):
        owner = det.get("blocked_owner") or "bilinmiyor"
        _job_step(job_id, "detect", "fail")
        _job_append(job_id, f"ABORT:port-busy ({owner})")
        _job_append(job_id, f"   :80/:443 portunu '{owner}' tutuyor — otomatik kurulum yapılamaz.")
        _job_append(job_id, "   Portu elle boşaltıp tekrar deneyin:  ss -ltnp 'sport = :80'")
        _job_finish(job_id, "aborted", f"ABORT:port-busy ({owner})")
        return
    options = det.get("options") or list(vps_install.WEB_SERVERS)
    _job_step(job_id, "detect", "ok")
    chosen = str(params.get("web_server") or "").strip().lower()
    if chosen not in options:
        chosen = det.get("server") or options[0]
    _job_append(job_id, f"==> Seçilen web sunucusu: {chosen}")

    # --- onar yolu: kurulu ve tunel saglikli ise tekrar kurma ---
    if (_gs("stremio_vps_installed") or "") == "1" and vps_install.tunnel_active():
        _job_append(job_id, "ABORT:already-installed (Stremio kurulu)")
        _job_finish(job_id, "aborted", "ABORT:already-installed")
        return
    if (_gs("stremio_vps_installed") or "") == "1":
        _job_append(job_id, "==> Mevcut kurulum eksik (tünel yok) — onarım modu")

    # --- web sunucusu kurulumu ---
    _job_step(job_id, "webserver", "run", f"Web sunucusu kuruluyor ({chosen})")
    try:
        ok, err = vps_install.install_web_stack(vrun, log, chosen, domain, backend, landing, logpath, email)
    except Exception as e:
        _job_append(job_id, f"HATA: web sunucusu kurulumu: {str(e)[:300]}")
        _job_finish(job_id, "aborted", "ABORT:ssh-failed")
        return
    if not ok:
        _job_append(job_id, f"ABORT:{err or 'webserver-failed'}")
        _job_finish(job_id, "aborted", f"ABORT:{err or 'webserver-failed'}")
        return

    # --- landing ---
    _job_step(job_id, "landing", "run", "Landing sayfası yazılıyor")
    ok, err = vps_install._write_landing(vrun, log, landing)
    if not ok:
        _job_step(job_id, "landing", "fail")
        _job_append(job_id, "ABORT:landing-failed")
        _job_finish(job_id, "aborted", "ABORT:landing-failed")
        return
    _job_step(job_id, "landing", "ok")

    # --- ters tunel (autossh) ---
    _job_step(job_id, "tunnel", "run", "Ters tünel kuruluyor (autossh)")
    try:
        ok, err = vps_install.install_tunnel(profile, secret, port, log)
    except Exception as e:
        _job_append(job_id, f"HATA: tünel kurulumu: {str(e)[:300]}")
        _job_finish(job_id, "aborted", "ABORT:tunnel-failed")
        return
    if not ok:
        _job_append(job_id, f"ABORT:{err or 'tunnel-failed'}")
        _job_finish(job_id, "aborted", f"ABORT:{err or 'tunnel-failed'}")
        return

    # --- uctan uca dogrulama ---
    _job_step(job_id, "verify", "run", "Uçtan uca doğrulanıyor")
    degraded = ""
    if not vps_install.tunnel_active():
        degraded = "DEGRADED:tunnel-inactive"
        _job_append(job_id, "UYARI: nextep-tunnel servisi aktif değil")
        try:
            pr = vps_install._pi_run(["journalctl", "-u", "nextep-tunnel", "-n", "20", "--no-pager"],
                                     timeout=30)
            _job_append(job_id, ((pr.stdout or "") + (pr.stderr or ""))[-2000:])
        except Exception:
            pass
    https_ok = vps_install._https_test(vrun, log, domain)
    if not https_ok and not degraded:
        degraded = "DEGRADED:backend-unreachable"
    _job_step(job_id, "verify", "fail" if degraded else "ok")

    try:
        _ss("stremio_vps_installed", "1")
        _ss("tp_base_url", f"https://{domain}")
        _ss("stremio_web_server", chosen)
    except Exception:
        pass
    if degraded:
        _job_append(job_id, "UYARI: kurulum doğrulanamadı — logları kontrol edin")
        _job_finish(job_id, "degraded", degraded)
    else:
        _job_finish(job_id, "success", "SUCCESS")
    _job_append(job_id, "Bitti: " + (degraded or "SUCCESS"))


@remote_bp.route("/api/remote/jobs", methods=["POST"])
def remote_jobs_create():
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    kind = str(body.get("kind") or "").strip()
    if kind not in ("wg", "stremio"):
        return jsonify({"error": "bad-kind"}), 400
    p = _get_profile()
    try:
        connected = (get_setting("vps_status_connected") or "") == "1"
    except Exception:
        connected = False
    if not p["host"] or not p.get("has_secret") or not connected:
        return jsonify({"error": "no-vps-link"}), 400
    if kind == "wg" and os.path.exists("/etc/wireguard/nextep.conf"):
        return jsonify({"error": "already-installed"}), 400
    if kind == "stremio":
        # Onarim yolu: kurulu gorunuyor ama ters tunel yoksa yeniden kurmaya izin ver.
        try:
            if (get_setting("stremio_vps_installed") or "") == "1" and vps_install.tunnel_active():
                return jsonify({"error": "already-installed"}), 400
        except Exception:
            pass
    params = body.get("params") or {}
    if not isinstance(params, dict):
        return jsonify({"error": "bad-params"}), 400
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            cur = conn.execute(
                "INSERT INTO remote_jobs(kind, status, log, created_at) VALUES(?, 'running', '', datetime('now'))",
                (kind,))
            job_id = cur.lastrowid
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    if kind == "wg":
        threading.Thread(target=_run_wg_job, args=(job_id,), daemon=True).start()
    else:
        threading.Thread(target=_run_stremio_job, args=(job_id, params), daemon=True).start()
    return jsonify({"ok": True, "job_id": job_id})


@remote_bp.route("/api/remote/jobs/<int:job_id>", methods=["GET"])
def remote_jobs_get(job_id):
    denied = _require_admin()
    if denied:
        return denied
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM remote_jobs WHERE id=?", (job_id,)).fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return jsonify({"error": "not-found"}), 404
        return jsonify({"ok": True, "id": row["id"], "kind": row["kind"],
                        "status": row["status"], "result": row["result"] or "",
                        "log": (row["log"] or "")[-8000:]})
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500


@remote_bp.route("/api/remote/disconnect", methods=["POST"])
def remote_disconnect():
    denied = _require_admin()
    if denied:
        return denied
    try:
        pr = subprocess.run(["systemctl", "disable", "--now", "wg-quick@nextep"],
                            capture_output=True, text=True, timeout=60)
        if pr.returncode != 0:
            return jsonify({"error": f"tunnel-down-failed: {(pr.stderr or pr.stdout or '').strip()[:300]}"}), 500
    except Exception as e:
        return jsonify({"error": f"tunnel-down-failed: {str(e)[:200]}"}), 500
    try:
        set_setting("remote_last_handshake", "")
    except Exception:
        pass
    return jsonify({"ok": True})


@remote_bp.route("/api/remote/connect", methods=["POST"])
def remote_connect():
    denied = _require_admin()
    if denied:
        return denied
    if not os.path.exists("/etc/wireguard/nextep.conf"):
        return jsonify({"error": "not-installed"}), 400
    try:
        pr = subprocess.run(["systemctl", "enable", "--now", "wg-quick@nextep"],
                            capture_output=True, text=True, timeout=60)
        if pr.returncode != 0:
            return jsonify({"error": f"tunnel-up-failed: {(pr.stderr or pr.stdout or '').strip()[:300]}"}), 500
    except Exception as e:
        return jsonify({"error": f"tunnel-up-failed: {str(e)[:200]}"}), 500
    return jsonify({"ok": True})


@remote_bp.route("/api/remote/web-servers", methods=["GET"])
def remote_web_servers():
    """Web sunucusu tespiti + secim secenekleri (kurmaz, yalniz bakar)."""
    denied = _require_admin()
    if denied:
        return denied
    p = _get_profile()
    secret = _get_secret()
    if not p["host"] or not secret or (get_setting("vps_status_connected") or "") != "1":
        return jsonify({"error": "no-vps-link"}), 400
    try:
        vrun = _mk_vps_run(p, secret)
        det = vps_install.detect_web(vrun)
    except Exception as e:
        return jsonify({"error": f"ssh-failed: {str(e)[:200]}"}), 500
    try:
        saved = get_setting("stremio_web_server") or ""
    except Exception:
        saved = ""
    return jsonify({
        "ok": True,
        "http": det.get("http") or "",
        "https": det.get("https") or "",
        "owner": det.get("owner") or "",
        "server": det.get("server") or "",
        "options": det.get("options") or [],
        "blocked": bool(det.get("blocked")),
        "blockedOwner": det.get("blocked_owner") or "",
        "saved": saved,
        "tunnelInstalled": vps_install.tunnel_installed(),
        "tunnelActive": vps_install.tunnel_active(),
        "installed": (get_setting("stremio_vps_installed") or "") == "1",
    })


@remote_bp.route("/api/remote/tunnel/remove", methods=["POST"])
def remote_tunnel_remove():
    """Kill-switch: ters tunel unit'i + kimlikleri kaldirir (web sunucusuna dokunmaz)."""
    denied = _require_admin()
    if denied:
        return denied
    lines = []
    try:
        vps_install.remove_tunnel(lambda t: lines.append(str(t)))
    except Exception as e:
        return jsonify({"error": f"tunnel-remove-failed: {str(e)[:200]}"}), 500
    return jsonify({"ok": True, "log": lines[-4000:]})


@remote_bp.route("/api/remote/reset", methods=["POST"])
def remote_reset():
    """Sunucu Degistir: Pi izlerini + profil/secret/DB durumunu sifirlar."""
    denied = _require_admin()
    if denied:
        return denied
    lines = []
    try:
        vps_install.teardown_local(lambda t: lines.append(str(t)))
    except Exception as e:
        lines.append(f"UYARI: yerel temizlik: {str(e)[:200]}")
    # VPS tarafi: yalnizca nexus yonetimli WG arayuzu kaldirilir (varsa).
    try:
        p = _get_profile()
        secret = _get_secret()
        if p["host"] and secret:
            vps_install.teardown_vps(_mk_vps_run(p, secret), lambda t: lines.append(str(t)))
    except Exception as e:
        lines.append(f"UYARI: VPS temizligi: {str(e)[:200]}")
    try:
        conn = get_db()
        try:
            conn.execute("DELETE FROM vps_hosts")
            try:
                conn.execute("DELETE FROM wg_peers")
            except Exception:
                pass
            try:
                conn.execute("DELETE FROM remote_jobs")
            except Exception:
                pass
            for key in ("vps_status_connected", "vps_ever_connected", "vps_last_test_ts",
                        "stremio_vps_installed", "tp_base_url", "stremio_web_server",
                        "remote_last_handshake"):
                conn.execute("DELETE FROM settings WHERE key=?", (key,))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        lines.append("==> Profil, sirlar ve durum sifirlandi")
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    return jsonify({"ok": True, "log": lines[-4000:]})


# ---------------------------------------------------------------------------
# Telefon peer'leri (her cihaz ayrı key/IP; nextep.conf asla paylaşılmaz)
# ---------------------------------------------------------------------------

def _pi_wg_conf():
    try:
        with open("/etc/wireguard/nextep.conf", "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return ""


def _parse_pi_conf(text):
    out = {}
    m = re.search(r"Address\s*=\s*([0-9.]+)/\d+", text or "")
    out["pi_ip"] = m.group(1) if m else ""
    m = re.search(r"Endpoint\s*=\s*(\S+)", text or "")
    out["endpoint"] = m.group(1) if m else ""
    m = re.search(r"PublicKey\s*=\s*(\S+)", text or "")
    out["vps_pub"] = m.group(1) if m else ""
    m = re.search(r"AllowedIPs\s*=\s*(.+)", text or "")
    out["allowed"] = m.group(1).strip() if m else ""
    m = re.search(r"PrivateKey\s*=\s*(\S+)", text or "")
    out["pi_priv"] = m.group(1) if m else ""
    return out


def _pi_pubkey(pi_priv):
    try:
        pr = subprocess.run(["wg", "pubkey"], input=pi_priv, capture_output=True,
                            text=True, timeout=10)
        if pr.returncode == 0:
            return (pr.stdout or "").strip()
    except Exception:
        pass
    return ""


def _vps_iface_for_pi(profile, secret, pi_pub):
    """Pi pubkey'ini tasiyan VPS arayuzunu bulur (yabanci conf'a dokunulmaz)."""
    rc, out = _vps_run(profile, secret,
                       f"grep -l '{pi_pub}' /etc/wireguard/*.conf 2>/dev/null | head -1",
                       timeout=30)
    if rc != 0 or not out.strip():
        return ""
    base = os.path.basename(out.strip().splitlines()[0])
    return base[:-5] if base.endswith(".conf") else ""


def _vps_wg_apply(profile, secret, iface):
    """Canli configi dosyayla esitle (restart'siz)."""
    rc, out = _vps_run(profile, secret,
                       f"wg syncconf {iface} <(wg-quick strip {iface}) 2>&1; echo SYNC-RC:$?",
                       timeout=60)
    return ("SYNC-RC:0" in out)


@remote_bp.route("/api/remote/peers", methods=["GET"])
def remote_peers_list():
    denied = _require_admin()
    if denied:
        return denied
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            rows = conn.execute("SELECT num, name, ip, suspended, created_at FROM wg_peers ORDER BY num").fetchall()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return jsonify({"ok": True, "peers": [
            {"num": r["num"], "file": f"nextep_remote_{r['num']}.conf",
             "name": r["name"] or "", "ip": r["ip"] or "",
             "suspended": bool(r["suspended"])} for r in rows]})
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500


@remote_bp.route("/api/remote/peers", methods=["POST"])
def remote_peers_add():
    denied = _require_admin()
    if denied:
        return denied
    profile = _get_profile()
    secret = _get_secret()
    try:
        from db import get_setting as _gs
        linked = (profile["host"] and secret and (_gs("vps_status_connected") or "") == "1")
    except Exception:
        linked = False
    if not linked:
        return jsonify({"error": "no-vps-link"}), 400
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()[:64]
    pi_text = _pi_wg_conf()
    if "[Interface]" not in pi_text:
        return jsonify({"error": "not-installed"}), 400
    pci = _parse_pi_conf(pi_text)
    if not pci["pi_ip"] or not pci["endpoint"] or not pci["vps_pub"]:
        return jsonify({"error": "bad-pi-conf"}), 500
    base3 = pci["pi_ip"].rsplit(".", 1)[0]
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            mx = conn.execute("SELECT MAX(num) AS m FROM wg_peers").fetchone()
            num = int((mx["m"] if mx and mx["m"] else 0)) + 1
            used = {int(r["ip"].rsplit(".", 1)[1]) for r in
                    conn.execute("SELECT ip FROM wg_peers").fetchall()
                    if r["ip"] and "." in (r["ip"] or "")}
            try:
                used.add(int(pci["pi_ip"].rsplit(".", 1)[1]))
            except Exception:
                pass
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    last = 2
    while last in used and last < 250:
        last += 1
    if last >= 250:
        return jsonify({"error": "subnet-full"}), 400
    ip = f"{base3}.{last}"
    try:
        gk = subprocess.run(["wg", "genkey"], capture_output=True, text=True, timeout=10)
        if gk.returncode != 0:
            raise RuntimeError("wg genkey failed")
        priv = (gk.stdout or "").strip()
        pb = subprocess.run(["wg", "pubkey"], input=priv, capture_output=True,
                            text=True, timeout=10)
        pub = (pb.stdout or "").strip()
        if not pub:
            raise RuntimeError("wg pubkey failed")
    except Exception as e:
        return jsonify({"error": f"keygen_failed: {str(e)[:150]}"}), 500
    pi_pub = _pi_pubkey(pci["pi_priv"])
    if not pi_pub:
        return jsonify({"error": "pi-pubkey-failed"}), 500
    try:
        iface = _vps_iface_for_pi(profile, secret, pi_pub)
    except Exception as e:
        return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
    if not iface:
        return jsonify({"error": "vps-iface-not-found"}), 502
    block = f"\n[Peer]\n# nextep_remote_{num} (telefon)\nPublicKey = {pub}\nAllowedIPs = {ip}/32\n"
    ts = time.strftime("%Y%m%d_%H%M%S")
    try:
        rc, out = _vps_run(
            profile, secret,
            f"cp /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.bak_{ts} "
            f"&& printf '%s' '{block}' >> /etc/wireguard/{iface}.conf && echo WROTE-OK",
            timeout=60)
    except Exception as e:
        return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
    if rc != 0 or "WROTE-OK" not in out:
        return jsonify({"error": f"vps-write-failed: {out.strip()[-300:]}"}), 502
    if not _vps_wg_apply(profile, secret, iface):
        return jsonify({"error": "vps-sync-failed"}), 502
    try:
        priv_enc = encrypt_secret(priv)
    except Exception:
        return jsonify({"error": "secret_store_failed"}), 500
    try:
        conn = get_db()
        try:
            conn.execute(
                "INSERT INTO wg_peers(num, name, pubkey, privkey_enc, ip, suspended, created_at)"
                " VALUES(?, ?, ?, ?, ?, 0, datetime('now'))",
                (num, name, pub, priv_enc, ip))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    allowed = pci["allowed"] or f"{base3}.0/24"
    conf = (f"# nextep-vps-setup (telefon peer — nextep_remote_{num}.conf)\n"
            f"[Interface]\nPrivateKey = {priv}\nAddress = {ip}/24\n\n"
            f"[Peer]\nPublicKey = {pci['vps_pub']}\nEndpoint = {pci['endpoint']}\n"
            f"AllowedIPs = {allowed}\nPersistentKeepalive = 25\n")
    return jsonify({"ok": True, "num": num, "file": f"nextep_remote_{num}.conf",
                    "ip": ip, "conf": conf})


def _peer_conf(num):
    """wg_peers satirinin istemci conf metnini uretir. (num, conf) | (None, hata)."""
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM wg_peers WHERE num=?", (num,)).fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return None, "not-found"
        priv = decrypt_secret(row["privkey_enc"]) or ""
    except Exception as e:
        return None, f"db_failed: {str(e)[:200]}"
    pci = _parse_pi_conf(_pi_wg_conf())
    if not priv or not pci["endpoint"] or not pci["vps_pub"]:
        return None, "conf-unavailable"
    base3 = (row["ip"] or "").rsplit(".", 1)[0]
    allowed = pci["allowed"] or f"{base3}.0/24"
    conf = (f"# nextep-vps-setup (telefon peer — nextep_remote_{num}.conf)\n"
            f"[Interface]\nPrivateKey = {priv}\nAddress = {row['ip']}/24\n\n"
            f"[Peer]\nPublicKey = {pci['vps_pub']}\nEndpoint = {pci['endpoint']}\n"
            f"AllowedIPs = {allowed}\nPersistentKeepalive = 25\n")
    return num, conf


@remote_bp.route("/api/remote/peers/<int:num>/conf", methods=["GET"])
def remote_peers_conf(num):
    denied = _require_admin()
    if denied:
        return denied
    _, conf = _peer_conf(num)
    if conf is None:
        return jsonify({"error": "not-found"}), 404
    if conf in ("not-found", "conf-unavailable") or conf.startswith("db_failed:"):
        return jsonify({"error": conf}), (404 if conf == "not-found" else 500)
    return jsonify({"ok": True, "file": f"nextep_remote_{num}.conf", "conf": conf})


@remote_bp.route("/api/remote/peers/<int:num>/conf/download", methods=["GET"])
def remote_peers_conf_download(num):
    denied = _require_admin()
    if denied:
        return denied
    _, conf = _peer_conf(num)
    if conf is None:
        return jsonify({"error": "not-found"}), 404
    if conf in ("not-found", "conf-unavailable") or conf.startswith("db_failed:"):
        return jsonify({"error": conf}), (404 if conf == "not-found" else 500)
    resp = Response(conf, mimetype="application/octet-stream")
    resp.headers["Content-Disposition"] = f'attachment; filename="nextep_remote_{num}.conf"'
    return resp


@remote_bp.route("/api/remote/peers/<int:num>", methods=["PATCH"])
def remote_peers_patch(num):
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM wg_peers WHERE num=?", (num,)).fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return jsonify({"error": "not-found"}), 404
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    if "name" in body:
        name = str(body.get("name") or "").strip()[:64]
        try:
            conn = get_db()
            try:
                conn.execute("UPDATE wg_peers SET name=? WHERE num=?", (name, num))
                conn.commit()
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
        except Exception as e:
            return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
        return jsonify({"ok": True, "name": name})
    if "suspended" in body:
        want = 1 if body.get("suspended") else 0
        if int(row["suspended"] or 0) == want:
            return jsonify({"ok": True, "suspended": want})
        profile = _get_profile()
        secret = _get_secret()
        try:
            from db import get_setting as _gs
            linked = (profile["host"] and secret and (_gs("vps_status_connected") or "") == "1")
        except Exception:
            linked = False
        if not linked:
            return jsonify({"error": "no-vps-link"}), 400
        pci = _parse_pi_conf(_pi_wg_conf())
        pi_pub = _pi_pubkey(pci.get("pi_priv", ""))
        try:
            iface = _vps_iface_for_pi(profile, secret, pi_pub)
        except Exception as e:
            return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
        if not iface:
            return jsonify({"error": "vps-iface-not-found"}), 502
        ts = time.strftime("%Y%m%d_%H%M%S")
        pub = row["pubkey"]
        ip = row["ip"]
        try:
            if want == 1:
                # Askı: blok dosyadan çıkar (yedekli) + canlıdan düşür.
                rc, out = _vps_run(
                    profile, secret,
                    f"cp /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.bak_{ts} && "
                    f"awk -v k='{pub}' '/^\\[/ {{ if (buf != \"\" && index(buf,k)==0) printf \"%s\", buf; buf=\"\"; }} "
                    f"{{ buf = buf $0 \"\\n\" }} "
                    f"END {{ if (buf != \"\" && index(buf,k)==0) printf \"%s\", buf }}' "
                    f"/etc/wireguard/{iface}.conf > /tmp/{iface}.new && "
                    f"grep -q '{pub}' /tmp/{iface}.new && {{ echo STILL-THERE; exit 1; }}; "
                    f"mv /tmp/{iface}.new /etc/wireguard/{iface}.conf && "
                    f"wg set {iface} peer {pub} remove && echo SUSPENDED-OK",
                    timeout=60)
                good = (rc == 0 and "SUSPENDED-OK" in out)
            else:
                block = f"\n[Peer]\n# nextep_remote_{num} (telefon)\nPublicKey = {pub}\nAllowedIPs = {ip}/32\n"
                rc, out = _vps_run(
                    profile, secret,
                    f"cp /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.bak_{ts} && "
                    f"printf '%s' '{block}' >> /etc/wireguard/{iface}.conf && "
                    f"wg set {iface} peer {pub} allowed-ips {ip}/32 && echo RESUMED-OK",
                    timeout=60)
                good = (rc == 0 and "RESUMED-OK" in out)
        except Exception as e:
            return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
        if not good:
            return jsonify({"error": f"vps-apply-failed: {out.strip()[-300:]}"}), 502
        if not _vps_wg_apply(profile, secret, iface):
            return jsonify({"error": "vps-sync-failed"}), 502
        try:
            conn = get_db()
            try:
                conn.execute("UPDATE wg_peers SET suspended=? WHERE num=?", (want, num))
                conn.commit()
            finally:
                try:
                    conn.close()
                except Exception:
                    pass
        except Exception as e:
            return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
        return jsonify({"ok": True, "suspended": want})
    return jsonify({"error": "bad-patch"}), 400


@remote_bp.route("/api/remote/peers/<int:num>", methods=["DELETE"])
def remote_peers_delete(num):
    denied = _require_admin()
    if denied:
        return denied
    ensure_remote_tables()
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM wg_peers WHERE num=?", (num,)).fetchone()
        finally:
            try:
                conn.close()
            except Exception:
                pass
        if not row:
            return jsonify({"error": "not-found"}), 404
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    profile = _get_profile()
    secret = _get_secret()
    try:
        from db import get_setting as _gs
        linked = (profile["host"] and secret and (_gs("vps_status_connected") or "") == "1")
    except Exception:
        linked = False
    if not linked:
        return jsonify({"error": "no-vps-link"}), 400
    pci = _parse_pi_conf(_pi_wg_conf())
    pi_pub = _pi_pubkey(pci.get("pi_priv", ""))
    try:
        iface = _vps_iface_for_pi(profile, secret, pi_pub)
    except Exception as e:
        return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
    if not iface:
        return jsonify({"error": "vps-iface-not-found"}), 502
    ts = time.strftime("%Y%m%d_%H%M%S")
    pub = row["pubkey"]
    try:
        rc, out = _vps_run(
            profile, secret,
            f"cp /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.bak_{ts} && "
            f"awk -v k='{pub}' '/^\\[/ {{ if (buf != \"\" && index(buf,k)==0) printf \"%s\", buf; buf=\"\"; }} "
            f"{{ buf = buf $0 \"\\n\" }} "
            f"END {{ if (buf != \"\" && index(buf,k)==0) printf \"%s\", buf }}' "
            f"/etc/wireguard/{iface}.conf > /tmp/{iface}.new && "
            f"grep -q '{pub}' /tmp/{iface}.new && {{ echo STILL-THERE; exit 1; }}; "
            f"mv /tmp/{iface}.new /etc/wireguard/{iface}.conf && "
            f"wg set {iface} peer {pub} remove; echo DELETED-OK",
            timeout=60)
    except Exception as e:
        return jsonify({"error": f"vps-unreachable: {str(e)[:200]}"}), 502
    if rc != 0 or "DELETED-OK" not in out:
        return jsonify({"error": f"vps-apply-failed: {out.strip()[-300:]}"}), 502
    _vps_wg_apply(profile, secret, iface)
    try:
        conn = get_db()
        try:
            conn.execute("DELETE FROM wg_peers WHERE num=?", (num,))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    return jsonify({"ok": True})


@remote_bp.route("/api/remote/vps-status", methods=["GET"])
def remote_vps_status():
    denied = _require_admin()
    if denied:
        return denied
    p = _get_profile()
    try:
        connected = (get_setting("vps_status_connected") or "") == "1"
    except Exception:
        connected = False
    try:
        ts_raw = get_setting("vps_last_test_ts") or ""
        last_ts = int(float(ts_raw)) if ts_raw else None
    except Exception:
        last_ts = None
    configured = bool(p["host"] and p["username"] and p["has_secret"])
    try:
        ever_connected = (get_setting("vps_ever_connected") or "") == "1"
    except Exception:
        ever_connected = False
    try:
        stremio_installed = (get_setting("stremio_vps_installed") or "") == "1" or bool(get_setting("tp_base_url") or "")
    except Exception:
        stremio_installed = False
    try:
        tunnel_installed = vps_install.tunnel_installed()
        tunnel_active = vps_install.tunnel_active()
    except Exception:
        tunnel_installed = False
        tunnel_active = False
    try:
        web_server = get_setting("stremio_web_server") or ""
    except Exception:
        web_server = ""
    return jsonify({"ok": True, "configured": configured, "connected": connected and configured,
                    "everConnected": ever_connected,
                    "lastTestTs": last_ts, "host": p["host"], "port": p["port"],
                    "username": p["username"], "auth_type": p["auth_type"],
                    "sudoHasSecret": bool(p.get("sudo_has_secret")),
                    "sudoNopasswd": bool(p.get("sudo_nopasswd")),
                    "fingerprint": p["fingerprint"], "stremioInstalled": stremio_installed,
                    "tunnelInstalled": tunnel_installed, "tunnelActive": tunnel_active,
                    "webServer": web_server})


@remote_bp.route("/api/remote/profile", methods=["POST"])
def remote_profile_save():
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    host = str(body.get("host") or "").strip()
    try:
        port = int(body.get("port") or 22)
    except (TypeError, ValueError):
        return jsonify({"error": "bad_port"}), 400
    username = str(body.get("username") or "root").strip().lower() or "root"
    auth_type = str(body.get("auth_type") or "key").strip().lower()
    secret_in = body.get("secret")
    sudo_in = body.get("sudo_secret")
    if not host or (not _HOST_RE.match(host) and not _IPV4_RE.match(host)):
        return jsonify({"error": "bad_host"}), 400
    if port < 1 or port > 65535:
        return jsonify({"error": "bad_port"}), 400
    if not _USER_RE.match(username):
        return jsonify({"error": "bad_user"}), 400
    if auth_type not in ("key", "password"):
        return jsonify({"error": "bad_auth"}), 400
    ensure_remote_tables()
    old = _get_profile()
    old_sudo_secret = _get_sudo_secret()
    old_secret = _get_secret()
    # secret: "••••••••" = koru, "" = temizle, None = koru, metin = yeni
    if secret_in is None or secret_in == "••••••••":
        secret = old_secret
    else:
        secret = str(secret_in or "")
    # sudo secret: root'ta ve parola modunda tutulmaz (parola modunda login
    # parolasi zaten sudo icin kullanilir). "••••••••" = koru.
    if username == "root" or auth_type == "password":
        sudo_secret = ""
    elif sudo_in is None or sudo_in == "••••••••":
        sudo_secret = old_sudo_secret
    else:
        sudo_secret = str(sudo_in or "")
    try:
        secret_enc = encrypt_secret(secret) if secret else ""
        sudo_enc = encrypt_secret(sudo_secret) if sudo_secret else ""
    except Exception:
        return jsonify({"error": "secret_store_failed"}), 500
    # Sudo dogrulamasi yalnizca ayni host + kullanici icin gecerli kalir.
    keep_nopass = 1 if (old.get("sudo_nopasswd") and old.get("username") == username
                        and old.get("host") == host and bool(old_sudo_secret) == bool(sudo_secret)
                        and username != "root") else 0
    try:
        conn = get_db()
        try:
            conn.execute(
                """INSERT INTO vps_hosts(id, host, port, username, auth_type, secret_enc,
                                        sudo_enc, sudo_nopasswd, updated_at)
                   VALUES(1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(id) DO UPDATE SET host=excluded.host, port=excluded.port,
                   username=excluded.username, auth_type=excluded.auth_type,
                   secret_enc=excluded.secret_enc, sudo_enc=excluded.sudo_enc,
                   sudo_nopasswd=excluded.sudo_nopasswd, updated_at=datetime('now')"""
                , (host, port, username, auth_type, secret_enc, sudo_enc, keep_nopass))
            conn.commit()
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception as e:
        return jsonify({"error": f"db_failed: {str(e)[:200]}"}), 500
    out = {"ok": True, "configured": bool(host and secret and username),
           "sudo_configured": bool(sudo_secret), "username": username,
           "key_format": detect_key_format(secret) if auth_type == "key" else None}
    return jsonify(out)


@remote_bp.route("/api/remote/test", methods=["POST"])
def remote_test():
    denied = _require_admin()
    if denied:
        return denied
    p = _get_profile()
    secret = _get_secret()
    sudo_secret = _get_sudo_secret()
    if not p["host"] or not p["username"] or not secret:
        return jsonify({"ok": True, "connected": False, "reason": "incomplete",
                        "detail": "host/kullanici/secret eksik"}), 200
    ts = int(time.time())
    if p["auth_type"] == "password" and not shutil.which("sshpass"):
        _store_test_state(0, ts, 0)
        return jsonify({"ok": True, "connected": False, "reason": "no-sshpass",
                        "detail": "parola auth icin VPS/Pi uzerinde sshpass gerekli",
                        "lastTestTs": ts}), 200
    try:
        # 1) SSH girisi: parola modunda login parolasi, key modunda anahtar.
        rc, out = _ssh_exec(p, secret, "echo REMOTE-OK; id -u; hostname", timeout=20)
        if rc != 0 or "REMOTE-OK" not in (out or ""):
            _store_test_state(0, ts, 0)
            return jsonify({"ok": True, "connected": False, "reason": "ssh-failed",
                            "detail": (out or "").strip()[:500], "lastTestTs": ts}), 200
        uid = ""
        for line in (out or "").splitlines():
            s = line.strip()
            if s.isdigit():
                uid = s
        sudo_used = False
        nopass = 0
        # 2) root degilse sudo ile root'a gecilir (sudo su muadili, parolasiz).
        if uid != "0":
            sudo_used = True
            _rc_s, out_s = _ssh_exec(p, secret, "sudo -n true 2>&1 && echo SUDO-NOPASS-OK",
                                     timeout=20)
            if "SUDO-NOPASS-OK" in (out_s or ""):
                nopass = 1
            else:
                pw = _sudo_login_secret(p, secret, sudo_secret)
                if not pw:
                    _store_test_state(0, ts, 0)
                    return jsonify({"ok": True, "connected": False, "reason": "sudo-pass-required",
                                    "detail": "root disi kullanici icin sudo parolasi gerekli",
                                    "lastTestTs": ts}), 200
                # 3) parolayi bir kez kullan: dogrula + NOPASSWD bootstrap.
                _rc_c, out_c = _ssh_exec(p, secret, "sudo -S -p '' true 2>&1 && echo SUDO-PASS-OK",
                                         input_text=pw + "\n", timeout=20)
                if "SUDO-PASS-OK" not in (out_c or ""):
                    _store_test_state(0, ts, 0)
                    reason = "sudo-not-allowed" if _sudo_denied(out_c) else "sudo-wrong-pass"
                    return jsonify({"ok": True, "connected": False, "reason": reason,
                                    "detail": (out_c or "").strip()[:300],
                                    "lastTestTs": ts}), 200
                okb, detb = _bootstrap_sudoers(p, secret, pw)
                if not okb:
                    _store_test_state(0, ts, 0)
                    reason = "sudo-not-allowed" if _sudo_denied(detb) else "sudo-bootstrap-failed"
                    return jsonify({"ok": True, "connected": False, "reason": reason,
                                    "detail": detb, "lastTestTs": ts}), 200
                nopass = 1
        # 4) root yetkisi dogrulandi: isaretleri yaz.
        _store_test_state(1, ts, nopass)
        # TOFU bilgi: fingerprint (fail-soft)
        fp = ""
        try:
            ks = subprocess.run(["ssh-keyscan", "-p", str(p["port"]), "-T", "5", p["host"]],
                                capture_output=True, text=True, timeout=15)
            for line in (ks.stdout or "").splitlines():
                if "ssh-rsa" in line or "ssh-ed25519" in line or "ecdsa" in line:
                    fp = line.strip()[:200]
                    break
        except Exception:
            fp = ""
        try:
            if fp:
                conn = get_db()
                try:
                    conn.execute("UPDATE vps_hosts SET fingerprint=? WHERE id=1", (fp,))
                    conn.commit()
                finally:
                    try:
                        conn.close()
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            set_setting("vps_ever_connected", "1")
        except Exception:
            pass
        return jsonify({"ok": True, "connected": True, "lastTestTs": ts,
                        "remoteHost": (out or "").strip().splitlines()[-1][:100] if out else "",
                        "fingerprint": fp, "username": p["username"],
                        "sudo": bool(sudo_used), "sudoNopasswd": bool(nopass)})
    except subprocess.TimeoutExpired:
        _store_test_state(0, ts, 0)
        return jsonify({"ok": True, "connected": False, "reason": "timeout",
                        "lastTestTs": ts}), 200
    except Exception as e:
        return jsonify({"error": f"test_failed: {str(e)[:300]}"}), 500


@remote_bp.route("/api/remote/check", methods=["GET"])
def remote_check():
    """VPS genis kontrol (yalniz Python, sh/vps_setup.sh cagrilmaz)."""
    denied = _require_admin()
    if denied:
        return denied
    p = _get_profile()
    secret = _get_secret()
    if not p["host"] or not secret:
        return jsonify({"error": "no-vps-link"}), 400
    try:
        vrun = _mk_vps_run(p, secret)
        chk = vps_install.check_vps(vrun)
    except Exception as e:
        return jsonify({"error": f"check_failed: {str(e)[:300]}"}), 500
    web = chk.get("web") or {}
    parsed = {
        "caddy": "KURULU" if chk.get("caddy") else "EKSIK",
        "stremio": "KURULU" if chk.get("stremio") else "EKSIK",
        "wireguard": chk.get("wg") or "yok",
    }
    raw_lines = [
        f"Caddy: {'KURULU' if chk.get('caddy') else 'EKSIK'}",
        f"Stremio: {'KURULU' if chk.get('stremio') else 'EKSIK'}",
        f"WireGuard: {chk.get('wg') or 'yok'}",
        f"Web sunucusu: {web.get('owner') or '-'} (:80={web.get('http') or '-'} :443={web.get('https') or '-'})",
    ]
    return jsonify({"ok": True, "parsed": parsed, "raw": "\n".join(raw_lines),
                    "web": {"owner": web.get("owner") or "",
                            "http": web.get("http") or "",
                            "https": web.get("https") or "",
                            "options": web.get("options") or [],
                            "blocked": bool(web.get("blocked")),
                            "blockedOwner": web.get("blocked_owner") or ""}})
