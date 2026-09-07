import json

import requests

from db import get_setting, _safe_json_list
from rate_track import acquire, record, handle_429


def tmdb_request(path, params=None, lang=None):
    """TMDB isteği yapar. `lang` verilirse o dilde (en-US yedeğiyle) çeker;
    verilmezse ayarlı dile göre döner."""
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
        acquire("tmdb")
        try:
            r = requests.get(url, params=p, timeout=15)
        except requests.RequestException:
            continue
        record("tmdb")
        if r.status_code == 429:
            handle_429("tmdb", r)
            acquire("tmdb")
            try:
                r = requests.get(url, params=p, timeout=15)
            except requests.RequestException:
                continue
            record("tmdb")
        if r.status_code != 200:
            return None
        data = r.json()
        if _has_content(data):
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


def get_tmdb_info(media_type, tmdb_id, lang=None):
    """TMDB'den temel bilgileri çeker: release_date, vote_average, yayın platformları ve detay alanları.
    `lang` verilirse TMDB verisi o dilde çekilir."""
    if media_type not in ("movie", "tv"):
        return None
    data = tmdb_request(f"/{media_type}/{tmdb_id}", lang=lang)
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


def get_tmdb_cast(media_type, tmdb_id):
    """TMDB'den oyuncu kadrosunu çeker (ilk 8)."""
    if media_type not in ("movie", "tv"):
        return []
    credits = tmdb_request(f"/{media_type}/{tmdb_id}/credits")
    if not credits:
        return []
    out = []
    for c in (credits.get("cast") or [])[:8]:
        name = c.get("name") or c.get("original_name")
        if name:
            out.append(
                {
                    "person_id": c.get("id"),
                    "name": name,
                    "character": c.get("character") or "",
                    "profile_path": c.get("profile_path"),
                }
            )
    return out


def save_details(conn, follow_id, info, cast, include_texts=True):
    """Detay verilerini ve oyuncu kadrosunu DB'ye yazar.
    include_texts=False ise overview/genres/tagline korunur (dil-bagimsiz refresh icin)."""
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
    }


def _tmdb_tv_by_people(params, genre_filter=None):
    """TV'de with_people discover güvenilmez (filtreyi yok sayıyor); bunun yerine
    her oyuncunun tv_credits'inden şovları toplayıp tür/yıl/puan/başlık filtrelerini
    kendi tarafımızda uygular."""
    person_ids = [p for p in (params.get("with_people") or "").split(",") if p]
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
    out = []
    for sid in show_ids:
        det = tmdb_request(f"/tv/{sid}")
        if not det:
            continue
        genres = set((g or {}).get("id") for g in (det.get("genres") or []))
        if genre_filter and not (genres & genre_filter):
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
            }
        )
    out.sort(key=lambda x: x["vote_average"], reverse=True)
    return out[:20]


def _tmdb_movie_by_people(params, genre_filter=None):
    """Movie'de with_people discover limitli (20) ve eksik; aktörün movie_credits
    uç noktasından tüm filmleri toplayıp tür/yıl/puan/başlık filtrelerini kendi
    tarafımızda uygular."""
    person_ids = [p for p in (params.get("with_people") or "").split(",") if p]
    year = params.get("primary_release_year")
    score = params.get("vote_average.gte")
    query = params.get("query")
    out = []
    seen = set()
    for pid in person_ids:
        data = tmdb_request(f"/person/{pid}/movie_credits")
        if not data:
            continue
        for item in (data.get("cast") or []):
            mid = item.get("id")
            if not mid or mid in seen:
                continue
            seen.add(mid)
            if genre_filter:
                item_genres = set(item.get("genre_ids") or [])
                if not (item_genres & genre_filter):
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
    return out


def _tmdb_adv_results(params_movie, params_tv, genre_filter=None, media_types=None):
    """Yıl/puan/oyuncu/tür filtreleriyle TMDB discover araması yapar (movie + tv).

    genre_filter: None veya {media_type: set} sözlüğü. Verilirse sonuçlar o türün
    ID'lerinden en az birini içermesi koşuluyla istemci tarafında filtrelenir
    (with_people + with_genres birlikte TMDB'de OR döndürdüğü için).
    media_types: (movie/tv) hangi ortamların aranacağı; None = ikisi de.
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
        if media_type == "movie" and params.get("with_people"):
            out.extend(_tmdb_movie_by_people(params, gf))
            continue
        if media_type == "tv" and params.get("with_people"):
            out.extend(_tmdb_tv_by_people(params, gf))
            continue
        data = tmdb_request(base_path, params)
        if not data:
            continue
        for item in (data.get("results") or [])[:20]:
            if gf:
                item_genres = set(item.get("genre_ids") or [])
                if not (item_genres & gf):
                    continue
            num_seasons = None
            num_episodes = None
            if media_type == "tv":
                detail = tmdb_request(f"/tv/{item.get('id')}")
                if detail:
                    num_seasons = detail.get("number_of_seasons")
                    num_episodes = detail.get("number_of_episodes")
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
                }
            )
    return out