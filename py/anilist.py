import json
import datetime
import time

import requests

import query_log
from db import get_db, _safe_json_list
from rate_track import acquire, record, handle_429

ANILIST_URL = "https://graphql.anilist.co"


def anilist_query(query, variables=None, tag=None):
    """AniList GraphQL isteği yapar (2.19.25: her istek/onbellek query_log'a yazılır)."""
    acquire("anilist")
    t0 = time.time()
    try:
        r = requests.post(
            ANILIST_URL,
            json={"query": query, "variables": variables or {}},
            timeout=15,
        )
    except requests.RequestException as exc:
        query_log.log("anilist", "POST", "/graphql", status=0,
                      ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                      err=str(exc)[:120])
        return None
    record("anilist")
    if r.status_code == 429:
        query_log.log("anilist", "POST", "/graphql", status=429,
                      ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                      err="rate-limit")
        handle_429("anilist", r)
        acquire("anilist")
        t0 = time.time()
        try:
            r = requests.post(
                ANILIST_URL,
                json={"query": query, "variables": variables or {}},
                timeout=15,
            )
        except requests.RequestException as exc:
            query_log.log("anilist", "POST", "/graphql", status=0,
                          ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                          err=str(exc)[:120])
            return None
        record("anilist")
    query_log.log("anilist", "POST", "/graphql", status=r.status_code,
                  ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                  params={"vars": list((variables or {}).keys())})
    if r.status_code != 200:
        return None
    data = r.json()
    return data.get("data")


ANIME_SEARCH_QUERY = """
query ($q: String) {
  Page(page: 1, perPage: 20) {
    media(search: $q, type: ANIME) {
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


def anilist_search(q):
    data = anilist_query(ANIME_SEARCH_QUERY, {"q": q})
    if not data or not data.get("Page"):
        return []
    return data["Page"].get("media") or []


ANIME_CHAR_MEDIA_QUERY = """
query ($characterId: Int) {
  Character(id: $characterId) {
    media(type: ANIME, perPage: 50) {
      nodes { id }
    }
  }
}
"""

ANIME_STAFF_MEDIA_QUERY = """
query ($staffId: Int) {
  Staff(id: $staffId) {
    staffMedia(type: ANIME, perPage: 50) {
      nodes { id }
    }
  }
}
"""

ANIME_STAFF_SEARCH_QUERY = """
query ($q: String) {
  Page(page: 1, perPage: 5) {
    staff(search: $q) {
      id
      name { full }
    }
  }
}
"""


def _resolve_anime_staff_ids(parts):
    """Yönetmen chip değerlerini AniList staff ID'lerine çevirir (rakam veya isim araması)."""
    ids = []
    for p in parts:
        p = (p or "").strip()
        if not p:
            continue
        if p.isdigit():
            ids.append(p)
            continue
        try:
            data = anilist_query(ANIME_STAFF_SEARCH_QUERY, {"q": p})
        except Exception:
            continue
        nodes = ((data or {}).get("Page") or {}).get("staff") or []
        if nodes and nodes[0].get("id"):
            ids.append(str(nodes[0]["id"]))
    return ids

ANIME_ADV_SEARCH_QUERY = """
query ($year: Int, $score: Int, $genres: [String], $q: String, $idIn: [Int]) {
  Page(page: 1, perPage: 50) {
    media(type: ANIME, seasonYear: $year, averageScore_greater: $score, genre_in: $genres, search: $q, id_in: $idIn) {
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


def _anime_adv_results(year=None, score=None, genres=None, q=None, character_id=None, staff_id=None):
    variables = {}
    if year is not None:
        variables["year"] = int(year)
    if score is not None:
        variables["score"] = int(round(float(score) * 10))
    if genres:
        variables["genres"] = [g.strip() for g in genres.split(",") if g.strip()]
    if q:
        variables["q"] = q
    id_sets = []
    if character_id is not None:
        cdata = anilist_query(ANIME_CHAR_MEDIA_QUERY, {"characterId": int(character_id)})
        ids = []
        if cdata and cdata.get("Character"):
            ids = [n.get("id") for n in (cdata["Character"].get("media") or {}).get("nodes") or [] if n.get("id")]
        if not ids:
            return []
        id_sets.append(set(ids))
    if staff_id is not None:
        sdata = anilist_query(ANIME_STAFF_MEDIA_QUERY, {"staffId": int(staff_id)})
        sids = []
        if sdata and sdata.get("Staff"):
            sids = [n.get("id") for n in (sdata["Staff"].get("staffMedia") or {}).get("nodes") or [] if n.get("id")]
        if not sids:
            return []
        id_sets.append(set(sids))
    if id_sets:
        joint = set.intersection(*id_sets)
        if not joint:
            return []
        variables["idIn"] = sorted(joint)
    data = anilist_query(ANIME_ADV_SEARCH_QUERY, variables)
    if not data or not data.get("Page"):
        return []
    results = []
    for m in data["Page"].get("media") or []:
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
    return results


ANIME_DETAIL_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    coverImage { large }
    bannerImage
    description
    format
    status
    episodes
    duration
    genres
    averageScore
    nextAiringEpisode { episode airingAt }
    startDate { year month day }
    endDate { year month day }
    studios(isMain: true) {
      nodes { name }
    }
    externalLinks {
      site
      url
    }
    characters(sort: ROLE, perPage: 12) {
      nodes {
        id
        name { full }
        image { large }
      }
    }
    staff(perPage: 10) {
      edges {
        role
        node {
          id
          name { full }
          image { large }
        }
      }
    }
  }
}
"""


def anilist_detail(anime_id):
    data = anilist_query(ANIME_DETAIL_QUERY, {"id": anime_id})
    if not data:
        return None
    return data.get("Media")


ANIME_STAFF_QUERY = """
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    staff(perPage: 10) {
      edges {
        role
        node {
          id
          name { full }
          image { large }
        }
      }
    }
  }
}
"""


def anilist_staff(anime_id):
    """Hafif staff sorgusuyla yönetmenleri döndürür (önbellek doldurma için)."""
    try:
        data = anilist_query(ANIME_STAFF_QUERY, {"id": int(anime_id)})
    except Exception:
        return []
    if not data:
        return []
    return anime_directors(data.get("Media"))


def save_anime_directors(conn, anime_id, directors):
    """Sadece anime yönetmen kayıtlarını yeniler (karakterlere dokunmaz)."""
    try:
        conn.execute("DELETE FROM anime_directors WHERE anime_id=?", (anime_id,))
        for i, d in enumerate(directors or []):
            conn.execute(
                "INSERT INTO anime_directors (anime_id, person_id, name, image, sort_order) VALUES (?, ?, ?, ?, ?)",
                (anime_id, d.get("id"), d.get("name"), d.get("image"), i),
            )
    except Exception:
        pass


def load_anime_map(conn, source, external_id):
    """anime_id_map onbellekinden harici ID -> anilist_id (yoksa None)."""
    try:
        row = conn.execute(
            "SELECT anilist_id FROM anime_id_map WHERE source=? AND external_id=?",
            (source, str(external_id)),
        ).fetchone()
        return row["anilist_id"] if row else None
    except Exception:
        return None


def store_anime_map(conn, source, external_id, anilist_id):
    """Harici ID -> anilist_id eslemesini kalici onbellege yazar. Fail-soft."""
    try:
        conn.execute(
            "INSERT OR REPLACE INTO anime_id_map (source, external_id, anilist_id, ts) VALUES (?, ?, ?, ?)",
            (source, str(external_id), int(anilist_id), int(time.time())),
        )
    except Exception:
        pass


def resolve_external_anilist(source, external_id):
    """Harici anime ID'yi anilist_id'ye cevirir (Kitsu API mappings uzerinden).

    source: kitsu | tmdb | imdb | tvdb | trakt. Hata/cozumsuz -> None (cagiran atlar,
    yanlis yazma yapilmaz). Sonuc anime_id_map'e yazilir (cagiran taraf).
    """
    try:
        external_id = str(external_id).strip()
        if not external_id:
            return None
        if source == "kitsu":
            url = f"https://kitsu.io/api/edge/anime/{external_id}/mappings?filter[externalSite]=anilist"
            r = requests.get(url, timeout=15, headers={"Accept": "application/vnd.api+json"})
            if r.status_code != 200:
                return None
            for it in (r.json().get("data") or []):
                attrs = it.get("attributes") or {}
                if attrs.get("externalSite") == "anilist" and str(attrs.get("externalId") or "").isdigit():
                    return int(attrs["externalId"])
            return None
        site_map = {"tmdb": "tmdb", "imdb": "imdb", "tvdb": "tvdb", "trakt": "trakt"}
        site = site_map.get(source)
        if not site:
            return None
        candidates = [external_id]
        if source == "imdb" and external_id.startswith("tt"):
            candidates.append(external_id[2:])
        kitsu_id = None
        for cand in candidates:
            url = f"https://kitsu.io/api/edge/mappings?filter[externalSite]={site}&filter[externalId]={cand}"
            r = requests.get(url, timeout=15, headers={"Accept": "application/vnd.api+json"})
            if r.status_code != 200:
                continue
            for it in (r.json().get("data") or []):
                rel = ((it.get("relationships") or {}).get("anime") or {}).get("data") or {}
                kid = rel.get("id")
                if kid:
                    kitsu_id = kid
                    break
            if kitsu_id:
                break
        if not kitsu_id:
            return None
        return resolve_external_anilist("kitsu", kitsu_id)
    except Exception:
        return None


ANIME_SCHEDULE_QUERY = """
query ($id: Int, $now: Int) {
  Media(id: $id, type: ANIME) {
    id
    episodes
    status
    nextAiringEpisode {
      episode airingAt
    }
  }
  future: Page(perPage: 50) {
    airingSchedules(mediaId: $id, airingAt_greater: $now, sort: TIME) {
      episode airingAt
    }
  }
  past: Page(perPage: 50) {
    airingSchedules(mediaId: $id, airingAt_lesser: $now, sort: TIME_DESC) {
      episode airingAt
    }
  }
}
"""


def anilist_schedule(anime_id):
    now = int(datetime.datetime.now().timestamp())
    data = anilist_query(ANIME_SCHEDULE_QUERY, {"id": anime_id, "now": now})
    if not data or not data.get("Media"):
        return None
    media = data["Media"]
    nodes = []
    seen = set()

    nxt = media.get("nextAiringEpisode")
    if nxt and nxt.get("episode") is not None:
        key = (nxt.get("episode"), nxt.get("airingAt"))
        seen.add(key)
        nodes.append(nxt)

    for group_key in ("future", "past"):
        group = (data.get(group_key) or {}).get("airingSchedules") or []
        for node in group:
            key = (node.get("episode"), node.get("airingAt"))
            if key not in seen:
                seen.add(key)
                nodes.append(node)
    media["airingSchedule"] = {"nodes": sorted(nodes, key=lambda n: n.get("episode") or 0)}
    return media


def _anime_title(m):
    if not m:
        return ""
    t = m.get("title") or {}
    return t.get("romaji") or t.get("english") or t.get("native") or ""


def _anime_cover(m):
    c = (m.get("coverImage") or {}).get("large")
    return c or ""


def _anime_next_ep(m):
    nea = m.get("nextAiringEpisode") or {}
    return nea.get("episode"), nea.get("airingAt")


def _anime_start_year(d):
    return (d.get("startDate") or {}).get("year") if (d.get("startDate") or {}).get("year") else None


def anime_directors(detail):
    """AniList detayındaki staff edges içinden yönetmenleri çıkarır (tümü).

    Döndürülen kayıt: {"id", "name", "image"}. Rol eşleşmesi büyük/küçük
    harf duyarsız "director" içerirlik kontrolüdür (Director, Co-Director,
    Series Director, Episode Director vb. hepsi alınır).
    """
    if not detail:
        return []
    out = []
    for edge in (detail.get("staff") or {}).get("edges") or []:
        role = (edge.get("role") or "")
        if "director" not in role.strip().lower():
            continue
        node = edge.get("node") or {}
        name = (node.get("name") or {}).get("full") if node.get("name") else ""
        if not name:
            continue
        if any(d.get("id") == node.get("id") for d in out):
            continue
        out.append(
            {
                "id": node.get("id"),
                "name": name,
                "image": (node.get("image") or {}).get("large") if node.get("image") else None,
            }
        )
    return out


def save_anime_details(conn, anime_id, detail, directors=None):
    """AniList detayından statik + dinamik verileri ve karakterleri DB'ye yazar (title/cover_url hariç).
    directors=None ise mevcut yönetmen kayıtlarına dokunulmaz; verilirse
    anime_directors tablosu yenilenir."""
    if not detail:
        return
    studios = ", ".join(
        s.get("name") for s in ((detail.get("studios") or {}).get("nodes") or []) if s.get("name")
    )
    conn.execute(
        "UPDATE anime SET banner=?, description=?, format=?, duration=?, genres=?, start_date=?, "
        "score=?, status=?, episodes=?, studios=? WHERE id=?",
        (
            detail.get("bannerImage"),
            detail.get("description"),
            detail.get("format"),
            detail.get("duration"),
            json.dumps(detail.get("genres") or []),
            _anime_start_year(detail),
            detail.get("averageScore"),
            detail.get("status"),
            detail.get("episodes"),
            studios,
            anime_id,
        ),
    )
    conn.execute("DELETE FROM anime_cast WHERE anime_id=?", (anime_id,))
    chars = (detail.get("characters") or {}).get("nodes") or []
    for i, c in enumerate(chars):
        name = c.get("name", {}).get("full") if c.get("name") else ""
        if not name:
            continue
        conn.execute(
            "INSERT INTO anime_cast (anime_id, person_id, name, image, sort_order) VALUES (?, ?, ?, ?, ?)",
            (anime_id, c.get("id"), name, (c.get("image") or {}).get("large") if c.get("image") else None, i),
        )
    if directors is None:
        directors = anime_directors(detail)
    save_anime_directors(conn, anime_id, directors)


def load_anime_details(conn, anime_id):
    """anime_id için DB'de saklı anime detay verilerini ve karakterleri döndürür (None = yok)."""
    row = conn.execute(
        "SELECT banner, description, format, duration, genres, start_date, title, cover_url, "
        "episodes, status, score, studios, anilist_id FROM anime WHERE id=?",
        (anime_id,),
    ).fetchone()
    if not row:
        return None
    chars = conn.execute(
        "SELECT person_id, name, image FROM anime_cast WHERE anime_id=? ORDER BY sort_order",
        (anime_id,),
    ).fetchall()
    try:
        dirs = conn.execute(
            "SELECT person_id, name, image FROM anime_directors WHERE anime_id=? ORDER BY sort_order",
            (anime_id,),
        ).fetchall()
    except Exception:
        dirs = []
    return {
        "anilist_id": row["anilist_id"],
        "title": row["title"],
        "cover_url": row["cover_url"],
        "banner_url": row["banner"],
        "description": row["description"],
        "format": row["format"],
        "status": row["status"],
        "episodes": row["episodes"],
        "duration": row["duration"],
        "genres": _safe_json_list(row["genres"]),
        "score": row["score"],
        "start_date": row["start_date"],
        "studios": [s for s in (row["studios"] or "").split(",") if s] if row["studios"] else [],
        "characters": [
            {"id": c["person_id"], "name": c["name"], "image": c["image"]}
            for c in chars
        ],
        "directors": [
            {"id": d["person_id"], "name": d["name"], "image": d["image"]}
            for d in dirs
        ],
    }


ANIME_REC_QUERY = """
query ($genres: [String], $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(type: ANIME, genre_in: $genres, sort: [POPULARITY_DESC, SCORE_DESC]) {
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
      studios { nodes { name } }
    }
  }
}
"""

ANIME_REC_POPULAR_QUERY = """
query ($perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(type: ANIME, sort: [POPULARITY_DESC, SCORE_DESC]) {
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
      studios { nodes { name } }
    }
  }
}
"""


def anilist_recommend(genres=None, per_page=50):
    """Öneri için AniList media listesi: genre_in + popularite sırası.
    genres boş/None ise genel popüler anime döner."""
    if genres:
        data = anilist_query(
            ANIME_REC_QUERY, {"genres": list(genres), "perPage": int(per_page)}
        )
    else:
        data = anilist_query(ANIME_REC_POPULAR_QUERY, {"perPage": int(per_page)})
    if not data or not data.get("Page"):
        return []
    return data["Page"].get("media") or []


ANIME_GENRE_QUERY = """
query {
  GenreCollection
}
"""


def _fetch_anilist_genres():
    """AniList'ten tüm anime tür isimlerini döndürür."""
    data = anilist_query(ANIME_GENRE_QUERY)
    if not data:
        return []
    return [g for g in (data.get("GenreCollection") or []) if g]