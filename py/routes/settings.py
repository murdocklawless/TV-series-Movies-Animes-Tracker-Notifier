import os
import json
import requests
import zoneinfo

from flask import Blueprint, jsonify, request

from db import get_setting, set_setting
from notifications import ntfy_topic_clean
from ramcache import bump
from scheduler import schedule_releases, _tmdb_genre_names, _anilist_genre_names, NOTIF_TYPES

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/fav_actors", methods=["GET", "POST"])
def fav_actors():
    if request.method == "GET":
        raw = get_setting("fav_actors")
        actors = json.loads(raw) if raw else []
        return jsonify({"actors": actors})
    body = request.get_json(silent=True) or {}
    person_id = body.get("person_id")
    name = (body.get("name") or "").strip()
    if not person_id:
        return jsonify({"error": "Oyuncu id gerekli"}), 400
    raw = get_setting("fav_actors")
    actors = json.loads(raw) if raw else []
    if any(a.get("person_id") == person_id for a in actors):
        actors = [a for a in actors if a.get("person_id") != person_id]
        added = False
    else:
        actors.append({"person_id": person_id, "name": name})
        added = True
    set_setting("fav_actors", json.dumps(actors, ensure_ascii=False))
    return jsonify({"ok": True, "added": added, "actors": actors})


@settings_bp.route("/api/fav_anime_chars", methods=["GET", "POST"])
def fav_anime_chars():
    if request.method == "GET":
        raw = get_setting("fav_anime_chars")
        chars = json.loads(raw) if raw else []
        return jsonify({"characters": chars})
    body = request.get_json(silent=True) or {}
    character_id = body.get("character_id")
    name = (body.get("name") or "").strip()
    anime_title = (body.get("anime_title") or "").strip()
    if not character_id:
        return jsonify({"error": "Karakter id gerekli"}), 400
    raw = get_setting("fav_anime_chars")
    chars = json.loads(raw) if raw else []
    if any(a.get("character_id") == character_id for a in chars):
        chars = [a for a in chars if a.get("character_id") != character_id]
        added = False
    else:
        chars.append({"character_id": character_id, "name": name, "anime_title": anime_title})
        added = True
    set_setting("fav_anime_chars", json.dumps(chars, ensure_ascii=False))
    return jsonify({"ok": True, "added": added, "characters": chars})


@settings_bp.route("/api/timezones")
def list_timezones():
    zones = sorted(z for z in zoneinfo.available_timezones() if "/" in z or z == "UTC")
    tz_country = {}
    try:
        with open("/usr/share/zoneinfo/zone.tab") as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    tz_country[parts[2]] = parts[0]
    except OSError:
        pass

    cc_lang = _country_languages()

    out = []
    for z in zones:
        cc = tz_country.get(z, "")
        locale = ""
        if cc:
            lang = cc_lang.get(cc.upper(), "")
            if lang:
                locale = f"{lang}-{cc.upper()}"
        out.append({"value": z, "country": cc, "locale": locale})
    return jsonify(out)


def _country_languages():
    """glibc locale dosyalarından ülke kodu -> birincil dil (örn. US -> en)."""
    locales_dir = "/usr/share/i18n/locales"
    cc_lang = {}
    try:
        names = sorted(os.listdir(locales_dir))
    except OSError:
        return cc_lang
    preferred = {
        "TR": "tr", "FR": "fr", "ES": "es", "IT": "it", "DE": "de",
        "US": "en", "GB": "en", "CA": "en", "AU": "en", "NZ": "en",
        "BR": "pt", "PT": "pt", "BE": "nl", "CH": "de", "AT": "de",
        "MX": "es", "AR": "es", "CO": "es", "PE": "es", "CL": "es",
        "MY": "ms", "SG": "en", "HK": "zh-Hant", "TW": "zh-TW", "CN": "zh",
        "IN": "hi", "PK": "ur", "BD": "bn", "LK": "si", "NP": "ne",
        "AE": "ar", "SA": "ar", "EG": "ar", "MA": "ar", "IQ": "ar",
        "IL": "he", "IR": "fa", "AZ": "az", "KZ": "kk", "UZ": "uz",
        "BY": "be", "UA": "uk", "MD": "ro", "BA": "bs", "RS": "sr",
        "HR": "hr", "SI": "sl", "SK": "sk", "CZ": "cs", "HU": "hu",
        "RO": "ro", "BG": "bg", "GR": "el", "CY": "el", "MT": "mt",
        "IS": "is", "NO": "nb", "SE": "sv", "FI": "fi", "DK": "da",
        "NL": "nl", "IE": "en", "LU": "lb", "EE": "et", "LV": "lv",
        "LT": "lt", "PL": "pl", "RU": "ru", "AM": "hy", "GE": "ka",
        "MN": "mn", "KH": "km", "LA": "lo", "TH": "th", "VN": "vi",
        "ID": "id", "PH": "fil", "MM": "my", "KR": "ko", "JP": "ja",
        "TR": "tr",
    }
    for name in names:
        if name.startswith(".") or "_" not in name:
            continue
        lang, cc = name.split("_", 1)
        cc = cc.upper()
        if len(cc) != 2 or not cc.isalpha():
            continue
        if cc in preferred:
            cc_lang[cc] = preferred[cc]
        elif cc not in cc_lang:
            cc_lang[cc] = lang
    return cc_lang


@settings_bp.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(
        {
            "tmdb_api_key": get_setting("tmdb_api_key") or "",
            "telegram_bot_token": get_setting("telegram_bot_token") or "",
            "telegram_chat_id": get_setting("telegram_chat_id") or "",
            "notify_hour": get_setting("notify_hour") or "09:00",
            "sync_hour": get_setting("sync_hour") or "09:00",
            "genre_hour": get_setting("genre_hour") or "05:00",
            "data_hour": get_setting("data_hour") or "05:10",
            "notification_hour": get_setting("notification_hour") or "09:05",
            "timezone": get_setting("timezone") or "Europe/Istanbul",
            "language": get_setting("language") or "tr-TR",
            "ntfy_topic": get_setting("ntfy_topic") or "",
            "telegram_enabled": get_setting("telegram_enabled") or "1",
            "ntfy_enabled": get_setting("ntfy_enabled") or "1",
            "notif_center_enabled": get_setting("notif_center_enabled") or "1",
            "cache_ttl": get_setting("cache_ttl") or "3600",
            **{f"notif_{k}": get_setting(f"notif_{k}") or "1" for k, _g in NOTIF_TYPES},
        }
    )


@settings_bp.route("/api/settings", methods=["POST"])
def save_settings():
    body = request.get_json()
    for key in (
        "tmdb_api_key",
        "telegram_bot_token",
        "telegram_chat_id",
        "notify_hour",
        "sync_hour",
        "genre_hour",
        "data_hour",
        "notification_hour",
        "timezone",
        "language",
        "ntfy_topic",
        "telegram_enabled",
        "ntfy_enabled",
        "notif_center_enabled",
        "cache_ttl",
        *(f"notif_{k}" for k, _g in NOTIF_TYPES),
    ):
        if key in body:
            set_setting(key, str(body[key] or ""))
    if "cache_ttl" in body:
        try:
            from ramcache import list_cache
            list_cache.configure(int(body["cache_ttl"] or 0))
        except (TypeError, ValueError):
            pass
    if any(k in body for k in ("notify_hour", "sync_hour", "genre_hour", "data_hour", "notification_hour", "timezone")):
        schedule_releases()
    return jsonify({"ok": True})


@settings_bp.route("/api/settings/test", methods=["POST"])
def test_settings():
    body = request.get_json()
    token = body.get("telegram_bot_token")
    chat_id = body.get("telegram_chat_id")
    ntfy_topic = body.get("ntfy_topic")
    if not ((token and chat_id) or ntfy_topic):
        return jsonify({"error": "Telegram veya ntfy bilgisi gereklidir"}), 400
    errors = []
    if token and chat_id:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        r = requests.post(
            url,
            json={
                "chat_id": chat_id,
                "text": "Takip uygulaması test mesajı",
            },
            timeout=15,
        )
        if r.status_code != 200:
            try:
                err = r.json().get("description", "Bilinmeyen hata")
            except Exception:
                err = "Bilinmeyen hata"
            errors.append(f"Telegram hatası: {err}")
    if ntfy_topic:
        r = requests.post(
            f"https://ntfy.sh/{ntfy_topic_clean(ntfy_topic)}",
            data="Takip uygulaması test mesajı",
            timeout=15,
        )
        if r.status_code != 200:
            errors.append(f"ntfy hatası: HTTP {r.status_code}")
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    return jsonify({"ok": True})


@settings_bp.route("/api/fav_genres", methods=["GET", "POST"])
def fav_genres():
    if request.method == "GET":
        raw = get_setting("fav_genres")
        genres = json.loads(raw) if raw else []
        return jsonify({"genres": genres})
    body = request.get_json(silent=True) or {}
    genre = (body.get("genre") or "").strip()
    if not genre:
        return jsonify({"error": "Tür adı gerekli"}), 400
    raw = get_setting("fav_genres")
    genres = json.loads(raw) if raw else []
    if genre in genres:
        genres.remove(genre)
        added = False
    else:
        genres.append(genre)
        added = True
    set_setting("fav_genres", json.dumps(genres, ensure_ascii=False))
    bump()
    return jsonify({"ok": True, "added": added, "genres": genres})


@settings_bp.route("/api/fav_anime_genres", methods=["GET", "POST"])
def fav_anime_genres():
    if request.method == "GET":
        raw = get_setting("fav_anime_genres")
        genres = json.loads(raw) if raw else []
        return jsonify({"genres": genres})
    body = request.get_json(silent=True) or {}
    genre = (body.get("genre") or "").strip()
    if not genre:
        return jsonify({"error": "Tür adı gerekli"}), 400
    raw = get_setting("fav_anime_genres")
    genres = json.loads(raw) if raw else []
    if genre in genres:
        genres.remove(genre)
        added = False
    else:
        genres.append(genre)
        added = True
    set_setting("fav_anime_genres", json.dumps(genres, ensure_ascii=False))
    bump()
    return jsonify({"ok": True, "added": added, "genres": genres})


@settings_bp.route("/api/genres")
def list_genres():
    source = request.args.get("source", "tmdb")
    if source == "anilist":
        return jsonify({"genres": _anilist_genre_names()})
    return jsonify({"genres": _tmdb_genre_names()})