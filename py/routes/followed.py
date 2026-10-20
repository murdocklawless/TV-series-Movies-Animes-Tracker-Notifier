import json
import datetime
import os

from flask import Blueprint, jsonify, request

from db import get_db, today_str, _safe_json_list
from auth import get_current_user
from tmdb import get_tmdb_info, get_tmdb_cast, get_tmdb_credits, get_tmdb_directors, save_details, save_directors, load_details, tmdb_request, get_tmdb_info_fallback, get_tmdb_title_fallback
from tvmaze import _tvmaze_episode_times
from scheduler import sync_episodes, save_watch_snapshot, pop_watch_snapshot, can_early_watch_tv, can_early_watch_movie, can_early_watch_anime, is_final_status
from poster_store import download_tmdb_poster_with_sizes, delete_poster_by_web, poster_local_path, delete_poster, filesystem_path_from_web, ensure_thumbnail, versioned_web_path
from ramcache import list_cache, bump, gen, cached_response
from recommendations import remove_rec_item

followed_bp = Blueprint("followed", __name__)


def _uid():
    """Oturumdaki kullanici id'si (Faz 32 izolasyon). Yoksa 0."""
    try:
        u = get_current_user()
        return int(u["id"]) if u else 0
    except Exception:
        return 0


def _tv_air_stats(conn, follow_id):
    """TV öğesi için son yayın tarihi + bölüm aralığı medyanı (gün).
    'Yeni bölüm' vs 'Yeni sezon' etiketi ayrımı için kullanılır."""
    last_air_date = None
    ep_gap_days = None
    try:
        rows = conn.execute(
            "SELECT air_date FROM episodes WHERE follow_id=? AND air_date IS NOT NULL ORDER BY air_date",
            (follow_id,),
        ).fetchall()
        dates = [r["air_date"] for r in rows]
        if dates:
            last_air_date = dates[-1]
            gaps = []
            for i in range(1, len(dates)):
                try:
                    d1 = datetime.date.fromisoformat(dates[i - 1])
                    d2 = datetime.date.fromisoformat(dates[i])
                    gaps.append((d2 - d1).days)
                except (ValueError, TypeError):
                    pass
            if gaps:
                gaps.sort()
                ep_gap_days = gaps[len(gaps) // 2]
    except Exception:
        pass
    return last_air_date, ep_gap_days


@followed_bp.route("/api/follow", methods=["POST"])
def follow():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    media_type = body.get("media_type")
    title = body.get("title")
    poster_path = body.get("poster_path")
    vote_average = body.get("vote_average")

    if not all([tmdb_id, media_type, title]):
        return jsonify({"error": "Eksik bilgi"}), 400

    info = get_tmdb_info(media_type, tmdb_id)
    release_date = body.get("release_date") or (info or {}).get("release_date")
    if vote_average is None:
        vote_average = (info or {}).get("vote_average") or 0
    networks = (info or {}).get("networks") or []

    conn = get_db()
    uid = _uid()
    existing = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "Zaten takipte"}), 400

    conn.execute(
        "INSERT INTO followed (user_id, tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (uid, tmdb_id, media_type, title, poster_path, release_date, vote_average, json.dumps(networks)),
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()

    if info:
        _credits = get_tmdb_credits(media_type, tmdb_id)
        save_details(conn, new_id, info, _credits.get("cast") or [], directors=_credits.get("directors") or [])
        conn.commit()

    # Poster lokal indirme (w500, bir kez) - ayri kolon poster_local
    try:
        pp = poster_path
        if not pp:
            # info poster_path dondurmez, dogrudan TMDB detayi dene
            try:
                _d = tmdb_request(f"/{media_type}/{tmdb_id}")
                pp = (_d or {}).get("poster_path")
                if pp:
                    conn.execute("UPDATE followed SET poster_path=? WHERE id=?", (pp, new_id))
                    conn.commit()
            except Exception:
                pp = None
        if pp:
            w500, w185 = download_tmdb_poster_with_sizes(media_type, tmdb_id, pp)
            if w500:
                conn.execute("UPDATE followed SET poster_local=?, poster_local_w185=? WHERE id=?", (w500, w185, new_id))
                conn.commit()
            elif w185:
                conn.execute("UPDATE followed SET poster_local_w185=? WHERE id=?", (w185, new_id))
                conn.commit()
    except Exception:
        pass

    if media_type == "tv":
        new_follow = conn.execute(
            "SELECT * FROM followed WHERE id=?", (new_id,)
        ).fetchone()
        sync_episodes(conn, new_follow)

    conn.close()
    try:
        remove_rec_item("shows" if media_type == "tv" else "movies", int(tmdb_id))
    except Exception:
        pass
    bump()
    return jsonify({"ok": True})


@followed_bp.route("/api/followed")
def followed():
    uid = _uid()
    # 1.83 Arsiv: ?archived=1 -> yalniz arsivliler; varsayilan -> yalniz aktifler.
    only_archived = str(request.args.get("archived") or "0") == "1"
    key = ("followed", uid, gen(), today_str(), 1 if only_archived else 0)
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    items = build_followed_items(conn, uid, only_archived)
    conn.close()
    list_cache.set(key, items)
    return cached_response(items, False)


def build_followed_items(conn, uid, archived=False):
    """followed satirlarini kartlarin bekledigi alanlarla dondurur.
    archived: False=yalniz aktif, True=yalniz arsivli, None=hepsi.
    /api/followed ve /api/local-search (2.19.8) ayni uretimi paylasir."""
    if archived is None:
        arch_sql = "1=1"
    else:
        arch_sql = "COALESCE(archived,0)=1" if archived else "COALESCE(archived,0)=0"
    rows = conn.execute(
        f"SELECT * FROM followed WHERE user_id=? AND {arch_sql} ORDER BY id DESC", (uid,)
    ).fetchall()
    today = today_str()
    items = []
    for r in rows:
        item = dict(r)
        try:
            item["networks"] = json.loads(item.get("networks")) if item.get("networks") else []
        except (ValueError, TypeError):
            item["networks"] = []
        try:
            item["genres"] = _safe_json_list(item.get("genres")) if item.get("genres") else []
        except (ValueError, TypeError):
            item["genres"] = []
        # film için watched, dizi için completed
        item["watched"] = int(item.get("watched") or 0)
        item["deferred"] = int(item.get("deferred") or 0)
        item["archived"] = int(item.get("archived") or 0)
        if item.get("poster_local"):
            item["poster_local"] = versioned_web_path(item["poster_local"])
        if item.get("poster_local_w185"):
            item["poster_local_w185"] = versioned_web_path(item["poster_local_w185"])
        if item["media_type"] == "tv":
            nxt = conn.execute(
                "SELECT season, episode, air_date FROM episodes "
                "WHERE follow_id=? AND air_date IS NOT NULL AND air_date>=? "
                "ORDER BY air_date ASC, episode ASC LIMIT 1",
                (item["id"], today),
            ).fetchone()
            if nxt:
                item["next_episode"] = {
                    "season": nxt["season"],
                    "episode": nxt["episode"],
                    "air_date": nxt["air_date"],
                }
            # tüm bölümler izlendi mi? + bölüm toplamları (özet için)
            try:
                total = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (item["id"],)).fetchone()["c"]
                watched_cnt = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (item["id"],)).fetchone()["c"]
                item["completed"] = bool(total > 0 and total == watched_cnt)
                item["total_eps"] = total
                item["watched_eps"] = watched_cnt
                show_rt = item.get("runtime")
                mrow = conn.execute(
                    "SELECT "
                    "COALESCE(SUM(CASE WHEN watched=1 THEN COALESCE(runtime, ?) END),0) AS wmin, "
                    "COALESCE(SUM(CASE WHEN watched=0 THEN COALESCE(runtime, ?) END),0) AS umin "
                    "FROM episodes WHERE follow_id=?",
                    (show_rt, show_rt, item["id"]),
                ).fetchone()
                item["watched_min"] = int(mrow["wmin"] or 0)
                item["unwatched_min"] = int(mrow["umin"] or 0)
            except Exception:
                item["completed"] = False
                item["total_eps"] = 0
                item["watched_eps"] = 0
                item["watched_min"] = 0
                item["unwatched_min"] = 0
            try:
                early = can_early_watch_tv(conn, item["id"])
            except Exception:
                early = False
            try:
                final = is_final_status("tv", item.get("status"))
            except Exception:
                final = False
            item["can_move_watched"] = bool(item.get("completed") or early or final)
            try:
                _last_air, _gap = _tv_air_stats(conn, item["id"])
                item["last_air_date"] = _last_air
                item["ep_gap_days"] = _gap
            except Exception:
                item["last_air_date"] = None
                item["ep_gap_days"] = None
        if item["media_type"] == "movie":
            item["total_eps"] = 1
            item["watched_eps"] = int(item.get("watched") or 0)
            if item.get("watched"):
                item["watched_min"] = int(item.get("runtime") or 0)
                item["unwatched_min"] = 0
            else:
                item["watched_min"] = 0
                item["unwatched_min"] = int(item.get("runtime") or 0)
            try:
                early = can_early_watch_movie(item.get("release_date"))
            except Exception:
                early = False
            try:
                final = is_final_status("movie", item.get("status"))
            except Exception:
                final = False
            item["can_move_watched"] = bool(item.get("watched") == 1 or early or final)
        items.append(item)
    return items


@followed_bp.route("/api/unwatched")
def unwatched():
    """Yayına girmiş ve izlenmemiş bölümleri olan dizi ve animeleri döndürür."""
    uid = _uid()
    key = ("unwatched", uid, gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    today = today_str()
    now = int(datetime.datetime.now().timestamp())

    shows = []
    for r in conn.execute("SELECT * FROM followed WHERE user_id=? AND media_type='tv' AND COALESCE(archived,0)=0", (uid,)).fetchall():
        rows = conn.execute(
            "SELECT season, episode, air_date, name FROM episodes "
            "WHERE follow_id=? AND air_date IS NOT NULL AND air_date<=? AND watched=0 "
            "ORDER BY air_date ASC, episode ASC",
            (r["id"], today),
        ).fetchall()
        if not rows:
            continue
        items = [
            {
                "season": x["season"],
                "episode": x["episode"],
                "episode_name": x["name"] or "",
                "air_date": x["air_date"],
            }
            for x in rows
        ]
        try:
            nxt = conn.execute(
                "SELECT season, episode, air_date FROM episodes "
                "WHERE follow_id=? AND air_date IS NOT NULL AND air_date>=? "
                "ORDER BY air_date ASC, episode ASC LIMIT 1",
                (r["id"], today),
            ).fetchone()
        except Exception:
            nxt = None
        try:
            total_eps = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)).fetchone()["c"]
            watched_eps = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)).fetchone()["c"]
        except Exception:
            total_eps, watched_eps = 0, 0
        show_rt = r["runtime"] if "runtime" in r.keys() else None
        try:
            mrow = conn.execute(
                "SELECT "
                "COALESCE(SUM(CASE WHEN watched=1 THEN COALESCE(runtime, ?) END),0) AS wmin, "
                "COALESCE(SUM(CASE WHEN watched=0 THEN COALESCE(runtime, ?) END),0) AS umin "
                "FROM episodes WHERE follow_id=?",
                (show_rt, show_rt, r["id"]),
            ).fetchone()
            watched_min = int(mrow["wmin"] or 0)
            unwatched_min = int(mrow["umin"] or 0)
        except Exception:
            watched_min, unwatched_min = 0, 0
        try:
            _last_air, _gap = _tv_air_stats(conn, r["id"])
        except Exception:
            _last_air, _gap = None, None
        shows.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "media_type": "tv",
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "genres": _safe_json_list(r["genres"]) if "genres" in r.keys() else [],
                "status": r["status"] if "status" in r.keys() else None,
                "season_list": r["season_list"] if "season_list" in r.keys() else None,
                "number_of_seasons": r["number_of_seasons"] if "number_of_seasons" in r.keys() else None,
                "number_of_episodes": r["number_of_episodes"] if "number_of_episodes" in r.keys() else None,
                "runtime": r["runtime"] if "runtime" in r.keys() else None,
                "total_eps": total_eps,
                "watched_eps": watched_eps,
                "watched_min": watched_min,
                "unwatched_min": unwatched_min,
                "last_air_date": _last_air,
                "ep_gap_days": _gap,
                "next_episode": {"season": nxt["season"], "episode": nxt["episode"], "air_date": nxt["air_date"]} if nxt else None,
                "unwatched": len(items),
                "items": items,
            }
        )

    movies = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND media_type='movie' AND watched=0 AND COALESCE(archived,0)=0 ORDER BY release_date IS NULL, release_date ASC",
        (uid,),
    ).fetchall():
        movies.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "media_type": "movie",
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "genres": _safe_json_list(r["genres"]) if "genres" in r.keys() else [],
                "release_date": r["release_date"],
                "runtime": r["runtime"] if "runtime" in r.keys() else None,
                "total_eps": 1,
                "watched_eps": int(r["watched"] or 0),
                "watched_min": 0,
                "unwatched_min": int(r["runtime"]) if ("runtime" in r.keys() and r["runtime"]) else 0,
                "watched": int(r["watched"] or 0),
            }
        )

    anime_list = []
    for r in conn.execute("SELECT * FROM anime WHERE user_id=? AND COALESCE(archived,0)=0", (uid,)).fetchall():
        rows = conn.execute(
            "SELECT episode, air_at FROM anime_episodes "
            "WHERE anime_id=? AND air_at IS NOT NULL AND air_at<=? AND watched=0 "
            "ORDER BY air_at ASC, episode ASC",
            (r["id"], now),
        ).fetchall()
        if not rows:
            continue
        try:
            nxt = conn.execute(
                "SELECT episode, air_at FROM anime_episodes "
                "WHERE anime_id=? AND air_at IS NOT NULL AND air_at>? "
                "ORDER BY air_at ASC, episode ASC LIMIT 1",
                (r["id"], now),
            ).fetchone()
        except Exception:
            nxt = None
        try:
            total_eps = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)).fetchone()["c"]
            watched_eps = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)).fetchone()["c"]
        except Exception:
            total_eps, watched_eps = 0, 0
        anime_list.append(
            {
                "id": r["id"],
                "anilist_id": r["anilist_id"],
                "title": r["title"],
                "cover_url": r["cover_url"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "score": r["score"],
                "studios": r["studios"],
                "status": r["status"] if "status" in r.keys() else None,
                "duration": r["duration"] if "duration" in r.keys() else None,
                "total_eps": total_eps,
                "watched_eps": watched_eps,
                "watched_min": int(watched_eps * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "unwatched_min": int((total_eps - watched_eps) * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "next_episode": {"episode": nxt["episode"], "airing_at": nxt["air_at"]} if nxt else None,
                "unwatched": len(rows),
                "items": [{"episode": x["episode"], "air_at": x["air_at"]} for x in rows],
            }
        )

    conn.close()
    payload = {"shows": shows, "anime": anime_list, "movies": movies}
    list_cache.set(key, payload)
    return cached_response(payload, False)


@followed_bp.route("/api/unfollow/<int:follow_id>", methods=["DELETE"])
def unfollow(follow_id):
    uid = _uid()
    conn = get_db()
    row = conn.execute("SELECT poster_local, poster_local_w185, tmdb_id, media_type FROM followed WHERE id=? AND user_id=?", (follow_id, uid)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 404
    tmdb_id = row["tmdb_id"]
    media_type = row["media_type"]
    conn.execute("DELETE FROM episodes WHERE follow_id=?", (follow_id,))
    conn.execute("DELETE FROM cast WHERE follow_id=?", (follow_id,))
    conn.execute("DELETE FROM followed WHERE id=?", (follow_id,))
    conn.commit()
    conn.close()
    # lokal posterleri sil (w500 + w185, eski flat dahil)
    try:
        delete_poster(media_type, tmdb_id)
        # fallback both kinds
        delete_poster("tv", tmdb_id)
        delete_poster("movie", tmdb_id)
    except Exception:
        pass
    # also try legacy web paths if any
    for p in (row["poster_local"] if "poster_local" in row.keys() else None, row["poster_local_w185"] if "poster_local_w185" in row.keys() else None):
        if p:
            delete_poster_by_web(p)
    bump()
    return jsonify({"ok": True})


@followed_bp.route("/api/watched")
def watched():
    """Kullanıcının onayladığı (in_watched=1) tamamen izlenmiş yapımları döndürür.
    Yeni bölüm yayınlananlar otomatik izlenmişten çıkarılır."""
    uid = _uid()
    key = ("watched", uid, gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()

    shows = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND media_type='tv' AND in_watched=1 AND COALESCE(archived,0)=0",
        (uid,),
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        try:
            st = r["status"] if "status" in r.keys() else None
            final_tv = is_final_status("tv", st)
        except Exception:
            final_tv = False
        if (total <= 0 or total != watched_cnt) and not final_tv:
            try:
                early = can_early_watch_tv(conn, r["id"])
            except Exception:
                early = False
            if not early:
                conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
                conn.commit()
                continue
        rows = conn.execute(
            "SELECT season, episode, air_date, name FROM episodes "
            "WHERE follow_id=? AND watched=1 ORDER BY season ASC, episode ASC",
            (r["id"],),
        ).fetchall()
        items = [
            {
                "season": x["season"],
                "episode": x["episode"],
                "episode_name": x["name"] or "",
                "air_date": x["air_date"],
            }
            for x in rows
        ]
        show_rt = r["runtime"] if "runtime" in r.keys() else None
        try:
            mrow = conn.execute(
                "SELECT "
                "COALESCE(SUM(CASE WHEN watched=1 THEN COALESCE(runtime, ?) END),0) AS wmin, "
                "COALESCE(SUM(CASE WHEN watched=0 THEN COALESCE(runtime, ?) END),0) AS umin "
                "FROM episodes WHERE follow_id=?",
                (show_rt, show_rt, r["id"]),
            ).fetchone()
            watched_min = int(mrow["wmin"] or 0)
            unwatched_min = int(mrow["umin"] or 0)
        except Exception:
            watched_min, unwatched_min = 0, 0
        try:
            _last_air, _gap = _tv_air_stats(conn, r["id"])
        except Exception:
            _last_air, _gap = None, None
        shows.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "media_type": "tv",
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "genres": _safe_json_list(r["genres"]) if "genres" in r.keys() else [],
                "status": r["status"] if "status" in r.keys() else None,
                "season_list": r["season_list"] if "season_list" in r.keys() else None,
                "number_of_seasons": r["number_of_seasons"] if "number_of_seasons" in r.keys() else None,
                "number_of_episodes": r["number_of_episodes"] if "number_of_episodes" in r.keys() else None,
                "runtime": r["runtime"] if "runtime" in r.keys() else None,
                "watched_min": watched_min,
                "unwatched_min": unwatched_min,
                "last_air_date": _last_air,
                "ep_gap_days": _gap,
                "watched": watched_cnt,
                "total": total,
                "items": items,
            }
        )

    movies = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND media_type='movie' AND in_watched=1 AND COALESCE(archived,0)=0 ORDER BY release_date IS NULL, release_date ASC",
        (uid,),
    ).fetchall():
        try:
            st = r["status"] if "status" in r.keys() else None
            final_movie = is_final_status("movie", st)
        except Exception:
            final_movie = False
        if not (r["watched"] == 1) and not final_movie:
            try:
                rel = r["release_date"] if "release_date" in r.keys() else None
                early = can_early_watch_movie(rel)
            except Exception:
                early = False
            if not early:
                conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
                conn.commit()
                continue
        movies.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "media_type": "movie",
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "genres": _safe_json_list(r["genres"]) if "genres" in r.keys() else [],
                "release_date": r["release_date"],
                "runtime": r["runtime"] if "runtime" in r.keys() else None,
                "watched_min": int(r["runtime"]) if ("runtime" in r.keys() and r["runtime"]) else 0,
                "unwatched_min": 0,
                "watched": 1,
            }
        )

    anime_list = []
    for r in conn.execute("SELECT * FROM anime WHERE user_id=? AND in_watched=1 AND COALESCE(archived,0)=0", (uid,)).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        try:
            st = r["status"] if "status" in r.keys() else None
            final_anime = is_final_status("anime", st)
        except Exception:
            final_anime = False
        if (total <= 0 or total != watched_cnt) and not final_anime:
            try:
                early = can_early_watch_anime(conn, r["id"])
            except Exception:
                early = False
            if not early:
                conn.execute("UPDATE anime SET in_watched=0 WHERE id=?", (r["id"],))
                conn.commit()
                continue
        rows = conn.execute(
            "SELECT episode, air_at FROM anime_episodes "
            "WHERE anime_id=? AND watched=1 ORDER BY episode ASC",
            (r["id"],),
        ).fetchall()
        anime_list.append(
            {
                "id": r["id"],
                "anilist_id": r["anilist_id"],
                "title": r["title"],
                "cover_url": r["cover_url"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "score": r["score"],
                "studios": r["studios"],
                "status": r["status"] if "status" in r.keys() else None,
                "duration": r["duration"] if "duration" in r.keys() else None,
                "watched_min": int(watched_cnt * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "unwatched_min": int((total - watched_cnt) * (r["duration"] or 0)) if ("duration" in r.keys() and r["duration"]) else 0,
                "watched": watched_cnt,
                "total": total,
                "items": [{"episode": x["episode"], "air_at": x["air_at"]} for x in rows],
            }
        )

    conn.close()
    payload = {"shows": shows, "movies": movies, "anime": anime_list}
    list_cache.set(key, payload)
    return cached_response(payload, False)


@followed_bp.route("/api/followed/move-watched", methods=["POST"])
def followed_move_watched():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    media_type = body.get("media_type")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id or media_type not in ("movie", "tv"):
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400
    try:
        st = follow["status"] if "status" in follow.keys() else None
        final = is_final_status(media_type, st)
    except Exception:
        final = False
    if watched:
        if media_type == "movie":
            if not (follow["watched"] == 1) and not final:
                try:
                    rel = follow["release_date"] if "release_date" in follow.keys() else None
                    early = can_early_watch_movie(rel)
                except Exception:
                    early = False
                if not early:
                    conn.close()
                    return jsonify({"error": "Film henüz izlenmedi"}), 400
        else:
            total = conn.execute(
                "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (follow["id"],)
            ).fetchone()["c"]
            watched_cnt = conn.execute(
                "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (follow["id"],)
            ).fetchone()["c"]
            if (total <= 0 or total != watched_cnt) and not final:
                try:
                    early = can_early_watch_tv(conn, follow["id"])
                except Exception:
                    early = False
                if not early:
                    conn.close()
                    return jsonify({"error": "Dizi henüz tamamlanmadı"}), 400
    now_ts = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    removed_eps = []          # 2.19.6: geri alinan bolumler -> Trakt kuyrugu
    removed_movie = False
    if watched:
        if media_type == "tv":
            # Tüm sezon/bölümleri otomatik izlenmiş yap; önceden izlenmemiş
            # olanları snapshot'a yaz (geri taşımada "kaldığım yer" korunur).
            try:
                rows = conn.execute(
                    "SELECT season, episode FROM episodes WHERE follow_id=? AND watched=0",
                    (follow["id"],),
                ).fetchall()
                auto = [[r["season"], r["episode"]] for r in rows]
            except Exception:
                auto = []
            if auto:
                conn.execute(
                    "UPDATE episodes SET watched=1, source=COALESCE(source, 'other'), direct_mark=0 WHERE follow_id=? AND watched=0",
                    (follow["id"],),
                )
                save_watch_snapshot(conn, uid, "tv", follow["id"], auto)
                for sn in sorted({int(s) for s, _e in auto if s is not None}):
                    conn.execute(
                        "INSERT INTO watch_marks (user_id, kind, ref_id, season, marked_at) VALUES (?,?,?,?,?)",
                        (uid, "tv", follow["id"], sn, now_ts),
                    )
            conn.execute("UPDATE followed SET in_watched=? WHERE id=?", (watched, follow["id"]))
        else:  # movie
            if int(follow["watched"] or 0) != 1:
                conn.execute("UPDATE followed SET watched=1, watched_source='other', direct_mark=0 WHERE id=?", (follow["id"],))
                save_watch_snapshot(conn, uid, "movie", follow["id"], ["1"])
            conn.execute(
                "UPDATE followed SET in_watched=?, watched_at=COALESCE(watched_at, ?), direct_mark=0 WHERE id=?",
                (watched, now_ts, follow["id"]),
            )
    else:
        # Geri taşıma: yalnız otomatik işaretlenen bölümleri izlenmemişe çevir.
        if media_type == "tv":
            try:
                snap = pop_watch_snapshot(conn, uid, "tv", follow["id"])
            except Exception:
                snap = None
            if snap:
                try:
                    for s, e in snap:
                        conn.execute(
                            "UPDATE episodes SET watched=0, watched_at=NULL, source=NULL, direct_mark=0 WHERE follow_id=? AND season=? AND episode=?",
                            (follow["id"], s, e),
                        )
                        removed_eps.append((s, e))
                except Exception:
                    pass
            conn.execute(
                "DELETE FROM watch_marks WHERE user_id=? AND kind='tv' AND ref_id=?",
                (uid, follow["id"]),
            )
            conn.execute("UPDATE followed SET in_watched=? WHERE id=?", (watched, follow["id"]))
        else:
            try:
                snap = pop_watch_snapshot(conn, uid, "movie", follow["id"])
            except Exception:
                snap = None
            if snap and "1" in snap:
                conn.execute("UPDATE followed SET watched=0, watched_at=NULL, watched_source=NULL, direct_mark=0 WHERE id=?", (follow["id"],))
                removed_movie = True
            conn.execute("UPDATE followed SET in_watched=? WHERE id=?", (watched, follow["id"]))
    conn.commit()
    conn.close()
    # 2.19.6: liste tasima da Trakt'a yansir (izlendi -> gonderim, izlenmedi -> kaldirma).
    if watched:
        _kick_trakt_out(uid)
    else:
        for s, e in removed_eps:
            _queue_trakt_unwatch(uid, "tv", tmdb_id, s, e)
        if removed_movie:
            _queue_trakt_unwatch(uid, "movie", tmdb_id)
    bump()
    return jsonify({"ok": True, "watched": watched})


@followed_bp.route("/api/followed/defer", methods=["POST"])
def followed_defer():
    """Daha-sonra-izle durumu: kartı listenin en altına indirir (sort'tan muaf)."""
    body = request.get_json(silent=True) or {}
    tmdb_id = body.get("tmdb_id")
    media_type = body.get("media_type")
    deferred = 1 if body.get("deferred") else 0
    if not tmdb_id or media_type not in ("movie", "tv"):
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400
    conn.execute("UPDATE followed SET deferred=? WHERE id=?", (deferred, follow["id"]))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "deferred": deferred})


@followed_bp.route("/api/followed/archive", methods=["POST"])
def followed_archive():
    """Arsiv durumu (1.83): takibi birakmadan yapimi arsive alir; bildirimler durur."""
    body = request.get_json(silent=True) or {}
    tmdb_id = body.get("tmdb_id")
    media_type = body.get("media_type")
    archived = 1 if body.get("archived") else 0
    if not tmdb_id or media_type not in ("movie", "tv"):
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadi"}), 400
    conn.execute("UPDATE followed SET archived=? WHERE id=?", (archived, follow["id"]))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "archived": archived})


@followed_bp.route("/api/next-up")
def next_up():
    """Siradaki Bolum seridi (1.84): her dizi/anime icin TEK sonraki izlenmemis bolum.

    Dizi (belgesel dizisi dahil): yayina girmis (air_date<=bugun) en dusuk
    (season, episode). Anime: air_at<=now en kucuk episode. Yalniz IZLEMEYE
    BASLANMIS yapimlar girer: en dusuk (season, episode) izlenmis olmali.
    Arsivliler dislanir. Sirali: yayin tarihi en yeni once (tarihi olmayanlar
    sonda). Film/belgesel filmi bu seride YOK (tek ogede 'sonraki bolum' yok)."""
    uid = _uid()
    key = ("next_up", uid, gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    today = today_str()
    try:
        now = int(datetime.datetime.now().timestamp())
    except Exception:
        now = 0
    items = []

    for r in conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND media_type='tv' "
        "AND COALESCE(archived,0)=0",
        (uid,),
    ).fetchall():
        # Ilk bolum izlenmis mi? (izlemeye baslanmamis yapim seride gorunmez)
        try:
            first = conn.execute(
                "SELECT watched FROM episodes "
                "WHERE follow_id=? AND season IS NOT NULL AND episode IS NOT NULL "
                "ORDER BY season ASC, episode ASC LIMIT 1",
                (r["id"],),
            ).fetchone()
        except Exception:
            first = None
        if not first or not int(first["watched"] or 0):
            continue
        try:
            ep = conn.execute(
                "SELECT season, episode, name, air_date, runtime FROM episodes "
                "WHERE follow_id=? AND COALESCE(watched,0)=0 AND air_date IS NOT NULL AND air_date<=? "
                "ORDER BY season ASC, episode ASC LIMIT 1",
                (r["id"], today),
            ).fetchone()
        except Exception:
            ep = None
        if not ep:
            continue
        try:
            show_rt = r["runtime"] if "runtime" in r.keys() else None
        except Exception:
            show_rt = None
        try:
            ep_rt = ep["runtime"] if "runtime" in ep.keys() else None
        except Exception:
            ep_rt = None
        try:
            est = int(ep_rt or show_rt or 0)
        except (TypeError, ValueError):
            est = 0
        # Ozet satiri icin bolum istatistikleri + yaklasan (gelecek) bolum tarihi
        try:
            cnt = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)).fetchone()["c"]
            wcnt = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)).fetchone()["c"]
        except Exception:
            cnt, wcnt = 0, 0
        try:
            mrow = conn.execute(
                "SELECT "
                "COALESCE(SUM(CASE WHEN watched=1 THEN COALESCE(runtime, ?) END),0) AS wmin, "
                "COALESCE(SUM(CASE WHEN watched=0 THEN COALESCE(runtime, ?) END),0) AS umin "
                "FROM episodes WHERE follow_id=?",
                (show_rt, show_rt, r["id"]),
            ).fetchone()
            wmin = int(mrow["wmin"] or 0)
            umin = int(mrow["umin"] or 0)
        except Exception:
            wmin, umin = 0, 0
        try:
            nx = conn.execute(
                "SELECT air_date FROM episodes "
                "WHERE follow_id=? AND air_date IS NOT NULL AND air_date>? "
                "ORDER BY air_date ASC, episode ASC LIMIT 1",
                (r["id"], today),
            ).fetchone()
            next_air = nx["air_date"] if nx else None
        except Exception:
            next_air = None
        items.append(
            {
                "kind": "tv",
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "media_type": "tv",
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "season": ep["season"],
                "episode": ep["episode"],
                "episode_name": ep["name"] or "",
                "air_date": ep["air_date"],
                "est_min": est,
                "genres": _safe_json_list(r["genres"]) if "genres" in r.keys() else [],
                "total_eps": int(cnt or 0),
                "watched_eps": int(wcnt or 0),
                "watched_min": wmin,
                "unwatched_min": umin,
                "next_air_date": next_air,
            }
        )

    for r in conn.execute(
        "SELECT * FROM anime WHERE user_id=? AND COALESCE(archived,0)=0",
        (uid,),
    ).fetchall():
        # Ilk bolum (en kucuk episode) izlenmis mi?
        try:
            first = conn.execute(
                "SELECT watched FROM anime_episodes WHERE anime_id=? ORDER BY episode ASC LIMIT 1",
                (r["id"],),
            ).fetchone()
        except Exception:
            first = None
        if not first or not int(first["watched"] or 0):
            continue
        try:
            ep = conn.execute(
                "SELECT episode, air_at FROM anime_episodes "
                "WHERE anime_id=? AND COALESCE(watched,0)=0 AND air_at IS NOT NULL AND air_at<=? "
                "ORDER BY episode ASC LIMIT 1",
                (r["id"], now),
            ).fetchone()
        except Exception:
            ep = None
        if not ep:
            continue
        try:
            dur = r["duration"] if "duration" in r.keys() else None
            est = int(dur or 0)
        except (TypeError, ValueError):
            est = 0
        try:
            air_date = datetime.datetime.fromtimestamp(ep["air_at"], datetime.timezone.utc).date().isoformat()
        except (ValueError, OSError, OverflowError, TypeError):
            air_date = None
        # Ozet satiri icin bolum istatistikleri + yaklasan (gelecek) bolum tarihi
        try:
            acnt = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)).fetchone()["c"]
            awcnt = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)).fetchone()["c"]
        except Exception:
            acnt, awcnt = 0, 0
        try:
            d = int(dur or 0)
        except (TypeError, ValueError):
            d = 0
        watched_min_a = int(awcnt or 0) * d
        unwatched_min_a = max(0, int(acnt or 0) - int(awcnt or 0)) * d
        try:
            anx = conn.execute(
                "SELECT air_at FROM anime_episodes "
                "WHERE anime_id=? AND air_at IS NOT NULL AND air_at>? "
                "ORDER BY episode ASC LIMIT 1",
                (r["id"], now),
            ).fetchone()
            next_air = (
                datetime.datetime.fromtimestamp(anx["air_at"], datetime.timezone.utc).date().isoformat()
                if anx else None
            )
        except Exception:
            next_air = None
        items.append(
            {
                "kind": "anime",
                "id": r["id"],
                "anilist_id": r["anilist_id"],
                "media_type": "anime",
                "title": r["title"],
                "cover_url": r["cover_url"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "season": None,
                "episode": ep["episode"],
                "episode_name": "",
                "air_date": air_date,
                "air_at": ep["air_at"],
                "est_min": est,
                "total_eps": int(acnt or 0),
                "watched_eps": int(awcnt or 0),
                "watched_min": watched_min_a,
                "unwatched_min": unwatched_min_a,
                "next_air_date": next_air,
            }
        )

    # Sirali: YAKLASAN (gelecek) bolum tarihi en yakin once; gelecek bolumu
    # olmayanlar sonda. Esitlikte ikincil anahtar: yayinlanmis bolum tarihi en
    # yeni once (stable sort: once ikincil, sonra birincil).
    items.sort(key=lambda x: x.get("air_date") or "", reverse=True)
    items.sort(key=lambda x: x.get("next_air_date") or "9999-99-99")
    try:
        total_min = sum(int(x.get("est_min") or 0) for x in items)
    except (TypeError, ValueError):
        total_min = 0
    payload = {"items": items, "totals": {"count": len(items), "min": total_min}}
    conn.close()
    list_cache.set(key, payload)
    return cached_response(payload, False)


@followed_bp.route("/api/releases")
def releases():
    media_type = request.args.get("media_type")
    tmdb_id = request.args.get("tmdb_id")
    title = request.args.get("title", "")
    if media_type not in ("movie", "tv") or not tmdb_id:
        return jsonify({"error": "Geçersiz istek"}), 400

    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()

    if media_type == "movie":
        movie_info = get_tmdb_info("movie", tmdb_id) or {}
        rel = (follow["release_date"] if follow else None) or movie_info.get("release_date")
        watched = int((follow["watched"] if follow and follow["watched"] is not None else 0))
        runtime = (follow["runtime"] if follow and "runtime" in follow.keys() and follow["runtime"] is not None else None)
        if runtime is None:
            runtime = movie_info.get("runtime")
        watched_at = (follow["watched_at"] if follow and "watched_at" in follow.keys() and follow["watched_at"] is not None else None)
        watched_source = (follow["watched_source"] if follow and "watched_source" in follow.keys() and follow["watched_source"] is not None else None)
        conn.close()
        return jsonify(
            {
                "title": title or (follow["title"] if follow else ""),
                "media_type": "movie",
                "items": [
                    {
                        "label": "Yayın Tarihi",
                        "date": rel,
                        "watched": watched,
                        "runtime": runtime,
                        "watched_at": watched_at,
                        "source": watched_source,
                    }
                ],
            }
        )

    if follow is None:
        conn.close()
        return jsonify({"error": "Takip edilen dizi bulunamadı"}), 404

    rows = conn.execute(
        "SELECT season, episode, air_date, air_time, name, watched FROM episodes "
        "WHERE follow_id=? ORDER BY season ASC, episode ASC",
        (follow["id"],),
    ).fetchall()
    if not rows:
        sync_episodes(conn, follow)
        rows = conn.execute(
            "SELECT season, episode, air_date, air_time, name, watched FROM episodes "
            "WHERE follow_id=? ORDER BY season ASC, episode ASC",
            (follow["id"],),
        ).fetchall()
    conn.close()

    items = [
        {
            "label": f"Sezon {x['season']} · Bölüm {x['episode']}",
            "episode_name": x["name"] or "",
            "season": x["season"],
            "episode": x["episode"],
            "date": x["air_date"],
            "watched": x["watched"],
            "air_time": x["air_time"],
        }
        for x in rows
    ]
    return jsonify(
        {
            "title": title or follow["title"],
            "media_type": "tv",
            "items": items,
        }
    )


@followed_bp.route("/api/episode/info")
def episode_info():
    """Bölüm özet modalı: TMDB'den arayüz dilinde özet+süre (boşsa İngilizce),
    DB'den izlenme tarihi."""
    tmdb_id = request.args.get("tmdb_id")
    try:
        season = int(request.args.get("season"))
        episode = int(request.args.get("episode"))
    except (TypeError, ValueError):
        return jsonify({"error": "Geçersiz istek"}), 400
    lang = request.args.get("lang") or "en-US"
    if not tmdb_id:
        return jsonify({"error": "Geçersiz istek"}), 400

    uid = _uid()
    key = ("episode_info", uid, tmdb_id, season, episode, lang, gen())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    follow = conn.execute(
        "SELECT id, title FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'",
        (uid, tmdb_id,),
    ).fetchone()
    title = follow["title"] if follow else ""
    watched_at = None
    source = None
    if follow:
        row = conn.execute(
            "SELECT watched_at, source FROM episodes WHERE follow_id=? AND season=? AND episode=?",
            (follow["id"], season, episode,),
        ).fetchone()
        if row:
            watched_at = row["watched_at"]
            source = row["source"]
    conn.close()

    overview, runtime = "", None
    season_data = tmdb_request(f"/tv/{tmdb_id}/season/{season}", lang=lang)
    if season_data:
        for ep in season_data.get("episodes", []):
            if ep.get("episode_number") == episode:
                overview = (ep.get("overview") or "").strip()
                runtime = ep.get("runtime")
                break
    if not overview and lang != "en-US":
        season_en = tmdb_request(f"/tv/{tmdb_id}/season/{season}", lang="en-US")
        if season_en:
            for ep in season_en.get("episodes", []):
                if ep.get("episode_number") == episode:
                    overview = (ep.get("overview") or "").strip()
                    if runtime is None:
                        runtime = ep.get("runtime")
                    break
    payload = {
        "title": title,
        "season": season,
        "episode": episode,
        "overview": overview,
        "runtime": runtime,
        "watched_at": watched_at,
        "source": source,
    }
    list_cache.set(key, payload)
    return cached_response(payload, False)


def _kick_trakt_out(uid):
    """2.19.6: yerel izleme isaretlemesi -> Trakt'a aninda gonderim (havuz).

    Havuz 2 sn toplayip tek POST atar; token yok / cift yon kapali ise no-op.
    """
    try:
        import sync_pool
        sync_pool.kick_trakt_out(uid)
    except Exception:
        pass


def _queue_trakt_unwatch(uid, kind, tmdb_id, season=None, episode=None):
    """2.19.4: yerelde izlendi -> izlenmedi gecisi.

    Cift yonlu Trakt senkronu icin kaldirmayi kuyruga yazar ve bekleyen sinyal
    tamponu satirini siler (clear-apply eski sinyali geri yazmasin). Fail-soft.
    """
    try:
        tmdb = int(tmdb_id)
    except Exception:
        return
    try:
        import trakt
        trakt.queue_remove(uid, kind, tmdb, season, episode)
    except Exception:
        pass
    # 2.19.6: kaldirma aninda Trakt'a gitsin (havuz 2 sn toplayip tek POST atar).
    try:
        import sync_pool
        sync_pool.kick_trakt_out(uid)
    except Exception:
        pass
    try:
        import stremio_buffer as sb
        sb.delete_signals([sb._dedupe(kind, tmdb, None, season, episode, uid)])
    except Exception:
        pass


@followed_bp.route("/api/episode/watch", methods=["POST"])
def episode_watch():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    season = body.get("season")
    episode = body.get("episode")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id or season is None or episode is None:
        return jsonify({"error": "Eksik bilgi"}), 400

    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'",
        (uid, tmdb_id,),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400

    prev = conn.execute(
        "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
        (follow["id"], season, episode),
    ).fetchone()

    conn.execute(
        "INSERT INTO episodes (follow_id, season, episode, watched, watched_at, source, direct_mark) "
        "VALUES (?, ?, ?, ?, ?, ?, 0) "
        "ON CONFLICT(follow_id, season, episode) "
        "DO UPDATE SET watched=excluded.watched, watched_at=excluded.watched_at, "
        "source=excluded.source, direct_mark=0",
        (follow["id"], season, episode, watched,
         int(datetime.datetime.now(datetime.timezone.utc).timestamp()) if watched else None,
         "other" if watched else None),
    )
    conn.commit()
    conn.close()
    if not watched and prev and prev["watched"]:
        _queue_trakt_unwatch(uid, "tv", tmdb_id, season, episode)
    elif watched:
        _kick_trakt_out(uid)
    bump()
    return jsonify({"ok": True, "watched": watched})


@followed_bp.route("/api/season/watch", methods=["POST"])
def season_watch():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    season = body.get("season")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id or season is None:
        return jsonify({"error": "Eksik bilgi"}), 400

    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'",
        (uid, tmdb_id,),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400

    season_data = tmdb_request(f"/tv/{tmdb_id}/season/{season}")
    if not season_data:
        conn.close()
        return jsonify({"error": "Sezon bilgisi alınamadı"}), 400

    show_data = tmdb_request(f"/tv/{tmdb_id}")
    utc_today = datetime.datetime.now(datetime.timezone.utc).date()
    tvmaze_times = None
    if watched:
        for t in (
            (show_data or {}).get("original_name"),
            (show_data or {}).get("name"),
        ):
            if t:
                tvmaze_times = _tvmaze_episode_times(t)
                if tvmaze_times is not None:
                    break
    prev_eps = []
    if not watched:
        prev_rows = conn.execute(
            "SELECT episode FROM episodes WHERE follow_id=? AND season=? AND watched=1",
            (follow["id"], season),
        ).fetchall()
        prev_eps = [int(r["episode"]) for r in prev_rows]
    count = 0
    for ep in season_data.get("episodes", []):
        ep_num = ep.get("episode_number")
        if not ep_num:
            continue
        air_date = ep.get("air_date")
        if watched:
            air_time = None
            if tvmaze_times is not None:
                air_time = tvmaze_times.get((season, ep_num))
            if air_time:
                # yayın günü UTC bugünden küçükse (en az 1 gün önce) seçilebilir
                try:
                    air_day = datetime.datetime.fromtimestamp(
                        air_time, datetime.timezone.utc
                    ).date()
                except (ValueError, OSError, OverflowError):
                    air_day = None
                if air_day is None or air_day >= utc_today:
                    continue
            else:
                # air_time yok: UTC günü olarak en az bir gün önce yayınlanmış olmalı
                try:
                    air_day = datetime.date.fromisoformat(air_date) if air_date else None
                except ValueError:
                    air_day = None
                if air_day is None or air_day >= utc_today:
                    continue
            if air_time:
                try:
                    air_date = datetime.datetime.fromtimestamp(
                        air_time, datetime.timezone.utc
                    ).date().isoformat()
                except (ValueError, OSError, OverflowError):
                    pass
        conn.execute(
            "INSERT INTO episodes (follow_id, season, episode, air_date, watched, watched_at, runtime, source, direct_mark) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) "
            "ON CONFLICT(follow_id, season, episode) "
            "DO UPDATE SET watched=excluded.watched, watched_at=excluded.watched_at, air_date=excluded.air_date, "
            "runtime=excluded.runtime, source=excluded.source, direct_mark=0",
            (follow["id"], season, ep_num, air_date, watched,
             int(datetime.datetime.now(datetime.timezone.utc).timestamp()) if watched else None,
             ep.get("runtime"),
             "other" if watched else None),
        )
        count += 1
    conn.commit()
    conn.close()
    for ep_num in prev_eps:
        _queue_trakt_unwatch(uid, "tv", tmdb_id, season, ep_num)
    if watched:
        _kick_trakt_out(uid)
    bump()
    return jsonify({"ok": True, "count": count})


@followed_bp.route("/api/movie/watch", methods=["POST"])
def movie_watch():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id:
        return jsonify({"error": "Eksik bilgi"}), 400
    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='movie'",
        (uid, tmdb_id,),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400
    prev = conn.execute(
        "SELECT watched FROM followed WHERE id=?", (follow["id"],)
    ).fetchone()
    conn.execute("UPDATE followed SET watched=?, watched_at=?, watched_source=?, direct_mark=0 WHERE id=?", (
        watched,
        int(datetime.datetime.now(datetime.timezone.utc).timestamp()) if watched else None,
        "other" if watched else None,
        follow["id"],
    ))
    conn.commit()
    conn.close()
    if not watched and prev and prev["watched"]:
        _queue_trakt_unwatch(uid, "movie", tmdb_id)
    elif watched:
        _kick_trakt_out(uid)
    bump()
    return jsonify({"ok": True, "watched": watched})


def _lang_to_locale(lang):
    """Kısa dil kodunu (tr, en, de...) TMDB locale'ine (tr-TR, en-US, de-DE) çevirir."""
    if not lang:
        return None
    base = str(lang).lower().split("-")[0]
    map_ = {
        "tr": "tr-TR", "en": "en-US", "de": "de-DE", "fr": "fr-FR", "es": "es-ES",
        "it": "it-IT", "ru": "ru-RU", "ar": "ar-SA", "pt": "pt-BR", "nl": "nl-NL",
        "pl": "pl-PL", "ja": "ja-JP", "ko": "ko-KR", "zh": "zh-CN", "hi": "hi-IN",
    }
    return map_.get(base, base)


def _load_localized(row_localized):
    try:
        v = json.loads(row_localized) if row_localized else {}
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError):
        return {}


def _poster_local_for(media_type, tmdb_id):
    """Takip edilen içerik için lokal w500 poster web yolunu (dosya gercekten varsa) dondurur."""
    kind = "tv" if media_type == "tv" else "movie"
    cand = poster_local_path(kind, tmdb_id, "w500")
    fs = filesystem_path_from_web(cand) if cand else None
    if cand and fs and os.path.exists(fs):
        return versioned_web_path(cand)
    return None


def _attach_poster_local(resp, pl):
    if pl:
        resp["poster_local"] = versioned_web_path(pl)
    return resp


def _sync_tmdb_poster(conn, media_type, tmdb_id, fresh_path, row):
    """TMDB afişi değiştiyse ya da lokal dosya kayıpsa yeniden indirip DB'yi günceller."""
    if not fresh_path or not row:
        return None
    kind = "tv" if media_type == "tv" else "movie"
    old_path = row["poster_path"] if "poster_path" in row.keys() else None
    local = row["poster_local"] if "poster_local" in row.keys() else None
    fs = filesystem_path_from_web(local) if local else None
    if fresh_path == old_path and fs and os.path.exists(fs):
        return None
    w500, w185 = download_tmdb_poster_with_sizes(media_type, tmdb_id, fresh_path)
    if not w500 and not w185:
        return None
    delete_poster_by_web(poster_local_path(kind, tmdb_id, "thumbnail"))
    ensure_thumbnail(kind, tmdb_id, None)
    conn.execute(
        "UPDATE followed SET poster_path=?, poster_local=?, poster_local_w185=? WHERE id=?",
        (fresh_path, w500 or local, w185, row["id"]),
    )
    bump()
    return w500


def _ensure_directors(conn, media_type, tmdb_id, follow_id, d):
    """Önbellek isabetinde yönetmen kaydı boşsa tek seferlik canlı doldurur.

    Eski satırlarda directors tablosu boştur; ilk açılışta bir /credits
    isteğiyle doldurulup DB'ye yazılır, sonraki açılışlar önbellektendir.
    """
    if d.get("directors"):
        return d
    try:
        dirs = get_tmdb_directors(media_type, tmdb_id)
    except Exception:
        return d
    if not dirs:
        return d
    try:
        save_directors(conn, follow_id, dirs)
        conn.commit()
    except Exception:
        pass
    d = dict(d)
    d["directors"] = [
        {"person_id": x.get("person_id"), "name": x.get("name"), "profile_path": x.get("profile_path")}
        for x in dirs
    ]
    return d


def _build_response(media_type, d):
    """Normalleştirilmiş detail sözlüğünü movie/tv JSON yanıtına çevirir."""
    cast = [
        {"id": c.get("person_id"), "name": c.get("name"), "character": c.get("character"), "profile_path": c.get("profile_path")}
        for c in (d.get("cast") or [])
    ]
    directors = [
        {"id": x.get("person_id"), "name": x.get("name"), "profile_path": x.get("profile_path")}
        for x in (d.get("directors") or [])
    ]
    # highlight_person / highlight_person_id: eşleşen oyuncuyu listeye başa al.
    highlight = (request.args.get("highlight_person") or "").strip().lower()
    hpid = (request.args.get("highlight_person_id") or "").strip()
    for i, c in enumerate(cast):
        nm = (c.get("name") or "").strip().lower()
        if (highlight and nm == highlight) or (hpid and str(c.get("id")) == hpid):
            cast.insert(0, cast.pop(i))
            break
    base = {
        "media_type": media_type,
        "title": d.get("title") or "",
        "poster_path": d.get("poster_path"),
        "overview": d.get("overview"),
        "tagline": d.get("tagline"),
        "genres": d.get("genres") or [],
        "vote_average": d.get("vote_average"),
        "vote_count": d.get("vote_count"),
        "runtime": d.get("runtime"),
        "cast": cast,
        "directors": directors,
    }
    if media_type == "movie":
        base["release_date"] = d.get("release_date")
    else:
        base["first_air_date"] = d.get("first_air_date")
        base["number_of_seasons"] = d.get("number_of_seasons")
        base["number_of_episodes"] = d.get("number_of_episodes")
        base["status"] = d.get("status")
    if d.get("_fallback_lang"):
        base["_fallback_lang"] = d.get("_fallback_lang")
        base["_fallback_fields"] = d.get("_fallback_fields") or []
    return base


@followed_bp.route("/api/details")
def details():
    media_type = request.args.get("media_type")
    tmdb_id = request.args.get("tmdb_id")
    lang = (request.args.get("lang") or "").strip() or None
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    if media_type not in ("movie", "tv") or not tmdb_id:
        return jsonify({"error": "Geçersiz istek"}), 400

    uid = _uid()
    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, tmdb_id, media_type),
    ).fetchone()
    localized = _load_localized(follow["localized"] if follow else None)
    pl = _poster_local_for(media_type, tmdb_id)

    # -- lang VERİLMEDİYSE: legacy (slot varsa HIT; bos overview artik MISS degil, en fallback'li yazilir). --
    if not lang:
        if follow and not refresh:
            d = load_details(conn, follow["id"])
            if d:
                d = _ensure_directors(conn, media_type, tmdb_id, follow["id"], d)
                conn.close()
                return jsonify(_attach_poster_local(_build_response(media_type, d), pl))
        data = tmdb_request(f"/{media_type}/{tmdb_id}")
        if not data:
            conn.close()
            return jsonify({"error": "TMDB'den veri alınamadı"}), 400
        info = get_tmdb_info_fallback(media_type, tmdb_id, lang=None)
        title, title_fb = get_tmdb_title_fallback(media_type, tmdb_id, lang=None, sel_data=data)
        credits = get_tmdb_credits(media_type, tmdb_id)
        cst = credits.get("cast") or []
        if follow:
            save_details(conn, follow["id"], info, cst, directors=credits.get("directors") or [])
            _sync_tmdb_poster(conn, media_type, int(tmdb_id), data.get("poster_path"), follow)
            conn.commit()
        conn.close()
        d = dict(info or {})
        d["title"] = title
        if title_fb:
            d["_fallback_lang"] = "en"
            d["_fallback_fields"] = list((d.get("_fallback_fields") or [])) + ["title"]
        d["poster_path"] = data.get("poster_path")
        d["cast"] = cst
        d["directors"] = credits.get("directors") or []
        return jsonify(_attach_poster_local(_build_response(media_type, d), pl))

    # -- lang VERİLDİYSE: dil başına önbellek (14 dil; boş alan en-US ile doldurulur). --
    locale = _lang_to_locale(lang)
    loc = localized.get(lang) if follow else None

    # Cache hit: o dilde slot varsa fetch yapmadan dön (fallback'li kayit da HIT;
    # bos overview artik MISS sayilmaz, bir kez yazilan slot her zaman cache'lenir).
    if follow and loc and not refresh:
        d = load_details(conn, follow["id"]) or {}
        d = dict(d)
        d["title"] = loc.get("title") or d.get("title")
        d["overview"] = loc.get("overview") or d.get("overview")
        d["genres"] = loc.get("genres") or d.get("genres") or []
        d["tagline"] = loc.get("tagline") or d.get("tagline")
        if loc.get("_fallback_lang"):
            d["_fallback_lang"] = loc.get("_fallback_lang")
            d["_fallback_fields"] = loc.get("_fallback_fields") or []
        d = _ensure_directors(conn, media_type, tmdb_id, follow["id"], d)
        conn.close()
        return jsonify(_attach_poster_local(_build_response(media_type, d), pl))

    # Cache miss: secilen dil + bos alanlar icin en-US fallback, sonra o dile yaz.
    data = tmdb_request(f"/{media_type}/{tmdb_id}", lang=locale)
    if not data:
        conn.close()
        return jsonify({"error": "TMDB'den veri alınamadı"}), 400
    info = get_tmdb_info_fallback(media_type, tmdb_id, lang=locale)
    title, title_fb = get_tmdb_title_fallback(media_type, tmdb_id, lang=locale, sel_data=data)
    credits = get_tmdb_credits(media_type, tmdb_id)
    cst = credits.get("cast") or []
    fb_fields = list((info or {}).get("_fallback_fields") or [])
    if title_fb and "title" not in fb_fields:
        fb_fields.append("title")
    if follow:
        _sync_tmdb_poster(conn, media_type, int(tmdb_id), data.get("poster_path"), follow)
        localized[lang] = {
            "title": title,
            "overview": (info or {}).get("overview") or "",
            "genres": (info or {}).get("genres") or [],
            "tagline": (info or {}).get("tagline") or "",
            "_fallback_lang": "en" if fb_fields else None,
            "_fallback_fields": fb_fields,
        }
        conn.execute(
            "UPDATE followed SET localized=? WHERE id=?",
            (json.dumps(localized, ensure_ascii=False), follow["id"]),
        )
        save_details(conn, follow["id"], info, cst, include_texts=False, directors=credits.get("directors") or [])
        conn.commit()
    conn.close()

    d = dict(info or {})
    d["title"] = title
    if fb_fields:
        d["_fallback_lang"] = "en"
        d["_fallback_fields"] = fb_fields
    d["poster_path"] = data.get("poster_path")
    d["cast"] = cst
    d["directors"] = credits.get("directors") or []
    return jsonify(_attach_poster_local(_build_response(media_type, d), pl))


# ---- İzleme geçmişi (history) ----
_DOC_GENRE_WORDS = {
    "documentary", "documentaries", "belgesel", "doku", "dokus",
    "documentaire", "documentaires", "documental", "documentales",
    "documentario", "documentari", "документальный", "доку",
    "وثائقي", "وثائقيات", "documentário", "documentários",
    "dokument", "dokumenty", "ドキュメンタリー", "다큐멘터리", "纪录片",
}


def _is_doc_genres(genres):
    if not genres:
        return False
    for g in genres:
        if str(g or "").strip().lower() in _DOC_GENRE_WORDS:
            return True
    return False


@followed_bp.route("/api/history")
def watch_history():
    """İzleme geçmişi: tv+bölümler, filmler, anime bölümleri (watched_at dolu olanlar).
    kind: shows | movies | docs | anime. ts epoch, azalan."""
    uid = _uid()
    conn = get_db()
    items = []
    try:
        rows = conn.execute(
            """SELECT f.title, f.media_type, f.genres, e.season, e.episode,
                      e.watched_at AS ts, e.source, e.direct_mark
               FROM episodes e JOIN followed f ON f.id=e.follow_id
               WHERE f.user_id=? AND e.watched=1 AND e.watched_at IS NOT NULL""",
            (uid,),
        ).fetchall()
        for r in rows:
            items.append({
                "ts": r["ts"],
                "kind": "docs" if _is_doc_genres(_safe_json_list(r["genres"])) else "shows",
                "title": r["title"] or "",
                "season": r["season"],
                "episode": r["episode"],
                "source": r["source"],
                "direct": bool(r["direct_mark"]),
            })
        rows = conn.execute(
            """SELECT title, genres, watched_at AS ts, watched_source, direct_mark
               FROM followed
               WHERE user_id=? AND media_type='movie' AND watched=1 AND watched_at IS NOT NULL""",
            (uid,),
        ).fetchall()
        for r in rows:
            items.append({
                "ts": r["ts"],
                "kind": "docs" if _is_doc_genres(_safe_json_list(r["genres"])) else "movies",
                "title": r["title"] or "",
                "season": None,
                "episode": None,
                "source": r["watched_source"],
                "direct": bool(r["direct_mark"]),
            })
        rows = conn.execute(
            """SELECT a.title, ae.episode, ae.watched_at AS ts, ae.source, ae.direct_mark
               FROM anime_episodes ae JOIN anime a ON a.id=ae.anime_id
               WHERE a.user_id=? AND ae.watched=1 AND ae.watched_at IS NOT NULL""",
            (uid,),
        ).fetchall()
        for r in rows:
            items.append({
                "ts": r["ts"],
                "kind": "anime",
                "title": r["title"] or "",
                "season": None,
                "episode": r["episode"],
                "source": r["source"],
                "direct": bool(r["direct_mark"]),
            })
        rows = conn.execute(
            """SELECT wm.marked_at AS ts, wm.season, f.title, f.genres
               FROM watch_marks wm JOIN followed f ON f.id=wm.ref_id
               WHERE wm.user_id=? AND wm.kind='tv'""",
            (uid,),
        ).fetchall()
        for r in rows:
            items.append({
                "ts": r["ts"],
                "kind": "docs" if _is_doc_genres(_safe_json_list(r["genres"])) else "shows",
                "title": r["title"] or "",
                "season": r["season"],
                "episode": None,
                "marked": True,
            })
        rows = conn.execute(
            """SELECT wm.marked_at AS ts, a.title
               FROM watch_marks wm JOIN anime a ON a.id=wm.ref_id
               WHERE wm.user_id=? AND wm.kind='anime'""",
            (uid,),
        ).fetchall()
        for r in rows:
            items.append({
                "ts": r["ts"],
                "kind": "anime",
                "title": r["title"] or "",
                "season": None,
                "episode": None,
                "marked": True,
            })
    finally:
        conn.close()
    items.sort(key=lambda x: x["ts"] or 0, reverse=True)
    return jsonify({"items": items})