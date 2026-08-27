"""Favori oyuncu / tür listeleme cache'i.
Oyuncu: limitsiz (combined_credits tamamı), Tür: 30 (discover).
Payload'lar gen/TTL'den bağımsız RAM + fav_listing_cache tablosunda tutulur;
fp = today_str() ile günde bir yenilenir, rec_hour (05:25) cron'u tetikler."""
import json
import threading
import time

from db import get_db, today_str
from tmdb import tmdb_request, _genre_names_to_ids, _genre_ids_for_media

GENRE_LIMIT = 30

_fav_lock = threading.Lock()
_fav_ram = {}  # {(kind, ident): {"items": [...], "fp": str}}


def _load_row(kind, ident):
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT payload, fp FROM fav_listing_cache WHERE kind=? AND ident=?",
            (kind, ident),
        ).fetchone()
        conn.close()
        return row
    except Exception:
        return None


def load_fav_listing(kind, ident):
    """Cache HIT ise items döner, yoksa/ fp değişmişse None."""
    fp = today_str()
    key = (kind, ident)
    with _fav_lock:
        entry = _fav_ram.get(key)
        if entry and entry.get("fp") == fp:
            return entry["items"]
    row = _load_row(kind, ident)
    if row and row["fp"] == fp:
        try:
            items = json.loads(row["payload"])
            if isinstance(items, list):
                with _fav_lock:
                    _fav_ram[key] = {"items": items, "fp": fp}
                return items
        except (ValueError, TypeError):
            pass
    return None


def save_fav_listing(kind, ident, items):
    fp = today_str()
    key = (kind, ident)
    with _fav_lock:
        _fav_ram[key] = {"items": items, "fp": fp}
    try:
        conn = get_db()
        conn.execute(
            "INSERT OR REPLACE INTO fav_listing_cache (kind, ident, payload, ts, fp) VALUES (?, ?, ?, ?, ?)",
            (kind, ident, json.dumps(items, ensure_ascii=False), time.time(), fp),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def invalidate_fav_listing(kind, ident):
    key = (kind, ident)
    with _fav_lock:
        _fav_ram.pop(key, None)
    try:
        conn = get_db()
        conn.execute("DELETE FROM fav_listing_cache WHERE kind=? AND ident=?", (kind, ident))
        conn.commit()
        conn.close()
    except Exception:
        pass


def _fetch_actor_credits(person_id):
    data = tmdb_request(f"/person/{person_id}/combined_credits")
    if not data:
        return None
    results = []
    for item in (data.get("cast") or []):
        media_type = item.get("media_type")
        if media_type not in ("movie", "tv"):
            continue
        title = item.get("title") or item.get("name")
        if not title:
            continue
        results.append(
            {
                "tmdb_id": item.get("id"),
                "media_type": media_type,
                "title": title,
                "poster_path": item.get("poster_path"),
                "release_date": item.get("release_date") or item.get("first_air_date"),
                "vote_average": item.get("vote_average") or 0,
                "character": item.get("character"),
            }
        )
    return results


def _fetch_genre_candidates(genre_name, media="all", wanted=GENRE_LIMIT):
    names = [genre_name]
    gids_raw = _genre_names_to_ids(names)
    if not gids_raw:
        return []
    out = []
    seen = set()
    # discover tv + movie separately, merge by popularity
    targets = []
    if media in ("tv", "all"):
        targets.append("tv")
    if media in ("movie", "all"):
        targets.append("movie")
    # fetch per media then interleave by popularity would be complex; simple: fetch both and sort by not needed, just fill 30 from merged
    # do 3 pages per media
    from tmdb import tmdb_request as _req
    per_media = {}
    for mt in targets:
        gids = _genre_ids_for_media(gids_raw, mt) if gids_raw else []
        per_media[mt] = []
        for page in (1, 2, 3):
            params = {
                "sort_by": "popularity.desc",
                "vote_average.gte": 6,
                "page": page,
                "include_adult": "false",
            }
            if gids:
                params["with_genres"] = ",".join(str(g) for g in gids)
            data = _req(f"/discover/{mt}", params)
            if not data:
                break
            results = data.get("results") or []
            if not results:
                break
            for it in results:
                tid = it.get("id")
                if not tid or tid in seen:
                    continue
                seen.add(tid)
                per_media[mt].append(
                    {
                        "tmdb_id": tid,
                        "media_type": mt,
                        "title": it.get("title") or it.get("name") or "",
                        "poster_path": it.get("poster_path"),
                        "release_date": it.get("release_date") or it.get("first_air_date"),
                        "vote_average": it.get("vote_average") or 0,
                    }
                )
                if len(per_media[mt]) >= wanted:
                    break
            if len(per_media[mt]) >= wanted:
                break
    # merge: alternate tv/movie to get mix; if only one media, just trim
    if len(targets) == 2:
        tvs = per_media.get("tv") or []
        movies = per_media.get("movie") or []
        i = j = 0
        while len(out) < wanted and (i < len(tvs) or j < len(movies)):
            if i < len(tvs):
                out.append(tvs[i]); i += 1
                if len(out) >= wanted: break
            if j < len(movies):
                out.append(movies[j]); j += 1
    else:
        mt = targets[0]
        out = (per_media.get(mt) or [])[:wanted]
    return out[:wanted]


def generate_fav_actor(person_id):
    try:
        pid = int(person_id)
    except (TypeError, ValueError):
        return None
    return _fetch_actor_credits(pid)


def generate_fav_genre(genre_name, media="all"):
    return _fetch_genre_candidates(genre_name, media=media, wanted=GENRE_LIMIT)


def refresh_all_fav_listings():
    """Gecede bir scheduler'in çağıracağı tam tazeleme (fail-soft)."""
    try:
        from db import get_db, get_setting
        conn = get_db()
        # collect actor ids
        actor_idents = []
        try:
            import json as _json
            raw = get_setting("fav_actors")
            arr = _json.loads(raw) if raw else []
            for a in arr:
                pid = a.get("person_id")
                if pid is not None:
                    actor_idents.append(str(pid))
        except Exception:
            pass
        # collect genre names
        genre_names = []
        try:
            raw = get_setting("fav_genres")
            arr = _json.loads(raw) if raw else []
            for g in arr:
                if isinstance(g, str) and g.strip():
                    genre_names.append(g.strip())
        except Exception:
            pass
        conn.close()
        for pid in actor_idents:
            try:
                items = generate_fav_actor(pid)
                if items is not None:
                    save_fav_listing("actor", str(pid), items)
            except Exception:
                continue
        for g in genre_names:
            ident = g.lower() + "|all"
            try:
                items = generate_fav_genre(g, media="all")
                if items is not None:
                    save_fav_listing("genre", ident, items)
            except Exception:
                continue
        # 30 günden eski fav cache temizle
        cutoff = time.time() - 30 * 86400
        try:
            c2 = get_db()
            c2.execute("DELETE FROM fav_listing_cache WHERE ts < ?", (cutoff,))
            c2.commit()
            c2.close()
        except Exception:
            pass
    except Exception:
        pass
