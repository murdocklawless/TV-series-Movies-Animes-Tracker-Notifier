"""Emby API senkronu (1.87) — webhook'suz izlenme durumu senkronu.

Bu kurulumda Emby'de webhook **Premiere** gerektirdigi icin kullanilamiyor
(Premiere yok). Bu yuzden izlenme durumu Emby API'sinden okunur:

  * POSTERDEN isaretleme (PlayCount=0 ve LastPlayedDate bos) -> **dogrudan yaz**
    (kullanici kendi onayladi; E-1 kilidi ihlalinde ask sorusu cikar)
  * ACILIP IZLENME   (PlayCount>=1 veya LastPlayedDate dolu) -> **ask akisi**
    ("... bolumunu izlediniz mi?")
  * Isaret kaldirma   (nextep'te source='emby' iken Emby artik izlenmemis)
    -> **korumali geri alma** (stremio.unwatch_from_source)

Tasiyicilar:
  * WebSocket (`/embywebsocket`, stdlib ile, yeni bagimlilik yok) -> aninda senkron
  * Yedek yoklama (15 dk, scheduler) -> kacan olaylari yakalar

Ayarlar (settings):
  emby_api_url       -> http://127.0.0.1:8097
  emby_api_key       -> encrypt_secret(...) kasasinda
  emby_user          -> Emby kullanici adi (bos: ilk kullanici)
  emby_user_id       -> cozulen kullanici id onbellegi
  emby_last_sync     -> epoch
  emby_last_result   -> "3 yeni · 1 ask · 1 geri" gibi ozet
  emby_last_detail   -> son hata/detay (teshis)
"""
import base64
import json
import os
import socket
import struct
import threading
import time

import requests

from db import get_setting, set_setting, get_db
from ramcache import bump

SOURCE = "emby"

# WS durumu (status icin)
_WS = {"connected": False, "last_msg": 0, "last_err": "", "thread": None}
_sync_lock = threading.Lock()
_last_sync = {"ts": 0.0}
_DEBOUNCE = 5.0          # WS mesajlari icin en az aralik
_WS_RECONNECT = 15.0
_USER_CACHE = {"id": None}


# ---------------------------------------------------------------------------
# ayar + API
# ---------------------------------------------------------------------------

def _cfg():
    """(url, key, user) — anahtar cozulur. Eksikse (None, None, None)."""
    url = (get_setting("emby_api_url") or "").strip().rstrip("/")
    enc = get_setting("emby_api_key") or ""
    user = (get_setting("emby_user") or "").strip()
    key = ""
    if enc:
        try:
            from crypto_util import decrypt_secret
            key = decrypt_secret(enc) or ""
        except Exception:
            key = ""
    if not url or not key:
        return None, None, None
    return url, key.strip(), user


def configured():
    url, key, _u = _cfg()
    return bool(url and key)


def _api(path, params=None, timeout=20):
    """Emby API GET -> (ok, json|None, err). Fail-soft."""
    url, key, _u = _cfg()
    if not url or not key:
        return False, None, "not-configured"
    try:
        r = requests.get(url + path, headers={"X-Emby-Token": key}, params=params or {}, timeout=timeout)
        if r.status_code != 200:
            return False, None, f"HTTP {r.status_code}"
        return True, r.json(), ""
    except Exception as e:
        return False, None, str(e)[:200]


def resolve_user_id(force=False):
    """Emby kullanici id'si (ayardaki ad, yoksa ilk kullanici). Fail-soft -> None."""
    if not force and _USER_CACHE["id"]:
        return _USER_CACHE["id"]
    if not force:
        cached = (get_setting("emby_user_id") or "").strip()
        if cached:
            _USER_CACHE["id"] = cached
            return cached
    ok, users, err = _api("/Users")
    if not ok or not isinstance(users, list) or not users:
        print(f"[emby] kullanici listesi alinamadi: {err}", flush=True)
        return None
    want = (_cfg()[2] or "").strip().lower()
    pick = None
    for u in users:
        if want and (u.get("Name") or "").strip().lower() == want:
            pick = u
            break
    if not pick:
        pick = users[0]
    uid = pick.get("Id")
    if uid:
        _USER_CACHE["id"] = uid
        try:
            set_setting("emby_user_id", uid)
        except Exception:
            pass
        print(f"[emby] kullanici: {pick.get('Name')} ({uid[:8]}...)", flush=True)
    return uid


def _nextep_owner(emby_user_name):
    """Emby kullanici adi nextep kullanicisiyla eslesirse onu, yoksa 1 (admin)."""
    try:
        name = (emby_user_name or "").strip().lower()
        if name:
            conn = get_db()
            try:
                row = conn.execute("SELECT id FROM users WHERE lower(username)=?", (name,)).fetchone()
            finally:
                conn.close()
            if row:
                return int(row["id"])
    except Exception:
        pass
    return 1


# ---------------------------------------------------------------------------
# Emby -> ortak oge sozlugu (webhook cozumleme zinciri yeniden kullanilir)
# ---------------------------------------------------------------------------

def _norm_title(s):
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def _to_item(it):
    """Emby BaseItemDto -> webhook normalizasyonunun bekledigi oge (kind/title/...)."""
    import routes.webhook as wh
    itype = str(it.get("Type") or "").strip().lower()
    name = it.get("Name") or ""
    ids = it.get("ProviderIds") or {}
    cands = wh._pairs(ids)
    if itype == "movie":
        tv = wh._tv_from_title(name, cands)
        if tv:
            return tv
        return {
            "kind": "movie",
            "title": name,
            "year": it.get("ProductionYear"),
            "candidates": cands,
            "season": None,
            "episode": None,
        }
    if itype in ("episode", "season", "series"):
        return {
            "kind": "tv",
            "title": it.get("SeriesName") or name,
            "year": None,
            "candidates": cands,
            "season": it.get("ParentIndexNumber"),
            "episode": it.get("IndexNumber"),
        }
    return None


def _resolve(item):
    """Oge -> tmdb id (None = cozulemedi)."""
    import routes.webhook as wh
    if item.get("kind") == "movie":
        return wh._int(wh._resolve_movie(item))
    return wh._int(wh._resolve_show(item))


# ---------------------------------------------------------------------------
# senkron
# ---------------------------------------------------------------------------

_PAGE = 200


def _fetch_played(user_id):
    """Emby'de izlenmis movie+episode listesi (sayfali). -> (items, err)"""
    items = []
    start = 0
    while True:
        params = {
            "Recursive": "true",
            "IncludeItemTypes": "Movie,Episode",
            "IsPlayed": "true",
            "Fields": "ProviderIds,SeriesName,IndexNumber,ParentIndexNumber,ProductionYear,Path,UserData",
            "EnableUserData": "true",
            "StartIndex": str(start),
            "Limit": str(_PAGE),
        }
        ok, data, err = _api("/Users/" + user_id + "/Items", params)
        if not ok or not isinstance(data, dict):
            return items, (err or "bos yanit")
        batch = data.get("Items") or []
        items.extend(batch)
        total = int(data.get("TotalRecordCount") or 0)
        start += len(batch)
        if not batch or start >= total or start > 20000:
            break
    return items, ""


def _nextep_watched(conn, uid, kind, tmdb_id, season=None, episode=None):
    """nextep'te bu oge izlenmis mi? (film: followed.watched, dizi: episodes.watched)"""
    try:
        if kind == "movie":
            row = conn.execute(
                "SELECT watched FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='movie'",
                (uid, tmdb_id),
            ).fetchone()
            return bool(row and int(row["watched"] or 0) == 1)
        f = conn.execute(
            "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'", (uid, tmdb_id)
        ).fetchone()
        if not f or season is None or episode is None:
            return False
        row = conn.execute(
            "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
            (f["id"], season, episode),
        ).fetchone()
        return bool(row and int(row["watched"] or 0) == 1)
    except Exception:
        return False


def _emby_sourced(conn, uid):
    """nextep'te source='emby' olarak izlenmis kayitlar -> [(kind, tmdb_id, season, episode, title)]"""
    out = []
    try:
        rows = conn.execute(
            "SELECT tmdb_id, title FROM followed WHERE user_id=? AND media_type='movie' "
            "AND watched=1 AND IFNULL(watched_source,'')=?", (uid, SOURCE),
        ).fetchall()
        for r in rows:
            out.append(("movie", int(r["tmdb_id"]), None, None, r["title"] or ""))
    except Exception:
        pass
    try:
        rows = conn.execute(
            "SELECT f.tmdb_id, f.title, e.season, e.episode FROM episodes e JOIN followed f ON f.id=e.follow_id "
            "WHERE f.user_id=? AND e.watched=1 AND IFNULL(e.source,'')=?", (uid, SOURCE),
        ).fetchall()
        for r in rows:
            out.append(("tv", int(r["tmdb_id"]), int(r["season"]), int(r["episode"]), r["title"] or ""))
    except Exception:
        pass
    return out


def sync_once(verbose=False):
    """Bir kez senkron. -> ozet dict (fail-soft, hic istisna atmaz)."""
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "error": "busy"}
    try:
        return _sync_inner(verbose=verbose)
    except Exception as e:
        print(f"[emby] senkron hata: {e}", flush=True)
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _sync_lock.release()


def _sync_inner(verbose=False):
    from routes.stremio import process_signal, unwatch_from_source

    if not configured():
        return {"ok": False, "error": "not-configured"}
    user_id = resolve_user_id()
    if not user_id:
        return {"ok": False, "error": "no-user"}
    ok, users, _e = _api("/Users")
    uname = ""
    if ok and isinstance(users, list):
        for u in users:
            if u.get("Id") == user_id:
                uname = u.get("Name") or ""
                break
    uid = _nextep_owner(uname)

    items, err = _fetch_played(user_id)
    if err:
        print(f"[emby] izlenmisler alinamadi: {err}", flush=True)
        return {"ok": False, "error": err}

    written = asked = skipped = unresolved = 0
    played_ids = set()
    played_named = set()

    for it in items:
        try:
            itype = str(it.get("Type") or "").strip().lower()
            ud = it.get("UserData") or {}
            pc = int(ud.get("PlayCount") or 0)
            lpd = ud.get("LastPlayedDate") or ""
            item = _to_item(it)
            if not item:
                continue
            tmdb = _resolve(item)
            s, e = item.get("season"), item.get("episode")
            if tmdb:
                played_ids.add((tmdb, s, e))
                if _norm_title(item.get("title")):
                    played_named.add((_norm_title(item.get("title")), s, e))
            if not tmdb:
                unresolved += 1
                continue
            conn = get_db()
            try:
                already = _nextep_watched(conn, uid, item.get("kind"), tmdb, s, e)
            finally:
                conn.close()
            if already:
                skipped += 1
                continue
            # manuel isaretleme mi, gercek oynatma mi? (kalibrasyon log'u ile dogrulanir)
            manual = (pc == 0 and not lpd)
            if verbose:
                print(f"[emby] kalibrasyon: type={itype} tmdb={tmdb} S{s}E{e} "
                      f"PlayCount={pc} LastPlayed={lpd or '-'} -> {'direct' if manual else 'ask'}",
                      flush=True)
            if item.get("kind") == "tv" and (s is None or e is None):
                unresolved += 1
                continue
            process_signal(
                {"route_norm": item.get("kind"), "provider": "tmdb", "ident": tmdb,
                 "season": s, "episode": e},
                owner_id=uid, source=SOURCE, direct=manual,
            )
            # 1.87: kartta "Son sinyal" + "xyz izlendi" (API ile senkronize edilen son izleme).
            _stamp_api_watch(uid, item, s, e)
            if manual:
                written += 1
            else:
                asked += 1
        except Exception as ex:
            print(f"[emby] oge isleme hata: {ex}", flush=True)

    # --- isaret kaldirma: nextep'te source='emby' ama Emby'de artik izlenmemis ---
    rolled = 0
    conn = get_db()
    try:
        src_rows = _emby_sourced(conn, uid)
    finally:
        conn.close()
    for kind, tmdb, s, e, title in src_rows:
        key = (tmdb, s, e)
        still = key in played_ids or (_norm_title(title), s, e) in played_named
        if still:
            continue
        res = unwatch_from_source(kind, tmdb, season=s, episode=e, owner_id=uid, source=SOURCE)
        print(f"[emby] geri alma: {res} kind={kind} tmdb={tmdb} s{s} e{e}", flush=True)
        if res == "ok":
            rolled += 1

    summary = f"{written} yeni · {asked} ask · {rolled} geri · {skipped} zaten"
    if unresolved:
        summary += f" · {unresolved} cozulemedi"
    try:
        set_setting("emby_last_sync", str(int(time.time())))
        set_setting("emby_last_result", summary)
        set_setting("emby_last_detail", (f"ws={'on' if _WS['connected'] else 'off'} · {len(items)} izlenmis"))
        # 1.87: yapisal istatistik (web arayuzu yerellestirilmis metni bundan kurar)
        set_setting("emby_last_stats", json.dumps({
            "scan": len(items), "written": written, "asked": asked,
            "rolled": rolled, "skipped": skipped, "unresolved": unresolved,
        }))
    except Exception:
        pass
    bump()
    print(f"[emby] senkron: {summary}", flush=True)
    return {"ok": True, "summary": summary, "written": written, "asked": asked,
            "rolled": rolled, "skipped": skipped, "unresolved": unresolved,
            "scanned": len(items)}


def sync_async():
    """Arka planda senkron (acilista / WS olayinda)."""
    def _run():
        try:
            sync_once()
        except Exception as e:
            print(f"[emby] async senkron hata: {e}", flush=True)
    t = threading.Thread(target=_run, name="emby-sync", daemon=True)
    t.start()
    return t


def sync_from_ws(force=False):
    """WS olayi -> debounce'lu senkron."""
    now = time.time()
    if not force and (now - _last_sync["ts"]) < _DEBOUNCE:
        return
    _last_sync["ts"] = now
    sync_async()


# ---------------------------------------------------------------------------
# WebSocket dinleyici (stdlib — yeni bagimlilik yok)
# ---------------------------------------------------------------------------

def _ws_frame_len(data):
    ln = data[1] & 0x7F
    if ln == 126:
        return struct.unpack(">H", data[2:4])[0], 4
    if ln == 127:
        return struct.unpack(">Q", data[2:10])[0], 10
    return ln, 2


def _ws_connect(url_base, key):
    """WebSocket handshake -> socket (None = basarisiz)."""
    u = url_base.replace("https://", "").replace("http://", "")
    hostport = u.split("/")[0]
    host = hostport.split(":")[0]
    port = int(hostport.split(":")[1]) if ":" in hostport else 80
    path = "/embywebsocket?api_key=" + key + "&deviceId=nextep"
    s = socket.create_connection((host, port), timeout=15)
    sk = base64.b64encode(os.urandom(16)).decode()
    req = ("GET " + path + " HTTP/1.1\r\nHost: " + hostport + "\r\n"
           "Upgrade: websocket\r\nConnection: Upgrade\r\n"
           "Sec-WebSocket-Key: " + sk + "\r\nSec-WebSocket-Version: 13\r\n"
           "User-Agent: nextep\r\n\r\n")
    s.sendall(req.encode())
    buf = b""
    s.settimeout(10)
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            s.close()
            return None
        buf += chunk
    head = buf.split(b"\r\n\r\n", 1)[0].decode("latin-1", "replace")
    if "101" not in head:
        s.close()
        return None
    return s


def _ws_mask_send(s, payload, opcode=0x9):
    """Maskeleme zorunlu (istemci->sunucu). Kucuk cerceve yeter (ping)."""
    data = payload.encode("utf-8")
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    ln = len(data)
    if ln < 126:
        header = struct.pack("!BB", 0x80 | opcode, 0x80 | ln)
    else:
        header = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, ln)
    try:
        s.sendall(header + mask + masked)
    except Exception:
        pass


def _ws_listen_loop():
    """Kopunca yeniden baglanir; UserDataChanged mesajinda senkron tetikler."""
    while True:
        url, key, _u = _cfg()
        if not url or not key:
            time.sleep(30)
            continue
        s = None
        try:
            s = _ws_connect(url, key)
            if not s:
                _WS["connected"] = False
                _WS["last_err"] = "handshake"
                time.sleep(_WS_RECONNECT)
                continue
            _WS["connected"] = True
            _WS["last_err"] = ""
            print("[emby] WebSocket baglandi (UserDataChanged bekleniyor)", flush=True)
            s.settimeout(30)
            buf = b""
            last_ping = time.time()
            while True:
                if time.time() - last_ping > 25:
                    _ws_mask_send(s, "nextep-ping")
                    last_ping = time.time()
                try:
                    chunk = s.recv(65536)
                except socket.timeout:
                    continue
                if not chunk:
                    raise ConnectionError("closed")
                buf += chunk
                while len(buf) >= 2:
                    ln, off = _ws_frame_len(buf)
                    if len(buf) < off + ln:
                        break
                    opcode = buf[0] & 0x0F
                    payload = buf[off:off + ln]
                    buf = buf[off + ln:]
                    if opcode == 1:
                        try:
                            txt = payload.decode("utf-8", "replace")
                        except Exception:
                            txt = ""
                        _WS["last_msg"] = int(time.time())
                        if "UserDataChanged" in txt or '"PlaybackStop"' in txt:
                            print(f"[emby] ws olay: {txt[:160]}", flush=True)
                            sync_from_ws()
                    elif opcode == 8:
                        raise ConnectionError("close-frame")
        except Exception as e:
            _WS["connected"] = False
            _WS["last_err"] = str(e)[:120]
            try:
                if s:
                    s.close()
            except Exception:
                pass
            time.sleep(_WS_RECONNECT)


def start_listener():
    """WS dinleyicisini baslat (ayar varsa). Idempotent."""
    if not configured():
        return False
    t = _WS.get("thread")
    if t and t.is_alive():
        return True
    th = threading.Thread(target=_ws_listen_loop, name="emby-ws", daemon=True)
    th.start()
    _WS["thread"] = th
    return True


# ---------------------------------------------------------------------------
# durum (kart icin)
# ---------------------------------------------------------------------------

def _host_via(url):
    """Adres LAN/yerel ag mi? -> "lan" | "url" | "" (1.87)

    Emby API karti durumunda "Bagli (LAN)" / "Bagli (URL)" gostermek icin.
    (webhook.py'deki request_via() ile ayni ozel-IP mantigi; burada kayitli URL icin.)
    """
    try:
        h = (url or "").split("://")[-1].split("/")[0].split(":")[0].strip().lower().strip("[]")
    except Exception:
        h = ""
    if not h:
        return ""
    if h in ("localhost", "127.0.0.1", "::1") or h.endswith(".local"):
        return "lan"
    try:
        if h.startswith(("10.", "192.168.", "169.254.")):
            return "lan"
        if h.startswith("172.") and 16 <= int(h.split(".")[1]) <= 31:
            return "lan"
    except Exception:
        pass
    return "url"


def _stamp_api_watch(uid, item, season=None, episode=None):
    """API ile senkronize edilen son izleme (kart "Son sinyal" + "xyz izlendi"). 1.87."""
    try:
        set_setting("emby_api_last_watch", json.dumps({
            "ts": int(time.time()),
            "title": str(item.get("title") or "").strip(),
            "kind": item.get("kind") or "",
            "season": season,
            "episode": episode,
        }, ensure_ascii=False))
    except Exception:
        pass


def api_status():
    """Kart icin API modu durumu (fail-soft)."""
    url, key, user = _cfg()
    try:
        last = int(float(get_setting("emby_last_sync") or 0))
    except Exception:
        last = 0
    try:
        stats = json.loads(get_setting("emby_last_stats") or "{}")
        if not isinstance(stats, dict):
            stats = {}
    except Exception:
        stats = {}
    # 1.87: API bolumunde "Son sinyal" + "xyz izlendi" (gercek izleme zamani, tarama degil).
    try:
        _lw = json.loads(get_setting("emby_api_last_watch") or "{}")
        if not isinstance(_lw, dict):
            _lw = {}
    except Exception:
        _lw = {}
    try:
        _lw_ts = int(float(_lw.get("ts"))) if _lw.get("ts") else None
    except Exception:
        _lw_ts = None
    scan = stats.get("scan")
    return {
        "apiConfigured": bool(url and key),
        "apiUrl": url or "",
        "apiUser": user or "",
        "apiHasKey": bool(key),
        "apiVia": _host_via(url),
        "apiLastSignal": _lw_ts,
        "apiLastWatch": {
            "kind": _lw.get("kind") or "",
            "title": _lw.get("title") or "",
            "season": _lw.get("season"),
            "episode": _lw.get("episode"),
        } if _lw.get("title") else None,
        "apiWsConnected": bool(_WS.get("connected")),
        "apiTransport": "ws" if _WS.get("connected") else ("ws-wait" if configured() else "off"),
        "lastSync": last or None,
        "lastResult": (get_setting("emby_last_result") or "") or None,
        "lastDetail": (get_setting("emby_last_detail") or "") or None,
        # 1.87: yerellestirilmis gosterim icin yapisal alanlar
        "apiScanCount": scan if isinstance(scan, int) else None,
        "apiStats": stats or None,
    }


def clear_config():
    """API ayarini temizle (kart 'Baglantiyi kes')."""
    for k in ("emby_api_url", "emby_api_key", "emby_user", "emby_user_id",
              "emby_last_sync", "emby_last_result", "emby_last_detail", "emby_last_stats",
              "emby_api_last_watch"):
        try:
            set_setting(k, "")
        except Exception:
            pass
    _USER_CACHE["id"] = None
    _WS["connected"] = False


def save_config(url, key, user):
    """Ayarlari kaydet (key bos ise mevcut korunur). -> (ok, err)"""
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "http://" + url
    try:
        if url:
            set_setting("emby_api_url", url)
        if key:
            from crypto_util import encrypt_secret
            set_setting("emby_api_key", encrypt_secret(key.strip()))
        if user is not None:
            set_setting("emby_user", (user or "").strip())
        _USER_CACHE["id"] = None
        try:
            set_setting("emby_user_id", "")
        except Exception:
            pass
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


def test_connection():
    """/System/Info ile baglanti testi -> (ok, info|err)"""
    ok, info, err = _api("/System/Info")
    if not ok:
        return False, err
    uid = resolve_user_id(force=True)
    return True, {
        "serverName": (info or {}).get("ServerName"),
        "version": (info or {}).get("Version"),
        "userId": uid,
        "userName": _cfg()[2],
    }
