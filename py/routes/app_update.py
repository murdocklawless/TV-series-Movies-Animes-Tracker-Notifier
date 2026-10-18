import threading

from flask import Blueprint, jsonify, request

from app_update import check_update, apply_update, fetch_remote_changelog, changelog_between, _ver_tuple, cached_version_state

app_update_bp = Blueprint("app_update", __name__)


@app_update_bp.route("/api/app-update/version", methods=["GET"])
def app_update_version():
    """Hizli (AG YOK) surum durumu — modal acilisinda aninda gosterim icin. 1.87."""
    local, remote, available, known = cached_version_state()
    return jsonify({"local": local, "remote": remote, "available": available, "known": known, "cached": True})


@app_update_bp.route("/api/app-update/check", methods=["GET"])
def app_update_check():
    force = str(request.args.get("force") or "") in ("1", "true", "yes")
    local, remote, available, known = check_update(force=force)
    return jsonify({"local": local, "remote": remote, "available": available, "known": known})


@app_update_bp.route("/api/app-update/run", methods=["POST"])
def app_update_run():
    body = request.get_json(silent=True) or {}
    local, remote, available, _known = check_update()
    if not available and not body.get("force"):
        return jsonify({"ok": True, "updated": False, "local": local, "remote": remote})
    # Downgrade kilidi: bayat available ne derse desin, uzak <= yerelse
    # dusurme yapilmaz (2026-09-12: 1.60'a "1.55'e guncelle" onerildi).
    # Bilincli manuel gecis (force) calismaya devam eder.
    if not body.get("force") and not (remote and _ver_tuple(remote) > _ver_tuple(local)):
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
