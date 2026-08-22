"""Surec ici RAM cache'i: TTL'li, sinirli girdili, thread-safe.
ttl=0 iken tamamen kapalidir (get hep None doner, set islemsizdir).
Girdiler ayrica SQLite'a (cache_store tablosu) yazilir; servis restart
edildiginde restore_from_db() ile geri yuklenir. Gen sayaci da kalici
tutulur ki anahtarlar restart sonrasi eslesmeye devam etsin."""
import threading
import time
import json

from flask import jsonify

from db import get_db, get_setting, set_setting

# Baslangiç zarfi: tracker.py backfill_votes/sync_genres calisirken bump
# bastirilir ki restore edilen cache aninda gecersiz olmasin.
_startup_grace = True

_gen_lock = threading.Lock()
_gen = 0


def end_startup():
    global _startup_grace
    _startup_grace = False


def bump():
    """Herhangi bir yazma isleminde cagrilir; tum liste cache'lerini gecersiz kil."""
    global _gen
    if _startup_grace:
        return
    with _gen_lock:
        _gen += 1
        try:
            set_setting("cache_gen", str(_gen))
        except Exception:
            pass


def gen():
    return _gen


def _persist(key, value, ts):
    try:
        conn = get_db()
        conn.execute(
            "INSERT OR REPLACE INTO cache_store (key, value, ts) VALUES (?, ?, ?)",
            (json.dumps(list(key), ensure_ascii=False), json.dumps(value, ensure_ascii=False), ts),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _db_clear():
    try:
        conn = get_db()
        conn.execute("DELETE FROM cache_store")
        conn.commit()
        conn.close()
    except Exception:
        pass


class TTLCache:
    def __init__(self, maxsize=64, ttl=90):
        self._store = {}
        self._lock = threading.Lock()
        self._maxsize = maxsize
        self._ttl = int(ttl or 0)

    def configure(self, ttl):
        with self._lock:
            self._ttl = int(ttl or 0)
            if self._ttl <= 0:
                self._store.clear()

    def get(self, key):
        now = time.time()
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            ts, value = item
            if self._ttl <= 0 or now - ts > self._ttl:
                del self._store[key]
                return None
            return value

    def set(self, key, value):
        if self._ttl <= 0:
            return
        now = time.time()
        with self._lock:
            if len(self._store) >= self._maxsize and key not in self._store:
                oldest = min(self._store, key=lambda k: self._store[k][0])
                del self._store[oldest]
            self._store[key] = (now, value)
        _persist(key, value, now)

    def clear(self):
        with self._lock:
            self._store.clear()
        _db_clear()

    def restore_from_db(self):
        """Restart sonrasi: gen sayacini ve cache girdilerini SQLite'tan geri yukler.
        ttl<=0 (Kapali) ise hicbir sey yuklemez."""
        global _gen
        try:
            saved = int(get_setting("cache_gen") or 0)
        except (TypeError, ValueError):
            saved = 0
        if saved > _gen:
            with _gen_lock:
                _gen = saved
        if self._ttl <= 0:
            return
        now = time.time()
        cutoff = now - 7 * 86400
        try:
            conn = get_db()
            rows = conn.execute("SELECT key, value, ts FROM cache_store").fetchall()
            conn.close()
        except Exception:
            return
        with self._lock:
            for r in rows:
                ts = r["ts"] or 0
                if ts < cutoff:
                    continue
                try:
                    k = tuple(json.loads(r["key"]))
                    v = json.loads(r["value"])
                except Exception:
                    continue
                if k not in self._store:
                    self._store[k] = (ts, v)


def cached_response(data, hit):
    """Cache durumunu X-Cache basligiyle dondurur (HIT/MISS)."""
    resp = jsonify(data)
    resp.headers["X-Cache"] = "HIT" if hit else "MISS"
    return resp


list_cache = TTLCache()