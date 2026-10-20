"""Emby API modu uclari (1.87).

Emby'de webhook Premiere gerektirdigi icin (bu kurulumda yok) izlenme durumu
API'den senkronlanir. Kartta "Sunucu adresi" + "API anahtari" alanlari bu
uclari kullanir. Anahtar `crypto_util` kasasinda saklanir ve **asla geri
dondurulmez** (yalniz "hasKey" bilgisi).

  GET  /api/thirdparty/emby/api    -> API durumu (anahtar maskeli)
  POST /api/thirdparty/emby/api    -> kaydet {url, key, user}
  POST /api/thirdparty/emby/test   -> baglanti testi (System/Info)
  POST /api/thirdparty/emby/sync   -> simdi senkronla
  POST /api/thirdparty/emby/token        -> login {url,user,password} veya
                                            elle token {url,token}
  GET  /api/thirdparty/emby/token/reveal -> cozulmus token (admin, acik istek)
  POST /api/thirdparty/emby/token/check  -> token kontrol/yenile
  POST /api/thirdparty/emby/token/clear  -> token + parola temizle

Yetki: admin (sunucu geneli ayar).
"""
from flask import Blueprint, jsonify, request

from auth import get_current_user
import emby_sync

emby_bp = Blueprint("emby", __name__)


def _no_store(resp):
    """Token/parola iceren yanitlar tarayici onbellegine yazilmasin."""
    try:
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        resp.headers["Pragma"] = "no-cache"
    except Exception:
        pass
    return resp


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


@emby_bp.route("/api/thirdparty/emby/api", methods=["GET"])
def emby_api_get():
    denied = _require_admin()
    if denied:
        return denied
    return _no_store(jsonify(emby_sync.api_status()))


@emby_bp.route("/api/thirdparty/emby/api", methods=["POST"])
def emby_api_set():
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    ok, err = emby_sync.save_config(body.get("url"), body.get("key"), body.get("user"))
    if not ok:
        return jsonify({"error": err or "kaydedilemedi"}), 400
    # Ayar kaydedildi -> WS dinleyiciyi yeniden baslat (URL/anahtar degismis
    # olabilir) + ilk senkronu arka planda yap.
    try:
        emby_sync.restart_listener()
        emby_sync.sync_async()
    except Exception as e:
        print(f"[emby] kayit sonrasi baslatma hata: {e}", flush=True)
    return _no_store(jsonify(emby_sync.api_status()))


@emby_bp.route("/api/thirdparty/emby/test", methods=["POST"])
def emby_test():
    denied = _require_admin()
    if denied:
        return denied
    ok, info = emby_sync.test_connection()
    if not ok:
        return jsonify({"error": info or "baglanti"}), 400
    return jsonify({"ok": True, "info": info})


@emby_bp.route("/api/thirdparty/emby/sync", methods=["POST"])
def emby_sync_now():
    denied = _require_admin()
    if denied:
        return denied
    res = emby_sync.sync_once(verbose=True)
    if not res.get("ok"):
        return jsonify({"error": res.get("error") or "senkron"}), 400
    return jsonify(res)


# ---------------------------------------------------------------------------
# 1.94 — Access Token
# ---------------------------------------------------------------------------

@emby_bp.route("/api/thirdparty/emby/token", methods=["POST"])
def emby_token_set():
    """Kullanici adi + parola ile token al veya elle token kaydet."""
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    url = (body.get("url") or "").strip()
    user = (body.get("user") or "").strip()
    password = body.get("password")
    token = (body.get("token") or "").strip()

    # URL'yi kaydet (bos ise mevcut URL kullanilir). URL degisirse eski
    # token/parola temizlenir; birazdan yeni token yazilacak.
    if url:
        ok, err = emby_sync.save_config(url, None, user or None)
        if not ok:
            return _no_store(jsonify({"error": err or "kaydedilemedi"})), 400

    if password is not None and str(password) != "":
        if not user:
            return _no_store(jsonify({"error": "kullanici"})), 400
        ok, data = emby_sync.login_access_token(
            url or (emby_sync._cfg()[0] or ""), user, str(password))
        if not ok:
            return _no_store(jsonify({"error": data or "auth"})), 400
        ok2, err2 = emby_sync.save_access_token(
            data.get("token"), data.get("user") or user,
            data.get("user_id") or "", password=str(password))
        if not ok2:
            return _no_store(jsonify({"error": err2 or "kaydedilemedi"})), 400
        try:
            emby_sync.restart_listener()
        except Exception:
            pass
        out = emby_sync.api_status()
        out["ok"] = True
        out["accessToken"] = data.get("token") or ""
        out["tokenUser"] = data.get("user") or user
        return _no_store(jsonify(out))

    if token:
        ok, info = emby_sync.save_manual_token(token, username=user)
        if not ok:
            return _no_store(jsonify({"error": info or "token-gecersiz"})), 400
        try:
            emby_sync.restart_listener()
        except Exception:
            pass
        out = emby_sync.api_status()
        out["ok"] = True
        out["accessToken"] = token
        out["tokenUser"] = info.get("name") or user
        return _no_store(jsonify(out))

    return _no_store(jsonify({"error": "eksik"})), 400


@emby_bp.route("/api/thirdparty/emby/token/reveal", methods=["GET"])
def emby_token_reveal():
    """Admin'e cozulmus access token'i dondur (yalnizca acik istek uzerine).

    1.97: GET /api/thirdparty/emby/api yalnizca hasToken doner; token'in
    kendisi bu ucdan, admin oturumu + no-store ile ve sadece kullanici
    "Goster"e bastiginda cekilir.
    """
    denied = _require_admin()
    if denied:
        return denied
    tok = emby_sync.access_token()
    if not tok:
        return _no_store(jsonify({"ok": False, "error": "token-yok"})), 404
    return _no_store(jsonify({"ok": True, "accessToken": tok}))


@emby_bp.route("/api/thirdparty/emby/token/check", methods=["POST"])
def emby_token_check():
    denied = _require_admin()
    if denied:
        return denied
    res = emby_sync.ensure_token(force=True)
    out = emby_sync.api_status()
    out["ok"] = bool(res.get("ok"))
    out["result"] = res
    return _no_store(jsonify(out))


@emby_bp.route("/api/thirdparty/emby/token/clear", methods=["POST"])
def emby_token_clear():
    denied = _require_admin()
    if denied:
        return denied
    emby_sync.clear_token_config()
    try:
        emby_sync.restart_listener()
    except Exception:
        pass
    out = emby_sync.api_status()
    out["ok"] = True
    return _no_store(jsonify(out))
