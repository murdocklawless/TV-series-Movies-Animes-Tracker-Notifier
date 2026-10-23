"""API hiz gostergesi + jeton kovasi (limit.md).

Kapsam: gozlem (rate monitor) + hiz sinirlama (token bucket).
TVmaze'e kova yok (kayit yalnizca).

Limitler tek yerden ayarlanir (asagidaki LIMITS).
Kovalar dolu baslar; kayit kuyruklari bos baslar.
Pik: gun-ici maksimum (05:00 hesap gunu), 05:00'te sifirlanir.
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
# snapshot() asla yeniden saymaz (titreme yapmaz), 05:00'te sifirlanir.
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


def _billing_day_key():
    """2.20.1: sayac siniri = 05:00 hesap gunu (query_log ile TEK kaynak)."""
    try:
        import query_log
        return query_log.billing_day()
    except Exception:
        d = datetime.datetime.fromtimestamp(_wall()) - datetime.timedelta(hours=5)
        return d.date().isoformat()


def _billing_start_epoch():
    """Hesap gununun baslangic epoch'i (05:00)."""
    try:
        import query_log
        return float(query_log.billing_day_start())
    except Exception:
        now_w = _wall()
        d = datetime.datetime.fromtimestamp(now_w)
        start = d.replace(hour=5, minute=0, second=0, microsecond=0)
        if d < start:
            start -= datetime.timedelta(days=1)
        return start.timestamp()


def _day_start_mono():
    """Hesap gunu basi (05:00) aninin monotonik karsiligi."""
    now_w = _wall()
    return _now() - (now_w - _billing_start_epoch())


def _today_key():
    """Hesap gunu anahtari (05:00 siniri) — gece yarisi DEGIL."""
    return _billing_day_key()


def _restore_from_log(day_key):
    """2.19.25: restart sonrasi gun-ici toplam/pik degerlerini sorgu
    gunlugunden geri hesaplar (canli JSONL dosyasi hesap gunu 05:00'dir).

    Neden: `record()` acilis zarfinda (backfill) saymaz ve RAM sayaclari
    restart'ta sifirlanir; gosterge "bugun 0 istek" gibi yanlis gorunuyordu.
    Log zaten her ag istegini yaziyor -> toparlama tek kaynaktan yapilir.
    Yalnizca gun degisiminde / ilk kullanimda bir kez calisir.
    """
    try:
        import query_log
    except Exception:
        return
    for name, cfg in LIMITS.items():
        try:
            total, peak = query_log.stats_today(
                name, cfg.get("window_sec") or 10, since=_billing_start_epoch()
            )
        except Exception:
            continue
        if total > _total.get(name, 0):
            _total[name] = int(total)
        if peak > _peak.get(name, 0):
            _peak[name] = int(peak)


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
        _restore_from_log(key)


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
    pct: o anki pencere dolulugu; peak: mandalli gun-ici tavan (05:00 hesap
    gununde sifirlanir; trafik yokken kimildamaz, cizgi titremez)."""
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
