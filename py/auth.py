"""Faz 30 coklu kullanici: kural denetimi, sifre hash'i, oturum, guard'lar.

Kurallar (frontend ile birebir ayni):
- Kullanici adi: ^[A-Za-z0-9]{3,20}$ (harf+rakam, 3-20 karakter)
- Sifre: >=10 karakter + buyuk + kucuk + rakam + sembol
"""
import os
import re
import time
import secrets
from functools import wraps

from flask import g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from config import BASE_DIR
from db import get_db

USERNAME_RE = re.compile(r"^[A-Za-z0-9]{3,20}$")
SESSION_COOKIE = "nextep_session"
SESSION_DAYS = 365
MAX_FAILS = 5
LOCK_SECONDS = 15 * 60

SECRET_FILE = os.path.join(BASE_DIR, ".flask_secret")

# Gecici sifre/sembol uretiminde kabuk/URL bozan karakterler yok.
_TEMP_SYMBOLS = "!@#$%^&*-_+="
_TEMP_LOWER = "abcdefghjkmnpqrstuvwxyz"
_TEMP_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ"
_TEMP_DIGIT = "23456789"


def validate_username(username):
    """Gecerliyse None, degilse hata anahtari dondurur."""
    u = username or ""
    if len(u) < 3:
        return "auth_user_min"
    if len(u) > 20:
        return "auth_user_max"
    if not USERNAME_RE.match(u):
        return "auth_user_chars"
    return None


def validate_password(password):
    """Gecerliyse None, degilse ilk bozulan kuralin anahtari."""
    p = password or ""
    if len(p) < 10:
        return "auth_pw_min"
    if not re.search(r"[A-Z]", p):
        return "auth_pw_upper"
    if not re.search(r"[a-z]", p):
        return "auth_pw_lower"
    if not re.search(r"[0-9]", p):
        return "auth_pw_digit"
    if not re.search(r"[^A-Za-z0-9]", p):
        return "auth_pw_symbol"
    return None


def make_temp_password():
    """Kurallara uyan 12 karakterlik gecici sifre."""
    parts = [
        secrets.choice(_TEMP_LOWER),
        secrets.choice(_TEMP_LOWER),
        secrets.choice(_TEMP_LOWER),
        secrets.choice(_TEMP_UPPER),
        secrets.choice(_TEMP_UPPER),
        secrets.choice(_TEMP_UPPER),
        secrets.choice(_TEMP_DIGIT),
        secrets.choice(_TEMP_DIGIT),
        secrets.choice(_TEMP_DIGIT),
        secrets.choice(_TEMP_SYMBOLS),
        secrets.choice(_TEMP_SYMBOLS),
        secrets.choice(_TEMP_SYMBOLS),
    ]
    secrets.SystemRandom().shuffle(parts)
    return "".join(parts)


def hash_password(password):
    return generate_password_hash(password)


def verify_password(password_hash, password):
    try:
        return check_password_hash(password_hash, password or "")
    except Exception:
        return False


def ensure_secret_key(app):
    """Gizli anahtar dosyada saklanir; yoksa uretilir. Repoya girmez."""
    secret = None
    try:
        if os.path.exists(SECRET_FILE):
            with open(SECRET_FILE, "r", encoding="utf-8") as f:
                secret = (f.read() or "").strip()
    except Exception:
        secret = None
    if not secret:
        secret = secrets.token_hex(32)
        try:
            with open(SECRET_FILE, "w", encoding="utf-8") as f:
                f.write(secret)
            try:
                os.chmod(SECRET_FILE, 0o600)
            except Exception:
                pass
        except Exception as e:
            print(f"secret write failed: {e}", flush=True)
    app.secret_key = secret


def _now():
    return int(time.time())


def create_session(user_id, device=""):
    token = secrets.token_urlsafe(32)
    now = _now()
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO sessions (token, user_id, device, created_at, expires_at, last_seen)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (token, user_id, (device or "")[:120], now, now + SESSION_DAYS * 86400, now),
        )
        # Suresi dolmus oturumlari faldan buda.
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.commit()
    finally:
        conn.close()
    return token, now + SESSION_DAYS * 86400


def drop_session(token):
    try:
        conn = get_db()
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def drop_user_sessions(user_id):
    try:
        conn = get_db()
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def get_current_user():
    """Cerezdeki oturumdan aktif kullanici (yoksa None). g'de onbelleklenir."""
    if hasattr(g, "auth_user"):
        return g.auth_user
    user = None
    token = request.cookies.get(SESSION_COOKIE) or ""
    if token:
        try:
            conn = get_db()
            row = conn.execute(
                "SELECT u.id, u.username, u.role, u.status, u.force_pw_change"
                " FROM sessions s JOIN users u ON u.id=s.user_id"
                " WHERE s.token=? AND s.expires_at > ?",
                (token, _now()),
            ).fetchone()
            conn.close()
            if row:
                user = {
                    "id": row["id"],
                    "username": row["username"],
                    "role": row["role"],
                    "status": row["status"],
                    "force_pw_change": row["force_pw_change"],
                }
        except Exception:
            user = None
    g.auth_user = user
    return user


def login_required(f):
    @wraps(f)
    def _wrap(*a, **kw):
        user = get_current_user()
        if not user:
            return jsonify({"error": "auth_required"}), 401
        if user["status"] == "pending":
            return jsonify({"error": "auth_pending"}), 403
        if user["status"] != "active":
            return jsonify({"error": "auth_disabled"}), 403
        return f(*a, **kw)

    return _wrap


def admin_required(f):
    @wraps(f)
    def _wrap(*a, **kw):
        user = get_current_user()
        if not user:
            return jsonify({"error": "auth_required"}), 401
        if user["status"] != "active" or user["role"] != "admin":
            return jsonify({"error": "auth_admin"}), 403
        return f(*a, **kw)

    return _wrap


def _attempt_key():
    try:
        fwd = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        ip = fwd or (request.remote_addr or "?")
    except Exception:
        ip = "?"
    return f"ip:{ip}"


def is_locked(key):
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT count, locked_until FROM login_attempts WHERE key=?", (key,)
        ).fetchone()
        conn.close()
        return bool(row and row["locked_until"] > _now())
    except Exception:
        return False


def record_fail(key):
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT count FROM login_attempts WHERE key=?", (key,)
        ).fetchone()
        count = (row["count"] if row else 0) + 1
        locked = _now() + LOCK_SECONDS if count >= MAX_FAILS else 0
        conn.execute(
            "INSERT INTO login_attempts (key, count, locked_until) VALUES (?, ?, ?)"
            " ON CONFLICT(key) DO UPDATE SET count=excluded.count,"
            " locked_until=excluded.locked_until",
            (key, count, locked),
        )
        conn.commit()
        conn.close()
        return locked > 0
    except Exception:
        return False


def reset_attempts(key):
    try:
        conn = get_db()
        conn.execute("DELETE FROM login_attempts WHERE key=?", (key,))
        conn.commit()
        conn.close()
    except Exception:
        pass


# Herkese acik auth uclari (cerezsiz erisilebilir).
_PUBLIC_AUTH = {
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/exists",
    "/api/auth/forgot",
    "/api/auth/geo",
    "/api/auth/reset-status",
    "/api/auth/reset-change",
}

# Yalniz admin.
_ADMIN_PATHS = (
    "/api/app-update/run",
    "/api/auth/pending",
    "/api/auth/approve",
    "/api/auth/reject",
    "/api/auth/members",
    "/api/auth/deactivate",
    "/api/auth/activate",
    "/api/auth/reset-password",
    "/api/auth/kick",
    "/api/auth/promote",
    "/api/auth/demote",
    "/api/auth/delete",
)


def init_auth(app):
    """Gizli anahtar + global giris kapisi. Stremio ve statikler muaf."""
    ensure_secret_key(app)

    @app.before_request
    def _auth_gate():
        path = request.path or ""
        # Giris ekrani, statikler ve Stremio eklentisi herkese acik.
        if path == "/" or path.startswith(("/static/", "/stremio/")):
            return None
        if not path.startswith("/api/"):
            return None
        if path in _PUBLIC_AUTH:
            return None
        user = get_current_user()
        if path == "/api/app-update/run" or path.startswith(_ADMIN_PATHS):
            if not user:
                return jsonify({"error": "auth_required"}), 401
            if user["status"] != "active" or user["role"] != "admin":
                return jsonify({"error": "auth_admin"}), 403
            return None
        if not user:
            return jsonify({"error": "auth_required"}), 401
        if user["status"] == "pending":
            return jsonify({"error": "auth_pending"}), 403
        if user["status"] != "active":
            return jsonify({"error": "auth_disabled"}), 403
        return None
