from flask import Blueprint, jsonify, request

from fav_listings import (
    load_fav_listing,
    save_fav_listing,
    generate_fav_actor,
    generate_fav_genre,
)
from ramcache import cached_response

fav_listings_bp = Blueprint("fav_listings", __name__)


@fav_listings_bp.route("/api/favorites/actor/<int:person_id>")
def fav_actor_list(person_id):
    ident = str(person_id)
    items = load_fav_listing("actor", ident)
    if items is not None:
        return cached_response({"items": items}, True)
    items = generate_fav_actor(person_id)
    if items is None:
        return jsonify({"error": "TMDB'den veri alinamadi"}), 400
    save_fav_listing("actor", ident, items)
    return cached_response({"items": items}, False)


@fav_listings_bp.route("/api/favorites/genre")
def fav_genre_list():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Tur adi gerekli"}), 400
    media = (request.args.get("media") or "all").strip().lower()
    if media not in ("tv", "movie", "all"):
        media = "all"
    ident = name.lower() + "|" + media
    items = load_fav_listing("genre", ident)
    if items is not None:
        return cached_response({"items": items}, True)
    items = generate_fav_genre(name, media=media)
    if items is None:
        return jsonify({"error": "TMDB'den veri alinamadi"}), 400
    save_fav_listing("genre", ident, items)
    return cached_response({"items": items}, False)
