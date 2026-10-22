import time
import datetime
import requests

import query_log
from rate_track import record

_TVMAZE_TTL = 6 * 3600  # 6 saat
_tvmaze_cache = {}


def _tvmaze_episode_times(title, tag=None):
    """TVmaze'ten dizi bölümlerinin yayın saatlerini (UTC epoch) döndürür.

    Dönüş: {(season, episode): epoch_saniye} veya None (bulunamadı/hata).
    2.19.25: istek/onbellek isabeti query_log'a yazılır.
    """
    if not title:
        return None
    now = time.time()
    cached = _tvmaze_cache.get(title)
    if cached and now - cached[0] < _TVMAZE_TTL:
        query_log.log("tvmaze", "GET", "/singlesearch/shows", status=200,
                      ms=0, src="cache", tag=tag, params={"q": title})
        return cached[1]
    record("tvmaze")  # kova yok; yalniz onbellek iskasi sayilir
    t0 = time.time()
    try:
        r = requests.get(
            "https://api.tvmaze.com/singlesearch/shows",
            params={"q": title, "embed": "episodes"},
            timeout=15,
        )
        if r.status_code != 200:
            query_log.log("tvmaze", "GET", "/singlesearch/shows", status=r.status_code,
                          ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                          params={"q": title})
            _tvmaze_cache[title] = (now, None)
            return None
        data = r.json()
    except requests.RequestException as exc:
        query_log.log("tvmaze", "GET", "/singlesearch/shows", status=0,
                      ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                      params={"q": title}, err=str(exc)[:120])
        _tvmaze_cache[title] = (now, None)
        return None
    query_log.log("tvmaze", "GET", "/singlesearch/shows", status=200,
                  ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                  params={"q": title})
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
