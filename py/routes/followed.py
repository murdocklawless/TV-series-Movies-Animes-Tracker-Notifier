import json
import datetime
import os

from flask import Blueprint, jsonify, request

from db import get_db, today_str
from tmdb import get_tmdb_info, get_tmdb_cast, save_details, load_details, tmdb_request
from tvmaze import _tvmaze_episode_times
from scheduler import sync_episodes
from poster_store import download_tmdb_poster_with_sizes, delete_poster_by_web, poster_local_path, delete_poster, filesystem_path_from_web, ensure_thumbnail, versioned_web_path
from ramcache import list_cache, bump, gen, cached_response
from recommendations import remove_rec_item

followed_bp = Blueprint("followed", __name__)


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
    existing = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type=?",
        (tmdb_id, media_type),
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "Zaten takipte"}), 400

    conn.execute(
        "INSERT INTO followed (tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (tmdb_id, media_type, title, poster_path, release_date, vote_average, json.dumps(networks)),
    )
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()

    if info:
        save_details(conn, new_id, info, get_tmdb_cast(media_type, tmdb_id))
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
    key = ("followed", gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    rows = conn.execute("SELECT * FROM followed ORDER BY id DESC").fetchall()
    today = today_str()
    items = []
    for r in rows:
        item = dict(r)
        try:
            item["networks"] = json.loads(item.get("networks")) if item.get("networks") else []
        except (ValueError, TypeError):
            item["networks"] = []
        # film için watched, dizi için completed
        item["watched"] = int(item.get("watched") or 0)
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
            # tüm bölümler izlendi mi?
            try:
                total = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (item["id"],)).fetchone()["c"]
                watched_cnt = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (item["id"],)).fetchone()["c"]
                item["completed"] = bool(total > 0 and total == watched_cnt)
            except Exception:
                item["completed"] = False
        items.append(item)
    conn.close()
    list_cache.set(key, items)
    return cached_response(items, False)


@followed_bp.route("/api/unwatched")
def unwatched():
    """Yayına girmiş ve izlenmemiş bölümleri olan dizi ve animeleri döndürür."""
    key = ("unwatched", gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()
    today = today_str()
    now = int(datetime.datetime.now().timestamp())

    shows = []
    for r in conn.execute("SELECT * FROM followed WHERE media_type='tv'").fetchall():
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
        shows.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "unwatched": len(items),
                "items": items,
            }
        )

    movies = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE media_type='movie' AND watched=0 ORDER BY release_date IS NULL, release_date ASC"
    ).fetchall():
        movies.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "release_date": r["release_date"],
                "watched": int(r["watched"] or 0),
            }
        )

    anime_list = []
    for r in conn.execute("SELECT * FROM anime").fetchall():
        rows = conn.execute(
            "SELECT episode, air_at FROM anime_episodes "
            "WHERE anime_id=? AND air_at IS NOT NULL AND air_at<=? AND watched=0 "
            "ORDER BY air_at ASC, episode ASC",
            (r["id"], now),
        ).fetchall()
        if not rows:
            continue
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
    conn = get_db()
    row = conn.execute("SELECT poster_local, poster_local_w185, tmdb_id, media_type FROM followed WHERE id=?", (follow_id,)).fetchone()
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
    key = ("watched", gen(), today_str())
    hit = list_cache.get(key)
    if hit is not None:
        return cached_response(hit, True)
    conn = get_db()

    shows = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE media_type='tv' AND in_watched=1"
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total <= 0 or total != watched_cnt:
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
        shows.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "watched": total,
                "items": items,
            }
        )

    movies = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE media_type='movie' AND in_watched=1 ORDER BY release_date IS NULL, release_date ASC"
    ).fetchall():
        if not (r["watched"] == 1):
            conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
            conn.commit()
            continue
        movies.append(
            {
                "id": r["id"],
                "tmdb_id": r["tmdb_id"],
                "title": r["title"],
                "poster_path": r["poster_path"],
                "poster_local": versioned_web_path(r["poster_local"] if "poster_local" in r.keys() else None),
                "poster_local_w185": versioned_web_path(r["poster_local_w185"] if "poster_local_w185" in r.keys() else None),
                "vote_average": r["vote_average"] or 0,
                "networks": json.loads(r["networks"]) if r["networks"] else [],
                "release_date": r["release_date"],
                "watched": 1,
            }
        )

    anime_list = []
    for r in conn.execute("SELECT * FROM anime WHERE in_watched=1").fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total <= 0 or total != watched_cnt:
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
                "watched": total,
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
    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE tmdb_id=? AND media_type=?",
        (tmdb_id, media_type),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400
    if watched:
        if media_type == "movie":
            if not (follow["watched"] == 1):
                conn.close()
                return jsonify({"error": "Film henüz izlenmedi"}), 400
        else:
            total = conn.execute(
                "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (follow["id"],)
            ).fetchone()["c"]
            watched_cnt = conn.execute(
                "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (follow["id"],)
            ).fetchone()["c"]
            if total <= 0 or total != watched_cnt:
                conn.close()
                return jsonify({"error": "Dizi henüz tamamlanmadı"}), 400
    conn.execute("UPDATE followed SET in_watched=? WHERE id=?", (watched, follow["id"]))
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "watched": watched})


@followed_bp.route("/api/releases")
def releases():
    media_type = request.args.get("media_type")
    tmdb_id = request.args.get("tmdb_id")
    title = request.args.get("title", "")
    if media_type not in ("movie", "tv") or not tmdb_id:
        return jsonify({"error": "Geçersiz istek"}), 400

    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE tmdb_id=? AND media_type=?",
        (tmdb_id, media_type),
    ).fetchone()

    if media_type == "movie":
        rel = (follow["release_date"] if follow else None) or (get_tmdb_info("movie", tmdb_id) or {}).get("release_date")
        watched = int((follow["watched"] if follow and follow["watched"] is not None else 0))
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


@followed_bp.route("/api/episode/watch", methods=["POST"])
def episode_watch():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    season = body.get("season")
    episode = body.get("episode")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id or season is None or episode is None:
        return jsonify({"error": "Eksik bilgi"}), 400

    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type='tv'",
        (tmdb_id,),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400

    conn.execute(
        "INSERT INTO episodes (follow_id, season, episode, watched) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(follow_id, season, episode) "
        "DO UPDATE SET watched=excluded.watched",
        (follow["id"], season, episode, watched),
    )
    conn.commit()
    conn.close()
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

    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type='tv'",
        (tmdb_id,),
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
            "INSERT INTO episodes (follow_id, season, episode, air_date, watched) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(follow_id, season, episode) "
            "DO UPDATE SET watched=excluded.watched, air_date=excluded.air_date",
            (follow["id"], season, ep_num, air_date, watched),
        )
        count += 1
    conn.commit()
    conn.close()
    bump()
    return jsonify({"ok": True, "count": count})


@followed_bp.route("/api/movie/watch", methods=["POST"])
def movie_watch():
    body = request.get_json()
    tmdb_id = body.get("tmdb_id")
    watched = 1 if body.get("watched") else 0
    if not tmdb_id:
        return jsonify({"error": "Eksik bilgi"}), 400
    conn = get_db()
    follow = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type='movie'",
        (tmdb_id,),
    ).fetchone()
    if not follow:
        conn.close()
        return jsonify({"error": "Takip bulunamadı"}), 400
    conn.execute("UPDATE followed SET watched=? WHERE id=?", (watched, follow["id"]))
    conn.commit()
    conn.close()
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


def _build_response(media_type, d):
    """Normalleştirilmiş detail sözlüğünü movie/tv JSON yanıtına çevirir."""
    cast = [
        {"id": c.get("person_id"), "name": c.get("name"), "character": c.get("character"), "profile_path": c.get("profile_path")}
        for c in (d.get("cast") or [])
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
    }
    if media_type == "movie":
        base["release_date"] = d.get("release_date")
    else:
        base["first_air_date"] = d.get("first_air_date")
        base["number_of_seasons"] = d.get("number_of_seasons")
        base["number_of_episodes"] = d.get("number_of_episodes")
        base["status"] = d.get("status")
    return base


@followed_bp.route("/api/details")
def details():
    media_type = request.args.get("media_type")
    tmdb_id = request.args.get("tmdb_id")
    lang = (request.args.get("lang") or "").strip() or None
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes")
    if media_type not in ("movie", "tv") or not tmdb_id:
        return jsonify({"error": "Geçersiz istek"}), 400

    conn = get_db()
    follow = conn.execute(
        "SELECT * FROM followed WHERE tmdb_id=? AND media_type=?",
        (tmdb_id, media_type),
    ).fetchone()
    localized = _load_localized(follow["localized"] if follow else None)
    pl = _poster_local_for(media_type, tmdb_id)

    # -- lang VERİLMEDİYSE: legacy davranış (base cached overview, yoksa fetch). --
    if not lang:
        if follow and not refresh:
            d = load_details(conn, follow["id"])
            if d and d.get("overview"):
                conn.close()
                return jsonify(_attach_poster_local(_build_response(media_type, d), pl))
        data = tmdb_request(f"/{media_type}/{tmdb_id}")
        if not data:
            conn.close()
            return jsonify({"error": "TMDB'den veri alınamadı"}), 400
        info = get_tmdb_info(media_type, tmdb_id)
        cst = get_tmdb_cast(media_type, tmdb_id)
        if follow:
            save_details(conn, follow["id"], info, cst)
            _sync_tmdb_poster(conn, media_type, int(tmdb_id), data.get("poster_path"), follow)
            conn.commit()
        conn.close()
        d = dict(info or {})
        d["title"] = data.get("title") or data.get("name") or data.get("original_name") or ""
        d["poster_path"] = data.get("poster_path")
        d["cast"] = cst
        return jsonify(_attach_poster_local(_build_response(media_type, d), pl))

    # -- lang VERİLDİYSE: dil başına önbellek. --
    locale = _lang_to_locale(lang)
    loc = localized.get(lang) if follow else None

    # Cache hit: o dilde kayıt varsa fetch yapmadan dön (cast dil-bağımsız). refresh bypass.
    if follow and loc and loc.get("overview") and not refresh:
        d = load_details(conn, follow["id"]) or {}
        d = dict(d)
        d["title"] = loc.get("title") or d.get("title")
        d["overview"] = loc.get("overview") or d.get("overview")
        d["genres"] = loc.get("genres") or d.get("genres") or []
        d["tagline"] = loc.get("tagline") or d.get("tagline")
        conn.close()
        return jsonify(_attach_poster_local(_build_response(media_type, d), pl))

    # Cache miss: seçilen dilde her zaman canlı fetch, sonra önbelleğe yaz.
    data = tmdb_request(f"/{media_type}/{tmdb_id}", lang=locale)
    if not data:
        conn.close()
        return jsonify({"error": "TMDB'den veri alınamadı"}), 400
    info = get_tmdb_info(media_type, tmdb_id, lang=locale)
    cst = get_tmdb_cast(media_type, tmdb_id)
    if follow:
        _sync_tmdb_poster(conn, media_type, int(tmdb_id), data.get("poster_path"), follow)
        localized[lang] = {
            "title": data.get("title") or data.get("name"),
            "overview": info.get("overview") or "",
            "genres": info.get("genres") or [],
            "tagline": info.get("tagline") or "",
        }
        conn.execute(
            "UPDATE followed SET localized=? WHERE id=?",
            (json.dumps(localized, ensure_ascii=False), follow["id"]),
        )
        save_details(conn, follow["id"], info, cst, include_texts=False)
        conn.commit()
    conn.close()

    d = dict(info or {})
    d["title"] = data.get("title") or data.get("name") or data.get("original_name") or ""
    d["poster_path"] = data.get("poster_path")
    d["cast"] = cst
    return jsonify(_attach_poster_local(_build_response(media_type, d), pl))