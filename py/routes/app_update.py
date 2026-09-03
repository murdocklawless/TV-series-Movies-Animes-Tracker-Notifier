import threading

from flask import Blueprint, jsonify, request

from app_update import check_update, apply_update, fetch_remote_changelog, changelog_between

app_update_bp = Blueprint("app_update", __name__)


@app_update_bp.route("/api/app-update/check", methods=["GET"])
def app_update_check():
    local, remote, available, known = check_update()
    return jsonify({"local": local, "remote": remote, "available": available, "known": known})


@app_update_bp.route("/api/app-update/run", methods=["POST"])
def app_update_run():
    body = request.get_json(silent=True) or {}
    local, remote, available, _known = check_update()
    if not available and not body.get("force"):
        return jsonify({"ok": True, "updated": False, "local": local, "remote": remote})
    try:
        # apply_update: senkron + pip + 3 sn sonra restart zamanlar; yanıt istemciye ulaşır
        from_ver, to_ver = apply_update()
    except Exception as e:
        return jsonify({"error": f"Güncelleme hatası: {e}"}), 500
    return jsonify({"ok": True, "updated": True, "from": from_ver, "to": to_ver})


@app_update_bp.route("/api/app-update/changelog", methods=["GET"])
def app_update_changelog():
    local, remote, _available, _known = check_update()
    try:
        text = fetch_remote_changelog()
    except Exception as e:
        return jsonify({"local": local, "remote": remote, "changes": [],
                        "error": f"Değişiklik notu alınamadı: {e}"})
    return jsonify({"local": local, "remote": remote,
                    "changes": changelog_between(text, local, remote)})
