"""Faz 30 coklu kullanici: kayit/giris/oturum/admin uclari."""
import datetime
import time

from flask import Blueprint, jsonify, request

from auth import (
    SESSION_COOKIE,
    SESSION_DAYS,
    _attempt_key,
    admin_required,
    create_session,
    drop_session,
    drop_user_sessions,
    get_current_user,
    hash_password,
    is_locked,
    login_required,
    record_fail,
    reset_attempts,
    validate_password,
    validate_username,
    verify_password,
)
from db import get_db, set_user_setting

from notification import create_notification

from geo import LOGIN_LANGS, normalize_lang, resolve_for_request

auth_bp = Blueprint("auth", __name__)


def _utcnow():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")


def _set_cookie(resp, token):
    resp.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="Lax",
        path="/",
    )
    return resp


def _clear_cookie(resp):
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@auth_bp.route("/api/auth/register", methods=["POST"])
def auth_register():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    err = validate_username(username) or validate_password(password)
    if err:
        return jsonify({"error": err}), 400
    if body.get("password2") is not None and body.get("password2") != password:
        return jsonify({"error": "auth_pw_mismatch"}), 400
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
            return jsonify({"error": "auth_taken"}), 409
        count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if count == 0:
            role, status = "admin", "active"
        else:
            role, status = "member", "pending"
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, role, status, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (username, hash_password(password), role, status, _utcnow()),
        )
        conn.commit()
        user_id = cur.lastrowid
    finally:
        conn.close()
    # Kayitta secilen dil hesaba yazilir (onay bekleyende de saklanir).
    try:
        lang = normalize_lang((body.get("language") or "").strip())
        if lang:
            set_user_setting(user_id, "language", lang)
    except Exception:
        pass
    if status == "pending":
        # Bekleyen kayit -> yalniz adminlere bildirim (merkez + push).
        _notify_admins("member_pending", username, "member_pending", f"pending_{user_id}")
    if status == "active":
        token, _exp = create_session(user_id, (request.headers.get("User-Agent") or ""))
        resp = jsonify({"ok": True, "role": role, "status": status, "username": username})
        return _set_cookie(resp, token)
    return jsonify({"ok": True, "role": role, "status": status, "username": username})


@auth_bp.route("/api/auth/login", methods=["POST"])
def auth_login():
    key = _attempt_key()
    if is_locked(key):
        return jsonify({"error": "auth_locked"}), 429
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    finally:
        conn.close()
    if not row or not verify_password(row["password_hash"], password):
        locked = record_fail(key)
        return jsonify({"error": "auth_locked" if locked else "auth_bad"}), 429 if locked else 401
    if row["status"] == "pending":
        return jsonify({"error": "auth_pending"}), 403
    if row["status"] != "active":
        return jsonify({"error": "auth_disabled"}), 403
    reset_attempts(key)
    token, _exp = create_session(row["id"], (request.headers.get("User-Agent") or ""))
    resp = jsonify(
        {
            "ok": True,
            "username": row["username"],
            "role": row["role"],
            "force_pw_change": bool(row["force_pw_change"]),
        }
    )
    return _set_cookie(resp, token)


@auth_bp.route("/api/auth/logout", methods=["POST"])
@login_required
def auth_logout():
    drop_session(request.cookies.get(SESSION_COOKIE) or "")
    return _clear_cookie(jsonify({"ok": True}))


@auth_bp.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "auth_required"}), 401
    if user["status"] == "pending":
        return jsonify({"error": "auth_pending"}), 403
    if user["status"] != "active":
        return jsonify({"error": "auth_disabled"}), 403
    return jsonify(
        {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "force_pw_change": bool(user["force_pw_change"]),
        }
    )


@auth_bp.route("/api/auth/exists", methods=["GET"])
def auth_exists():
    username = (request.args.get("u") or "").strip()
    if validate_username(username):
        return jsonify({"exists": False})
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    finally:
        conn.close()
    return jsonify({"exists": bool(row)})


@auth_bp.route("/api/auth/forgot", methods=["POST"])
def auth_forgot():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    if not validate_username(username):
        conn = get_db()
        try:
            row = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if row:
                open_req = conn.execute(
                    "SELECT id FROM password_resets WHERE user_id=? AND status='open'",
                    (row["id"],),
                ).fetchone()
                if not open_req:
                    cur = conn.execute(
                        "INSERT INTO password_resets (user_id, status, created_at)"
                        " VALUES (?, 'open', ?)",
                        (row["id"], _utcnow()),
                    )
                    conn.commit()
                    try:
                        _notify_admins("password_reset", username, "password_reset", f"reset_{cur.lastrowid}")
                    except Exception:
                        pass
        finally:
            conn.close()
    return jsonify({"ok": True})


def _admin_uids():
    """Bildirim alacak aktif adminler."""
    try:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id"
            ).fetchall()
        finally:
            conn.close()
        return [int(r["id"]) for r in rows]
    except Exception:
        return []


def _notify_admins(type_name, username, subject_key, notified_date):
    """Uyelik olayini adminlerin kendi dilinde bildir (merkez + push).
    Tip kapaliysa _notif_create sessiz gecer; ayni konu dedupe ile tek kalir."""
    try:
        from scheduler import _notif_create
        from db import get_user_setting
        from messages_i18n import render as _render
    except Exception:
        return
    for uid in _admin_uids():
        try:
            lang = (get_user_setting(uid, "language") or "tr-TR").split("-")[0]
            msg = _render(subject_key, lang, username=username)
        except Exception:
            msg = username
        try:
            _notif_create(username, msg, type_name, notified_date=notified_date, user_id=uid)
        except Exception:
            continue


def _client_ip():
    """Caddy ters-tunel arkasinda gercek istemci IP'si (X-Forwarded-For ilk)."""
    try:
        fwd = (request.headers.get("X-Forwarded-For") or "").strip()
        if fwd:
            return fwd.split(",")[0].strip()
    except Exception:
        pass
    try:
        return (request.remote_addr or "").strip()
    except Exception:
        return ""


@auth_bp.route("/api/auth/geo", methods=["GET"])
def auth_geo():
    try:
        info = resolve_for_request(_client_ip())
    except Exception:
        info = {"country_code": "", "country": "", "city": "", "timezone": "", "lang": "en"}
    if not info.get("lang"):
        info["lang"] = "en"
    return jsonify(info)


@auth_bp.route("/api/auth/change-password", methods=["POST"])
@login_required
def auth_change_password():
    user = get_current_user()
    body = request.get_json(silent=True) or {}
    old = body.get("old") or ""
    new = body.get("new") or ""
    err = validate_password(new)
    if err:
        return jsonify({"error": err}), 400
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        if not row or not verify_password(row["password_hash"], old):
            return jsonify({"error": "auth_bad_old"}), 401
        conn.execute(
            "UPDATE users SET password_hash=?, force_pw_change=0 WHERE id=?",
            (hash_password(new), user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


# --- Admin ---


def _user_dict(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "status": row["status"],
        "created_at": row["created_at"],
    }


# Faz 31d: cevrimici esigi (sn). Ping 30 sn'de bir; veda sinyali gelemeyen
# (cokus/kesinti) en gec bu surede dusmus sayilir.
ONLINE_WINDOW = 90


@auth_bp.route("/api/auth/ping", methods=["POST"])
@login_required
def auth_ping():
    user = get_current_user()
    token = request.cookies.get(SESSION_COOKIE) or ""
    now = int(time.time())
    conn = get_db()
    try:
        conn.execute(
            "UPDATE sessions SET last_seen=? WHERE token=? AND user_id=?",
            (now, token, user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "now": now})


@auth_bp.route("/api/auth/exit", methods=["POST"])
@login_required
def auth_exit():
    user = get_current_user()
    token = request.cookies.get(SESSION_COOKIE) or ""
    conn = get_db()
    try:
        conn.execute(
            "UPDATE sessions SET last_seen=0 WHERE token=? AND user_id=?",
            (token, user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/pending", methods=["GET"])
@admin_required
def auth_pending():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM users WHERE status='pending' ORDER BY id"
        ).fetchall()
        resets = conn.execute(
            "SELECT r.id, r.user_id, r.created_at, u.username FROM password_resets r"
            " JOIN users u ON u.id=r.user_id WHERE r.status='open' ORDER BY r.id"
        ).fetchall()
    finally:
        conn.close()
    return jsonify(
        {
            "pending": [_user_dict(r) for r in rows],
            "resets": [
                {"id": r["id"], "user_id": r["user_id"], "username": r["username"],
                 "created_at": r["created_at"]}
                for r in resets
            ],
        }
    )


@auth_bp.route("/api/auth/members", methods=["GET"])
@admin_required
def auth_members():
    now = int(time.time())
    cutoff = now - ONLINE_WINDOW
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        out = []
        for r in rows:
            d = _user_dict(r)
            on = conn.execute(
                "SELECT 1 FROM sessions WHERE user_id=? AND expires_at>? AND last_seen>? LIMIT 1",
                (r["id"], now, cutoff),
            ).fetchone()
            d["online"] = bool(on)
            out.append(d)
    finally:
        conn.close()
    return jsonify({"members": out})


@auth_bp.route("/api/auth/approve", methods=["POST"])
@admin_required
def auth_approve():
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return jsonify({"error": "auth_nouser"}), 404
        conn.execute("UPDATE users SET status='active' WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    # Faz 32c: aktif uyeye bildirim job'u ac (fail-soft).
    try:
        from scheduler import build_user_jobs
        build_user_jobs(user_id)
    except Exception:
        pass
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/reject", methods=["POST"])
@admin_required
def auth_reject():
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    if user_id == 1:
        return jsonify({"error": "auth_admin"}), 403
    conn = get_db()
    try:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.execute("DELETE FROM password_resets WHERE user_id=?", (user_id,))
        cur = conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.commit()
        gone = cur.rowcount
    finally:
        conn.close()
    if not gone:
        return jsonify({"error": "auth_nouser"}), 404
    # Faz 32c: bekleyen uye silindi (job'u zaten yoktu; no-op guvencesi).
    try:
        from scheduler import remove_user_jobs
        remove_user_jobs(user_id)
    except Exception:
        pass
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/deactivate", methods=["POST"])
@admin_required
def auth_deactivate():
    return _set_status(request, "passive")


@auth_bp.route("/api/auth/activate", methods=["POST"])
@admin_required
def auth_activate():
    return _set_status(request, "active")


def _set_status(request, status):
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    if user_id == 1:
        return jsonify({"error": "auth_admin"}), 403
    conn = get_db()
    try:
        cur = conn.execute("UPDATE users SET status=? WHERE id=?", (status, user_id))
        if status != "active":
            conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()
        changed = cur.rowcount
    finally:
        conn.close()
    if not changed:
        return jsonify({"error": "auth_nouser"}), 404
    # Faz 32c: statuye gore job ac/kaldir (fail-soft, restartsiz).
    try:
        from scheduler import build_user_jobs, remove_user_jobs
        if status == "active":
            build_user_jobs(user_id)
        else:
            remove_user_jobs(user_id)
    except Exception:
        pass
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/reset-password", methods=["POST"])
@admin_required
def auth_reset_password():
    """Sifre sifirlama istegi ETKINLESTIRME (temp uretmez): open -> active.
    Kullanici login'de adini yazinca Sifre Degistirme bolumu acilir."""
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    if user_id == 1:
        return jsonify({"error": "auth_admin"}), 403
    conn = get_db()
    try:
        row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return jsonify({"error": "auth_nouser"}), 404
        cur = conn.execute(
            "UPDATE password_resets SET status='active' WHERE user_id=? AND status='open'",
            (user_id,),
        )
        conn.commit()
        changed = cur.rowcount
    finally:
        conn.close()
    if not changed:
        return jsonify({"error": "auth_nouser"}), 404
    # Istek sahibine push (telegram + ntfy, kendi dilinde; atesle-gec).
    try:
        _push_reset_activated(user_id, row["username"])
    except Exception:
        pass
    return jsonify({"ok": True})


def _push_reset_activated(user_id, username):
    try:
        from db import get_user_setting
        from messages_i18n import render as _render
        from notifications import send_ntfy, send_telegram
        admin = get_current_user()
        admin_name = (admin.get("username") if admin else "admin") or "admin"
        lang = (get_user_setting(user_id, "language") or "tr-TR").split("-")[0]
        msg = _render("reset_user_notice", lang, admin=admin_name)
        try:
            send_telegram(msg, user_id=user_id)
        except Exception:
            pass
        try:
            send_ntfy(msg, user_id=user_id)
        except Exception:
            pass
    except Exception:
        pass


RESET_ACTIVE_DAYS = 3


def _reset_fresh(ts):
    """Active istek 3 gun icinde mi (created_at UTC 'YYYY-MM-DD HH:MM')."""
    try:
        dt = datetime.datetime.strptime((ts or "").strip(), "%Y-%m-%d %H:%M").replace(
            tzinfo=datetime.timezone.utc
        )
        now = datetime.datetime.now(datetime.timezone.utc)
        return (now - dt).total_seconds() < RESET_ACTIVE_DAYS * 86400
    except Exception:
        return False


@auth_bp.route("/api/auth/reset-status", methods=["GET"])
def auth_reset_status():
    username = (request.args.get("u") or "").strip()
    if validate_username(username):
        return jsonify({"active": False, "pending": False})
    conn = get_db()
    try:
        row = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            return jsonify({"active": False, "pending": False})
        req = conn.execute(
            "SELECT created_at FROM password_resets WHERE user_id=? AND status='active'"
            " ORDER BY id DESC LIMIT 1",
            (row["id"],),
        ).fetchone()
        open_req = conn.execute(
            "SELECT 1 FROM password_resets WHERE user_id=? AND status='open' LIMIT 1",
            (row["id"],),
        ).fetchone()
    finally:
        conn.close()
    return jsonify({
        "active": bool(req and _reset_fresh(req["created_at"])),
        "pending": bool(open_req),
    })


@auth_bp.route("/api/auth/reset-change", methods=["POST"])
def auth_reset_change():
    """Kullanicinin kendisi sifre belirler (active istek sart; sonunda done).
    Basariliysa active hesapta oturum acilir (oto-giris), bekleyende login ekrani."""
    key = _attempt_key()
    if is_locked(key):
        return jsonify({"error": "auth_locked"}), 429
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    new = body.get("new") or ""
    new2 = body.get("new2")
    err = validate_username(username) or validate_password(new)
    if err:
        return jsonify({"error": err}), 400
    if new2 is not None and new2 != new:
        return jsonify({"error": "auth_pw_mismatch"}), 400
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not row:
            locked = record_fail(key)
            return jsonify({"error": "auth_locked" if locked else "auth_nouser"}), 429 if locked else 404
        req = conn.execute(
            "SELECT * FROM password_resets WHERE user_id=? AND status='active'"
            " ORDER BY id DESC LIMIT 1",
            (row["id"],),
        ).fetchone()
        if not req or not _reset_fresh(req["created_at"]):
            locked = record_fail(key)
            return jsonify({"error": "auth_locked" if locked else "auth_nouser"}), 429 if locked else 403
        conn.execute(
            "UPDATE users SET password_hash=?, force_pw_change=0 WHERE id=?",
            (hash_password(new), row["id"]),
        )
        conn.execute("UPDATE password_resets SET status='done' WHERE id=?", (req["id"],))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
        conn.commit()
        status = row["status"]
    finally:
        conn.close()
    reset_attempts(key)
    if status == "active":
        token, _exp = create_session(row["id"], (request.headers.get("User-Agent") or ""))
        resp = jsonify({"ok": True, "role": row["role"], "status": status, "username": username})
        return _set_cookie(resp, token)
    return jsonify({"ok": True, "role": row["role"], "status": status, "username": username})


@auth_bp.route("/api/auth/kick", methods=["POST"])
@admin_required
def auth_kick():
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    drop_user_sessions(user_id)
    return jsonify({"ok": True})


def _other_admin_count(conn, exclude_id):
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active' AND id!=?",
        (exclude_id,),
    ).fetchone()
    return row["c"] if row else 0


def _role_notify(target_id, actor_name, to_admin):
    """Baskasi rol degistirince hedefe kisisel bildirim; kendi isleminde sessiz."""
    try:
        conn = get_db()
        row = conn.execute("SELECT username FROM users WHERE id=?", (target_id,)).fetchone()
        conn.close()
        if not row or row["username"] == actor_name:
            return
    except Exception:
        return
    import time as _time

    kind = "role_admin" if to_admin else "role_member"
    title = "Admin yapıldınız" if to_admin else "Üye yapıldınız"
    msg = f"{actor_name} tarafından {'admin' if to_admin else 'üye'} yapıldınız"
    try:
        # time_ns: art arda degisimlerde ayni-saniye dedupe yutmasin.
        create_notification(title, msg, kind, notified_date=f"role_{_time.time_ns()}_{target_id}",
                            user_id=target_id)
    except Exception:
        pass


@auth_bp.route("/api/auth/promote", methods=["POST"])
@admin_required
def auth_promote():
    actor = get_current_user()
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row or row["status"] != "active" or row["role"] == "admin":
            return jsonify({"error": "auth_nouser"}), 404
        conn.execute("UPDATE users SET role='admin' WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    _role_notify(user_id, actor["username"], True)
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/demote", methods=["POST"])
@admin_required
def auth_demote():
    actor = get_current_user()
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row or row["status"] != "active" or row["role"] != "admin":
            return jsonify({"error": "auth_nouser"}), 404
        # Son admin inemez (id==1 ozel yasagi yerine gecer).
        if _other_admin_count(conn, user_id) < 1:
            return jsonify({"error": "auth_last_admin"}), 403
        conn.execute("UPDATE users SET role='member' WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    _role_notify(user_id, actor["username"], False)
    return jsonify({"ok": True})


# Faz 32'de user_id kolonu gelen tablolar buraya eklenir (sifir kirinti).
_USER_TABLES = ["sessions", "password_resets", "notifications", "user_settings"]


def _delete_user_everything(user_id):
    conn = get_db()
    try:
        for tbl in _USER_TABLES:
            col = "user_id"
            try:
                conn.execute(f"DELETE FROM {tbl} WHERE {col}=?", (user_id,))
            except Exception:
                pass
        # Faz 32: karta bagli cocuk satirlar once (episodes/anime_episodes), sonra parent.
        try:
            frows = conn.execute("SELECT id FROM followed WHERE user_id=?", (user_id,)).fetchall()
            for fr in frows:
                try:
                    conn.execute("DELETE FROM episodes WHERE follow_id=?", (fr["id"],))
                except Exception:
                    pass
                try:
                    conn.execute("DELETE FROM cast WHERE follow_id=?", (fr["id"],))
                except Exception:
                    pass
        except Exception:
            pass
        try:
            arows = conn.execute("SELECT id FROM anime WHERE user_id=?", (user_id,)).fetchall()
            for ar in arows:
                try:
                    conn.execute("DELETE FROM anime_episodes WHERE anime_id=?", (ar["id"],))
                except Exception:
                    pass
                try:
                    conn.execute("DELETE FROM anime_cast WHERE anime_id=?", (ar["id"],))
                except Exception:
                    pass
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM followed WHERE user_id=?", (user_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM anime WHERE user_id=?", (user_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM stremio_signals WHERE user_id=?", (user_id,))
        except Exception:
            # kolon yoksa (eski DB) tumu degil hicbiri silinmesin
            pass
        try:
            conn.execute("DELETE FROM rec_cache WHERE user_id=?", (user_id,))
        except Exception:
            pass
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()


@auth_bp.route("/api/auth/delete", methods=["POST"])
@admin_required
def auth_delete():
    actor = get_current_user()
    body = request.get_json(silent=True) or {}
    try:
        user_id = int(body.get("id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "auth_nouser"}), 404
    if user_id == actor["id"]:
        return jsonify({"error": "auth_self"}), 403
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return jsonify({"error": "auth_nouser"}), 404
        if row["role"] == "admin" and row["status"] == "active":
            if _other_admin_count(conn, user_id) < 1:
                return jsonify({"error": "auth_last_admin"}), 403
    finally:
        conn.close()
    _delete_user_everything(user_id)
    # Faz 32c: silinen uyenin cron'u da otomatik kalkar (restartsiz).
    try:
        from scheduler import remove_user_jobs
        remove_user_jobs(user_id)
    except Exception:
        pass
    return jsonify({"ok": True})


@auth_bp.route("/api/admin/rate", methods=["GET"])
@admin_required
def admin_rate():
    """API hiz gostergesi: TMDB/AniList/TVMaze canli doluluk + son 1 saat piki.
    Dis istek yapmaz, maliyeti sifir."""
    from rate_track import snapshot

    return jsonify(snapshot())
