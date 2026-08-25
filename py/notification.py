import time
import json
from flask import Blueprint, jsonify, request

from db import get_db
from ramcache import list_cache, bump, gen, cached_response
from poster_store import versioned_web_path

notification_bp = Blueprint("notification", __name__)


def _now_ts():
    return int(time.time())


def is_duplicate_notification(type_name, title, season=None, episode=None, tmdb_id=None, anilist_id=None, notified_date=None):
    """Aynı tip+başlık(+sezon/bölüm/id) + notified_date kombinasyonu daha once
    uretilmis ise True doner. Dis push kapilarinin da kullanmasi icin ayrik."""
    conn = get_db()
    try:
        if season is not None or episode is not None:
            rows = conn.execute(
                "SELECT id, season, episode, tmdb_id, anilist_id, notified_date FROM notifications WHERE type=? AND title=?",
                (type_name, title),
            ).fetchall()
            for r in rows:
                if (r["season"] == season and r["episode"] == episode and r["tmdb_id"] == tmdb_id and r["anilist_id"] == anilist_id and r["notified_date"] == notified_date):
                    return True
        else:
            rows = conn.execute(
                "SELECT notified_date FROM notifications WHERE type=? AND title=?",
                (type_name, title),
            ).fetchall()
            for r in rows:
                if r["notified_date"] == notified_date:
                    return True
        return False
    except Exception:
        return False
    finally:
        conn.close()


def create_notification(title, message, type_name, media_type=None, tmdb_id=None, anilist_id=None, season=None, episode=None, poster_local=None, thumbnail_local=None, remote_poster_url=None, kind_for_thumb=None, ident_for_thumb=None, notified_date=None):
    """Insert notification if not duplicate. Handles thumbnail generation.
    kind_for_thumb: tv/movie/anime, ident_for_thumb: tmdb_id/anilist_id
    remote_poster_url: fallback url (w500 or cover) to ensure thumb if w500 missing.
    Returns new id or None if duplicate."""
    conn = get_db()
    try:
        if is_duplicate_notification(type_name, title, season=season, episode=episode, tmdb_id=tmdb_id, anilist_id=anilist_id, notified_date=notified_date):
            conn.close()
            return None
    except Exception:
        pass

    # ensure thumbnail
    thumb = thumbnail_local
    if not thumb and kind_for_thumb and ident_for_thumb:
        try:
            from poster_store import ensure_thumbnail
            thumb = ensure_thumbnail(kind_for_thumb, ident_for_thumb, remote_poster_url)
        except Exception:
            thumb = None

    # ensure poster_local if missing and remote exists? keep as is
    if not poster_local and remote_poster_url and kind_for_thumb:
        # try to ensure w500
        try:
            from poster_store import download_poster
            # download_poster will create w500/w185, but we already have thumb logic
            # attempt to ensure w500
            from poster_store import poster_local_path, filesystem_path_from_web
            import os
            w500 = poster_local_path(kind_for_thumb, ident_for_thumb, "w500")
            if w500:
                import os
                fs = filesystem_path_from_web(w500)
                if not fs or not os.path.exists(fs):
                    from poster_store import download_poster as dp
                    dp(kind_for_thumb, ident_for_thumb, remote_poster_url)
                    poster_local = poster_local_path(kind_for_thumb, ident_for_thumb, "w500")
        except Exception:
            pass

    conn.execute(
        "INSERT INTO notifications (type, title, message, tmdb_id, anilist_id, media_type, season, episode, poster_local, thumbnail_local, is_read, notified_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (type_name, title, message, tmdb_id, anilist_id, media_type, season, episode, poster_local, thumb, 0, notified_date, _now_ts()),
    )
    conn.commit()
    nid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    bump()
    return nid


@notification_bp.route("/api/notifications", methods=["GET"])
def list_notifications():
    unread = request.args.get("unread")
    try:
        limit = int(request.args.get("limit", "50"))
    except:
        limit = 50
    try:
        offset = int(request.args.get("offset", "0"))
    except:
        offset = 0
    limit = max(1, min(100, limit))
    offset = max(0, offset)
    key = ("notif_list", gen(), unread or "", limit, offset)
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    if unread in ("1", "true", "yes"):
        rows = conn.execute("SELECT * FROM notifications WHERE is_read=0 ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    conn.close()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("thumbnail_local"):
            d["thumbnail_local"] = versioned_web_path(d["thumbnail_local"])
        if d.get("poster_local"):
            d["poster_local"] = versioned_web_path(d["poster_local"])
        out.append(d)
    list_cache.set(key, out)
    return cached_response(out, False)


@notification_bp.route("/api/notifications/count", methods=["GET"])
def count_notifications():
    unread = request.args.get("unread")
    key = ("notif_count", gen(), unread or "")
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    if unread in ("1", "true", "yes"):
        c = conn.execute("SELECT COUNT(*) c FROM notifications WHERE is_read=0").fetchone()["c"]
    else:
        c = conn.execute("SELECT COUNT(*) c FROM notifications").fetchone()["c"]
    conn.close()
    payload = {"count": c}
    list_cache.set(key, payload)
    return cached_response(payload, False)


@notification_bp.route("/api/notifications/<int:nid>/read", methods=["POST"])
def mark_read(nid):
    body = request.get_json(silent=True) or {}
    is_read = body.get("is_read")
    if is_read is None:
        is_read = 1
    else:
        is_read = 1 if is_read else 0
    conn = get_db()
    conn.execute("UPDATE notifications SET is_read=? WHERE id=?", (is_read, nid))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications/read-all", methods=["POST"])
def mark_all_read():
    conn = get_db()
    conn.execute("UPDATE notifications SET is_read=1 WHERE is_read=0")
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications/<int:nid>", methods=["DELETE"])
def delete_one(nid):
    conn = get_db()
    # also delete thumb/poster? keep files as they may be used elsewhere, but thumbnail could be removed if no other notification references it - keep for now
    conn.execute("DELETE FROM notifications WHERE id=?", (nid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications", methods=["DELETE"])
def delete_all():
    # clear all
    conn = get_db()
    conn.execute("DELETE FROM notifications")
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})
