"""Senkron havuzu (2.19.6).

Amac: Trakt giden islemlerini **aninda** yapmak ve gelen Trakt yoklamasini
uygulama aktifken 10 saniyeye indirmek. Webhook'lar ve Emby WS akislari bu
havuzun uzerinden calisir (Emby WS oge bazli hizli yol).

Yapi
----
* `sync_events` tablosu = kalici outbox. Restart'ta bekleyen isler kaybolmaz.
* Iki worker thread:
    - `sync-pool-out` : outbox olaylari (trakt.out / emby.ws)
    - `sync-pool-in`  : Trakt gelen yoklama zamanlayicisi (aktif 10 sn / bossa
      kullanici araligi) + seyrek mutabakat (`trakt.reconcile_if_due`)
* `EVENT` ile uyanma: yerel olayda ~50 ms, yoklama icin zamanlayici.

Kurallar
--------
* dedupe: ayni anahtar tekrar gelirse satir cogalmaz ("trakt.out" tek kick).
* retry: 5s -> 30s -> 2dk -> 10dk; 8 denemede `failed`.
* 429/rate-limit: Trakt'in `Retry-After` degeri kadar beklenir.
* echo korumasi: `source='trakt'` yazan `process_signal` cagrilari kick atmaz.
* token yok / cift yon kapali: olay no-op sayilir (basarili kapanir).
"""
import json
import threading
import time

from db import get_db

KIND_TRAKT_OUT = "trakt.out"        # giden aktarim (kick; Trakt tarafi tarar)
KIND_EMBY_WS = "emby.ws"            # Emby WS olayi (oge id listesi)

ACTIVE_WINDOW = 60          # sn: son ping'den sonra "aktif" sayilir
FAST_INTERVAL = 10          # sn: aktifken Trakt gelen yoklama araligi
RECONCILE_MIN = 15          # dk: mutabakat en fazla bu aralikla calisir
MAX_ATTEMPTS = 8
BACKOFF = (5, 30, 120, 600)
BATCH = 20                  # tek turda islenecek olay sayisi
IDLE_TICK = 5.0             # en uzun uyku (aktiflik degisimi cabuk fark edilsin)
OUT_DEBOUNCE = 2.0          # sn: giden islemi 2 sn topla (tek POST'ta birlestir)

_EVENT = threading.Event()      # outbox icin uyandirma
_IN_EVENT = threading.Event()   # gelen yoklama icin uyandirma
_STOP = threading.Event()
_STARTED = False
_LOCK = threading.Lock()

_PRESENCE = {}                  # uid -> son ping epoch
_USERS = {"ts": 0.0, "ids": []}
_IN_DUE = {}
_LAST = {"ts": 0, "kind": "", "error": ""}


# ---------------------------------------------------------------------------
# genel yardimcilar
# ---------------------------------------------------------------------------

def _now():
    return int(time.time())


def _log(msg):
    print(f"[sync_pool] {msg}", flush=True)


def _parse_rate(err):
    """'rate-limit:120' -> 120 (yoksa 0)."""
    try:
        e = str(err or "")
        if e.startswith("rate-limit:"):
            return max(5, int(e.split(":", 1)[1]))
    except Exception:
        pass
    return 0


# ---------------------------------------------------------------------------
# uretici tarafi
# ---------------------------------------------------------------------------

def put(kind, uid=0, payload=None, dedupe=None):
    """Olayi outbox'a yaz + worker'i uyandir. Fail-soft -> True/False."""
    now = _now()
    body = json.dumps(payload or {}, ensure_ascii=False)
    try:
        conn = get_db()
        try:
            if dedupe:
                # Ayni anahtar varsa tazelenir; yoksa yeni satir acilir.
                # (ON CONFLICT yerine elle: kismi UNIQUE index'i hedeflemek
                # SQLite surumune gore kirilgan.)
                row = conn.execute(
                    "SELECT id FROM sync_events WHERE dedupe=? ORDER BY id DESC LIMIT 1",
                    (dedupe,),
                ).fetchone()
                if row:
                    conn.execute(
                        "UPDATE sync_events SET uid=?, kind=?, payload=?, state='pending', "
                        "next_ts=?, updated_ts=? WHERE id=?",
                        (int(uid or 0), kind, body, now, now, int(row["id"])),
                    )
                else:
                    conn.execute(
                        "INSERT INTO sync_events "
                        "(dedupe, uid, kind, payload, state, attempts, next_ts, created_ts, updated_ts, last_error) "
                        "VALUES (?,?,?,?,'pending',0,?,?,?,'')",
                        (dedupe, int(uid or 0), kind, body, now, now, now),
                    )
            else:
                conn.execute(
                    "INSERT INTO sync_events "
                    "(dedupe, uid, kind, payload, state, attempts, next_ts, created_ts, updated_ts, last_error) "
                    "VALUES (NULL,?,?,?,'pending',0,?,?,?,'')",
                    (int(uid or 0), kind, body, now, now, now),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        _log(f"put hata ({kind}): {e}")
        return False
    _EVENT.set()
    return True


def kick_trakt_out(uid):
    """Giden aktarim taramasi iste (tek bekleyen satir; tekrarlar birlesir).

    Izleme/kaldirma yazildiktan hemen sonra cagrilir: 2 sn sonra tek POST
    olarak Trakt'a gider (hem kaldirmalar hem yeni izlemeler).
    """
    try:
        uid = int(uid or 0)
    except (TypeError, ValueError):
        return False
    if uid <= 0:
        return False
    return put(KIND_TRAKT_OUT, uid, {}, dedupe=f"{KIND_TRAKT_OUT}:{uid}")


def put_emby_ws(ids):
    """Emby WS olayi (oge id listesi) -> kuyruk."""
    ids = [str(i) for i in (ids or []) if i]
    if not ids:
        return False
    return put(KIND_EMBY_WS, 0, {"ids": ids, "count": len(ids)})


# ---------------------------------------------------------------------------
# aktiflik (gorunur sekme ping'i)
# ---------------------------------------------------------------------------

def presence(uid=0):
    """Gorunur sekme ping'i -> aktif penceresi tazelenir."""
    try:
        uid = int(uid or 0)
    except (TypeError, ValueError):
        uid = 0
    _PRESENCE[uid] = time.time()
    _IN_EVENT.set()
    return True


def is_active(uid=None):
    now = time.time()
    if uid is None:
        return any(now - ts <= ACTIVE_WINDOW for ts in _PRESENCE.values())
    try:
        ts = _PRESENCE.get(int(uid))
    except (TypeError, ValueError):
        ts = None
    return bool(ts and (now - ts) <= ACTIVE_WINDOW)


def interval_seconds(uid):
    """Trakt gelen yoklama araligi (sn). 0 = kapali."""
    try:
        import trakt
        if not trakt.connected(uid):
            return 0
        if not trakt.in_enabled(uid):
            return 0
        minutes = trakt.poll_minutes(uid)
    except Exception:
        return 0
    if minutes <= 0:
        return 0
    return FAST_INTERVAL if is_active(uid) else int(minutes * 60)


# ---------------------------------------------------------------------------
# worker: outbox
# ---------------------------------------------------------------------------

def _due_rows(now, limit=BATCH):
    try:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT id, uid, kind, payload, attempts, created_ts FROM sync_events "
                "WHERE state='pending' AND next_ts<=? ORDER BY next_ts, id LIMIT ?",
                (int(now), int(limit)),
            ).fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        _log(f"kuyruk okunamadi: {e}")
        return []


def _set_state(row_id, state, err="", next_ts=None, bump_attempt=False):
    now = _now()
    try:
        conn = get_db()
        try:
            if bump_attempt:
                conn.execute(
                    "UPDATE sync_events SET state=?, attempts=attempts+1, next_ts=?, "
                    "updated_ts=?, last_error=? WHERE id=?",
                    (state, int(next_ts if next_ts is not None else now),
                     now, str(err or "")[:300], int(row_id)),
                )
            else:
                conn.execute(
                    "UPDATE sync_events SET state=?, next_ts=?, updated_ts=?, last_error=? WHERE id=?",
                    (state, int(next_ts if next_ts is not None else now),
                     now, str(err or "")[:300], int(row_id)),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        _log(f"durum yazilamadi: {e}")


def _dispatch(row):
    """-> (ok, err)."""
    kind = row.get("kind") or ""
    uid = int(row.get("uid") or 0)
    try:
        payload = json.loads(row.get("payload") or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except Exception:
        payload = {}

    if kind == KIND_TRAKT_OUT:
        import trakt
        if not trakt.connected(uid) or not trakt.two_way(uid):
            return True, "skip"          # no-op: basarili say
        return trakt.flush_out(uid)

    if kind == KIND_EMBY_WS:
        import emby_sync
        ids = payload.get("ids") or []
        if not ids:
            return True, "skip"
        return emby_sync.sync_items(ids, trigger="ws")

    return True, "unknown-kind"          # bilinmeyen tur: sonsuz donguye girme


def _handle(row):
    # Giden aktarim: 2 sn topla (art arda gelen isaretlemeler tek POST olur).
    if row.get("kind") == KIND_TRAKT_OUT:
        try:
            ready_at = float(row.get("created_ts") or 0) + OUT_DEBOUNCE
        except (TypeError, ValueError):
            ready_at = 0.0
        if ready_at > time.time():
            _set_state(row["id"], "pending", next_ts=int(ready_at) + 1)
            return
    _set_state(row["id"], "running")
    ok, err = (False, "exception")
    try:
        ok, err = _dispatch(row)
    except Exception as e:
        ok, err = False, str(e)[:200]
    if ok:
        _set_state(row["id"], "done")
        _LAST.update({"ts": _now(), "kind": row.get("kind") or "", "error": ""})
        return
    attempts = int(row.get("attempts") or 0) + 1
    if attempts >= MAX_ATTEMPTS:
        _set_state(row["id"], "failed", err, bump_attempt=True)
        _LAST.update({"ts": _now(), "kind": row.get("kind") or "", "error": str(err or "")})
        _log(f"olay basarisiz (#{row['id']} {row.get('kind')}): {err}")
        return
    wait = _parse_rate(err) or BACKOFF[min(attempts - 1, len(BACKOFF) - 1)]
    _set_state(row["id"], "pending", err, next_ts=_now() + wait, bump_attempt=True)
    _LAST.update({"ts": _now(), "kind": row.get("kind") or "", "error": str(err or "")})


def _next_due(now):
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT MIN(next_ts) m FROM sync_events WHERE state='pending'"
            ).fetchone()
        finally:
            conn.close()
        if row and row["m"] is not None:
            return max(0.2, float(row["m"]) - now)
    except Exception:
        pass
    return IDLE_TICK


def _loop_out():
    while not _STOP.is_set():
        try:
            rows = _due_rows(time.time())
            for r in rows:
                if _STOP.is_set():
                    break
                _handle(r)
            wait = _next_due(time.time())
        except Exception as e:
            _log(f"out dongu hata: {e}")
            wait = 2.0
        _EVENT.wait(min(wait, IDLE_TICK))
        _EVENT.clear()


# ---------------------------------------------------------------------------
# worker: Trakt gelen yoklama
# ---------------------------------------------------------------------------

def _in_users():
    """Trakt token'i olan kullanicilar (30 sn onbellek)."""
    now = time.time()
    if now - _USERS["ts"] < 30:
        return list(_USERS["ids"])
    ids = []
    try:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT DISTINCT user_id FROM user_settings "
                "WHERE key='tp_trakt_token' AND IFNULL(value,'')<>''"
            ).fetchall()
            ids = [int(r["user_id"]) for r in rows]
        finally:
            conn.close()
    except Exception as e:
        _log(f"kullanici listesi okunamadi: {e}")
        ids = [1]          # okuma hatasi: yoklama tamamen durmasin
    _USERS["ts"] = now
    _USERS["ids"] = ids
    return list(ids)


def _loop_in():
    while not _STOP.is_set():
        now = time.time()
        try:
            for uid in _in_users():
                due = _IN_DUE.get(uid)
                if due is None:
                    _IN_DUE[uid] = now + 1.0      # ilk yoklama: 1 sn sonra
                    continue
                if now < due:
                    continue
                secs = interval_seconds(uid)
                if secs <= 0:
                    _IN_DUE[uid] = now + 60.0     # kapali: seyrek kontrol
                    continue
                _IN_DUE[uid] = now + secs
                try:
                    import trakt
                    res = trakt.poll_in(uid)
                    if res.get("ok") and res.get("in"):
                        _log(f"gelen izleme uid={uid}: {res.get('in')}")
                    # Mutabakat: her turda degil, en fazla RECONCILE_MIN dakikada bir.
                    trakt.reconcile_if_due(uid, minutes=RECONCILE_MIN)
                except Exception as e:
                    _log(f"poll_in hata uid={uid}: {e}")
            wake = min([_IN_DUE.get(u, now + IDLE_TICK) for u in _in_users()] + [now + IDLE_TICK])
            wait = max(0.3, wake - time.time())
        except Exception as e:
            _log(f"in dongu hata: {e}")
            wait = IDLE_TICK
        _IN_EVENT.wait(min(wait, IDLE_TICK))
        _IN_EVENT.clear()


# ---------------------------------------------------------------------------
# yasam dongusu / durum
# ---------------------------------------------------------------------------

def _recover():
    """Cokme sonrasi 'running' kalmis satirlari tekrar kuyruga al."""
    try:
        conn = get_db()
        try:
            conn.execute(
                "UPDATE sync_events SET state='pending', next_ts=? "
                "WHERE state='running' AND updated_ts < ?",
                (_now(), _now() - 300),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def start():
    """Worker'lari baslat (idempotent)."""
    global _STARTED
    with _LOCK:
        if _STARTED:
            return False
        _STOP.clear()
        _recover()
        threading.Thread(target=_loop_out, name="sync-pool-out", daemon=True).start()
        threading.Thread(target=_loop_in, name="sync-pool-in", daemon=True).start()
        _STARTED = True
    _log("havuz basladi (out + in)")
    return True


def stop():
    _STOP.set()
    _EVENT.set()
    _IN_EVENT.set()


def status(uid=None):
    """Kart/panel icin durum (fail-soft)."""
    out = {
        "pending": 0, "failed": 0, "lastTs": None, "lastKind": "",
        "lastError": "", "active": is_active(uid), "inInterval": 0,
    }
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT "
                "(SELECT COUNT(*) FROM sync_events WHERE state='pending') p, "
                "(SELECT COUNT(*) FROM sync_events WHERE state='failed') f, "
                "(SELECT MAX(updated_ts) FROM sync_events WHERE state='done') lt, "
                "(SELECT kind FROM sync_events WHERE state='done' ORDER BY updated_ts DESC LIMIT 1) lk"
            ).fetchone()
            if row:
                out["pending"] = int(row["p"] or 0)
                out["failed"] = int(row["f"] or 0)
                out["lastTs"] = int(row["lt"]) if row["lt"] else None
                out["lastKind"] = row["lk"] or ""
            err = conn.execute(
                "SELECT last_error FROM sync_events WHERE state IN ('failed','pending') "
                "AND IFNULL(last_error,'')<>'' ORDER BY updated_ts DESC LIMIT 1"
            ).fetchone()
            if err:
                out["lastError"] = err["last_error"] or ""
        finally:
            conn.close()
    except Exception:
        pass
    try:
        if uid is None:
            ids = _in_users()
            out["inInterval"] = interval_seconds(ids[0]) if ids else 0
        else:
            out["inInterval"] = interval_seconds(uid)
    except Exception:
        pass
    if not out["lastTs"] and _LAST.get("ts"):
        out["lastTs"] = int(_LAST["ts"])
        out["lastKind"] = _LAST.get("kind") or ""
    return out
