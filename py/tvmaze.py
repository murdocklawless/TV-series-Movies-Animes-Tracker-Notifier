import time
import datetime
import requests

import query_log
from rate_track import record

_TVMAZE_TTL = 6 * 3600  # 6 saat
_tvmaze_cache = {}


def _tvmaze_episode_times(title, tag=None, premiere_year=None):
    """TVmaze'ten dizi bölümlerinin yayın saatlerini (UTC epoch) döndürür.

    Dönüş: {(season, episode): epoch_saniye} veya None (bulunamadı/hata).
    2.19.25: istek/onbellek isabeti query_log'a yazılır.

    2.20.7: `premiere_year` verilirse TVmaze'in döndürdüğü şovun prömiyer yılı
    TMDB yılıyla ±1 tutmalıdır; tutmuyorsa sonuç REDDEDİLİR. Aksi halde aynı
    ada sahip bambaşka bir yapım (ör. "Mayday": TR'de "Uçak Kazası Raporu" 2003
    vs Norveç "Mayday" 2026) bölüm tarihlerini ezebiliyordu.
    """
    if not title:
        return None
    now = time.time()
    # Önbellek anahtarı yılı da içerir: yanlış eşleşme başka yılın sorgusunu
    # kirletmesin.
    cache_key = f"{title}|{premiere_year if premiere_year else ''}"
    cached = _tvmaze_cache.get(cache_key)
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
            _tvmaze_cache[cache_key] = (now, None)
            return None
        data = r.json()
    except requests.RequestException as exc:
        query_log.log("tvmaze", "GET", "/singlesearch/shows", status=0,
                      ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                      params={"q": title}, err=str(exc)[:120])
        _tvmaze_cache[cache_key] = (now, None)
        return None
    query_log.log("tvmaze", "GET", "/singlesearch/shows", status=200,
                  ms=int((time.time() - t0) * 1000), src="net", tag=tag,
                  params={"q": title})
    # 2.20.7: isim eşleşmesi tek başına yeterli değil — prömiyer yılı doğrula.
    if premiere_year:
        try:
            pyear = int(str(data.get("premiered") or "")[:4])
        except (TypeError, ValueError):
            pyear = 0
        try:
            exp_year = int(premiere_year)
        except (TypeError, ValueError):
            exp_year = 0
        if not pyear or abs(pyear - exp_year) > 1:
            print(f"[tvmaze] eslesme reddedildi: {title!r} (tvmaze {pyear or '?'} != tmdb {exp_year or '?'})",
                  flush=True)
            _tvmaze_cache[cache_key] = (now, None)
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
    _tvmaze_cache[cache_key] = (now, eps)
    return eps
