import threading

from flask import Blueprint, jsonify

from app_update import check_update, apply_update

app_update_bp = Blueprint("app_update", __name__)


@app_update_bp.route("/api/app-update/check", methods=["GET"])
def app_update_check():
    local, remote, available = check_update()
    return jsonify({"local": local, "remote": remote, "available": available})


@app_update_bp.route("/api/app-update/run", methods=["POST"])
def app_update_run():
    local, remote, available = check_update()
    if not available:
        return jsonify({"ok": True, "updated": False, "local": local, "remote": remote})
    try:
        # apply_update: senkron + pip + 3 sn sonra restart zamanlar; yanıt istemciye ulaşır
        from_ver, to_ver = apply_update()
    except Exception as e:
        return jsonify({"error": f"Güncelleme hatası: {e}"}), 500
    return jsonify({"ok": True, "updated": True, "from": from_ver, "to": to_ver})
