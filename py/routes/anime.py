import datetime
import os

from flask import Blueprint, jsonify, request

from db import get_db
from scheduler import save_watch_snapshot, pop_watch_snapshot, can_early_watch_anime, is_final_status
from auth import get_current_user
from poster_store import download_anime_poster_with_sizes, delete_poster, delete_poster_by_web, poster_local_path, filesystem_path_from_web, ensure_thumbnail, versioned_web_path
from anilist import (
    anilist_search,
    anilist_detail,
    anilist_schedule,
    anilist_staff,
    anime_directors,
    _anime_title,
    _anime_cover,
    _anime_next_ep,
    save_anime_details,
    save_anime_directors,
    load_anime_details,
    _anime_start_year,
)
from ramcache import list_cache, bump, gen, cached_response
from recommendations import remove_rec_item

anime_bp = Blueprint("anime", __name__)


def _uid():
    try:
        u = get_current_user()
        return int(u["id"]) if u else 0
    except Exception:
        return 0


def _with_poster_local(d, arow):
    """Anime detayina lokal w500 poster yolunu (dosya gercekten varsa) ekler."""
    pl = arow["poster_local"] if arow and "poster_local" in arow.keys() else None
    if pl:
        fs = filesystem_path_from_web(pl)
        if fs and os.path.exists(fs):
            d = dict(d)
            d["poster_local"] = versioned_web_path(pl)
    return d


def _sync_anime_poster(conn, anilist_id, fresh_cover, arow):
    """AniList afişi değiştiyse ya da lokal dosya kayıpsa yeniden indirip DB'yi günceller."""
    if not fresh_cover or not arow:
        return False
    old = arow["cover_url"] if "cover_url" in arow.keys() else None
    local = arow["poster_local"] if "poster_local" in arow.keys() else None
    fs = filesystem_path_from_web(local) if local else None
    if fresh_cover == old and fs and os.path.exists(fs):
        return False
    w500, w185 = download_anime_poster_with_sizes(anilist_id, fresh_cover)
    if not w500 and not w185:
        return False
    delete_poster_by_web(poster_local_path("anime", anilist_id, "thumbnail"))
    ensure_thumbnail("anime", anilist_id, None)
    conn.execute(
        "UPDATE anime SET cover_url=?, poster_local=?, poster_local_w185=? WHERE id=?",
        (fresh_cover, w500 or local, w185, arow["id"]),
    )
    bump()
    return True


@anime_bp.route("/api/anime/search")
def anime_search():
    q = request.args.get("q", "")
    if not q:
        return jsonify([])
    items = anilist_search(q)
    results = []
    for m in items:
        ep, air_at = _anime_next_ep(m)
        results.append(
            {
                "anilist_id": m.get("id"),
                "title": _anime_title(m),
                "cover_url": _anime_cover(m),
                "format": m.get("format"),
                "status": m.get("status"),
                "episodes": m.get("episodes"),
                "next_episode": ep,
                "airing_at": air_at,
                "score": m.get("averageScore"),
                "start_date": (
                    (m.get("startDate") or {}).get("year")
                    if (m.get("startDate") or {}).get("year")
                    else None
                ),
                "genres": m.get("genres") or [],
                "studios": [s.get("name") for s in ((m.get("studios") or {}).get("nodes") or []) if s.get("name")][:3],
            }
        )
    return jsonify(results)


@anime_bp.route("/api/anime/details")
def anime_details():
    anilist_id = request.args.get("anilist_id")
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    if not anilist_id:
        return jsonify({"error": "anilist_id gereklidir"}), 400
    uid = _uid()
    conn = get_db()
    arow = conn.execute("SELECT id, poster_local, cover_url FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    if arow and not refresh:
        d = load_anime_details(conn, arow["id"])
        if d and d.get("description"):
            if not d.get("directors"):
                try:
                    _dirs = anilist_staff(anilist_id)
                except Exception:
                    _dirs = []
                if _dirs:
                    try:
                        save_anime_directors(conn, arow["id"], _dirs)
                        conn.commit()
                    except Exception:
                        pass
                    d["directors"] = _dirs
            conn.close()
            return jsonify(_with_poster_local(d, arow))
    detail = anilist_detail(anilist_id)
    if not detail:
        conn.close()
        return jsonify({"error": "AniList'ten veri alınamadı"}), 404
    if arow:
        _sync_anime_poster(conn, anilist_id, _anime_cover(detail), arow)
        save_anime_details(conn, arow["id"], detail)
        conn.commit()
        d = load_anime_details(conn, arow["id"])
        arow = conn.execute("SELECT id, poster_local FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
        conn.close()
        return jsonify(_with_poster_local(d, arow))
    conn.close()
    return jsonify(
        {
            "anilist_id": detail.get("id"),
            "title": _anime_title(detail),
            "cover_url": _anime_cover(detail),
            "banner_url": detail.get("bannerImage"),
            "description": detail.get("description"),
            "format": detail.get("format"),
            "status": detail.get("status"),
            "episodes": detail.get("episodes"),
            "duration": detail.get("duration"),
            "genres": detail.get("genres") or [],
            "score": detail.get("averageScore"),
            "start_date": _anime_start_year(detail),
            "studios": [s.get("name") for s in (detail.get("studios") or {}).get("nodes") or [] if s.get("name")],
            "characters": [
                {
                    "id": c.get("id"),
                    "name": c.get("name", {}).get("full") if c.get("name") else "",
                    "image": (c.get("image") or {}).get("large") if c.get("image") else None,
                }
                for c in (detail.get("characters") or {}).get("nodes") or []
            ],
            "directors": anime_directors(detail),
        }
    )


@anime_bp.route("/api/anime/followed")
def anime_followed():
    uid = _uid()
    # 1.83 Arsiv: ?archived=1 -> yalniz arsivliler; varsayilan -> yalniz aktifler.
    only_archived = str(request.args.get("archived") or "0") == "1"
    key = ("anime_followed", uid, gen(), datetime.datetime.now().strftime("%Y%m%d%H"), 1 if only_archived else 0)
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    arch_sql = "COALESCE(archived,0)=1" if only_archived else "COALESCE(archived,0)=0"
    rows = conn.execute(
        f"SELECT * FROM anime WHERE user_id=? AND {arch_sql} ORDER BY id DESC", (uid,)
    ).fetchall()
    result = []
    for r in rows:
        score = r["score"]
        if score is None:
            detail = anilist_detail(r["anilist_id"])
            if detail and detail.get("averageScore") is not None:
                score = detail.get("averageScore")
                conn.execute(
                    "UPDATE anime SET score=? WHERE id=?",
                    (score, r["id"]),
                )
                conn.commit()
        comp = _anime_followed_completed(conn, r["id"])
        total_eps, watched_eps = _anime_followed_counts(conn, r["id"])
        try:
            early = can_early_watch_anime(conn, r["id"])
        except Exception:
            early = False
        try:
            final = is_final_status("anime", r["status"] if "status" in r.keys() else None)
        except Exception:
            final = False
        result.append(
            {
                "id": r["id"],
                "anilist_id": r["anilist_id"],
                "title": r["title"],
                "cover_url": r["cover_url"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "episodes": r["episodes"],
                "status": r["status"],
                "score": score,
                "studios": r["studios"],
                "duration": r["duration"] if "duration" in r.keys() else None,
                "total_eps": total_eps,
                "watched_eps": watched_eps,
                "watched_min": int(watched_eps * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "unwatched_min": int((total_eps - watched_eps) * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "completed": comp,
                "can_move_watched": bool(comp or early or final),
                "in_watched": int(r["in_watched"] or 0),
                "deferred": int(r["deferred"] or 0) if "deferred" in r.keys() else 0,
                "archived": int(r["archived"] or 0) if "archived" in r.keys() else 0,
                "next_episode": _anime_followed_next(conn, r["id"]),
            }
        )
    conn.close()
    list_cache.set(key, result)
    return cached_response(result, False)


def _anime_followed_counts(conn, anime_id):
    total = conn.execute(
        "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (anime_id,)
    ).fetchone()["c"]
    watched_cnt = conn.execute(
        "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (anime_id,)
    ).fetchone()["c"]
    return total, watched_cnt


def _anime_followed_completed(conn, anime_id):
    total, watched_cnt = _anime_followed_counts(conn, anime_id)
    return total > 0 and total == watched_cnt


def _anime_followed_next(conn, anime_id):
    now = int(datetime.datetime.now().timestamp())
    row = conn.execute(
        "SELECT episode, air_at FROM anime_episodes "
        "WHERE anime_id=? AND watched=0 AND air_at IS NOT NULL AND air_at > ? "
        "ORDER BY episode LIMIT 1",
        (anime_id, now),
    ).fetchone()
    if row:
        return {"episode": row["episode"], "airing_at": row["air_at"]}
    return None


@anime_bp.route("/api/anime/follow", methods=["POST"])
def anime_follow():
    body = request.get_json()
    anilist_id = body.get("anilist_id")
    if not anilist_id:
        return jsonify({"error": "anilist_id gereklidir"}), 400
    detail = anilist_detail(anilist_id)
    if not detail:
        return jsonify({"error": "AniList'ten veri alınamadı"}), 400
    title = _anime_title(detail)
    cover = _anime_cover(detail)
    episodes = detail.get("episodes") or 0
    status = detail.get("status")
    score = detail.get("averageScore")
    studios = [s.get("name") for s in (detail.get("studios") or {}).get("nodes") or [] if s.get("name")]
    studio = studios[0] if studios else None
    uid = _uid()
    conn = get_db()
    conn.execute(
        "INSERT INTO anime (user_id, anilist_id, title, cover_url, episodes, status, score, studios) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, anilist_id) DO UPDATE SET "
        "title=excluded.title, cover_url=excluded.cover_url, "
        "episodes=excluded.episodes, status=excluded.status, score=excluded.score, studios=excluded.studios",
        (uid, anilist_id, title, cover, episodes, status, score, studio),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    anime_db_id = row["id"]

    save_anime_details(conn, anime_db_id, detail)
    conn.commit()

    # Poster lokal indirme w500+w185 (bir kez) - ayri kolonlar
    try:
        if cover:
            w500, w185 = download_anime_poster_with_sizes(anilist_id, cover)
            if w500 or w185:
                conn.execute("UPDATE anime SET poster_local=?, poster_local_w185=? WHERE id=?", (w500, w185, anime_db_id))
                conn.commit()
    except Exception:
        pass

    schedule = anilist_schedule(anilist_id)
    if schedule and schedule.get("airingSchedule"):
        for node in schedule["airingSchedule"].get("nodes") or []:
            conn.execute(
                "INSERT INTO anime_episodes (anime_id, episode, air_at) "
                "VALUES (?, ?, ?) "
                "ON CONFLICT(anime_id, episode) DO UPDATE SET air_at=excluded.air_at",
                (anime_db_id, node.get("episode"), node.get("airingAt")),
            )
        conn.commit()
    conn.close()
    try:
        remove_rec_item("anime", int(anilist_id))
    except Exception:
        pass
    bump()
    return jsonify({"ok": True})


@anime_bp.route("/api/anime/unfollow/<int:anime_id>", methods=["DELETE"])
def anime_unfollow(anime_id):
    uid = _uid()
    conn = get_db()
    row = conn.execute("SELECT poster_local, poster_local_w185, anilist_id FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Anime bulunamadı"}), 404
    anilist_id = row["anilist_id"] if row else None
    conn.execute("DELETE FROM anime_cast WHERE anime_id=?", (anime_id,))
    conn.execute("DELETE FROM anime_episodes WHERE anime_id=?", (anime_id,))
    conn.execute("DELETE FROM anime WHERE id=?", (anime_id,))
    conn.commit()
    conn.close()
    if anilist_id:
        try:
            delete_poster("anime", anilist_id)
        except Exception:
            pass
    for p in (row["poster_local"] if row and "poster_local" in row.keys() else None, row["poster_local_w185"] if row and "poster_local_w185" in row.keys() else None):
        if p:
            delete_poster_by_web(p)
    bump()
    return jsonify({"ok": True})


@anime_bp.route("/api/anime/schedule")
def anime_schedule():
    anime_id = request.args.get("anime_id")
    if not anime_id:
        return jsonify({"error": "anime_id gereklidir"}), 400
    uid = _uid()
    conn = get_db()
    arow = conn.execute("SELECT * FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not arow:
        return jsonify({"error": "Anime bulunamadı"}), 404
    rows = conn.execute(
        "SELECT episode, air_at, watched, notified, watched_at, source FROM anime_episodes "
        "WHERE anime_id=? ORDER BY episode",
        (anime_id,),
    ).fetchall()
    conn.close()
    return jsonify(
        {
            "title": arow["title"],
            "anilist_id": arow["anilist_id"],
            "duration": arow["duration"] if "duration" in arow.keys() else None,
            "items": [
                {
                    "episode": r["episode"],
                    "airing_at": r["air_at"],
                    "watched": r["watched"],
                    "notified": r["notified"],
                    "watched_at": r["watched_at"] if "watched_at" in r.keys() else None,
                    "source": r["source"] if "source" in r.keys() else None,
                }
                for r in rows
            ],
        }
    )


@anime_bp.route("/api/anime/episode/watch", methods=["POST"])
def anime_episode_watch():
    body = request.get_json()
    anime_id = body.get("anime_id")
    episode = body.get("episode")
    watched = 1 if body.get("watched") else 0
    if not anime_id or episode is None:
        return jsonify({"error": "Eksik bilgi"}), 400

    uid = _uid()
    conn = get_db()
    owner = conn.execute("SELECT id FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "Anime bulunamadı"}), 404
    conn.execute(
        "INSERT INTO anime_episodes (anime_id, episode, watched, watched_at, source) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=excluded.watched, watched_at=excluded.watched_at, source=excluded.source",
        (anime_id, episode, watched,
         int(datetime.datetime.now(datetime.timezone.utc).timestamp()) if watched else None,
         "other" if watched else None),
    )
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "watched": watched})


@anime_bp.route("/api/anime/move-watched", methods=["POST"])
def anime_move_watched():
    body = request.get_json()
    anime_id = body.get("anime_id")
    watched = 1 if body.get("watched") else 0
    if not anime_id:
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    row = conn.execute("SELECT id, status FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Anime bulunamadı"}), 400
    try:
        st = row["status"] if "status" in row.keys() else None
        final = is_final_status("anime", st)
    except Exception:
        final = False
    if watched and not final and not _anime_followed_completed(conn, anime_id):
        try:
            early = can_early_watch_anime(conn, anime_id)
        except Exception:
            early = False
        if not early:
            conn.close()
            return jsonify({"error": "Anime henüz tamamlanmadı"}), 400
    now_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    if watched:
        # Tüm bölümleri otomatik izlenmiş yap; önceden izlenmemiş olanları snapshot'a yaz.
        try:
            rows = conn.execute(
                "SELECT episode FROM anime_episodes WHERE anime_id=? AND watched=0",
                (anime_id,),
            ).fetchall()
            auto = [r["episode"] for r in rows]
        except Exception:
            auto = []
        if auto:
            conn.execute(
                "UPDATE anime_episodes SET watched=1, source=COALESCE(source, 'other') WHERE anime_id=? AND watched=0",
                (anime_id,),
            )
            save_watch_snapshot(conn, uid, "anime", anime_id, auto)
            conn.execute(
                "INSERT INTO watch_marks (user_id, kind, ref_id, season, marked_at) VALUES (?,?,?,?,?)",
                (uid, "anime", anime_id, None, now_ts),
            )
    else:
        # Geri taşıma: yalnız otomatik işaretlenen bölümleri izlenmemişe çevir.
        try:
            snap = pop_watch_snapshot(conn, uid, "anime", anime_id)
        except Exception:
            snap = None
        if snap:
            try:
                for e in snap:
                    conn.execute(
                        "UPDATE anime_episodes SET watched=0, watched_at=NULL, source=NULL WHERE anime_id=? AND episode=?",
                        (anime_id, e),
                    )
            except Exception:
                pass
        conn.execute(
            "DELETE FROM watch_marks WHERE user_id=? AND kind='anime' AND ref_id=?",
            (uid, anime_id),
        )
    conn.execute("UPDATE anime SET in_watched=? WHERE id=?", (watched, anime_id))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "watched": watched})


@anime_bp.route("/api/anime/defer", methods=["POST"])
def anime_defer():
    """Daha-sonra-izle durumu: kartı listenin en altına indirir (sort'tan muaf)."""
    body = request.get_json(silent=True) or {}
    anime_id = body.get("anime_id")
    deferred = 1 if body.get("deferred") else 0
    if not anime_id:
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    row = conn.execute("SELECT id FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Anime bulunamadı"}), 400
    conn.execute("UPDATE anime SET deferred=? WHERE id=?", (deferred, anime_id))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "deferred": deferred})


@anime_bp.route("/api/anime/archive", methods=["POST"])
def anime_archive():
    """Arsiv durumu (1.83): anime icin arsive al / arsivden cikar."""
    body = request.get_json(silent=True) or {}
    anime_id = body.get("anime_id")
    archived = 1 if body.get("archived") else 0
    if not anime_id:
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    row = conn.execute("SELECT id FROM anime WHERE id=? AND user_id=?", (anime_id, uid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Anime bulunamadi"}), 400
    conn.execute("UPDATE anime SET archived=? WHERE id=?", (archived, anime_id))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "archived": archived})