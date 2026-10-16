import time
import json
from flask import Blueprint, jsonify, request

from db import get_db
from auth import get_current_user
from ramcache import list_cache, bump, gen, cached_response
from poster_store import versioned_web_path

notification_bp = Blueprint("notification", __name__)


def _me_id():
    """Oturumdaki kullanici id'si (yoksa 0). Faz 31: kisisel bildirim suzgeci."""
    try:
        u = get_current_user()
        return u["id"] if u else 0
    except Exception:
        return 0


def _now_ts():
    return int(time.time())


def is_duplicate_notification(type_name, title, season=None, episode=None, tmdb_id=None, anilist_id=None, notified_date=None, user_id=None):
    """Aynı tip+başlık(+sezon/bölüm/id) + notified_date kombinasyonu daha once
    uretilmis ise True doner. Dis push kapilarinin da kullanmasi icin ayrik.
    Faz 32: user_id verilirse yalniz o kullanicinin satirlari karsilastirilir."""
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    conn = get_db()
    try:
        uscope = "AND user_id=? " if uid else ""
        up = (uid,) if uid else ()
        # birikme tiplerinde tmdb_id/anilist_id ile dedupe (aynı isimli farklı dizi çakışmasın)
        if type_name in ("unwatched_bulk", "anime_unwatched_bulk"):
            if tmdb_id is not None:
                rows = conn.execute(
                    f"SELECT notified_date FROM notifications WHERE type=? AND tmdb_id=? {uscope}",
                    (type_name, tmdb_id, *up),
                ).fetchall()
            elif anilist_id is not None:
                rows = conn.execute(
                    f"SELECT notified_date FROM notifications WHERE type=? AND anilist_id=? {uscope}",
                    (type_name, anilist_id, *up),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT notified_date FROM notifications WHERE type=? AND title=? {uscope}",
                    (type_name, title, *up),
                ).fetchall()
            for r in rows:
                if r["notified_date"] == notified_date:
                    return True
            return False
        if season is not None or episode is not None:
            rows = conn.execute(
                f"SELECT id, season, episode, tmdb_id, anilist_id, notified_date, user_id FROM notifications WHERE type=? AND title=? {uscope}",
                (type_name, title, *up),
            ).fetchall()
            for r in rows:
                if (r["season"] == season and r["episode"] == episode and r["tmdb_id"] == tmdb_id and r["anilist_id"] == anilist_id and r["notified_date"] == notified_date):
                    return True
        else:
            rows = conn.execute(
                f"SELECT notified_date FROM notifications WHERE type=? AND title=? {uscope}",
                (type_name, title, *up),
            ).fetchall()
            for r in rows:
                if r["notified_date"] == notified_date:
                    return True
        return False
    except Exception:
        return False
    finally:
        conn.close()


def create_notification(title, message, type_name, media_type=None, tmdb_id=None, anilist_id=None, season=None, episode=None, poster_local=None, thumbnail_local=None, remote_poster_url=None, kind_for_thumb=None, ident_for_thumb=None, notified_date=None, user_id=0):
    """Insert notification if not duplicate. Handles thumbnail generation.
    kind_for_thumb: tv/movie/anime, ident_for_thumb: tmdb_id/anilist_id
    remote_poster_url: fallback url (w500 or cover) to ensure thumb if w500 missing.
    user_id: 0 = herkese acik; >0 yalniz hedef kullaniciya (Faz 31 rol bildirimi).
    Returns new id or None if duplicate."""
    conn = get_db()
    try:
        if is_duplicate_notification(type_name, title, season=season, episode=episode, tmdb_id=tmdb_id, anilist_id=anilist_id, notified_date=notified_date, user_id=user_id):
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
        "INSERT INTO notifications (type, title, message, tmdb_id, anilist_id, media_type, season, episode, poster_local, thumbnail_local, is_read, notified_date, created_at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (type_name, title, message, tmdb_id, anilist_id, media_type, season, episode, poster_local, thumb, 0, notified_date, _now_ts(), user_id or 0),
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
    uid = _me_id()
    key = ("notif_list", gen(), uid, unread or "", limit, offset)
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    if unread in ("1", "true", "yes"):
        rows = conn.execute("SELECT * FROM notifications WHERE is_read=0 AND type!='watched_ask' AND (user_id=0 OR user_id=?) ORDER BY created_at DESC LIMIT ? OFFSET ?", (uid, limit, offset)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM notifications WHERE type!='watched_ask' AND (user_id=0 OR user_id=?) ORDER BY created_at DESC LIMIT ? OFFSET ?", (uid, limit, offset)).fetchall()
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
    uid = _me_id()
    key = ("notif_count", gen(), uid, unread or "")
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    if unread in ("1", "true", "yes"):
        c = conn.execute("SELECT COUNT(*) c FROM notifications WHERE is_read=0 AND type!='watched_ask' AND (user_id=0 OR user_id=?)", (uid,)).fetchone()["c"]
    else:
        c = conn.execute("SELECT COUNT(*) c FROM notifications WHERE type!='watched_ask' AND (user_id=0 OR user_id=?)", (uid,)).fetchone()["c"]
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
    uid = _me_id()
    conn = get_db()
    conn.execute("UPDATE notifications SET is_read=? WHERE id=? AND (user_id=0 OR user_id=?)", (is_read, nid, uid))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications/read-all", methods=["POST"])
def mark_all_read():
    uid = _me_id()
    conn = get_db()
    conn.execute("UPDATE notifications SET is_read=1 WHERE is_read=0 AND (user_id=0 OR user_id=?)", (uid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications/<int:nid>", methods=["DELETE"])
def delete_one(nid):
    uid = _me_id()
    conn = get_db()
    # also delete thumb/poster? keep files as they may be used elsewhere, but thumbnail could be removed if no other notification references it - keep for now
    conn.execute("DELETE FROM notifications WHERE id=? AND (user_id=0 OR user_id=?)", (nid, uid))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/notifications", methods=["DELETE"])
def delete_all():
    # clear all
    uid = _me_id()
    conn = get_db()
    conn.execute("DELETE FROM notifications WHERE (user_id=0 OR user_id=?)", (uid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


def _ask_row_dict(r):
    d = dict(r)
    if d.get("thumbnail_local"):
        d["thumbnail_local"] = versioned_web_path(d["thumbnail_local"])
    if d.get("poster_local"):
        d["poster_local"] = versioned_web_path(d["poster_local"])
    return d


@notification_bp.route("/api/asks", methods=["GET"])
def list_asks():
    """Izlendi-sor bildirimleri (kullaniciya ozel). resolved: 0=bekliyor,1=Evet,2=Hayir."""
    uid = _me_id()
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM notifications WHERE type='watched_ask' AND user_id=? ORDER BY created_at DESC",
        (uid,),
    ).fetchall()
    conn.close()
    return jsonify({"asks": [_ask_row_dict(r) for r in rows]})


@notification_bp.route("/api/asks/count", methods=["GET"])
def count_asks():
    uid = _me_id()
    conn = get_db()
    c = conn.execute(
        "SELECT COUNT(*) c FROM notifications WHERE type='watched_ask' AND user_id=? AND resolved=0",
        (uid,),
    ).fetchone()["c"]
    conn.close()
    return jsonify({"count": c})


def _ask_ts(row):
    """Ask kaydindaki izleme zamani: bildirimde gosterilen an (notifications.created_at).

    Onay tiklama anini DEGIL, sinyalin geldigi (bildirim metninde de yazan) saati
    dondurur. Eksik/bozuksa simdi'ye duser.
    """
    try:
        t = int(row["created_at"] or 0)
    except Exception:
        t = 0
    return t if t > 0 else int(time.time())


def _mark_ask_watched(row):
    """Izlendi-sor onayi: medya tipine gore watched=1 yazar. commit'li.

    watched_at her zaman ask (bildirim) zamanindan alinir; boylece "Evet"e
    gunler sonra basilsa da izleme gecmisi/siralamasi sinyal saatini gosterir.
    """
    conn = get_db()
    uid = row["user_id"]
    media = (row["media_type"] or "").lower()
    season, episode = row["season"], row["episode"]
    ts = _ask_ts(row)
    try:
        if media == "anime":
            anilist_id = row["anilist_id"]
            arow = conn.execute(
                "SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id)
            ).fetchone()
            if not arow:
                return None
            if episode is None:
                # anime filmi: satir bazli bolum yok -> yalniz yapim izlendi
                conn.execute("UPDATE anime SET in_watched=1 WHERE id=?", (arow["id"],))
            else:
                conn.execute(
                    "INSERT INTO anime_episodes (anime_id, episode, watched, watched_at) VALUES (?,?,1,?) "
                    "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=1, watched_at=excluded.watched_at",
                    (arow["id"], episode, ts),
                )
        elif media == "movie":
            # mevcut saat varsa (dogrudan isaretleme) korunur, yoksa ask zamani yazilir
            conn.execute(
                "UPDATE followed SET watched=1, in_watched=1, watched_at=COALESCE(watched_at, ?) "
                "WHERE user_id=? AND tmdb_id=? AND media_type='movie'",
                (ts, uid, row["tmdb_id"]),
            )
        else:  # tv
            frow = conn.execute(
                "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'",
                (uid, row["tmdb_id"]),
            ).fetchone()
            if frow and season is not None and episode is not None:
                conn.execute(
                    "INSERT INTO episodes (follow_id, season, episode, watched, watched_at) VALUES (?,?,?,1,?) "
                    "ON CONFLICT(follow_id, season, episode) DO UPDATE SET watched=1, watched_at=excluded.watched_at",
                    (frow["id"], season, episode, ts),
                )
        conn.commit()
        print(f"[asks] onay: watched_at=ask zamani ({ts}) media={media} s{season} e{episode}", flush=True)
        return True
    except Exception as e:
        print(f"[asks] watched yazma hata: {e}", flush=True)
        return None
    finally:
        conn.close()


@notification_bp.route("/api/asks/<int:aid>/approve", methods=["POST"])
def approve_ask(aid):
    uid = _me_id()
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM notifications WHERE id=? AND type='watched_ask' AND user_id=?", (aid, uid)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "ask bulunamadi"}), 404
    _mark_ask_watched(row)
    conn = get_db()
    conn.execute("UPDATE notifications SET resolved=1, is_read=1 WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/asks/<int:aid>/reject", methods=["POST"])
def reject_ask(aid):
    uid = _me_id()
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM notifications WHERE id=? AND type='watched_ask' AND user_id=?", (aid, uid)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "ask bulunamadi"}), 404
    conn.execute("UPDATE notifications SET resolved=2, is_read=1 WHERE id=?", (aid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})


@notification_bp.route("/api/asks", methods=["DELETE"])
def clear_asks():
    """Izlendi-sor bildirimlerini (yalniz watched_ask) temizler."""
    uid = _me_id()
    conn = get_db()
    conn.execute("DELETE FROM notifications WHERE type='watched_ask' AND user_id=?", (uid,))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True})
