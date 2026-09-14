from flask import Blueprint, jsonify, request, send_from_directory

from config import STATIC_DIR
from tmdb import tmdb_request, _tmdb_adv_results, _genre_names_to_ids, _genre_ids_for_media
from anilist import _anime_adv_results, _anime_title, _anime_cover, _anime_next_ep

search_bp = Blueprint("search", __name__)


@search_bp.route("/")
def index():
    resp = send_from_directory(STATIC_DIR, "index.html")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@search_bp.route("/api/search")
def search():
    q = request.args.get("q", "")
    media_type = request.args.get("media_type", "").strip()
    if not q:
        return jsonify([])
    if media_type in ("movie", "tv"):
        data = tmdb_request(f"/search/{media_type}", {"query": q, "include_adult": "false"})
        if not data:
            return jsonify({"error": "TMDB API anahtarı geçersiz veya ayarlanmamış"}), 400
        return jsonify([_build_search_item(item, media_type) for item in data.get("results", [])])
    if media_type == "doc":
        data = tmdb_request("/search/multi", {"query": q, "include_adult": "false"})
        if not data:
            return jsonify({"error": "TMDB API anahtarı geçersiz veya ayarlanmamış"}), 400
        results = []
        for item in data.get("results", []):
            if item.get("media_type") not in ("movie", "tv"):
                continue
            if 99 not in (item.get("genre_ids") or []):
                continue
            results.append(_build_search_item(item, item.get("media_type")))
        return jsonify(results)
    data = tmdb_request("/search/multi", {"query": q, "include_adult": "false"})
    if not data:
        return jsonify({"error": "TMDB API anahtarı geçersiz veya ayarlanmamış"}), 400
    results = []
    for item in data.get("results", []):
        if item.get("media_type") not in ("movie", "tv"):
            continue
        results.append(_build_search_item(item, item.get("media_type")))
    return jsonify(results)


def _build_search_item(item, media_type):
    num_seasons = None
    num_episodes = None
    if media_type == "tv":
        detail = tmdb_request(f"/tv/{item.get('id')}")
        if detail:
            num_seasons = detail.get("number_of_seasons")
            num_episodes = detail.get("number_of_episodes")
    return {
        "tmdb_id": item.get("id"),
        "media_type": media_type,
        "title": item.get("title") or item.get("name"),
        "poster_path": item.get("poster_path"),
        "release_date": item.get("release_date") or item.get("first_air_date"),
        "vote_average": item.get("vote_average") or 0,
        "overview": item.get("overview"),
        "number_of_seasons": num_seasons,
        "number_of_episodes": num_episodes,
    }


@search_bp.route("/api/adv-search")
def adv_search():
    mode = request.args.get("mode", "")  # actor | genre | year | score
    media = request.args.get("media", "show")  # show | anime
    value = request.args.get("value", "").strip()

    if mode == "year":
        if not (value.isdigit() and len(value) == 4):
            return jsonify({"error": "Yıl 4 haneli olmalı"}), 400
        y = int(value)
        if not (1900 <= y <= 2100):
            return jsonify({"error": "Yıl 1900-2100 arasında olmalı"}), 400
        if media == "anime":
            return jsonify(_anime_adv_results(year=y))
        return jsonify(_tmdb_adv_results(
            {"primary_release_year": y},
            {"first_air_date_year": y},
        ))

    if mode == "score":
        norm = value.replace(",", ".")
        try:
            s = float(norm)
        except ValueError:
            return jsonify({"error": "Puan formatı geçersiz"}), 400
        if not (0 <= s <= 10):
            return jsonify({"error": "Puan 0-10 arasında olmalı"}), 400
        if media == "anime":
            return jsonify(_anime_adv_results(score=s))
        return jsonify(_tmdb_adv_results(
            {"vote_average.gte": s},
            {"vote_average.gte": s},
        ))

    if mode == "actor":
        parts = [x.strip() for x in value.split(",") if x.strip()]
        if not parts:
            return jsonify({"error": "Oyuncu girilmedi"}), 400
        ids = []
        for p in parts:
            if p.isdigit():
                ids.append(p)
            else:
                data = tmdb_request("/search/person", {"query": p})
                if data and (data.get("results") or []):
                    first = data["results"][0]
                    if first.get("id"):
                        ids.append(str(first["id"]))
        if not ids:
            return jsonify({"error": "Oyuncu bulunamadı"}), 400
        people = ",".join(ids)
        return jsonify(_tmdb_adv_results(
            {"with_people": people},
            {"with_people": people},
        ))

    if mode == "genre":
        names = [x.strip() for x in value.split(",") if x.strip()]
        if not names:
            return jsonify({"error": "Tür seçilmedi"}), 400
        genres = []
        for gid in _genre_names_to_ids(names):
            if gid not in genres:
                genres.append(gid)
        if not genres:
            return jsonify({"error": "Türler TMDB'de bulunamadı"}), 400
        joined = ",".join(str(g) for g in genres)
        return jsonify(_tmdb_adv_results(
            {"with_genres": joined},
            {"with_genres": joined},
        ))

    return jsonify({"error": "Geçersiz arama modu"}), 400


def _resolve_actor_ids(parts):
    ids = []
    for p in parts:
        if p.isdigit():
            ids.append(p)
        else:
            data = tmdb_request("/search/person", {"query": p})
            if data and (data.get("results") or []):
                first = data["results"][0]
                if first.get("id"):
                    ids.append(str(first["id"]))
    return ids


@search_bp.route("/api/combo-search")
def combo_search():
    """Çoklu kriter araması: actors+genres+year+score+q (hepsi AND)."""
    media = request.args.get("media", "show")  # show | anime
    kind = request.args.get("kind", "").strip()  # movie | tv | boş (ikisi)
    actors = request.args.get("actors", "").strip()
    genres = request.args.get("genres", "").strip()
    year = request.args.get("year", "").strip()
    score = request.args.get("score", "").strip()
    q = request.args.get("q", "").strip()

    if kind not in ("", "movie", "tv", "doc"):
        kind = ""
    media_types = None
    if kind == "movie":
        media_types = ("movie",)
    elif kind == "tv":
        media_types = ("tv",)
    doc_only = (kind == "doc")

    if not (actors or genres or year or score or q or doc_only):
        return jsonify({"error": "En az bir kriter gerekli"}), 400

    year_i = None
    if year:
        if not (year.isdigit() and len(year) == 4):
            return jsonify({"error": "Yıl 4 haneli olmalı"}), 400
        year_i = int(year)
        if not (1900 <= year_i <= 2100):
            return jsonify({"error": "Yıl 1900-2100 arasında olmalı"}), 400

    score_f = None
    if score:
        norm = score.replace(",", ".")
        try:
            score_f = float(norm)
        except ValueError:
            return jsonify({"error": "Puan formatı geçersiz"}), 400
        if not (0 <= score_f <= 10):
            return jsonify({"error": "Puan 0-10 arasında olmalı"}), 400

    if media == "anime":
        character_id = None
        if actors:
            cids = [x.strip() for x in actors.split(",") if x.strip().isdigit()]
            if not cids:
                return jsonify({"error": "Karakter bulunamadı"}), 400
            character_id = int(cids[0])
        return jsonify(_anime_adv_results(year=year_i, score=score_f, genres=genres or None, q=q or None, character_id=character_id))

    params_movie = {}
    params_tv = {}
    genre_filter = None
    if actors:
        ids = _resolve_actor_ids([x.strip() for x in actors.split(",") if x.strip()])
        if not ids:
            return jsonify({"error": "Oyuncu bulunamadı"}), 400
        people = ",".join(ids)
        params_movie["with_people"] = people
        params_tv["with_people"] = people
    if genres:
        gnames = [x.strip() for x in genres.split(",") if x.strip()]
        movie_groups = []
        tv_groups = []
        for name in gnames:
            ids_for_name = _genre_names_to_ids([name])
            movie_groups.append(list(_genre_ids_for_media(ids_for_name, "movie")))
            tv_groups.append(list(_genre_ids_for_media(ids_for_name, "tv")))
        all_gids = []
        for grp in movie_groups + tv_groups:
            for g in grp:
                if g not in all_gids:
                    all_gids.append(g)
        if not all_gids:
            return jsonify({"error": "Türler TMDB'de bulunamadı"}), 400
        if actors:
            # TMDB with_people + with_genres birlikte OR döndürür; AND için
            # oyuncu sonuçlarını tür ID'leriyle kendi tarafımızda filtrele.
            # Film türleri TV'ye özel birleşik türleri taşımadığı için her
            # ortama uygun set ayrı ayrı hesaplanır (set = OR).
            genre_filter = {
                "movie": set(g for grp in movie_groups for g in grp),
                "tv": set(g for grp in tv_groups for g in grp),
            }
        else:
            # with_genres: virgül AND, | OR. Birleşik türler grup içinde OR,
            # seçilen farklı türler arasında AND olur.
            params_movie["with_genres"] = ",".join(
                "|".join(str(g) for g in grp) for grp in movie_groups if grp
            )
            params_tv["with_genres"] = ",".join(
                "|".join(str(g) for g in grp) for grp in tv_groups if grp
            )
    if doc_only:
        # Belgesel: TMDB tur id 99 ile AND (kullanici turleriyle birlesir).
        # discover yolu TMDB tarafinda filtrelenir; with_people yolu icin
        # doc_only bayragi _tmdb_adv_results'a tasinir (istemci tarafta 99 sarti).
        for _p in (params_movie, params_tv):
            _wg = (_p.get("with_genres") or "").strip()
            _p["with_genres"] = (_wg + ",99" if _wg else "99")
        if actors and genre_filter is None:
            genre_filter = {"movie": {99}, "tv": {99}}
    if year_i:
        params_movie["primary_release_year"] = year_i
        params_tv["first_air_date_year"] = year_i
    if score_f:
        params_movie["vote_average.gte"] = score_f
        params_tv["vote_average.gte"] = score_f
    if q:
        params_movie["query"] = q
        params_tv["query"] = q
    return jsonify(_tmdb_adv_results(params_movie, params_tv, genre_filter, media_types, doc_only))


@search_bp.route("/api/person/<int:person_id>")
def person_credits(person_id):
    data = tmdb_request(f"/person/{person_id}/combined_credits")
    if not data:
        return jsonify({"error": "TMDB'den veri alınamadı"}), 400
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
    return jsonify(results)