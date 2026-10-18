import json

from flask import Blueprint, jsonify, request

from db import get_db
from auth import get_current_user
from ramcache import cached_response, bump
from recommendations import (
    generate_recommendations,
    generate_fill,
    section_fingerprint,
    load_rec_section,
    save_rec_section,
    append_to_rec_section,
    remove_rec_item,
    hide_rec_item,
    unhide_rec_item,
    list_rec_hidden,
)
from tmdb import get_tmdb_info, get_tmdb_cast, get_tmdb_credits, save_details, tmdb_request
from anilist import anilist_detail, _anime_title, _anime_cover, save_anime_details, anilist_schedule
from scheduler import sync_episodes, save_watch_snapshot
from poster_store import download_tmdb_poster_with_sizes
from feed import generate_feed, feed_last_run, feed_next_run, FEED_SOURCES

recommendations_bp = Blueprint("recommendations", __name__)

_MEDIA_KINDS = {
    "all": ["shows", "movies", "docs", "anime"],
    "dizi": ["shows"],
    "film": ["movies"],
    "belgesel": ["docs"],
    "anime": ["anime"],
}

_HIDDEN_MEDIA = {
    "dizi": "shows",
    "film": "movies",
    "belgesel": "docs",
    "shows": "shows",
    "movies": "movies",
    "docs": "docs",
    "anime": "anime",
    "tv": "shows",
    "movie": "movies",
}


def _uid():
    try:
        from flask import has_request_context
        if has_request_context():
            u = get_current_user()
            return int(u["id"]) if u else 0
    except Exception:
        pass
    return 0


@recommendations_bp.route("/api/recommendations")
def recommendations():
    media = request.args.get("media", "all")
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    kinds = _MEDIA_KINDS.get(media)
    if kinds is None:
        return jsonify({"error": "Geçersiz media parametresi"}), 400

    # Doldurma modu: kart kaldirilinca eksik slotu doldurur ve kalici payload'i guncel tutar.
    limit_raw = request.args.get("limit", "")
    uid = _uid()
    if limit_raw:
        try:
            limit = min(int(limit_raw), 12)
        except (TypeError, ValueError):
            return jsonify({"error": "Geçersiz limit"}), 400
        exclude = [int(x) for x in (request.args.get("exclude") or "").split(",") if x.strip().isdigit()]
        conn = get_db()
        try:
            payload = {}
            for kind in kinds:
                items = generate_fill(conn, kind, exclude, limit, user_id=uid)
                append_to_rec_section(kind, items, section_fingerprint(conn, kind, user_id=uid), user_id=uid)
                payload[kind] = items
        finally:
            conn.close()
        return cached_response(payload, False)

    # Normal akis: RAM sözlüğü -> rec_cache -> üretim. refresh=1 üretimi zorlar.
    conn = get_db()
    any_miss = False
    try:
        payload = {}
        for kind in kinds:
            items = None if refresh else load_rec_section(conn, kind, user_id=uid)
            if items is not None:
                payload[kind] = items
                continue
            items = generate_recommendations(conn, kind, user_id=uid)
            save_rec_section(kind, items, section_fingerprint(conn, kind, user_id=uid), user_id=uid)
            payload[kind] = items
            any_miss = True
    finally:
        conn.close()
    return cached_response(payload, not any_miss)


@recommendations_bp.route("/api/recommendations/feed")
def recommendations_feed():
    """Secilen medya + kaynak icin 18 kartlik besleme (takipte/izlenmis ve
    gizlenenler dislanir). media=dizi|film|belgesel|anime, source=FEED_SOURCES."""
    media = (request.args.get("media") or "dizi").strip()
    source = (request.args.get("source") or "trend").strip()
    if media not in _MEDIA_KINDS or media == "all":
        return jsonify({"error": "Gecersiz media parametresi"}), 400
    if source not in FEED_SOURCES:
        return jsonify({"error": "Gecersiz source parametresi"}), 400
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    conn = get_db()
    try:
        items = generate_feed(conn, media, source, user_id=_uid(), force=refresh)
    finally:
        conn.close()
    return jsonify({
        "media": media,
        "source": source,
        "items": items,
        "updated_at": feed_last_run(source),
        "next_update": feed_next_run(source),
    })


@recommendations_bp.route("/api/recommendations/hide", methods=["POST"])
def rec_hide():
    """'Bir daha gösterme': öneriyi kalıcı olarak gizler + payload'dan cerrahi
    çıkarır. Body: {tmdb_id+media_type} veya {anilist_id} (+title, poster_path,
    vote_average/score, release_date, networks, studios, tv_status)."""
    body = request.get_json(silent=True) or {}
    kind, ident = None, None
    kind_hint = body.get("kind")
    if kind_hint in ("shows", "movies", "docs") and body.get("tmdb_id"):
        kind, ident = kind_hint, body.get("tmdb_id")
    elif kind_hint == "anime" and body.get("anilist_id"):
        kind, ident = "anime", body.get("anilist_id")
    elif body.get("anilist_id"):
        kind, ident = "anime", body.get("anilist_id")
    else:
        media_type = body.get("media_type")
        tmdb_id = body.get("tmdb_id")
        if media_type not in ("movie", "tv") or not tmdb_id:
            return jsonify({"error": "Eksik bilgi"}), 400
        kind = "shows" if media_type == "tv" else "movies"
        ident = tmdb_id
    score = body.get("vote_average", body.get("score"))
    try:
        score = float(score) if score is not None else None
    except (TypeError, ValueError):
        score = None
    extra = {
        "score": score,
        "release_date": body.get("release_date") or "",
        "networks": body.get("networks") or [],
        "studios": body.get("studios") or [],
        "media_type": body.get("media_type") or "",
        "tv_status": body.get("tv_status") or "",
    }
    if not hide_rec_item(kind, ident, body.get("title") or "", body.get("poster_path"), user_id=_uid(), extra=extra):
        return jsonify({"error": "Geçersiz bilgi"}), 400
    remove_rec_item(kind, ident, user_id=_uid())
    return jsonify({"ok": True})


@recommendations_bp.route("/api/recommendations/hidden")
def rec_hidden():
    """Bir bölümün gizlenenlerini listeler (ts azalan)."""
    kind = _HIDDEN_MEDIA.get(request.args.get("media", ""))
    if not kind:
        return jsonify({"error": "Geçersiz media parametresi"}), 400
    return jsonify({"items": list_rec_hidden(kind, user_id=_uid())})


@recommendations_bp.route("/api/recommendations/unhide", methods=["POST"])
def rec_unhide():
    """Gizlemeyi kaldırır; öğe sonraki üretimde yeniden aday olur."""
    body = request.get_json(silent=True) or {}
    ident = body.get("id") or body.get("tmdb_id") or body.get("anilist_id")
    kind = _HIDDEN_MEDIA.get(body.get("kind") or body.get("media_type") or "")
    if not kind or ident is None:
        return jsonify({"error": "Eksik bilgi"}), 400
    if not unhide_rec_item(kind, ident, user_id=_uid()):
        return jsonify({"error": "Kayıt bulunamadı"}), 404
    return jsonify({"ok": True})


@recommendations_bp.route("/api/recommendations/move-watched", methods=["POST"])
def rec_move_watched():
    """Öneri kartindaki 'İzlenmişlere taşı': yapimi takip eder (yoksa) ve tüm
    bilinen bolumlerini izlenmis isaretleyip in_watched=1 yapar."""
    body = request.get_json(silent=True) or {}
    uid = _uid()
    conn = get_db()
    try:
        if body.get("anilist_id"):
            anilist_id = body.get("anilist_id")
            detail = anilist_detail(anilist_id)
            if not detail:
                return jsonify({"error": "AniList'ten veri alınamadı"}), 404
            title = _anime_title(detail)
            cover = _anime_cover(detail)
            episodes = detail.get("episodes") or 0
            status = detail.get("status")
            score = detail.get("averageScore")
            studios = [s.get("name") for s in (detail.get("studios") or {}).get("nodes") or [] if s.get("name")]
            studio = studios[0] if studios else None
            conn.execute(
                "INSERT INTO anime (user_id, anilist_id, title, cover_url, episodes, status, score, studios) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, anilist_id) DO UPDATE SET "
                "title=excluded.title, cover_url=excluded.cover_url, episodes=excluded.episodes, "
                "status=excluded.status, score=excluded.score, studios=excluded.studios",
                (uid, anilist_id, title, cover, episodes, status, score, studio),
            )
            conn.commit()
            row = conn.execute("SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
            anime_db_id = row["id"]
            save_anime_details(conn, anime_db_id, detail)
            schedule = anilist_schedule(anilist_id)
            if schedule and schedule.get("airingSchedule"):
                for node in schedule["airingSchedule"].get("nodes") or []:
                    conn.execute(
                        "INSERT INTO anime_episodes (anime_id, episode, air_at) VALUES (?, ?, ?) "
                        "ON CONFLICT(anime_id, episode) DO UPDATE SET air_at=excluded.air_at",
                        (anime_db_id, node.get("episode"), node.get("airingAt")),
                    )
            try:
                _arows = conn.execute(
                    "SELECT episode FROM anime_episodes WHERE anime_id=? AND watched=0", (anime_db_id,)
                ).fetchall()
                _auto = [r["episode"] for r in _arows]
            except Exception:
                _auto = []
            if _auto:
                save_watch_snapshot(conn, uid, "anime", anime_db_id, _auto)
                import time as _t
                conn.execute(
                    "INSERT INTO watch_marks (user_id, kind, ref_id, season, marked_at) VALUES (?,?,?,?,?)",
                    (uid, "anime", anime_db_id, None, int(_t.time())),
                )
            conn.execute("UPDATE anime_episodes SET watched=1, source=COALESCE(source, 'other') WHERE anime_id=?", (anime_db_id,))
            conn.execute("UPDATE anime SET in_watched=1 WHERE id=?", (anime_db_id,))
        else:
            media_type = body.get("media_type")
            tmdb_id = body.get("tmdb_id")
            if media_type not in ("movie", "tv") or not tmdb_id:
                return jsonify({"error": "Eksik bilgi"}), 400
            title = body.get("title") or ""
            poster_path = body.get("poster_path")
            info = get_tmdb_info(media_type, tmdb_id)
            release_date = body.get("release_date") or (info or {}).get("release_date")
            vote_average = body.get("vote_average")
            if vote_average is None:
                vote_average = (info or {}).get("vote_average") or 0
            networks = (info or {}).get("networks") or []
            existing = conn.execute(
                "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?", (uid, tmdb_id, media_type)
            ).fetchone()
            follow_id = existing["id"] if existing else None
            if follow_id is None:
                conn.execute(
                    "INSERT INTO followed (user_id, tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (uid, tmdb_id, media_type, title, poster_path, release_date, vote_average, json.dumps(networks)),
                )
                follow_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                if info:
                    _credits = get_tmdb_credits(media_type, tmdb_id)
                    save_details(conn, follow_id, info, _credits.get("cast") or [], directors=_credits.get("directors") or [])
                try:
                    pp = poster_path
                    if not pp:
                        _d = tmdb_request(f"/{media_type}/{tmdb_id}")
                        pp = (_d or {}).get("poster_path")
                        if pp:
                            conn.execute("UPDATE followed SET poster_path=? WHERE id=?", (pp, follow_id))
                    if pp:
                        w500, w185 = download_tmdb_poster_with_sizes(media_type, tmdb_id, pp)
                        if w500:
                            conn.execute(
                                "UPDATE followed SET poster_local=?, poster_local_w185=? WHERE id=?",
                                (w500, w185, follow_id),
                            )
                        elif w185:
                            conn.execute("UPDATE followed SET poster_local_w185=? WHERE id=?", (w185, follow_id))
                except Exception:
                    pass
                if media_type == "tv":
                    nf = conn.execute("SELECT * FROM followed WHERE id=?", (follow_id,)).fetchone()
                    sync_episodes(conn, nf)
            if media_type == "movie":
                _f = conn.execute("SELECT watched FROM followed WHERE id=?", (follow_id,)).fetchone()
                _fw = int(_f["watched"] or 0) if _f else 0
                if _fw != 1:
                    save_watch_snapshot(conn, uid, "movie", follow_id, ["1"])
                conn.execute("UPDATE followed SET watched=1, in_watched=1, watched_source=COALESCE(watched_source, 'other') WHERE id=?", (follow_id,))
            else:
                import time as _t
                try:
                    _trows = conn.execute(
                        "SELECT season, episode FROM episodes WHERE follow_id=? AND watched=0", (follow_id,)
                    ).fetchall()
                    _tauto = [[r["season"], r["episode"]] for r in _trows]
                except Exception:
                    _tauto = []
                if _tauto:
                    save_watch_snapshot(conn, uid, "tv", follow_id, _tauto)
                    _now = int(_t.time())
                    for sn in sorted({int(s) for s, _e in _tauto if s is not None}):
                        conn.execute(
                            "INSERT INTO watch_marks (user_id, kind, ref_id, season, marked_at) VALUES (?,?,?,?,?)",
                            (uid, "tv", follow_id, sn, _now),
                        )
                conn.execute("UPDATE episodes SET watched=1, source=COALESCE(source, 'other') WHERE follow_id=? AND watched=0", (follow_id,))
                conn.execute("UPDATE followed SET in_watched=1 WHERE id=?", (follow_id,))
        if body.get("anilist_id"):
            rec_kind, ident = "anime", body.get("anilist_id")
        else:
            rec_kind = "shows" if media_type == "tv" else "movies"
            ident = tmdb_id
        conn.commit()
    finally:
        conn.close()
    try:
        if ident:
            remove_rec_item(rec_kind, int(ident), user_id=uid)
    except Exception:
        pass
    bump()
    return jsonify({"ok": True})