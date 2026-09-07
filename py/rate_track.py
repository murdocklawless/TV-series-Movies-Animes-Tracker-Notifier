"""API hiz gostergesi + jeton kovasi (limit.md).

Kapsam: gozlem (rate monitor) + hiz sinirlama (token bucket).
TVmaze'e kova yok (kayit yalnizca).

Limitler tek yerden ayarlanir (asagidaki LIMITS).
Kovalar dolu baslar; kayit kuyruklari bos baslar.
Pik: gun-ici maksimum (pi yerel tarihi), gece yarisinda sifirlanir.
"""

import collections
import datetime
import threading
import time

# Tek ayar noktasi: (kapasite, dolum/sn, pencere-sn, pencere-limiti)
# Bar metriki: pencere ici istek / pencere-limiti.
LIMITS = {
    "tmdb": {"capacity": 30, "refill_per_sec": 3.0, "window_sec": 10, "window_limit": 30},
    "anilist": {"capacity": 70, "refill_per_sec": 70.0 / 60.0, "window_sec": 60, "window_limit": 70},
    "tvmaze": {"capacity": None, "refill_per_sec": None, "window_sec": 10, "window_limit": 20},
}

_lock = threading.Lock()
_tokens = {}
_last = {}
_hits = {name: collections.deque() for name in LIMITS}

# Kuyruklar gun-basi + pencere tutulur; bar sayimi okuma aninda pencereye
# gore filtrelenir. Pik mandallidir: yalniz record() aninda yukselir,
# snapshot() asla yeniden saymaz (titreme yapmaz), gece yarisinda sifirlanir.
_PEAK_STEP = 60  # korunuyor (eski test uyumlulugu); taramada artik kullanilmiyor
_peak = {name: 0 for name in LIMITS}
_total = {name: 0 for name in LIMITS}
_peak_day = None

# Acilis zarfi: nextep.py backfill_votes/sync_genres calisirken record
# sayilmaz (bar/pik acilis patlamasiyla kirlenmez). Throttle (acquire)
# aynen calisir; yalniz gosterge atlanir. ramcache deseniyle ayni.
_startup_grace = True


def set_startup_grace(on):
    """Acilis zarfini acar/kapatir (nextep.py serve oncesi kapatir)."""
    global _startup_grace
    _startup_grace = bool(on)

_now = time.monotonic  # testler sahte saat enjekte eder
_wall = time.time  # testler sahte duvar-saati enjekte eder


def _day_start_mono():
    """Pi yerel tarihiyle gun-basi aninin monotonik karsiligi (gece-yarisi siniri)."""
    now_w = _wall()
    mid_w = datetime.datetime.fromtimestamp(now_w).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    return _now() - (now_w - mid_w)


def _today_key():
    """Pi yerel tarihi (gun-degisimi = pik sifirlama siniri)."""
    return datetime.datetime.fromtimestamp(_wall()).date().isoformat()


def _rollover_locked():
    """Gun degismisse mandalli pikleri ve gunluk toplamlari sifirlar
    (kilit altinda cagrilir)."""
    global _peak_day
    key = _today_key()
    if key != _peak_day:
        _peak_day = key
        for name in _peak:
            _peak[name] = 0
        for name in _total:
            _total[name] = 0


def _ensure(name):
    if name not in _tokens:
        cap = LIMITS[name]["capacity"]
        _tokens[name] = float(cap) if cap else 0.0
        _last[name] = _now()


def _refill(name):
    """Kovayi son-dolum zamanindan bu yana gecen sureye gore doldurur (tavanli)."""
    cfg = LIMITS[name]
    if not cfg["capacity"]:
        return
    _ensure(name)
    now = _now()
    elapsed = now - _last[name]
    if elapsed > 0:
        _tokens[name] = min(float(cfg["capacity"]), _tokens[name] + elapsed * cfg["refill_per_sec"])
        _last[name] = now


def acquire(service):
    """Jeton varsa duser ve doner; yoksa bir sonraki doluma kadar kisa uyuyup
    tekrar dener (cagirani bloklar, istegi dusurmez). TVmaze'de cagrilmaz."""
    cfg = LIMITS[service]
    if not cfg["capacity"]:
        return True
    while True:
        with _lock:
            _refill(service)
            if _tokens[service] >= 1.0:
                _tokens[service] -= 1.0
                return True
            need = (1.0 - _tokens[service]) / cfg["refill_per_sec"]
        time.sleep(min(max(need, 0.01), 1.0))


def record(service):
    """Yalniz gercek HTTP aninda cagrilir (akisi bekletmez; pencere sayimi +
    pik mandali mikrosaniyeler mertebesindedir). Onbellek isabeti sayilmaz."""
    now = _now()
    with _lock:
        if _startup_grace:
            return
        _rollover_locked()
        dq = _hits[service]
        dq.append(now)
        cfg = LIMITS[service]
        cutoff = _day_start_mono() - cfg["window_sec"]
        while dq and dq[0] <= cutoff:
            dq.popleft()
        # Pik mandali: o anki pencere dolulugu rekoru kirarsa yukselt,
        # asla dusurme (trafik yokken snapshot titremez).
        wcut = now - cfg["window_sec"]
        c = sum(1 for ts in dq if ts > wcut)
        if c > _peak[service]:
            _peak[service] = c
        _total[service] += 1


def handle_429(service, response):
    """429 yedegi: Retry-After saygisi (yoksa 60 sn, tavan 120 sn) uyur, True doner.
    Cagiran bir kez tekrar dener."""
    try:
        wait = float(response.headers.get("Retry-After") or 60)
    except (TypeError, ValueError, AttributeError):
        wait = 60.0
    wait = min(max(wait, 0.0), 120.0)
    time.sleep(wait)
    return True


def snapshot():
    """{tmdb: {pct, peak, hits}, anilist: {...}, tvmaze: {...}} (yalniz RAM okur).
    pct: o anki pencere dolulugu; peak: mandalli gun-ici tavan (gece yarisi
    sifirlanir; trafik yokken kimildamaz, cizgi titremez)."""
    now = _now()
    day0 = _day_start_mono()
    out = {}
    with _lock:
        _rollover_locked()
        for name, cfg in LIMITS.items():
            dq = _hits[name]
            keep = day0 - cfg["window_sec"]
            while dq and dq[0] <= keep:
                dq.popleft()
            cutoff = now - cfg["window_sec"]
            hits = sum(1 for ts in dq if ts > cutoff)
            pct = min(100, int(round(hits * 100.0 / cfg["window_limit"]))) if cfg["window_limit"] else 0
            pk = _peak[name]
            peak = min(100, int(round(pk * 100.0 / cfg["window_limit"]))) if cfg["window_limit"] else 0
            out[name] = {"pct": pct, "peak": peak, "hits": hits, "total": _total[name]}
    return out


def _reset_for_tests():
    """Birim testler icin kovalar + kuyruklar + mandalli pikler + toplamlar sifirlanir."""
    global _peak_day, _startup_grace
    with _lock:
        _tokens.clear()
        _last.clear()
        for dq in _hits.values():
            dq.clear()
        for name in _peak:
            _peak[name] = 0
        for name in _total:
            _total[name] = 0
        _peak_day = None
        _startup_grace = False
