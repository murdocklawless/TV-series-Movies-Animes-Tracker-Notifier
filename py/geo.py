"""IP-ulke konumu: pi konumu DB'de (settings.geo_*), istemci lookup, ulke->dil + tz.

Gizlilik: istemci IP'si ham haliyle disari gonderilmez; sorguyu pi yapar
(sunucudan sunucuya). Istemci-IP konumlari saklanmaz, yalniz pi'nin
kendi konumu settings tablosunda tutulur.
"""
import ipaddress
import json
import time
import urllib.request
import zoneinfo

from db import get_setting, set_setting

GEO_TIMEOUT = 2
GEO_STALE_SEC = 86400
GEO_BANNER_DAYS = 7

# 14 desteklenen dilin tam kodlari (kayit dogrulamasi icin).
LOGIN_LANGS = (
    "tr-TR", "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "ru-RU",
    "ar-SA", "pt-BR", "nl-NL", "pl-PL", "ja-JP", "ko-KR", "zh-CN",
)
_LOGIN_SHORTS = {c.split("-")[0] for c in LOGIN_LANGS}


def normalize_lang(code):
    """tr-TR / tr -> tr-TR; bilinmiyorsa None."""
    if not code or not isinstance(code, str):
        return None
    code = code.strip()
    if code in LOGIN_LANGS:
        return code
    short = code.split("-")[0].strip().lower()
    for full in LOGIN_LANGS:
        if full.split("-")[0] == short:
            return full
    return None


# Ulke -> arayuz dili (kisa kod). Eslesmeyen -> en.
# Cok-dilliler: CH->de, BE->nl, CA->en (kullanici karari).
COUNTRY_LANG = {
    "TR": "tr",
    "US": "en", "CA": "en", "GB": "en", "IE": "en", "AU": "en", "NZ": "en",
    "DE": "de", "AT": "de", "CH": "de",
    "FR": "fr",
    "ES": "es", "MX": "es", "AR": "es", "CL": "es", "CO": "es", "PE": "es",
    "VE": "es", "UY": "es", "PY": "es", "BO": "es", "EC": "es", "CR": "es",
    "PA": "es", "DO": "es", "GT": "es", "HN": "es", "SV": "es", "NI": "es",
    "CU": "es",
    "IT": "it",
    "RU": "ru", "UA": "ru", "BY": "ru", "KZ": "ru",
    "SA": "ar", "EG": "ar", "DZ": "ar", "MA": "ar", "TN": "ar", "LY": "ar",
    "SD": "ar", "IQ": "ar", "JO": "ar", "LB": "ar", "SY": "ar", "YE": "ar",
    "KW": "ar", "QA": "ar", "BH": "ar", "OM": "ar", "MR": "ar",
    "BR": "pt", "PT": "pt", "AO": "pt", "MZ": "pt",
    "NL": "nl", "BE": "nl",
    "PL": "pl",
    "JP": "ja",
    "KR": "ko",
    "CN": "zh", "TW": "zh", "HK": "zh", "SG": "zh",
}


def lang_for_country(cc):
    if not cc or not isinstance(cc, str):
        return "en"
    return COUNTRY_LANG.get(cc.strip().upper(), "en")


# Ulke -> baskent/birincil kusak (API timezone veremezse yedek).
CAPITAL_TZ = {
    "TR": "Europe/Istanbul", "US": "America/New_York", "CA": "America/Toronto",
    "GB": "Europe/London", "IE": "Europe/Dublin", "AU": "Australia/Sydney",
    "NZ": "Pacific/Auckland", "DE": "Europe/Berlin", "AT": "Europe/Vienna",
    "CH": "Europe/Zurich", "FR": "Europe/Paris", "ES": "Europe/Madrid",
    "MX": "America/Mexico_City", "AR": "America/Argentina/Buenos_Aires",
    "CL": "America/Santiago", "CO": "America/Bogota", "PE": "America/Lima",
    "VE": "America/Caracas", "UY": "America/Montevideo", "PY": "America/Asuncion",
    "BO": "America/La_Paz", "EC": "America/Guayaquil", "CR": "America/Costa_Rica",
    "PA": "America/Panama", "DO": "America/Santo_Domingo", "GT": "America/Guatemala",
    "HN": "America/Tegucigalpa", "SV": "America/El_Salvador", "NI": "America/Managua",
    "CU": "America/Havana", "IT": "Europe/Rome", "RU": "Europe/Moscow",
    "UA": "Europe/Kiev", "BY": "Europe/Minsk", "KZ": "Asia/Almaty",
    "SA": "Asia/Riyadh", "EG": "Africa/Cairo", "DZ": "Africa/Algiers",
    "MA": "Africa/Casablanca", "TN": "Africa/Tunis", "BR": "America/Sao_Paulo",
    "PT": "Europe/Lisbon", "AO": "Africa/Luanda", "MZ": "Africa/Maputo",
    "NL": "Europe/Amsterdam", "BE": "Europe/Brussels", "PL": "Europe/Warsaw",
    "JP": "Asia/Tokyo", "KR": "Asia/Seoul", "CN": "Asia/Shanghai",
    "TW": "Asia/Taipei", "HK": "Asia/Hong_Kong", "SG": "Asia/Singapore",
}


def valid_tz(tz):
    try:
        return bool(tz) and tz in zoneinfo.available_timezones()
    except Exception:
        return False


def is_public_ip(ip):
    try:
        o = ipaddress.ip_address((ip or "").strip())
        return o.is_global and not o.is_reserved and not o.is_multicast
    except Exception:
        return False


def lookup_ip(ip):
    """ip-api.com sorgusu -> {country_code, country, city, timezone} ya da None.
    ip bos ise kendi cikis IP'si cozulur."""
    try:
        target = (ip or "").strip()
        url = "http://ip-api.com/json/%s?fields=status,country,countryCode,city,timezone,query" % target
        req = urllib.request.Request(url, headers={"User-Agent": "nextep-geo/1.0"})
        with urllib.request.urlopen(req, timeout=GEO_TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        if not isinstance(data, dict) or data.get("status") != "success":
            return None
        cc = (data.get("countryCode") or "").strip().upper()
        if not cc:
            return None
        tz = (data.get("timezone") or "").strip()
        if not valid_tz(tz):
            tz = CAPITAL_TZ.get(cc, "")
            if not valid_tz(tz):
                tz = ""
        return {
            "country_code": cc,
            "country": (data.get("country") or cc).strip(),
            "city": (data.get("city") or "").strip(),
            "timezone": tz,
        }
    except Exception:
        return None


def get_pi_geo():
    try:
        return {
            "country_code": get_setting("geo_country") or "",
            "country": get_setting("geo_country_name") or "",
            "city": get_setting("geo_city") or "",
            "timezone": get_setting("geo_tz") or "",
            "updated": int(get_setting("geo_updated") or 0),
            "moved_at": int(get_setting("geo_moved_at") or 0),
        }
    except Exception:
        return {"country_code": "", "country": "", "city": "", "timezone": "", "updated": 0, "moved_at": 0}


def refresh_pi_geo(force=False):
    """Pi konumunu tazele (gunde 1). Ulke degismisse geo_moved_at damgala +
    eski ulke tz'sini tasiyan kullanicilari yeni tz'ye gecir. Donus: pi geo."""
    now = int(time.time())
    cur = get_pi_geo()
    if not force and cur["updated"] and now - cur["updated"] < GEO_STALE_SEC:
        return cur
    try:
        info = lookup_ip("")
    except Exception:
        info = None
    if not info:
        return cur
    old_cc = cur["country_code"]
    old_tz = cur["timezone"]
    new_cc = info["country_code"]
    new_tz = info["timezone"] or CAPITAL_TZ.get(new_cc, "") or old_tz or "Europe/Istanbul"
    try:
        set_setting("geo_country", new_cc)
        set_setting("geo_country_name", info["country"])
        set_setting("geo_city", info["city"])
        if valid_tz(new_tz):
            set_setting("geo_tz", new_tz)
        set_setting("geo_updated", str(now))
    except Exception:
        return cur
    if old_cc and old_cc != new_cc:
        # Ulke degisimi: bir kez damgala (gunluk tazeleme ezmez).
        try:
            set_setting("geo_moved_at", str(now))
        except Exception:
            pass
        if old_tz and valid_tz(new_tz) and old_tz != new_tz:
            _migrate_followers_tz(old_tz, new_tz)
    cur = get_pi_geo()
    return cur


def _migrate_followers_tz(old_tz, new_tz):
    """Eski ulke tz'sini tasiyan uyeleri yeni tz'ye gecir; ozel tz'lilere
    dokunulmaz. Global varsayilan esitse o da guncellenir."""
    try:
        from db import get_db
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT user_id FROM user_settings WHERE key='timezone' AND value=?",
                (old_tz,),
            ).fetchall()
            for r in rows:
                try:
                    conn.execute(
                        "UPDATE user_settings SET value=? WHERE user_id=? AND key='timezone'",
                        (new_tz, r["user_id"]),
                    )
                except Exception:
                    continue
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    try:
        if (get_setting("timezone") or "") == old_tz:
            set_setting("timezone", new_tz)
    except Exception:
        pass


def resolve_for_request(client_ip):
    """Istek icin konum: herkese-acik IP canli, ozel/tunel/hata pi konumu.
    Donus {country_code, country, city, timezone, lang} (lang daima dolu)."""
    pi = get_pi_geo()
    info = None
    if is_public_ip(client_ip):
        try:
            info = lookup_ip(client_ip)
        except Exception:
            info = None
    if not info:
        info = {
            "country_code": pi["country_code"],
            "country": pi["country"] or pi["country_code"],
            "city": pi["city"],
            "timezone": pi["timezone"],
        }
    cc = (info.get("country_code") or "").strip().upper()
    out = {
        "country_code": cc,
        "country": (info.get("country") or cc).strip(),
        "city": (info.get("city") or "").strip(),
        "timezone": (info.get("timezone") or "").strip(),
    }
    out["lang"] = lang_for_country(cc)
    return out
