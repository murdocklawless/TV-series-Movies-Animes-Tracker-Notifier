"""Emby API modu uclari (1.87).

Emby'de webhook Premiere gerektirdigi icin (bu kurulumda yok) izlenme durumu
API'den senkronlanir. Kartta "Sunucu adresi" + "API anahtari" alanlari bu
uclari kullanir. Anahtar `crypto_util` kasasinda saklanir ve **asla geri
dondurulmez** (yalniz "hasKey" bilgisi).

  GET  /api/thirdparty/emby/api    -> API durumu (anahtar maskeli)
  POST /api/thirdparty/emby/api    -> kaydet {url, key, user}
  POST /api/thirdparty/emby/test   -> baglanti testi (System/Info)
  POST /api/thirdparty/emby/sync   -> simdi senkronla

Yetki: admin (sunucu geneli ayar).
"""
from flask import Blueprint, jsonify, request

from auth import get_current_user
import emby_sync

emby_bp = Blueprint("emby", __name__)


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
    return jsonify(emby_sync.api_status())


@emby_bp.route("/api/thirdparty/emby/api", methods=["POST"])
def emby_api_set():
    denied = _require_admin()
    if denied:
        return denied
    body = request.get_json(silent=True) or {}
    ok, err = emby_sync.save_config(body.get("url"), body.get("key"), body.get("user"))
    if not ok:
        return jsonify({"error": err or "kaydedilemedi"}), 400
    # Ayar kaydedildi -> WS dinleyiciyi baslat + ilk senkronu arka planda yap
    try:
        emby_sync.start_listener()
        emby_sync.sync_async()
    except Exception as e:
        print(f"[emby] kayit sonrasi baslatma hata: {e}", flush=True)
    return jsonify(emby_sync.api_status())


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
