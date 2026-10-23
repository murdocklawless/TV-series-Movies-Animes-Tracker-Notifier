"""Öneriler görünümü besleme motoru (feed).

İki pulldown: medya (dizi/film/belgesel/anime) + kaynak
(tmdb trend/popüler/en çok beğenilen, netflix, hbo max, disney+, paramount,
apple tv+, prime video, amc+, rastgele). Seçilen besleme 18 kart döndürür;
takipte VEYA izlenmiş olan ve gizlenen öğeler dışlanır, yerine bir sonraki gelir.

Ham aday havuzu global cache'lenir (feed_cache); kullanıcı bazlı dışlama istek
anında uygulanır. Cache haftalık olarak (feed_schedule ayarına göre, kaynak
başına ayrı gün+saat) scheduler tarafından tazelenir."""
import json
import random
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from db import get_db, get_setting, set_setting
from tmdb import tmdb_request
from anilist import anilist_query, _anime_title, _anime_cover, _anime_next_ep
import query_log
from recommendations import (
    _rec_uid,
    _followed_ids,
    _hidden_ids,
    _attach_tv_details,
    _attach_movie_details,
    _can_move_watched,
)

MEDIA_KINDS = {
    "dizi": "shows",
    "film": "movies",
    "belgesel": "docs",
    "anime": "anime",
}
MEDIA_ORDER = ("dizi", "film", "belgesel", "anime")

FEED_LIMIT = 18
POOL_BUFFER = 60
# 2.20.0 rev2 (feed D): belgesel havuzu AYDA BIR tazelenir (dar kitle, pahali havuz).
FEED_DOCS_DAYS = 30
# 2.20.0 rev2 (feed B): saglayici kaynaklari tek platformlu -> kartin platform
# etiketi kaynaktan bilinir; film/belgesel kartlari icin TMDB detay istegi
# ATILMAZ (tv kartlarinda status icin detay yine cekilir).
PROVIDER_LABELS = {
    "netflix": "Netflix",
    "hbo_max": "HBO Max",
    "disney_plus": "Disney+",
    "paramount": "Paramount+",
    "apple_tv": "Apple TV+",
    "prime_video": "Prime Video",
    "amc": "AMC+",
}

# TMDB watch provider ID'leri (US katalogu). Bölge sabit: kullanıcı tercihi değil.
REGION = "US"
PROVIDERS = {
    "netflix": 8,
    "hbo_max": 1899,
    "disney_plus": 337,
    "paramount": 2303,
    "apple_tv": 350,
    "prime_video": 9,
    "amc": 526,
}
# İkinci pulldown sırası (rastgele en sonda)
FEED_SOURCES = ("trend", "popular", "top_rated", "netflix", "hbo_max",
                "disney_plus", "paramount", "apple_tv", "prime_video", "amc", "random")
TMDB_SOURCE_LABEL = {"trend": "trend", "popular": "popular", "top_rated": "top_rated"}

# Cache güvenlik süresi (haftalık cron gecikirse on-demand yenilenir)
FEED_TTL = 8 * 86400
# 2.00: Bos sonucun cache omru (anime + AMC+/Apple TV+/Paramount gibi gercekten
# bos donen kaynaklar her bakista sorgulanmasin; 24 saat sonra yeniden denenir).
FEED_EMPTY_TTL = 24 * 3600

_feed_lock = threading.Lock()

# Varsayılan haftalık zamanlama: 11 kaynak haftaya yayılır (dow 0=Pzt)
DEFAULT_FEED_SCHEDULE = {
    "trend": {"dow": 0, "time": "04:00"},
    "popular": {"dow": 0, "time": "04:20"},
    "top_rated": {"dow": 1, "time": "04:00"},
    "netflix": {"dow": 1, "time": "04:20"},
    "hbo_max": {"dow": 2, "time": "04:00"},
    "disney_plus": {"dow": 2, "time": "04:20"},
    "paramount": {"dow": 3, "time": "04:00"},
    "apple_tv": {"dow": 3, "time": "04:20"},
    "prime_video": {"dow": 4, "time": "04:00"},
    "amc": {"dow": 4, "time": "04:20"},
    "random": {"dow": 5, "time": "04:00"},
}


ANILIST_FEED_QUERY = """
query ($sort: [MediaSort], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: $sort, isAdult: false) {
      id
      title { romaji english native }
      coverImage { large }
      format
      status
      episodes
      nextAiringEpisode { episode airingAt }
      averageScore
      startDate { year month day }
      genres
      studios(isMain: true) { nodes { name } }
    }
  }
}
"""


def get_feed_schedule():
    """feed_schedule ayarını (JSON) varsayılanlarla birleştirip döndürür."""
    out = {s: dict(v) for s, v in DEFAULT_FEED_SCHEDULE.items()}
    try:
        raw = get_setting("feed_schedule")
        if raw:
            data = json.loads(raw)
            if isinstance(data, dict):
                for s, v in data.items():
                    if s in FEED_SOURCES and isinstance(v, dict) and v.get("time"):
                        try:
                            dow = int(v.get("dow", out[s]["dow"])) % 7
                        except (TypeError, ValueError):
                            dow = out[s]["dow"]
                        out[s] = {"dow": dow, "time": v.get("time")}
    except Exception:
        pass
    return out


# ---------------- cache ----------------

def _cache_key(media, source):
    return f"{media}:{source}"


def _cache_get(key, max_age=FEED_TTL):
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT payload, ts FROM feed_cache WHERE key=?", (key,)
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        items = json.loads(row["payload"] or "[]")
        if not isinstance(items, list):
            return None
        age = time.time() - (row["ts"] or 0)
        if items:
            # Dolu havuz: max_age=0 ise sinirsiz, degilse max_age.
            if max_age and age > max_age:
                return None
            return items
        # 2.00: Bos havuz da cache'lenir; FEED_EMPTY_TTL icinde sorgusuz [] doner.
        if age > FEED_EMPTY_TTL:
            return None
        return []
    except Exception:
        return None


def _cache_put(key, items):
    # 2.00: Bos havuz da yazilir (tekrar sorgulanmasin). _cache_get bos kaydi
    # FEED_EMPTY_TTL ile sinirlar; boylece gecici hata kalici bos olmaz.
    try:
        conn = get_db()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO feed_cache (key, payload, ts) VALUES (?, ?, ?)",
                (key, json.dumps(items or [], ensure_ascii=False), time.time()),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[feed] cache yazma hata: {e}", flush=True)


# ---------------- normalizasyon ----------------

def _norm_tmdb(it, media_type, kind, is_doc=False):
    return {
        "kind": kind,
        "tmdb_id": it.get("id"),
        "anilist_id": None,
        "media_type": media_type,
        "title": it.get("title") or it.get("name") or "",
        "poster_path": it.get("poster_path"),
        "cover_url": None,
        "release_date": it.get("release_date") or it.get("first_air_date") or "",
        "vote_average": it.get("vote_average") or 0,
        "score": None,
        "overview": it.get("overview") or "",
        "genre_ids": it.get("genre_ids") or [],
        "networks": [],
        "tv_status": "",
        "status": "",
        "format": None,
        "is_doc": bool(is_doc),
    }


def _norm_anime(m):
    ep, _air = _anime_next_ep(m)
    sd = m.get("startDate") or {}
    sy, sm, sdy = sd.get("year"), sd.get("month"), sd.get("day")
    rel = f"{sy}-{sm or 1:02d}-{sdy or 1:02d}" if sy else ""
    studios = [s.get("name") for s in ((m.get("studios") or {}).get("nodes") or []) if s.get("name")][:3]
    avg = m.get("averageScore")
    return {
        "kind": "anime",
        "tmdb_id": None,
        "anilist_id": m.get("id"),
        "media_type": "anime",
        "title": _anime_title(m),
        "poster_path": None,
        "cover_url": _anime_cover(m),
        "release_date": rel,
        "vote_average": (avg / 10.0) if avg else 0,
        "score": avg,
        "overview": "",
        "genre_ids": [],
        "networks": studios,
        "tv_status": "",
        "status": m.get("status") or "",
        "format": m.get("format"),
        "is_doc": False,
        "next_episode": ep,
        "airing_at": _air,
    }


# ---------------- kaynak havuzları ----------------

def _tmdb_pages(path, base_params, norm, wanted, pages=(1, 2)):
    out = []
    seen = set()
    for page in pages:
        params = dict(base_params)
        params["page"] = page
        data = tmdb_request(path, params)
        if not data:
            # gecici hata olabilir (429/timeout): kisa bekle, bir kez daha dene
            time.sleep(0.5)
            data = tmdb_request(path, params)
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
            out.append(norm(it))
            if len(out) >= wanted:
                return out
    return out


def _tmdb_media(media_type, kind, source, wanted):
    """Dizi/Film havuzu (trend/popüler/beğenilen/sağlayıcı/rastgele)."""
    params = {"include_adult": "false"}
    if source == "trend":
        path = f"/trending/{media_type}/week"
    elif source == "popular":
        path = f"/{media_type}/popular"
    elif source == "top_rated":
        path = f"/{media_type}/top_rated"
    elif source in PROVIDERS:
        path = f"/discover/{media_type}"
        params.update({
            "with_watch_providers": str(PROVIDERS[source]),
            "watch_region": REGION,
            "with_watch_monetization_types": "flatrate",
            "sort_by": "popularity.desc",
        })
    elif source == "random":
        path = f"/discover/{media_type}"
        params["sort_by"] = "popularity.desc"
    else:
        return []
    norm = lambda it: _norm_tmdb(it, media_type, kind, False)
    return _tmdb_pages(path, params, norm, wanted)


def _tmdb_docs(source, wanted):
    """Belgesel havuzu: film + dizi, with_genres=99."""
    out = []
    for media_type in ("movie", "tv"):
        params = {"with_genres": "99", "include_adult": "false"}
        if source == "top_rated":
            params["sort_by"] = "vote_average.desc"
            params["vote_count.gte"] = "50"
        elif source in PROVIDERS:
            params["sort_by"] = "popularity.desc"
            params.update({
                "with_watch_providers": str(PROVIDERS[source]),
                "watch_region": REGION,
                "with_watch_monetization_types": "flatrate",
            })
        else:  # trend/popüler -> popülerlik yaklaşımı (trend endpoint'i tür filtrelemez)
            params["sort_by"] = "popularity.desc"
        norm = lambda it, mt=media_type: _norm_tmdb(it, mt, "docs", True)
        out.extend(_tmdb_pages(f"/discover/{media_type}", params, norm, wanted))
        if len(out) >= wanted:
            break
    return out


def _anilist_media(sort, wanted):
    out = []
    seen = set()
    per = min(50, max(10, wanted))
    for page in (1, 2):
        data = anilist_query(ANILIST_FEED_QUERY, {"sort": [sort], "page": page, "perPage": per})
        media = ((data or {}).get("Page") or {}).get("media") or []
        if not media:
            break
        for m in media:
            mid = m.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            out.append(_norm_anime(m))
            if len(out) >= wanted:
                return out
    return out


def _anime_pool(source, wanted):
    if source == "trend":
        return _anilist_media("TRENDING_DESC", wanted)
    if source == "popular":
        return _anilist_media("POPULARITY_DESC", wanted)
    if source == "top_rated":
        return _anilist_media("SCORE_DESC", wanted)
    if source == "random":
        items = _anilist_media("TRENDING_DESC", 50)
        random.shuffle(items)
        return items
    if source in PROVIDERS:
        # AniList platform bilgisi vermez -> TMDB animasyon + sağlayıcı fallback
        params = {
            "with_genres": "16",
            "with_original_language": "ja",
            "with_watch_providers": str(PROVIDERS[source]),
            "watch_region": REGION,
            "with_watch_monetization_types": "flatrate",
            "sort_by": "popularity.desc",
            "include_adult": "false",
        }
        norm = lambda it: _norm_tmdb(it, "tv", "anime", False)
        return _tmdb_pages("/discover/tv", params, norm, wanted, pages=(1, 2))
    return []


def _fetch_pool(media, source):
    """Ham aday havuzu (dislama uygulanmaz). random: dort tur karisik.

    2.20.0 rev2 (feed B): saglayici kaynaklarinda ogelere `source_provider` yazilir;
    boylece film/belgesel kartlarinin platform etiketi TMDB'ye sorulmadan
    kaynaktan turetilir."""
    if source == "random":
        if media == "anime":
            pool = _anime_pool("trend", 50)
        elif media == "belgesel":
            pool = _tmdb_docs("trend", 50)
        elif media == "film":
            pool = _tmdb_media("movie", "movies", "trend", 50)
        else:
            pool = _tmdb_media("tv", "shows", "trend", 50)
        random.shuffle(pool)
    elif media == "anime":
        pool = _anime_pool(source, POOL_BUFFER)
    elif media == "belgesel":
        pool = _tmdb_docs(source, POOL_BUFFER)
    elif media == "dizi":
        pool = _tmdb_media("tv", "shows", source, POOL_BUFFER)
    elif media == "film":
        pool = _tmdb_media("movie", "movies", source, POOL_BUFFER)
    else:
        pool = []
    label = PROVIDER_LABELS.get(source)
    if label:
        for it in pool:
            try:
                it["source_provider"] = label
            except Exception:
                pass
    return pool


# ---------------- üretim ----------------

def _blocked_sets(conn, uid):
    """kind -> (followed, hidden) sözlükleri (tembel)."""
    cache = {}

    def get(kind):
        if kind not in cache:
            followed = _followed_ids(conn, kind, user_id=uid)
            hidden = _hidden_ids(kind, user_id=uid)
            if kind == "movies":
                hidden = hidden | _hidden_ids("docs", user_id=uid)
            cache[kind] = (followed, hidden)
        return cache[kind]

    return get


def generate_feed(conn, media, source, user_id=None, limit=FEED_LIMIT, force=False):
    """Seçilen medya+kaynak için, dışlanmış 18 kart üretir.

    force=False: cache-first, yaş sınırı YOK. Havuz feed_cache'te varsa
    sorgusuz kullanılır; yoksa çekilip cache'lenir. Kart detayları da
    rec_detail'te varsa sorgusuz kullanılır, yoksa çekilir.
    force=True: havuz + detaylar her zaman yeniden çekilir (refresh butonu).
    """
    if media not in MEDIA_KINDS or source not in FEED_SOURCES:
        return []
    uid = _rec_uid(user_id)
    key = _cache_key(media, source)
    # 1.99: cache-first, yas siniri yok. Cache yoksa cek + cache'le.
    pool = None if force else _cache_get(key, max_age=0)
    if pool is None:
        pool = _fetch_pool(media, source)
        _cache_put(key, pool)

    get_blocked = _blocked_sets(conn, uid)
    chosen = []
    for cand in pool:
        # Dışlama anahtarı öğenin gerçek türüne göre (TMDB anime fallback -> shows)
        if cand.get("anilist_id") is not None:
            kind_for_excl = "anime"
            ident = cand.get("anilist_id")
        else:
            if cand.get("is_doc"):
                kind_for_excl = "docs"
            elif cand.get("media_type") == "movie":
                kind_for_excl = "movies"
            else:
                kind_for_excl = "shows"
            ident = cand.get("tmdb_id")
        followed, hidden = get_blocked(kind_for_excl)
        if ident is None:
            continue
        if ident in followed or ident in hidden:
            continue
        chosen.append(cand)
        if len(chosen) >= limit:
            break

    # Detaylar (networks/status) + izlenmişe taşı uygunluğu
    tv_items = [c for c in chosen if c.get("media_type") == "tv"]
    mv_items = [c for c in chosen if c.get("media_type") == "movie"]
    if tv_items:
        _attach_tv_details(tv_items, force=force, tag="feed.detail")
    if mv_items:
        _attach_movie_details(mv_items, force=force, tag="feed.detail")
    for c in chosen:
        try:
            c["can_move_watched"] = _can_move_watched(c)
        except Exception:
            c["can_move_watched"] = False
    return chosen


def _docs_due():
    """2.20.0 rev2 (feed D): belgesel havuzu en son 30+ gun once tazelendiyse due."""
    try:
        last = int(get_setting("feed_docs_last") or 0)
    except Exception:
        last = 0
    return (time.time() - last) >= FEED_DOCS_DAYS * 86400


def _docs_mark():
    try:
        set_setting("feed_docs_last", int(time.time()))
    except Exception:
        pass


def refresh_feed_source(source):
    """Bir kaynagin ham cache'lerini yeniler (scheduler).

    2.19.25: havuzun TAMAMININ detayi yeniden cekilmiyordu (force kaldirildi).
    2.20.0 rev2 (feed A): havuz detay ON-ISITMASI tamamen kaldirildi — kart detayi
    yalniz GOSTERILEN kartlar icin, gosterim yolunda cekilir (rec_detail
    kalici oldugu icin her kart en fazla bir kez sorulur).
    2.20.0 rev2 (feed D): belgesel havuzu ayda bir tazelenir.
    """
    if source not in FEED_SOURCES:
        return
    query_log.begin_run("feed.refresh", sec=f"feed:{source}")
    query_log.set_tag("feed.pool")
    docs_due = _docs_due()
    try:
        for media in MEDIA_ORDER:
            if media == "belgesel" and not docs_due:
                continue
            pool = _fetch_pool(media, source)
            _cache_put(f"{media}:{source}", pool)
            if media == "belgesel":
                _docs_mark()
    except Exception as e:
        print(f"[feed] refresh hata ({source}): {e}", flush=True)
    finally:
        query_log.end_run()


def refresh_all_feeds():
    for s in FEED_SOURCES:
        refresh_feed_source(s)


def feed_next_run(source):
    """Kaynağın feed_schedule (dow + saat) tanımına göre bir sonraki tazelenme zamanı (epoch)."""
    if source not in FEED_SOURCES:
        return None
    try:
        sch = get_feed_schedule().get(source)
        if not sch:
            return None
        dow = int(sch.get("dow", 0)) % 7
        hm = (str(sch.get("time") or "04:00")).split(":")
        h = int(hm[0]) % 24
        m = int(hm[1]) % 60
        try:
            tz = ZoneInfo(get_setting("timezone") or "Europe/Istanbul")
        except Exception:
            tz = ZoneInfo("Europe/Istanbul")
        now = datetime.now(tz)
        for delta in range(8):
            cand = (now + timedelta(days=delta)).replace(hour=h, minute=m, second=0, microsecond=0)
            if cand.weekday() == dow and cand > now:
                return int(cand.timestamp())
    except Exception:
        pass
    return None


def feed_last_run(source):
    """Kaynağın feed_schedule (dow + saat) tanımına göre son planlı tazelenme zamanı (epoch)."""
    if source not in FEED_SOURCES:
        return None
    try:
        sch = get_feed_schedule().get(source)
        if not sch:
            return None
        dow = int(sch.get("dow", 0)) % 7
        hm = (str(sch.get("time") or "04:00")).split(":")
        h = int(hm[0]) % 24
        m = int(hm[1]) % 60
        try:
            tz = ZoneInfo(get_setting("timezone") or "Europe/Istanbul")
        except Exception:
            tz = ZoneInfo("Europe/Istanbul")
        now = datetime.now(tz)
        for delta in range(8):
            cand = (now - timedelta(days=delta)).replace(hour=h, minute=m, second=0, microsecond=0)
            if cand.weekday() == dow and cand <= now:
                return int(cand.timestamp())
    except Exception:
        pass
    return None
