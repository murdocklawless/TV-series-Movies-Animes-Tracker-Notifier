import json

from flask import Blueprint, jsonify, request

from db import get_db
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
from tmdb import get_tmdb_info, get_tmdb_cast, save_details, tmdb_request
from anilist import anilist_detail, _anime_title, _anime_cover, save_anime_details, anilist_schedule
from scheduler import sync_episodes
from poster_store import download_tmdb_poster_with_sizes

recommendations_bp = Blueprint("recommendations", __name__)

_MEDIA_KINDS = {
    "all": ["shows", "movies", "anime"],
    "dizi": ["shows"],
    "film": ["movies"],
    "anime": ["anime"],
}

_HIDDEN_MEDIA = {
    "dizi": "shows",
    "film": "movies",
    "shows": "shows",
    "movies": "movies",
    "anime": "anime",
    "tv": "shows",
    "movie": "movies",
}


@recommendations_bp.route("/api/recommendations")
def recommendations():
    media = request.args.get("media", "all")
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    kinds = _MEDIA_KINDS.get(media)
    if kinds is None:
        return jsonify({"error": "Geçersiz media parametresi"}), 400

    # Doldurma modu: kart kaldirilinca eksik slotu doldurur ve kalici payload'i guncel tutar.
    limit_raw = request.args.get("limit", "")
    if limit_raw:
        try:
            limit = min(int(limit_raw), 18)
        except (TypeError, ValueError):
            return jsonify({"error": "Geçersiz limit"}), 400
        exclude = [int(x) for x in (request.args.get("exclude") or "").split(",") if x.strip().isdigit()]
        conn = get_db()
        try:
            payload = {}
            for kind in kinds:
                items = generate_fill(conn, kind, exclude, limit)
                append_to_rec_section(kind, items, section_fingerprint(conn, kind))
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
            items = None if refresh else load_rec_section(conn, kind)
            if items is not None:
                payload[kind] = items
                continue
            items = generate_recommendations(conn, kind)
            save_rec_section(kind, items, section_fingerprint(conn, kind))
            payload[kind] = items
            any_miss = True
    finally:
        conn.close()
    return cached_response(payload, not any_miss)


@recommendations_bp.route("/api/recommendations/hide", methods=["POST"])
def rec_hide():
    """'Bir daha gösterme': öneriyi kalıcı olarak gizler + payload'dan cerrahi
    çıkarır. Body: {tmdb_id+media_type} veya {anilist_id} (+title, poster_path)."""
    body = request.get_json(silent=True) or {}
    if body.get("anilist_id"):
        kind, ident = "anime", body.get("anilist_id")
    else:
        media_type = body.get("media_type")
        tmdb_id = body.get("tmdb_id")
        if media_type not in ("movie", "tv") or not tmdb_id:
            return jsonify({"error": "Eksik bilgi"}), 400
        kind = "shows" if media_type == "tv" else "movies"
        ident = tmdb_id
    if not hide_rec_item(kind, ident, body.get("title") or "", body.get("poster_path")):
        return jsonify({"error": "Geçersiz bilgi"}), 400
    remove_rec_item(kind, ident)
    return jsonify({"ok": True})


@recommendations_bp.route("/api/recommendations/hidden")
def rec_hidden():
    """Bir bölümün gizlenenlerini listeler (ts azalan)."""
    kind = _HIDDEN_MEDIA.get(request.args.get("media", ""))
    if not kind:
        return jsonify({"error": "Geçersiz media parametresi"}), 400
    return jsonify({"items": list_rec_hidden(kind)})


@recommendations_bp.route("/api/recommendations/unhide", methods=["POST"])
def rec_unhide():
    """Gizlemeyi kaldırır; öğe sonraki üretimde yeniden aday olur."""
    body = request.get_json(silent=True) or {}
    ident = body.get("id") or body.get("tmdb_id") or body.get("anilist_id")
    kind = _HIDDEN_MEDIA.get(body.get("kind") or body.get("media_type") or "")
    if not kind or ident is None:
        return jsonify({"error": "Eksik bilgi"}), 400
    if not unhide_rec_item(kind, ident):
        return jsonify({"error": "Kayıt bulunamadı"}), 404
    return jsonify({"ok": True})


@recommendations_bp.route("/api/recommendations/move-watched", methods=["POST"])
def rec_move_watched():
    """Öneri kartindaki 'İzlenmişlere taşı': yapimi takip eder (yoksa) ve tüm
    bilinen bolumlerini izlenmis isaretleyip in_watched=1 yapar."""
    body = request.get_json(silent=True) or {}
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
                "INSERT INTO anime (anilist_id, title, cover_url, episodes, status, score, studios) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(anilist_id) DO UPDATE SET "
                "title=excluded.title, cover_url=excluded.cover_url, episodes=excluded.episodes, "
                "status=excluded.status, score=excluded.score, studios=excluded.studios",
                (anilist_id, title, cover, episodes, status, score, studio),
            )
            conn.commit()
            row = conn.execute("SELECT id FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
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
            conn.execute("UPDATE anime_episodes SET watched=1 WHERE anime_id=?", (anime_db_id,))
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
                "SELECT id FROM followed WHERE tmdb_id=? AND media_type=?", (tmdb_id, media_type)
            ).fetchone()
            follow_id = existing["id"] if existing else None
            if follow_id is None:
                conn.execute(
                    "INSERT INTO followed (tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (tmdb_id, media_type, title, poster_path, release_date, vote_average, json.dumps(networks)),
                )
                follow_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                if info:
                    save_details(conn, follow_id, info, get_tmdb_cast(media_type, tmdb_id))
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
                conn.execute("UPDATE followed SET watched=1, in_watched=1 WHERE id=?", (follow_id,))
            else:
                conn.execute("UPDATE episodes SET watched=1 WHERE follow_id=?", (follow_id,))
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
            remove_rec_item(rec_kind, int(ident))
    except Exception:
        pass
    bump()
    return jsonify({"ok": True})