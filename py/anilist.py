import json
import datetime

import requests

from db import get_db, _safe_json_list

ANILIST_URL = "https://graphql.anilist.co"


def anilist_query(query, variables=None):
    """AniList GraphQL isteği yapar."""
    try:
        r = requests.post(
            ANILIST_URL,
            json={"query": query, "variables": variables or {}},
            timeout=15,
        )
    except requests.RequestException:
        return None
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

ANIME_ADV_SEARCH_QUERY = """
query ($year: Int, $score: Int, $genres: [String], $q: String, $idIn: [Int]) {
  Page(page: 1, perPage: 20) {
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
    }
  }
}
"""


def _anime_adv_results(year=None, score=None, genres=None, q=None, character_id=None):
    variables = {}
    if year is not None:
        variables["year"] = int(year)
    if score is not None:
        variables["score"] = int(round(float(score) * 10))
    if genres:
        variables["genres"] = [g.strip() for g in genres.split(",") if g.strip()]
    if q:
        variables["q"] = q
    if character_id is not None:
        cdata = anilist_query(ANIME_CHAR_MEDIA_QUERY, {"characterId": int(character_id)})
        ids = []
        if cdata and cdata.get("Character"):
            ids = [n.get("id") for n in (cdata["Character"].get("media") or {}).get("nodes") or [] if n.get("id")]
        if not ids:
            return []
        variables["idIn"] = ids
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
    characters(sort: ROLE, perPage: 12) {
      nodes {
        id
        name { full }
        image { large }
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


def save_anime_details(conn, anime_id, detail):
    """AniList detayından statik + dinamik verileri ve karakterleri DB'ye yazar (title/cover_url hariç)."""
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