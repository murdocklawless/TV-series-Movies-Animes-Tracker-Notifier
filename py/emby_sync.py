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

1.94 — Access Token modu:
  * Kullanici web arayuzunde Emby kullanici adi + parolasini girer.
  * Parola alanindan cikinca `/Users/AuthenticateByName` ile access token alinir.
  * Token + parola `encrypt_secret(...)` kasasinda saklanir (parola yalnizca
    otomatik yenileme icin).
  * WebSocket bu token ile acilir; oturum kullaniciya baglanir ve
    `UserDataChanged` aninda gelir.
  * Token 5 dk'da bir `/Users/{id}` ile kontrol edilir; 401/403'te
    kullanici adi + parola ile otomatik yenilenir.
  * API Key 15 dk yedek yoklama icin korunur.

Ayarlar (settings):
  emby_api_url           -> http://127.0.0.1:8097
  emby_api_key           -> encrypt_secret(...) kasasinda
  emby_user              -> Emby kullanici adi (bos: ilk kullanici)
  emby_user_id           -> cozulen kullanici id onbellegi
  emby_last_sync         -> epoch
  emby_last_result       -> "3 yeni · 1 ask · 1 geri" gibi ozet
  emby_last_detail       -> son hata/detay (teshis)
  emby_access_token      -> encrypt_secret(...) (WS icin kullanici token'i)
  emby_auth_user         -> token/parola girilen Emby kullanici adi
  emby_auth_password     -> encrypt_secret(...) (otomatik yenileme icin)
  emby_token_user_id     -> token'in Emby kullanici id'si
  emby_token_user        -> token'in Emby kullanici adi
  emby_token_created     -> ilk token alma epoch
  emby_token_last_ok     -> son basarili kontrol epoch
  emby_token_last_check  -> son kontrol epoch
  emby_token_last_renew  -> son otomatik yenileme epoch
  emby_token_error       -> "" | auth | unreachable | credentials-missing
  emby_token_fail_count  -> ardisik basarisiz login sayisi
  emby_token_next_try    -> backoff sonrasi sonraki deneme epoch
  emby_ws_last_event     -> son WS olayi epoch
  emby_ws_last_watch     -> son WS kaynakli izleme JSON
"""
import base64
import json
import os
import socket
import struct
import threading
import time
from urllib.parse import quote

import requests

from db import get_setting, set_setting, get_db
from ramcache import bump

SOURCE = "emby"

# WS durumu (status icin)
_WS = {"connected": False, "last_msg": 0, "last_err": "", "thread": None,
       "sock": None, "reload": 0, "auth": ""}
_sync_lock = threading.Lock()
_TOKEN_LOCK = threading.Lock()
_last_sync = {"ts": 0.0}
_DEBOUNCE = 5.0          # WS mesajlari icin en az aralik
_WS_RECONNECT = 15.0
_USER_CACHE = {"id": None}
_AUTH_HEADER = ('MediaBrowser Client="NextEp", Device="NextEp", '
                'DeviceId="nextep", Version="1.0"')


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


# ---------------------------------------------------------------------------
# 1.94 — Access Token yardimcilari
# ---------------------------------------------------------------------------

def _norm_url(url):
    """Sema ekle + sonda / temizle (save_config ile ayni kural)."""
    v = (url or "").strip().rstrip("/")
    if v and not v.startswith(("http://", "https://")):
        v = "http://" + v
    return v


def _setting_decrypt(name):
    """encrypt_secret ile saklanan ayari coz. -> "" (yok/bozuk)."""
    enc = get_setting(name) or ""
    if not enc:
        return ""
    try:
        from crypto_util import decrypt_secret
        return decrypt_secret(enc) or ""
    except Exception:
        return ""


def _setting_encrypt(name, plain):
    """Degeri encrypt_secret ile sakla. Bos deger yazmaz.

    Parola bas/son bosluk icerebilir; bu yuzden strip YAPILMAZ. Token
    cagiranlar zaten strip ederek verir.
    """
    val = plain if isinstance(plain, str) else (plain or "")
    if not val:
        return False
    try:
        from crypto_util import encrypt_secret
        enc = encrypt_secret(val)
        if not enc:
            return False
        set_setting(name, enc)
        return True
    except Exception:
        return False


def access_token():
    """Kullanicinin access token'i (cozulmus). Yoksa ""."""
    return (_setting_decrypt("emby_access_token") or "").strip()


def auth_user():
    """Token/parola girilen Emby kullanici adi."""
    return ((get_setting("emby_auth_user") or "").strip()
            or (get_setting("emby_user") or "").strip())


def auth_password():
    """Otomatik yenileme icin saklanan Emby parolasi (cozulmus)."""
    return (_setting_decrypt("emby_auth_password") or "")


def _ws_cfg():
    """(url, ws_key, user) — token varsa token, yoksa API key."""
    url = (get_setting("emby_api_url") or "").strip().rstrip("/")
    if not url:
        return None, None, None
    tok = access_token()
    if tok:
        return url, tok, (auth_user() or "")
    _url, key, user = _cfg()
    return _url or url, key, user


def _token_user(token, user_id="", username="", timeout=15):
    """Token gecerliligi + kullanici bilgisi. -> (info|None, err).

    Emby'de `/Users/Me` guvenilir calismadigi icin once `/Users/{id}`
    denenir; id yoksa API key ile cozulur. API key yoksa `/System/Info`
    ile yalnizca token gecerliligi kontrol edilir.
    """
    url = (get_setting("emby_api_url") or "").strip().rstrip("/")
    tok = (token or "").strip()
    if not url or not tok:
        return None, "not-configured"
    uid = (user_id or "").strip()
    if not uid:
        try:
            uid = resolve_user_id(force=True) or ""
        except Exception:
            uid = ""
    if uid:
        try:
            r = requests.get(url + "/Users/" + uid,
                             headers={"X-Emby-Token": tok}, timeout=timeout)
        except Exception as e:
            return None, "unreachable:" + str(e)[:120]
        if r.status_code == 200:
            try:
                data = r.json()
            except Exception:
                data = {}
            name = (data.get("Name") or username or "").strip()
            if username and name and name.lower() != username.strip().lower():
                return None, "user-mismatch"
            return {"id": data.get("Id") or uid, "name": name}, ""
        if r.status_code in (401, 403):
            return None, "auth"
        return None, f"HTTP {r.status_code}"
    # id yok: yalnizca gecerlilik
    try:
        r = requests.get(url + "/System/Info",
                         headers={"X-Emby-Token": tok}, timeout=timeout)
    except Exception as e:
        return None, "unreachable:" + str(e)[:120]
    if r.status_code == 200:
        return {"id": "", "name": (username or "").strip()}, ""
    if r.status_code in (401, 403):
        return None, "auth"
    return None, f"HTTP {r.status_code}"


def login_access_token(url, username, password):
    """Emby kullanici adi + parola -> access token.

    -> (ok, {"token","user","user_id"} | hata_kodu)
    """
    url = _norm_url(url)
    user = (username or "").strip()
    pw = password or ""
    if not url or not user or not pw:
        return False, "eksik"
    try:
        r = requests.post(
            url + "/Users/AuthenticateByName",
            headers={"X-Emby-Authorization": _AUTH_HEADER,
                     "Content-Type": "application/json"},
            json={"Username": user, "Pw": pw},
            timeout=20,
        )
    except Exception as e:
        return False, "unreachable:" + str(e)[:120]
    if r.status_code in (401, 403):
        return False, "auth"
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}"
    try:
        data = r.json()
    except Exception:
        data = {}
    tok = (data.get("AccessToken") or "").strip()
    if not tok:
        return False, "token-yok"
    u = data.get("User") or {}
    return True, {
        "token": tok,
        "user": (u.get("Name") or user).strip(),
        "user_id": (u.get("Id") or "").strip(),
    }


def save_access_token(token, username="", user_id="", password=None,
                      renew=False):
    """Access token'i (ve verilen parolayi) sifreli sakla.

    password=None  -> mevcut parola korunur (yenileme)
    password=""    -> parola silinir
    renew=True     -> emby_token_last_renew guncellenir
    """
    tok = (token or "").strip()
    if not tok:
        return False, "token-yok"
    now = int(time.time())
    try:
        if not _setting_encrypt("emby_access_token", tok):
            return False, "sifreleme"
        if password is not None:
            if password:
                if not _setting_encrypt("emby_auth_password", password):
                    return False, "sifreleme"
            else:
                set_setting("emby_auth_password", "")
        name = (username or "").strip()
        if name:
            set_setting("emby_auth_user", name)
            # API yoklamasi ile ayni kullaniciya bakilsin
            set_setting("emby_user", name)
        if (user_id or "").strip():
            set_setting("emby_token_user_id", (user_id or "").strip())
        if name:
            set_setting("emby_token_user", name)
        if not (get_setting("emby_token_created") or "").strip():
            set_setting("emby_token_created", str(now))
        set_setting("emby_token_last_ok", str(now))
        set_setting("emby_token_last_check", str(now))
        set_setting("emby_token_error", "")
        set_setting("emby_token_fail_count", "0")
        set_setting("emby_token_next_try", "0")
        if renew:
            set_setting("emby_token_last_renew", str(now))
        # API tarafi yeni kullaniciya gecsin
        _USER_CACHE["id"] = None
        try:
            set_setting("emby_user_id", "")
        except Exception:
            pass
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


def _user_id_by_name(name):
    """API key ile /Users listesinden ada gore id bul. -> id|None."""
    want = (name or "").strip().lower()
    if not want:
        return None
    ok, users, _err = _api("/Users")
    if not ok or not isinstance(users, list):
        return None
    for u in users:
        if (u.get("Name") or "").strip().lower() == want:
            return (u.get("Id") or "").strip() or None
    return None


def validate_access_token(token, username=""):
    """Elle yapistirilan token'i dogrula. -> (ok, info|err)."""
    tok = (token or "").strip()
    if not tok:
        return False, "token-yok"
    # Yeni token baska bir kullaniciya ait olabilir; eski token id'sini
    # koru etmek yerine kullanici adi verildiyse onu API key ile coz.
    uid = _user_id_by_name(username) if username else ""
    if not uid:
        uid = (get_setting("emby_token_user_id") or "").strip()
    info, err = _token_user(tok, user_id=uid, username=username or auth_user())
    if not info:
        return False, err
    return True, info


def save_manual_token(token, username=""):
    """Elle yapistirilan token: dogrula + kaydet. -> (ok, info|err)."""
    ok, info = validate_access_token(token, username=username)
    if not ok:
        return False, info
    ok2, err2 = save_access_token(token, info.get("name") or username,
                                  info.get("id") or "")
    if not ok2:
        return False, err2
    return True, info


def clear_token_config():
    """Access token + parola + token durumunu temizle."""
    for k in ("emby_access_token", "emby_auth_password", "emby_auth_user",
              "emby_token_user_id", "emby_token_user", "emby_token_created",
              "emby_token_last_ok", "emby_token_last_check",
              "emby_token_last_renew", "emby_token_error",
              "emby_token_fail_count", "emby_token_next_try",
              "emby_ws_last_event", "emby_ws_last_watch"):
        try:
            set_setting(k, "")
        except Exception:
            pass
    _WS["connected"] = False
    _WS["auth"] = ""


def ensure_token(force=False):
    """Token gecerliligini kontrol et; gerekirse otomatik yenile.

    -> dict {"ok":bool, "valid":bool, "renewed":bool, "error":str, ...}
    """
    if not _TOKEN_LOCK.acquire(blocking=False):
        return {"ok": False, "error": "busy"}
    try:
        now = int(time.time())
        url = (get_setting("emby_api_url") or "").strip().rstrip("/")
        if not url:
            return {"ok": False, "error": "not-configured"}
        token = access_token()
        user = auth_user()
        pw = auth_password()
        # Hic token/parola yoksa gereksiz "credentials-missing" durumu yazma;
        # 5 dakikalik job da her seferinde log basmasin.
        if not token and not pw:
            set_setting("emby_token_error", "")
            return {"ok": True, "valid": False, "skipped": True}
        try:
            next_try = int(float(get_setting("emby_token_next_try") or 0))
        except Exception:
            next_try = 0
        if not force and next_try and now < next_try:
            return {"ok": False, "error": "backoff", "retry_in": next_try - now}
        # 1) Mevcut token gecerli mi?
        if token:
            info, err = _token_user(
                token, user_id=(get_setting("emby_token_user_id") or ""),
                username=user)
            if info:
                set_setting("emby_token_last_ok", str(now))
                set_setting("emby_token_last_check", str(now))
                set_setting("emby_token_error", "")
                set_setting("emby_token_fail_count", "0")
                set_setting("emby_token_next_try", "0")
                if info.get("id"):
                    set_setting("emby_token_user_id", info.get("id") or "")
                return {"ok": True, "valid": True, "renewed": False,
                        "user": info}
            if err not in ("auth", "user-mismatch"):
                # ag/sunucu hatasi: token'i silme
                set_setting("emby_token_last_check", str(now))
                set_setting("emby_token_error",
                            "unreachable" if str(err).startswith("unreachable")
                            else str(err))
                return {"ok": False, "error": "unreachable", "detail": err}
            # auth / kullanici uyusmazligi -> asagida yenile
        # 2) Kullanici adi + parola ile yenile
        if not user or not pw:
            set_setting("emby_token_last_check", str(now))
            set_setting("emby_token_error", "credentials-missing")
            return {"ok": False, "error": "credentials-missing"}
        ok, data = login_access_token(url, user, pw)
        if not ok:
            fail = 0
            try:
                fail = int(float(get_setting("emby_token_fail_count") or 0))
            except Exception:
                fail = 0
            fail += 1
            delay = min(3600, 30 * (2 ** min(fail - 1, 7)))
            set_setting("emby_token_fail_count", str(fail))
            set_setting("emby_token_next_try", str(now + delay))
            set_setting("emby_token_last_check", str(now))
            set_setting("emby_token_error",
                        "auth" if data == "auth" else str(data))
            return {"ok": False, "error": data, "retry_in": delay}
        save_access_token(data.get("token"), data.get("user") or user,
                          data.get("user_id") or "", password=None,
                          renew=True)
        set_setting("emby_token_last_check", str(now))
        restart_listener()
        return {"ok": True, "valid": True, "renewed": True,
                "user": {"id": data.get("user_id") or "", "name": data.get("user") or user}}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _TOKEN_LOCK.release()


def _api(path, params=None, timeout=20):
    """Emby API GET -> (ok, json|None, err). Fail-soft."""
    url, key, _u = _cfg()
    if not url or not key:
        return False, None, "not-configured"
    try:
        t0 = time.time()
        r = requests.get(url + path, headers={"X-Emby-Token": key}, params=params or {}, timeout=timeout)
        try:
            import query_log
            query_log.log("emby", "GET", path, status=r.status_code,
                          ms=int((time.time() - t0) * 1000), src="net",
                          tag="emby", params=params, level="debug")
        except Exception:
            pass
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


def _user_name(user_id):
    """Emby kullanici adi (nextep sahibi eslesmesi icin). Fail-soft."""
    try:
        ok, users, _e = _api("/Users")
        if ok and isinstance(users, list):
            for u in users:
                if u.get("Id") == user_id:
                    return u.get("Name") or ""
    except Exception:
        pass
    return ""


def _item_by_id(user_id, item_id):
    """Tek ogeyi Emby'den oku (WS hizli yolu). -> (item|None, err)"""
    ok, data, err = _api(
        f"/Users/{user_id}/Items/{item_id}",
        {"Fields": "ProviderIds,SeriesName,IndexNumber,ParentIndexNumber,"
                   "ProductionYear,Path,UserData"},
    )
    if not ok or not isinstance(data, dict):
        return None, err or "bos yanit"
    return data, ""


def _apply_item(it, uid, trigger="ws"):
    """Tek Emby ogesini NextEp'e isle (2.19.6 oge bazli hizli yol).

    `Played` alanina gore izleme yazar **veya** yalniz kaynagi emby olan kaydi
    geri alir. -> "written"|"asked"|"skipped"|"unresolved"|"rolled"|"none"
    """
    from routes.stremio import process_signal, unwatch_from_source

    item = _to_item(it)
    if not item:
        return "none"
    tmdb = _resolve(item)
    s, e = item.get("season"), item.get("episode")
    kind = item.get("kind")
    if not tmdb:
        return "unresolved"
    if kind == "tv" and (s is None or e is None):
        return "unresolved"

    ud = it.get("UserData") or {}
    played = bool(ud.get("Played"))
    pc = int(ud.get("PlayCount") or 0)
    lpd = ud.get("LastPlayedDate") or ""

    conn = get_db()
    try:
        already = _nextep_watched(conn, uid, kind, tmdb, s, e)
        src = ""
        if kind == "movie":
            r = conn.execute(
                "SELECT watched_source AS s FROM followed "
                "WHERE user_id=? AND tmdb_id=? AND media_type='movie'", (uid, tmdb)
            ).fetchone()
            src = (r["s"] or "") if r else ""
        else:
            f = conn.execute(
                "SELECT id, watched_source AS s FROM followed "
                "WHERE user_id=? AND tmdb_id=? AND media_type='tv'", (uid, tmdb)
            ).fetchone()
            if f:
                r = conn.execute(
                    "SELECT source FROM episodes WHERE follow_id=? AND season=? AND episode=?",
                    (f["id"], s, e),
                ).fetchone()
                src = (r["source"] if r and r["source"] else f["s"]) or ""
    finally:
        conn.close()

    if not played:
        # Emby'de artik izlenmemis: yalniz kaynagi emby olan kayit geri alinir.
        if not already or str(src).lower() != SOURCE:
            return "skipped"
        res = unwatch_from_source(kind, tmdb, season=s, episode=e,
                                  owner_id=uid, source=SOURCE)
        return "rolled" if res == "ok" else "skipped"

    if already:
        return "skipped"
    # manuel isaretleme mi, gercek oynatma mi?
    manual = (pc == 0 and not lpd)
    process_signal(
        {"route_norm": kind, "provider": "tmdb", "ident": tmdb,
         "season": s, "episode": e},
        owner_id=uid, source=SOURCE, direct=manual,
    )
    _stamp_api_watch(uid, item, s, e, trigger=trigger)
    return "written" if manual else "asked"


def sync_items(ids, trigger="ws"):
    """Oge bazli hizli yol (2.19.6). -> (ok, ozet).

    WS `UserDataChanged` mesajindaki oge id'leri dogrudan islenir: 200'luk tam
    tarama beklemeden izleme saniyeler icinde yazilir. Tam tarama yedek olarak
    kalir (debounce'lu) ve periyodik calisir.
    """
    if not configured():
        return True, "not-configured"
    ids = [str(i) for i in (ids or []) if i][:200]
    if not ids:
        return True, "empty"
    if not _sync_lock.acquire(blocking=False):
        return True, "busy"          # tam tarama calisiyor; o da bunu kapsar
    try:
        user_id = resolve_user_id()
        if not user_id:
            return True, "no-user"
        uid = _nextep_owner(_user_name(user_id))
        counts = {}
        for item_id in ids:
            data, _err = _item_by_id(user_id, item_id)
            if not data:
                continue
            st = _apply_item(data, uid, trigger=trigger)
            counts[st] = counts.get(st, 0) + 1
        if counts:
            try:
                set_setting("emby_last_sync", str(int(time.time())))
                set_setting(
                    "emby_last_detail",
                    f"ws-item · {len(ids)} olay · " +
                    ", ".join(f"{k}={v}" for k, v in sorted(counts.items())),
                )
                set_setting("emby_last_stats", json.dumps({
                    "scan": len(ids),
                    "written": counts.get("written", 0),
                    "asked": counts.get("asked", 0),
                    "rolled": counts.get("rolled", 0),
                    "skipped": counts.get("skipped", 0),
                    "unresolved": counts.get("unresolved", 0),
                }))
            except Exception:
                pass
            bump()
        return True, "ok:" + ",".join(f"{k}={v}" for k, v in sorted(counts.items()))
    except Exception as e:
        return False, str(e)[:160]
    finally:
        _sync_lock.release()


def sync_once(verbose=False, trigger="poll"):
    """Bir kez senkron. -> ozet dict (fail-soft, hic istisna atmaz).

    trigger="ws" ise izleme damgasi Access Token bolumunun "Son sinyal"
    alanina da yazilir.
    """
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "error": "busy"}
    try:
        return _sync_inner(verbose=verbose, trigger=trigger)
    except Exception as e:
        print(f"[emby] senkron hata: {e}", flush=True)
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _sync_lock.release()


def _sync_inner(verbose=False, trigger="poll"):
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
            _stamp_api_watch(uid, item, s, e, trigger=trigger)
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


def sync_async(trigger="poll"):
    """Arka planda senkron (acilista / WS olayinda)."""
    def _run():
        try:
            sync_once(trigger=trigger)
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
    try:
        set_setting("emby_ws_last_event", str(int(now)))
    except Exception:
        pass
    sync_async(trigger="ws")


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
    """WebSocket handshake -> (socket|None, err).

    err: "" | "auth" (401/403) | "handshake" | ag hatasi.
    """
    u = url_base.replace("https://", "").replace("http://", "")
    hostport = u.split("/")[0]
    host = hostport.split(":")[0]
    port = int(hostport.split(":")[1]) if ":" in hostport else 80
    path = "/embywebsocket?api_key=" + quote(key or "", safe="") + "&deviceId=nextep"
    try:
        s = socket.create_connection((host, port), timeout=15)
    except Exception as e:
        return None, str(e)[:120]
    try:
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
                return None, "handshake"
            buf += chunk
        head = buf.split(b"\r\n\r\n", 1)[0].decode("latin-1", "replace")
        if " 401 " in head or " 403 " in head:
            s.close()
            return None, "auth"
        if "101" not in head:
            s.close()
            return None, "handshake"
        return s, ""
    except Exception as e:
        try:
            s.close()
        except Exception:
            pass
        return None, str(e)[:120]


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


def _ws_item_ids(txt):
    """WS mesajindan oge id'lerini cikar (UserDataChanged / PlaybackStop)."""
    try:
        msg = json.loads(txt)
    except Exception:
        return []
    if not isinstance(msg, dict):
        return []
    out = []
    data = msg.get("Data")
    if isinstance(data, dict):
        iid = data.get("ItemId")
        if iid:
            out.append(str(iid))
        for key in ("UserDataList", "Items"):
            lst = data.get(key)
            if isinstance(lst, list):
                for it in lst:
                    if isinstance(it, dict):
                        iid = it.get("ItemId") or it.get("Id")
                        if iid:
                            out.append(str(iid))
    iid = msg.get("ItemId")
    if iid:
        out.append(str(iid))
    return list(dict.fromkeys(out))


_WS_BATCH = {"lock": threading.Lock(), "ids": set(), "waiting": False}


def _ws_collect(ids):
    """Oge id'lerini 2 sn toplayip tek seferde kuyruga yaz (olaylar birlesir)."""
    if not ids:
        return
    with _WS_BATCH["lock"]:
        _WS_BATCH["ids"].update(ids)
        if _WS_BATCH["waiting"]:
            return
        _WS_BATCH["waiting"] = True
    threading.Thread(target=_ws_flush_ids, name="emby-ws-items", daemon=True).start()


def _ws_flush_ids():
    """2 sn'lik pencere doldu -> oge id'lerini havuz kuyruguna yaz.

    Havuz (sync_pool) uzerinden gitmek retry/backoff kazandirir; kuyruk kalici
    oldugu icin restart'ta bekleyen oge isleri kaybolmaz. Havuz yoksa dogrudan
    islenir (fail-soft).
    """
    try:
        time.sleep(2.0)
    finally:
        with _WS_BATCH["lock"]:
            ids = list(_WS_BATCH["ids"])
            _WS_BATCH["ids"].clear()
            _WS_BATCH["waiting"] = False
    if not ids:
        return
    try:
        import sync_pool
        if sync_pool.put_emby_ws(ids):
            return
    except Exception as e:
        print(f"[emby] ws oge kuyrugu hata: {e}", flush=True)
    sync_items(ids, trigger="ws")


def _ws_listen_loop():
    """Kopunca yeniden baglanir; UserDataChanged mesajinda senkron tetikler."""
    while True:
        reload_mark = _WS.get("reload", 0)
        url, key, _u = _ws_cfg()
        if not url or not key:
            _WS["connected"] = False
            _WS["auth"] = ""
            # reload istegi gelirse 30 sn beklemeden cik
            for _ in range(30):
                if _WS.get("reload", 0) != reload_mark:
                    break
                time.sleep(1)
            continue
        s = None
        try:
            s, werr = _ws_connect(url, key)
            if not s:
                _WS["connected"] = False
                _WS["last_err"] = werr or "handshake"
                # 1.94: token varsa ve 401/403 ise aninda yenile
                if werr == "auth" and access_token():
                    print("[emby] WS token gecersiz -> yenileniyor", flush=True)
                    ensure_token(force=True)
                # reload istegi varsa beklemeden yeniden baglan
                if _WS.get("reload", 0) != reload_mark:
                    continue
                time.sleep(_WS_RECONNECT)
                continue
            _WS["sock"] = s
            _WS["connected"] = True
            _WS["last_err"] = ""
            _WS["auth"] = "token" if access_token() else "api_key"
            print("[emby] WebSocket baglandi (UserDataChanged bekleniyor; "
                  + _WS["auth"] + ")", flush=True)
            # 1.94: kisa timeout -> reload/close istegi en gec 5 sn icinde fark edilir.
            s.settimeout(5)
            buf = b""
            last_ping = time.time()
            while True:
                if _WS.get("reload", 0) != reload_mark:
                    raise ConnectionError("reload")
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
                            ids = _ws_item_ids(txt)
                            if ids:
                                print(f"[emby] ws olay (oge): {len(ids)} adet", flush=True)
                                _ws_collect(ids)
                            else:
                                print(f"[emby] ws olay: {txt[:160]}", flush=True)
                                sync_from_ws()
                    elif opcode == 8:
                        raise ConnectionError("close-frame")
        except Exception as e:
            _WS["connected"] = False
            _WS["last_err"] = str(e)[:120]
            _ws_close(s)
            _WS["sock"] = None
            # reload istegi varsa beklemeden yeniden baglan (token/URL degisti)
            if _WS.get("reload", 0) != reload_mark:
                continue
            time.sleep(_WS_RECONNECT)


def start_listener():
    """WS dinleyicisini baslat (token veya API key varsa). Idempotent."""
    url, key, _u = _ws_cfg()
    if not url or not key:
        return False
    t = _WS.get("thread")
    if t and t.is_alive():
        return True
    th = threading.Thread(target=_ws_listen_loop, name="emby-ws", daemon=True)
    th.start()
    _WS["thread"] = th
    return True


def _ws_close(s):
    """WS soketini bloke recv'i uyandiracak sekilde kapat (shutdown + close)."""
    if not s:
        return
    try:
        s.shutdown(socket.SHUT_RDWR)
    except Exception:
        pass
    try:
        s.close()
    except Exception:
        pass


def restart_listener():
    """Token degisti -> mevcut WS'i kapat, dongunun yeniden baglanmasini sagla."""
    _WS["reload"] = int(time.time() * 1000)
    s = _WS.get("sock")
    if s:
        _ws_close(s)
    _WS["sock"] = None
    _WS["connected"] = False
    return start_listener()


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


def _watch_payload(item, season=None, episode=None, ts=None):
    return {
        "ts": int(ts or time.time()),
        "title": str(item.get("title") or "").strip(),
        "kind": item.get("kind") or "",
        "season": season,
        "episode": episode,
    }


def _stamp_api_watch(uid, item, season=None, episode=None, trigger="poll"):
    """API ile senkronize edilen son izleme (kart "Son sinyal" + "xyz izlendi"). 1.87."""
    try:
        payload = _watch_payload(item, season, episode)
        set_setting("emby_api_last_watch", json.dumps(payload, ensure_ascii=False))
        # 1.94: Access Token bolumundeki "Son sinyal" yalnizca WS kaynakli olayi gosterir.
        if trigger == "ws":
            set_setting("emby_ws_last_watch", json.dumps(payload, ensure_ascii=False))
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
    # 1.94: Access Token durumu
    tok = access_token()
    has_token = bool(tok)
    has_pw = bool(auth_password())
    token_user = (get_setting("emby_token_user") or "").strip() or auth_user()
    token_err = (get_setting("emby_token_error") or "").strip()
    ws_auth = (_WS.get("auth") or "").strip()
    if not ws_auth:
        ws_auth = "token" if has_token else ("api_key" if key else "")
    if token_err == "credentials-missing":
        token_status = "no-credentials"
    elif token_err == "auth":
        token_status = "auth-error"
    elif token_err.startswith("unreachable"):
        token_status = "unreachable"
    elif _WS.get("connected") and has_token and ws_auth == "token":
        token_status = "connected"
    elif has_token:
        token_status = "ready"
    else:
        token_status = "off"
    try:
        _tw = json.loads(get_setting("emby_ws_last_watch") or "{}")
        if not isinstance(_tw, dict):
            _tw = {}
    except Exception:
        _tw = {}
    try:
        _tw_ts = int(float(_tw.get("ts"))) if _tw.get("ts") else None
    except Exception:
        _tw_ts = None
    try:
        _we = int(float(get_setting("emby_ws_last_event") or 0))
    except Exception:
        _we = 0
    try:
        _tc = int(float(get_setting("emby_token_last_check") or 0))
    except Exception:
        _tc = 0
    try:
        _tr = int(float(get_setting("emby_token_last_renew") or 0))
    except Exception:
        _tr = 0
    try:
        _tcreated = int(float(get_setting("emby_token_created") or 0))
    except Exception:
        _tcreated = 0
    try:
        _tnext = int(float(get_setting("emby_token_next_try") or 0))
    except Exception:
        _tnext = 0
    try:
        _tfail = int(float(get_setting("emby_token_fail_count") or 0))
    except Exception:
        _tfail = 0
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
        "apiWsAuth": ws_auth,
        "apiTransport": "ws" if (_WS.get("connected") and ws_auth == "token") else (
            "ws-wait" if (configured() or has_token) else "off"),
        "lastSync": last or None,
        "lastResult": (get_setting("emby_last_result") or "") or None,
        "lastDetail": (get_setting("emby_last_detail") or "") or None,
        # 1.87: yerellestirilmis gosterim icin yapisal alanlar
        "apiScanCount": scan if isinstance(scan, int) else None,
        "apiStats": stats or None,
        # 1.94: Access Token
        "apiHasToken": has_token,
        "apiHasPassword": has_pw,
        "apiTokenUser": token_user,
        "apiTokenStatus": token_status,
        "apiTokenError": token_err,
        "apiTokenLastCheck": _tc or None,
        "apiTokenLastRenew": _tr or None,
        "apiTokenCreated": _tcreated or None,
        "apiTokenNextTry": _tnext or None,
        "apiTokenFailCount": _tfail,
        "apiTokenLastEvent": _we or None,
        "apiTokenLastSignal": _tw_ts or None,
        "apiTokenLastWatch": {
            "kind": _tw.get("kind") or "",
            "title": _tw.get("title") or "",
            "season": _tw.get("season"),
            "episode": _tw.get("episode"),
        } if _tw.get("title") else None,
        "apiWsLastErr": (_WS.get("last_err") or "").strip() or None,
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
    clear_token_config()
    _USER_CACHE["id"] = None
    _WS["connected"] = False


def save_config(url, key, user):
    """Ayarlari kaydet (key bos ise mevcut korunur). -> (ok, err)"""
    old_url = (get_setting("emby_api_url") or "").strip().rstrip("/")
    url = _norm_url(url)
    try:
        if url:
            set_setting("emby_api_url", url)
        if key:
            from crypto_util import encrypt_secret
            set_setting("emby_api_key", encrypt_secret(key.strip()))
        if user is not None:
            set_setting("emby_user", (user or "").strip())
        # 1.94: sunucu adresi degisirse eski token/parola baska sunucuya ait olabilir.
        if url and old_url and url != old_url:
            clear_token_config()
            try:
                restart_listener()
            except Exception:
                pass
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
