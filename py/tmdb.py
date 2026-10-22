import collections
import json
import threading
import time

import requests

import query_log
from db import get_setting, _safe_json_list
from rate_track import acquire, record, handle_429

# ---------------------------------------------------------------------------
# 2.19.25: HTTP yanit onbellegi (ayni URL tekrar tekrar sorulmasin).
# TTL 6 saat; `no_cache=True` (kullanici "yenile") baypas eder.
# Yalnizca 200 + icerikli yanitlar yazilir; hata/429 asla onbelleklenmez.
# ---------------------------------------------------------------------------
CACHE_TTL = 6 * 3600
CACHE_MAX = 500

_CACHE = collections.OrderedDict()
_CACHE_LOCK = threading.Lock()


def _cache_key(path, lang, params):
    try:
        items = tuple(sorted((str(k), str(v)) for k, v in (params or {}).items()))
    except Exception:
        items = ()
    return (str(path), str(lang or ""), items)


def _cache_get(key):
    now = time.time()
    with _CACHE_LOCK:
        row = _CACHE.get(key)
        if not row:
            return None
        ts, data = row
        if now - ts > CACHE_TTL:
            _CACHE.pop(key, None)
            return None
        _CACHE.move_to_end(key)
        return data


def _cache_put(key, data):
    now = time.time()
    with _CACHE_LOCK:
        _CACHE[key] = (now, data)
        _CACHE.move_to_end(key)
        while len(_CACHE) > CACHE_MAX:
            _CACHE.popitem(last=False)


def cache_clear():
    with _CACHE_LOCK:
        _CACHE.clear()


def cache_info():
    with _CACHE_LOCK:
        return {"entries": len(_CACHE), "ttl": CACHE_TTL, "max": CACHE_MAX}


def tmdb_request(path, params=None, lang=None, tag=None, no_cache=False):
    """TMDB isteği yapar. `lang` verilirse o dilde (en-US yedeğiyle) çeker;
    verilmezse ayarlı dile göre döner.

    2.19.25: aynı (path, params, lang) 6 saat içinde tekrar sorulmaz.
    `no_cache=True` kullanıcı kaynaklı yenilemelerde önbelleği atlar.
    Her gerçek istek/onbellek isabeti `query_log`'a yazılır."""
    api_key = get_setting("tmdb_api_key")
    if not api_key:
        return None
    url = "https://api.themoviedb.org/3/" + path.lstrip("/")
    if lang:
        langs = [lang] + (["en-US"] if lang != "en-US" else [])
    else:
        selected = get_setting("language") or "tr-TR"
        langs = ["en-US"]
        if selected != "en-US":
            langs.insert(0, selected)
    for l in langs:
        p = {"api_key": api_key, "language": l}
        if params:
            p.update(params)
        key = _cache_key(url, l, params)
        if not no_cache:
            hit = _cache_get(key)
            if hit is not None:
                query_log.log("tmdb", "GET", path, params=params, status=200,
                              ms=0, src="cache", tag=tag)
                return hit
        acquire("tmdb")
        t0 = time.time()
        try:
            r = requests.get(url, params=p, timeout=15)
        except requests.RequestException as exc:
            query_log.log("tmdb", "GET", path, params=params, status=0,
                          ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                          err=str(exc)[:120])
            continue
        record("tmdb")
        if r.status_code == 429:
            query_log.log("tmdb", "GET", path, params=params, status=429,
                          ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                          err="rate-limit")
            handle_429("tmdb", r)
            acquire("tmdb")
            t0 = time.time()
            try:
                r = requests.get(url, params=p, timeout=15)
            except requests.RequestException as exc:
                query_log.log("tmdb", "GET", path, params=params, status=0,
                              ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                              err=str(exc)[:120])
                continue
            record("tmdb")
        if r.status_code != 200:
            query_log.log("tmdb", "GET", path, params=params, status=r.status_code,
                          ms=int((time.time() - t0) * 1000), src="net", tag=tag)
            return None
        data = r.json()
        query_log.log("tmdb", "GET", path, params=params, status=200,
                      ms=int((time.time() - t0) * 1000), src="net", tag=tag)
        if _has_content(data):
            if not no_cache:
                _cache_put(key, data)
            return data
    return None


def _has_content(data):
    """TMDB yanıtında kullanılabilir içerik olup olmadığını kontrol eder."""
    if not data:
        return False
    if isinstance(data, list):
        return bool(data)
    if "results" in data:
        return bool(data.get("results"))
    if data.get("title") or data.get("name") or data.get("overview"):
        return True
    if data.get("cast") or data.get("crew") or data.get("episodes"):
        return True
    if data.get("genres"):
        return True
    return False


_genre_cache = None


def _genre_names_to_ids(names):
    """Favori tür isimlerini TMDB genre ID'lerine çevirir (dil duyarlı)."""
    global _genre_cache
    if _genre_cache is None:
        _genre_cache = {}
        selected = get_setting("language") or "tr-TR"
        for lang in ({selected, "en-US"} if selected != "en-US" else {"en-US"}):
            for gpath in ("genre/movie/list", "genre/tv/list"):
                data = tmdb_request(gpath, {"language": lang})
                if data:
                    for g in (data.get("genres") or []):
                        gid = g.get("id")
                        gname = (g.get("name") or "").strip().lower()
                        if gid and gname:
                            _genre_cache.setdefault(gname, gid)
    wanted = {n.lower() for n in names}
    return [_genre_cache[n] for n in wanted if n in _genre_cache]


def _genre_ids_for_media(gids, media_type):
    """Tür ID listesini ortama göre normalize eder. TMDB'de TV'ye özel birleşik
    türleri film eşleniklerine genişletir (filmler o tür ID'sini taşımaz)."""
    out = set(gids)
    if media_type == "movie" and 10759 in out:  # Aksiyon & Macera -> Aksiyon + Macera
        out.discard(10759)
        out.update([28, 12])
    return out


def _fetch_tmdb_genres():
    """TMDB'den (seçili dilde) tüm film+dizi tür isimlerini döndürür."""
    selected = get_setting("language") or "tr-TR"
    names = []
    seen = set()
    for gpath in ("genre/movie/list", "genre/tv/list"):
        data = tmdb_request(gpath, {"language": selected})
        if data:
            for g in (data.get("genres") or []):
                gname = (g.get("name") or "").strip()
                if gname and gname.lower() not in seen:
                    seen.add(gname.lower())
                    names.append(gname)
    return names


def get_tmdb_info(media_type, tmdb_id, lang=None, data=None, tag=None):
    """TMDB'den temel bilgileri çeker: release_date, vote_average, yayın platformları ve detay alanları.
    `lang` verilirse TMDB verisi o dilde çekilir.
    `data` verilirse (zaten çekilmiş detay) yeniden istek atılmaz (2.19.25)."""
    if media_type not in ("movie", "tv"):
        return None
    if data is None:
        data = tmdb_request(f"/{media_type}/{tmdb_id}", lang=lang, tag=tag)
    if not data:
        return None
    networks = [n.get("name") for n in (data.get("networks") or []) if n.get("name")]
    genres = [g.get("name") for g in data.get("genres", []) if g.get("name")]
    if media_type == "movie":
        networks = [c.get("name") for c in (data.get("production_companies") or []) if c.get("name")]
        return {
            "release_date": data.get("release_date"),
            "vote_average": data.get("vote_average") or 0,
            "vote_count": data.get("vote_count"),
            "networks": networks,
            "overview": data.get("overview") or "",
            "genres": genres,
            "tagline": data.get("tagline") or "",
            "runtime": data.get("runtime"),
            "number_of_seasons": None,
            "number_of_episodes": None,
            "status": data.get("status") or "",
            "season_list": [],
        }
    season_list = [
        {
            "season_number": s.get("season_number"),
            "name": s.get("name") or "",
            "air_date": s.get("air_date"),
            "episode_count": s.get("episode_count"),
        }
        for s in (data.get("seasons") or [])
        if s.get("season_number") and s.get("season_number") != 0
    ]
    return {
        "release_date": data.get("first_air_date"),
        "vote_average": data.get("vote_average") or 0,
        "vote_count": data.get("vote_count"),
        "networks": networks,
        "overview": data.get("overview") or "",
        "genres": genres,
        "tagline": data.get("tagline") or "",
        "runtime": (data.get("episode_run_time") or [None])[0],
        "number_of_seasons": data.get("number_of_seasons"),
        "number_of_episodes": data.get("number_of_episodes"),
        "status": data.get("status") or "",
        "season_list": season_list,
    }


def get_tmdb_info_fallback(media_type, tmdb_id, lang=None, sel_data=None, tag=None):
    """Secili dilde bos metin alanlarini en-US ile doldurur (14 dil icin genel kural).

    Kapsar: overview, tagline, genres. Title, cagiran tarafta
    get_tmdb_title_fallback() ile birlestirilir (get_tmdb_info title dondurmez).
    Donus: info dict + _fallback_lang (_en_ ya da None) + _fallback_fields listesi.
    locale zaten en ise ikinci cagri yapilmaz.
    2.19.25: `sel_data` verilirse secili dil icin yeniden istek atilmaz.
    """
    eff_lang = lang
    if not (eff_lang or "").strip():
        try:
            eff_lang = get_setting("language") or "tr-TR"
        except Exception:
            eff_lang = "tr-TR"
    sel = get_tmdb_info(media_type, tmdb_id, lang=lang, data=sel_data, tag=tag)
    norm = (eff_lang or "").strip()
    base = norm.lower().split("-")[0]
    if base in ("", "en"):
        if sel is None:
            return None
        out = dict(sel)
        out["_fallback_lang"] = None
        out["_fallback_fields"] = []
        return out
    if sel is None:
        en = get_tmdb_info(media_type, tmdb_id, lang="en-US", tag=tag)
        if not en:
            return None
        out = dict(en)
        out["_fallback_lang"] = "en"
        out["_fallback_fields"] = ["overview", "tagline", "genres", "title"]
        return out
    need = []
    if not (sel.get("overview") or "").strip():
        need.append("overview")
    if not (sel.get("tagline") or "").strip():
        need.append("tagline")
    if not (sel.get("genres") or []):
        need.append("genres")
    if not need:
        out = dict(sel)
        out["_fallback_lang"] = None
        out["_fallback_fields"] = []
        return out
    en = get_tmdb_info(media_type, tmdb_id, lang="en-US", tag=tag)
    if not en:
        out = dict(sel)
        out["_fallback_lang"] = None
        out["_fallback_fields"] = []
        return out
    merged = dict(sel)
    fb = []
    for f in ("overview", "tagline", "genres"):
        if f in need and en.get(f):
            merged[f] = en[f]
            fb.append(f)
    merged["_fallback_lang"] = "en" if fb else None
    merged["_fallback_fields"] = fb
    return merged


def get_tmdb_title_fallback(media_type, tmdb_id, lang=None, sel_data=None, tag=None):
    """Baslik icin secili dil -> en-US fallback. (title, fallback_yapildi_mi) doner."""
    data = sel_data
    if data is None:
        data = tmdb_request(f"/{media_type}/{tmdb_id}", lang=lang, tag=tag)
    title = (data or {}).get("title") or (data or {}).get("name") or (data or {}).get("original_name") or ""
    if (title or "").strip():
        return title, False
    eff = (lang or "").strip()
    if not eff:
        try:
            eff = get_setting("language") or "tr-TR"
        except Exception:
            eff = "tr-TR"
    norm = eff.strip().lower().split("-")[0]
    if norm in ("", "en"):
        return title, False
    en_data = tmdb_request(f"/{media_type}/{tmdb_id}", lang="en-US", tag=tag)
    en_title = (en_data or {}).get("title") or (en_data or {}).get("name") or (en_data or {}).get("original_name") or ""
    if (en_title or "").strip():
        return en_title, True
    return title, False


def get_tmdb_credits(media_type, tmdb_id, data=None, tag=None):
    """TMDB credits'ten oyuncu kadrosu (ilk 8) + yönetmenleri döndürür.

    Tek istekle ikisini birden çıkarır; döndürülen sözlük
    {"cast": [...], "directors": [...]} biçimindedir. Yönetmen kaydı:
    {"person_id", "name", "profile_path"}.
    Not: dizilerde /credits ekip listesi yönetmen içermez, o yüzden
    dizi için /aggregate_credits kullanılır (crew.jobs dizisi + cast.roles).
    2.19.25: `data` (append_to_response ile alınmış detay) verilirse ek istek atılmaz.
    """
    if media_type not in ("movie", "tv"):
        return {"cast": [], "directors": []}
    ckey = "aggregate_credits" if media_type == "tv" else "credits"
    path = f"/{media_type}/{tmdb_id}/{ckey}"
    credits = data.get(ckey) if isinstance(data, dict) else None
    if not credits:
        credits = tmdb_request(path, tag=tag)
    if not credits:
        return {"cast": [], "directors": []}
    cast = []
    for c in (credits.get("cast") or [])[:8]:
        name = c.get("name") or c.get("original_name")
        if not name:
            continue
        character = c.get("character") or ""
        if not character and media_type == "tv":
            roles = c.get("roles") or []
            character = (roles[0].get("character") if roles else "") or ""
        cast.append(
            {
                "person_id": c.get("id"),
                "name": name,
                "character": character,
                "profile_path": c.get("profile_path"),
            }
        )
    directors = []
    for m in credits.get("crew") or []:
        if media_type == "tv":
            jobs = [(j.get("job") or "").strip().lower() for j in (m.get("jobs") or [])]
            if "director" not in jobs:
                continue
        elif (m.get("job") or "").strip().lower() != "director":
            continue
        name = m.get("name") or m.get("original_name")
        if not name:
            continue
        if any(d.get("person_id") == m.get("id") for d in directors):
            continue
        directors.append(
            {
                "person_id": m.get("id"),
                "name": name,
                "profile_path": m.get("profile_path"),
            }
        )
    return {"cast": cast, "directors": directors}


def get_tmdb_cast(media_type, tmdb_id):
    """TMDB'den oyuncu kadrosunu çeker (ilk 8)."""
    return get_tmdb_credits(media_type, tmdb_id).get("cast") or []


def get_tmdb_directors(media_type, tmdb_id):
    """TMDB credits.crew içinden job=Director olanları döndürür (tümü)."""
    return get_tmdb_credits(media_type, tmdb_id).get("directors") or []


def save_details(conn, follow_id, info, cast, include_texts=True, directors=None):
    """Detay verilerini, oyuncu kadrosunu ve yönetmenleri DB'ye yazar.
    include_texts=False ise overview/genres/tagline korunur (dil-bagimsiz refresh icin).
    directors=None ise mevcut yönetmen kayıtlarına dokunulmaz."""
    if not info:
        return
    if include_texts:
        conn.execute(
            "UPDATE followed SET overview=?, genres=?, tagline=?, runtime=?, "
            "number_of_seasons=?, number_of_episodes=?, status=?, season_list=?, "
            "vote_count=?, first_air_date=? WHERE id=?",
            (
                info.get("overview") or "",
                json.dumps(info.get("genres") or []),
                info.get("tagline") or "",
                info.get("runtime"),
                info.get("number_of_seasons"),
                info.get("number_of_episodes"),
                info.get("status") or "",
                json.dumps(info.get("season_list") or []),
                info.get("vote_count"),
                info.get("release_date"),
                follow_id,
            ),
        )
    else:
        conn.execute(
            "UPDATE followed SET runtime=?, number_of_seasons=?, number_of_episodes=?, "
            "status=?, season_list=?, vote_count=?, first_air_date=? WHERE id=?",
            (
                info.get("runtime"),
                info.get("number_of_seasons"),
                info.get("number_of_episodes"),
                info.get("status") or "",
                json.dumps(info.get("season_list") or []),
                info.get("vote_count"),
                info.get("release_date"),
                follow_id,
            ),
        )
    conn.execute("DELETE FROM cast WHERE follow_id=?", (follow_id,))
    for i, c in enumerate(cast):
        conn.execute(
            "INSERT INTO cast (follow_id, person_id, name, character, profile_path, sort_order) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (follow_id, c.get("person_id"), c.get("name"), c.get("character") or "", c.get("profile_path"), i),
        )
    if directors is not None:
        save_directors(conn, follow_id, directors)


def save_directors(conn, follow_id, directors):
    """Sadece yönetmen kayıtlarını yeniler (cast'a dokunmaz)."""
    try:
        conn.execute("DELETE FROM directors WHERE follow_id=?", (follow_id,))
        for i, d in enumerate(directors or []):
            conn.execute(
                "INSERT INTO directors (follow_id, person_id, name, profile_path, sort_order) "
                "VALUES (?, ?, ?, ?, ?)",
                (follow_id, d.get("person_id"), d.get("name"), d.get("profile_path"), i),
            )
    except Exception:
        pass


def load_details(conn, follow_id):
    """follow_id için DB'de saklı detay verilerini ve oyuncu kadrosunu döndürür (None = yok)."""
    row = conn.execute(
        "SELECT overview, genres, tagline, runtime, number_of_seasons, number_of_episodes, "
        "status, season_list, vote_count, first_air_date, poster_path, vote_average, release_date, title "
        "FROM followed WHERE id=?",
        (follow_id,),
    ).fetchone()
    if not row:
        return None
    cast = conn.execute(
        "SELECT person_id, name, character, profile_path FROM cast WHERE follow_id=? ORDER BY sort_order",
        (follow_id,),
    ).fetchall()
    try:
        directors = conn.execute(
            "SELECT person_id, name, profile_path FROM directors WHERE follow_id=? ORDER BY sort_order",
            (follow_id,),
        ).fetchall()
    except Exception:
        directors = []
    return {
        "overview": row["overview"] or "",
        "genres": _safe_json_list(row["genres"]),
        "tagline": row["tagline"] or "",
        "runtime": row["runtime"],
        "number_of_seasons": row["number_of_seasons"],
        "number_of_episodes": row["number_of_episodes"],
        "status": row["status"] or "",
        "season_list": _safe_json_list(row["season_list"]),
        "vote_count": row["vote_count"],
        "first_air_date": row["first_air_date"] or row["release_date"],
        "poster_path": row["poster_path"],
        "vote_average": row["vote_average"],
        "release_date": row["release_date"],
        "title": row["title"],
        "cast": [dict(c) for c in cast],
        "directors": [{"person_id": d["person_id"], "name": d["name"], "profile_path": d["profile_path"]} for d in directors],
    }


def _person_crew_ids(kind, person_id, job="director"):
    """Kişinin movie/tv_credits crew kayıtlarından verilen roldeki iş ID'lerini döndürür."""
    try:
        data = tmdb_request(f"/person/{person_id}/{kind}_credits")
    except Exception:
        return set()
    if not data:
        return set()
    job = (job or "").strip().lower()
    return {
        item.get("id")
        for item in (data.get("crew") or [])
        if item.get("id") and (item.get("job") or "").strip().lower() == job
    }


def _tmdb_tv_by_people(params, genre_filter=None, doc_only=False):
    """TV'de with_people discover güvenilmez (filtreyi yok sayıyor); bunun yerine
    her oyuncunun tv_credits'inden şovları toplayıp tür/yıl/puan/başlık filtrelerini
    kendi tarafımızda uygular. with_crew verilirse yönetmen (crew/Director)
    kayıtlarıyla kesiştirir; yalnız with_crew varsa yönetilen şovları listeler."""
    person_ids = [p for p in (params.get("with_people") or "").split(",") if p]
    crew_ids = [p for p in (params.get("with_crew") or "").split(",") if p]
    year = params.get("first_air_date_year")
    score = params.get("vote_average.gte")
    query = params.get("query")
    show_ids = []
    for pid in person_ids:
        data = tmdb_request(f"/person/{pid}/tv_credits")
        if data:
            for item in (data.get("cast") or []):
                sid = item.get("id")
                if sid and sid not in show_ids:
                    show_ids.append(sid)
    if crew_ids:
        directed = set()
        for pid in crew_ids:
            directed |= _person_crew_ids("tv", pid)
        if person_ids:
            show_ids = [sid for sid in show_ids if sid in directed]
        else:
            show_ids = sorted(directed)
    out = []
    for sid in show_ids:
        det = tmdb_request(f"/tv/{sid}")
        if not det:
            continue
        genres = set((g or {}).get("id") for g in (det.get("genres") or []))
        if genre_filter and not (genres & genre_filter):
            continue
        if doc_only and 99 not in genres:
            continue
        first_air = det.get("first_air_date") or ""
        if year and not first_air.startswith(str(year)):
            continue
        va = det.get("vote_average") or 0
        if score is not None and va < score:
            continue
        if query and query.lower() not in (det.get("name") or "").lower():
            continue
        out.append(
            {
                "tmdb_id": det.get("id"),
                "media_type": "tv",
                "title": det.get("name"),
                "poster_path": det.get("poster_path"),
                "release_date": det.get("first_air_date"),
                "vote_average": va,
                "overview": det.get("overview"),
                "number_of_seasons": det.get("number_of_seasons"),
                "number_of_episodes": det.get("number_of_episodes"),
                "networks": [n.get("name") for n in (det.get("networks") or []) if n.get("name")],
                "status": det.get("status") or "",
            }
        )
    out.sort(key=lambda x: x["vote_average"], reverse=True)
    return out[:50]


def _tmdb_movie_by_people(params, genre_filter=None, doc_only=False):
    """Movie'de with_people discover limitli (20) ve eksik; aktörün movie_credits
    uç noktasından tüm filmleri toplayıp tür/yıl/puan/başlık filtrelerini kendi
    tarafımızda uygular. with_crew verilirse yönetmen (crew/Director) kayıtlarıyla
    kesiştirir; yalnız with_crew varsa yönetilen filmleri listeler."""
    person_ids = [p for p in (params.get("with_people") or "").split(",") if p]
    crew_ids = [p for p in (params.get("with_crew") or "").split(",") if p]
    year = params.get("primary_release_year")
    score = params.get("vote_average.gte")
    query = params.get("query")
    out = []
    seen = set()
    directed = None
    if crew_ids:
        directed = set()
        for pid in crew_ids:
            directed |= _person_crew_ids("movie", pid)
        if not directed and not person_ids:
            return []
    pools = []
    if person_ids:
        for pid in person_ids:
            data = tmdb_request(f"/person/{pid}/movie_credits")
            if data:
                pools.append(data.get("cast") or [])
    if crew_ids and not person_ids:
        for pid in crew_ids:
            data = tmdb_request(f"/person/{pid}/movie_credits")
            if data:
                pools.append([i for i in (data.get("crew") or []) if (i.get("job") or "").strip().lower() == "director"])
    for pool in pools:
        for item in pool:
            mid = item.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            if directed is not None and mid not in directed:
                continue
            if genre_filter:
                item_genres = set(item.get("genre_ids") or [])
                if not (item_genres & genre_filter):
                    continue
            if doc_only and 99 not in (item.get("genre_ids") or []):
                continue
            release = item.get("release_date") or ""
            if year and not release.startswith(str(year)):
                continue
            va = item.get("vote_average") or 0
            if score is not None and va < score:
                continue
            if query and query.lower() not in (item.get("title") or "").lower():
                continue
            out.append(
                {
                    "tmdb_id": mid,
                    "media_type": "movie",
                    "title": item.get("title"),
                    "poster_path": item.get("poster_path"),
                    "release_date": release,
                    "vote_average": va,
                    "overview": item.get("overview"),
                    "number_of_seasons": None,
                    "number_of_episodes": None,
                }
            )
    out.sort(key=lambda x: x["vote_average"], reverse=True)
    return out[:50]


def _tmdb_adv_results(params_movie, params_tv, genre_filter=None, media_types=None, doc_only=False):
    """Yıl/puan/oyuncu/tür filtreleriyle TMDB discover araması yapar (movie + tv).

    genre_filter: None veya {media_type: set} sözlüğü. Verilirse sonuçlar o türün
    ID'lerinden en az birini içermesi koşuluyla istemci tarafında filtrelenir
    (with_people + with_genres birlikte TMDB'de OR döndürdüğü için).
    media_types: (movie/tv) hangi ortamların aranacağı; None = ikisi de.
    doc_only: True ise with_people yolunda da tur 99 (Belgesel) sarti aranir;
    discover yolunda with_genres=99 cagiran tarafca eklenir.
    """
    if media_types is None:
        media_types = ("movie", "tv")
    out = []
    for media_type, base_path, date_key in (
        ("movie", "/discover/movie", "release_date"),
        ("tv", "/discover/tv", "first_air_date"),
    ):
        if media_type not in media_types:
            continue
        gf = (genre_filter or {}).get(media_type) if genre_filter else None
        params = dict(params_movie if media_type == "movie" else params_tv)
        params["include_adult"] = "false"
        if media_type == "movie" and (params.get("with_people") or params.get("with_crew")):
            out.extend(_tmdb_movie_by_people(params, gf, doc_only))
            continue
        if media_type == "tv" and (params.get("with_people") or params.get("with_crew")):
            out.extend(_tmdb_tv_by_people(params, gf, doc_only))
            continue
        data = tmdb_request(base_path, params)
        if not data:
            continue
        for item in (data.get("results") or [])[:25]:
            if gf:
                item_genres = set(item.get("genre_ids") or [])
                if not (item_genres & gf):
                    continue
            num_seasons = None
            num_episodes = None
            networks = []
            status = ""
            out.append(
                {
                    "tmdb_id": item.get("id"),
                    "media_type": media_type,
                    "title": item.get("title") or item.get("name"),
                    "poster_path": item.get("poster_path"),
                    "release_date": item.get(date_key),
                    "vote_average": item.get("vote_average") or 0,
                    "overview": item.get("overview"),
                    "number_of_seasons": num_seasons,
                    "number_of_episodes": num_episodes,
                    "networks": networks,
                    "status": status,
                }
            )
    return out[:50]