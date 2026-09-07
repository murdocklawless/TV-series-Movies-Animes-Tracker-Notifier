import time
import datetime
import requests

from rate_track import record

_TVMAZE_TTL = 6 * 3600  # 6 saat
_tvmaze_cache = {}


def _tvmaze_episode_times(title):
    """TVmaze'ten dizi bölümlerinin yayın saatlerini (UTC epoch) döndürür.

    Dönüş: {(season, episode): epoch_saniye} veya None (bulunamadı/hata).
    """
    if not title:
        return None
    now = time.time()
    cached = _tvmaze_cache.get(title)
    if cached and now - cached[0] < _TVMAZE_TTL:
        return cached[1]
    record("tvmaze")  # kova yok; yalniz onbellek iskasi sayilir
    try:
        r = requests.get(
            "https://api.tvmaze.com/singlesearch/shows",
            params={"q": title, "embed": "episodes"},
            timeout=15,
        )
        if r.status_code != 200:
            _tvmaze_cache[title] = (now, None)
            return None
        data = r.json()
    except requests.RequestException:
        _tvmaze_cache[title] = (now, None)
        return None
    eps = {}
    for ep in data.get("_embedded", {}).get("episodes", []):
        air = ep.get("airstamp")
        season = ep.get("season")
        number = ep.get("number")
        if air and season is not None and number is not None:
            try:
                dt = datetime.datetime.fromisoformat(air.replace("Z", "+00:00"))
                eps[(season, number)] = int(dt.timestamp())
            except ValueError:
                continue
    _tvmaze_cache[title] = (now, eps)
    return eps
