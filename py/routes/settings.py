import os
import json
import requests
import zoneinfo

from flask import Blueprint, jsonify, request

from db import get_setting, set_setting
from crypto_util import encrypt_secret, decrypt_secret
from notifications import ntfy_topic_clean, _send_generic_smtp, _email_card_html
from messages_i18n import t
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
    try:
        from fav_listings import invalidate_fav_listing
        invalidate_fav_listing("actor", str(person_id))
    except Exception:
        pass
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
            "notification_hour": get_setting("notification_hour") or "09:05",
            "sync_hour": get_setting("sync_hour") or "09:00",
            "genre_hour": get_setting("genre_hour") or "05:00",
            "data_hour": get_setting("data_hour") or "05:10",
            "anime_notification_hour": get_setting("anime_notification_hour") or "09:05",
            "rec_hour": get_setting("rec_hour") or "05:25",
            "backup_hour": get_setting("backup_hour") or "03:00",
            "backup_mode": get_setting("backup_mode") or "",
            "backup_rsync_host": get_setting("backup_rsync_host") or "",
            "backup_rsync_port": get_setting("backup_rsync_port") or "",
            "backup_rsync_path": get_setting("backup_rsync_path") or "",
            "backup_rsync_user": get_setting("backup_rsync_user") or "",
            "has_backup_rsync_pass": bool(get_setting("backup_rsync_pass")),
            "has_backup_key": bool(get_setting("backup_rsync_key")),
            "backup_samba_host": get_setting("backup_samba_host") or "",
            "backup_samba_port": get_setting("backup_samba_port") or "",
            "backup_samba_share": get_setting("backup_samba_share") or "",
            "backup_samba_user": get_setting("backup_samba_user") or "",
            "has_backup_samba_pass": bool(get_setting("backup_samba_pass")),
            "timezone": get_setting("timezone") or "Europe/Istanbul",
            "language": get_setting("language") or "tr-TR",
            "ntfy_topic": get_setting("ntfy_topic") or "",
            "telegram_enabled": get_setting("telegram_enabled") or "1",
            "ntfy_enabled": get_setting("ntfy_enabled") or "1",
            "notif_center_enabled": get_setting("notif_center_enabled") or "1",
            "notif_center_time": get_setting("notif_center_time") or "relative",
            "notif_center_poster": get_setting("notif_center_poster") or "1",
            "notif_center_hide_read": get_setting("notif_center_hide_read") or "0",
            "notif_center_limit": get_setting("notif_center_limit") or "50",
            "discord_enabled": get_setting("discord_enabled") or "1",
            "discord_webhook_url": get_setting("discord_webhook_url") or "",
            "email_enabled": get_setting("email_enabled") or "1",
            "brevo_api_key": get_setting("brevo_api_key") or "",
            "email_from": get_setting("email_from") or "",
            "email_to": get_setting("email_to") or "",
            "email_provider": get_setting("email_provider") or "brevo",
            "smtp_preset": get_setting("smtp_preset") or "",
            "smtp_host": get_setting("smtp_host") or "",
            "smtp_port": get_setting("smtp_port") or "",
            "smtp_user": get_setting("smtp_user") or "",
            "has_smtp_pass": bool(get_setting("smtp_pass")),
            "cache_ttl": get_setting("cache_ttl") or "3600",
            **{f"notif_{k}": get_setting(f"notif_{k}") or "1" for k, _g in NOTIF_TYPES},
        }
    )


@settings_bp.route("/api/settings", methods=["POST"])
def save_settings():
    body = request.get_json()
    # gecersiz timezone DB'ye yazilip scheduler'i bozmasin
    if "timezone" in body:
        tz_val = str(body.get("timezone") or "").strip()
        if tz_val and tz_val not in zoneinfo.available_timezones():
            return jsonify({"error": "gecersiz timezone"}), 400
    # bildirim merkezi tarih modu yalnizca iki deger alabilir
    if "notif_center_time" in body and str(body.get("notif_center_time")) not in ("relative", "absolute"):
        return jsonify({"error": "gecersiz tarih formati"}), 400
    if "notif_center_limit" in body:
        try:
            if int(body.get("notif_center_limit")) not in (20, 50, 100):
                return jsonify({"error": "gecersiz liste boyutu"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "gecersiz liste boyutu"}), 400
    for key in (
        "tmdb_api_key",
        "telegram_bot_token",
        "telegram_chat_id",
        "notify_hour",
        "notification_hour",
        "sync_hour",
        "genre_hour",
        "data_hour",
        "anime_notification_hour",
        "rec_hour",
        "backup_hour",
        "backup_mode",
        "backup_rsync_host",
        "backup_rsync_port",
        "backup_rsync_path",
        "backup_rsync_user",
        "backup_samba_host",
        "backup_samba_port",
        "backup_samba_share",
        "backup_samba_user",
        "timezone",
        "language",
        "ntfy_topic",
        "telegram_enabled",
        "ntfy_enabled",
        "notif_center_enabled",
        "notif_center_time",
        "notif_center_poster",
        "notif_center_hide_read",
        "notif_center_limit",
        "discord_enabled",
        "discord_webhook_url",
        "email_enabled",
        "brevo_api_key",
        "email_from",
        "email_to",
        "email_provider",
        "smtp_preset",
        "smtp_host",
        "smtp_port",
        "smtp_user",
        "cache_ttl",
        *(f"notif_{k}" for k, _g in NOTIF_TYPES),
    ):
        if key in body:
            set_setting(key, str(body[key] or ""))
    if "smtp_pass" in body:
        val = (body.get("smtp_pass") or "").strip()
        # bos deger -> mevcut sifre korunur; sadece yeni girilen deger sifrelenir
        if val:
            set_setting("smtp_pass", encrypt_secret(val))
    for sec_key in ("backup_rsync_pass", "backup_samba_pass", "backup_rsync_key"):
        if sec_key in body:
            v = (body.get(sec_key) or "").strip()
            if v and v != "••••••••":
                set_setting(sec_key, encrypt_secret(v))
            elif v == "":
                # temizle isteği
                set_setting(sec_key, "")
    if "cache_ttl" in body:
        try:
            from ramcache import list_cache
            list_cache.configure(int(body["cache_ttl"] or 0))
        except (TypeError, ValueError):
            pass
    if any(k in body for k in ("notify_hour", "notification_hour", "sync_hour", "genre_hour", "data_hour", "anime_notification_hour", "rec_hour", "backup_hour", "timezone")):
        schedule_releases()
    return jsonify({"ok": True})


PROVIDER_LABELS = {
    "gmail": "Gmail", "outlook": "Outlook/Hotmail", "yahoo": "Yahoo",
    "yandex": "Yandex", "icloud": "iCloud", "zoho": "Zoho",
    "other": "E-Posta sunucusu", "brevo": "Brevo",
}


@settings_bp.route("/api/backup/run", methods=["POST"])
def backup_run():
    mode = (get_setting("backup_mode") or "").strip()
    if not mode:
        return jsonify({"error": "Yedekleme modu seçili değil"}), 400
    # stub: gerçek rsync/samba komutu sonraki fazda eklenecek; şimdilik ayar var mı kontrol et
    if mode == "db":
        # db dosyası var mı
        from config import DB_PATH
        import os
        if not os.path.exists(DB_PATH):
            return jsonify({"error": "DB dosyası bulunamadı"}), 400
    return jsonify({"ok": True, "msg": "Yedekleme kuyruğa alındı"})


@settings_bp.route("/api/backup/restore", methods=["POST"])
def backup_restore():
    mode = (get_setting("backup_mode") or "").strip()
    if not mode:
        return jsonify({"error": "Yedekleme modu seçili değil"}), 400
    return jsonify({"ok": True, "msg": "Geri yükleme kuyruğa alındı"})


@settings_bp.route("/api/settings/test", methods=["POST"])
def test_settings():
    body = request.get_json(silent=True) or {}
    channel = (body.get("channel") or "").strip().lower()
    if channel == "backup_rsync":
        host = (get_setting("backup_rsync_host") or "").strip()
        if not host:
            return jsonify({"error": "Uzak IP gerekli"}), 400
        return jsonify({"ok": True})
    if channel == "backup_samba":
        host = (get_setting("backup_samba_host") or "").strip()
        share = (get_setting("backup_samba_share") or "").strip()
        if not (host and share):
            return jsonify({"error": "Uzak IP ve paylaşılan klasör gerekli"}), 400
        return jsonify({"ok": True})
    token = (body.get("telegram_bot_token") or "").strip() or (get_setting("telegram_bot_token") or "").strip()
    chat_id = (body.get("telegram_chat_id") or "").strip() or (get_setting("telegram_chat_id") or "").strip()
    ntfy_topic = (body.get("ntfy_topic") or "").strip() or (get_setting("ntfy_topic") or "").strip()
    discord_url = (body.get("discord_webhook_url") or "").strip() or (get_setting("discord_webhook_url") or "").strip()
    brevo_api_key = (body.get("brevo_api_key") or "").strip() or (get_setting("brevo_api_key") or "").strip()
    email_from = (body.get("email_from") or "").strip() or (get_setting("email_from") or "").strip()
    email_to = (body.get("email_to") or "").strip() or (get_setting("email_to") or "").strip()
    provider = (body.get("email_provider") or get_setting("email_provider") or "brevo").strip() or "brevo"
    smtp_host = (body.get("smtp_host") or "").strip() or (get_setting("smtp_host") or "").strip()
    smtp_port = (body.get("smtp_port") or "").strip() or (get_setting("smtp_port") or "").strip()
    smtp_user = (body.get("smtp_user") or "").strip() or (get_setting("smtp_user") or "").strip()
    smtp_pass_plain = body.get("smtp_pass") or ""
    stored_pass = get_setting("smtp_pass") or ""
    sample_card = {
        "title": "Örnek Dizi",
        "media_type": "tv",
        "score": 8.1,
        "platform": "Netflix",
        "status_line": "S01E01 · Bugün Yayınlanacak",
        "poster_url": "https://image.tmdb.org/t/p/w500/gMYZZvnkVNTqSVnVCphWbPXwWwb.jpg",
    }

    if channel == "telegram":
        if not (token and chat_id):
            return jsonify({"error": "Telegram bot token ve chat ID gereklidir"}), 400
        r = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": t("test_message")},
            timeout=15,
        )
        if r.status_code != 200:
            try:
                err = r.json().get("description", "Bilinmeyen hata")
            except Exception:
                err = "Bilinmeyen hata"
            return jsonify({"error": f"Telegram hatası: {err}"}), 400
    elif channel == "ntfy":
        if not ntfy_topic:
            return jsonify({"error": "ntfy konusu gereklidir"}), 400
        r = requests.post(
            f"https://ntfy.sh/{ntfy_topic_clean(ntfy_topic)}",
            data=t("test_message"),
            timeout=15,
        )
        if r.status_code != 200:
            return jsonify({"error": f"ntfy hatası: HTTP {r.status_code}"}), 400
    elif channel == "discord":
        if not discord_url.startswith("https://discord.com/api/webhooks/"):
            return jsonify({"error": "Geçerli Discord webhook adresi gereklidir"}), 400
        try:
            r = requests.post(
                discord_url,
                json={"content": t("test_message")},
                timeout=15,
            )
            if r.status_code not in (200, 204):
                try:
                    err = r.json().get("message", "Bilinmeyen hata")
                except Exception:
                    err = "Bilinmeyen hata"
                return jsonify({"error": f"Discord hatası: {err}"}), 400
        except Exception as e:
            return jsonify({"error": f"Discord hatası: {e}"}), 400
    elif channel == "email":
        prov_label = PROVIDER_LABELS.get(provider, "E-Posta")
        if provider == "brevo":
            if not (brevo_api_key and email_from and email_to):
                return jsonify({"error": "Brevo API anahtarı, gönderen ve alıcı e-posta gereklidir"}), 400
            try:
                r = requests.post(
                    "https://api.brevo.com/v3/smtp/email",
                    json={
                        "sender": {"name": "NextEp", "email": email_from},
                        "to": [{"email": email_to}],
                        "subject": t("test_message"),
                        "textContent": t("test_message"),
                        "htmlContent": _email_card_html(sample_card),
                    },
                    headers={
                        "api-key": brevo_api_key,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    timeout=20,
                )
                if r.status_code not in (200, 201):
                    return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
            except Exception as e:
                return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
        else:
            password = smtp_pass_plain or decrypt_secret(stored_pass)
            if not (smtp_host and smtp_port and smtp_user and password and email_from and email_to):
                return jsonify({"error": "SMTP bilgileri eksik"}), 400
            try:
                ok = _send_generic_smtp(
                    t("test_message"), None,
                    host=smtp_host, port_raw=smtp_port, user=smtp_user, password=password,
                    email_from=email_from, email_to=email_to, card=sample_card,
                )
                if not ok:
                    return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400
            except Exception as e:
                return jsonify({"error": t("email_send_failed", provider=prov_label)}), 400

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
    try:
        from fav_listings import invalidate_fav_listing
        invalidate_fav_listing("genre", genre.lower() + "|all")
        invalidate_fav_listing("genre", genre.lower() + "|tv")
        invalidate_fav_listing("genre", genre.lower() + "|movie")
    except Exception:
        pass
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