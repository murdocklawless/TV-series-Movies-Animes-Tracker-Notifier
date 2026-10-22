"""Trakt entegrasyonu (2.03).

Amac: NextEp'in dogrudan hook'layamadigi oynaticilari (VLC/Kodi/Infuse vb.)
Trakt uzerinden yakalamak. Trakt bir "scrobble merkezi"dir; oynaticilar
Trakt'a bildirir, NextEp Trakt'tan okur.

Yon:
  - Tek yon (varsayilan): Trakt -> NextEp. Trakt gecmisi okunur, NextEp'te
    "izlendi" + kaynak="trakt" yazilir. Trakt'a veri GONDERILMEZ.
  - Cift yon (on/off): ek olarak NextEp'in algiladigi izlemeler (kaynak != trakt)
    Trakt'a da yazilir.

Kimlik: Trakt OAuth device code. Global `trakt_client_id` + `trakt_client_secret`
(kullanici kendi Trakt uygulamasini olusturur). Per-user token `user_settings`
icinde sifreli saklanir.
"""
import json
import threading
import time

import requests

from db import get_setting, set_setting, get_user_setting, set_user_setting, get_db

TRAKT_API = "https://api.trakt.tv"
TRAKT_UA = "NextEp/1.0"
_lock = threading.Lock()

POLL_CHOICES = (0, 1, 5, 10, 15, 30, 60)  # 0 = kapali
POLL_DEFAULT = 10
# 2.19.6: hizli yoklama icin kucuk sayfa; gerektiginde sayfalama yapilir.
IN_LIMIT = 20          # sayfa basina history kaydi
IN_MAX_PAGES = 5       # tek yoklamada en fazla 100 kayit


# ---------------------------------------------------------------------------
# ayarlar / token
# ---------------------------------------------------------------------------

def client_id():
    try:
        return (get_setting("trakt_client_id") or "").strip()
    except Exception:
        return ""


def client_secret():
    try:
        return (get_setting("trakt_client_secret") or "").strip()
    except Exception:
        return ""


def configured():
    # 2.11: PKCE (public client) uygulamalarinda client_secret URETILMEZ -> yalniz client_id yeterli.
    return bool(client_id())


# 2.11: PKCE (secret'siz public client) — gecici code_verifier deposu (device_code -> verifier).
_PKCE = {}


def _pkce_verifier():
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits + "-._~"
    return "".join(secrets.choice(alphabet) for _ in range(64))


def _pkce_challenge(verifier):
    import base64
    import hashlib
    d = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode("ascii")


def set_redirect_mode(mode):
    """Kullanici secimi: aktif redirect modu (lan/url)."""
    m = (mode or "").strip().lower()
    if m not in ("lan", "url"):
        return False
    try:
        set_setting("trakt_redirect_mode", m)
        return True
    except Exception:
        return False


def redirect_mode():
    """Aktif redirect modu: kullanici secimi varsa o, yoksa varsayilan 'lan'."""
    try:
        m = (get_setting("trakt_redirect_mode") or "").strip().lower()
    except Exception:
        m = ""
    return m if m in ("lan", "url") else "lan"


def redirect_uri_lan():
    """Trakt redirect (LAN modu) — dev uygulamalar YALNIZ localhost kabul eder.

    Gercek LAN IP'si (or. http://192.168.2.11:8050) Trakt'a KAYDEDILEMEZ; bu yuzden
    deger her zaman http://127.0.0.1:<PORT>/trakt/callback olur (port = servis portu).
    """
    try:
        import os as _os
        port = str(_os.environ.get("PORT") or "8050")
    except Exception:
        port = "8050"
    return f"http://127.0.0.1:{port}/trakt/callback"


def redirect_uri_url():
    try:
        from routes.stremio import _public_base
        b = (_public_base() or "").rstrip("/")
    except Exception:
        b = ""
    return (b + "/trakt/callback") if b else ""


def redirect_uri():
    """Aktif redirect URI (refresh'te gonderilir)."""
    if redirect_mode() == "url":
        return redirect_uri_url() or redirect_uri_lan()
    return redirect_uri_lan()


def freeze_redirect():
    """Baglanma aninda: kullanici secimi yoksa varsayilan LAN yaz (secimi ezme)."""
    try:
        m = (get_setting("trakt_redirect_mode") or "").strip().lower()
        if m not in ("lan", "url"):
            set_setting("trakt_redirect_mode", "lan")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# OAuth Authorization Code + PKCE (2.12)
# Trakt yeni uygulamalarda client_secret URETMIYOR; device flow calismaz.
# ---------------------------------------------------------------------------

_AUTH_STATE = {}  # tek bekleyen onay: {uid, state, verifier, redirect_uri, ts}
DEFAULT_AUTH_REDIRECT = "https://nextep.cembol.com/callback"


def auth_redirect_uri():
    """Authorization code akisi icin redirect URI (Trakt formundaki ile BIREBIR ayni olmali)."""
    try:
        v = (get_setting("trakt_redirect_uri") or "").strip()
    except Exception:
        v = ""
    if v:
        return v
    try:
        from routes.stremio import _public_base
        b = (_public_base() or "").rstrip("/")
    except Exception:
        b = ""
    return (b + "/callback") if b else DEFAULT_AUTH_REDIRECT


def set_auth_redirect_uri(v):
    v = (v or "").strip()
    try:
        set_setting("trakt_redirect_uri", v)
        return True
    except Exception:
        return False


def authorize_url(uid):
    """PKCE onay URL'i uret (code_verifier + state saklanir). -> (ok, url|err)."""
    cid = client_id()
    if not cid:
        return False, "client-id"
    from urllib.parse import urlencode
    ruri = auth_redirect_uri()
    verifier = _pkce_verifier()
    state = _pkce_verifier()
    _AUTH_STATE.clear()
    _AUTH_STATE.update({"uid": int(uid or 1), "state": state, "verifier": verifier,
                        "redirect_uri": ruri, "ts": int(time.time())})
    q = urlencode({
        "response_type": "code",
        "client_id": cid,
        "redirect_uri": ruri,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
        "state": state,
    })
    return True, "https://auth.trakt.tv/oauth/authorize?" + q


def exchange_code(code, state):
    """Authorization code -> token (PKCE; client_secret YOK). -> (ok, err)."""
    st = (_AUTH_STATE.get("state") or "")
    ver = (_AUTH_STATE.get("verifier") or "")
    ruri = (_AUTH_STATE.get("redirect_uri") or "") or auth_redirect_uri()
    uid = int(_AUTH_STATE.get("uid") or 1)
    if not st or not ver:
        return False, "no-state"
    if (state or "") != st:
        return False, "state"
    body = {
        "code": code,
        "client_id": client_id(),
        "redirect_uri": ruri,
        "code_verifier": ver,
        "grant_type": "authorization_code",
    }
    sec = client_secret()
    if sec:
        body["client_secret"] = sec
    try:
        r = requests.post(f"{TRAKT_API}/oauth/token", headers=_headers(), json=body, timeout=20)
    except Exception as e:
        return False, str(e)[:200]
    if r.status_code != 200:
        try:
            err = (r.json() or {}).get("error") or ("HTTP %s" % r.status_code)
        except Exception:
            err = "HTTP %s" % r.status_code
        return False, err
    if not _save_token(uid, r.json()):
        return False, "save"
    _AUTH_STATE.clear()
    return True, ""


def _enc(v):
    if not v:
        return ""
    try:
        from crypto_util import encrypt_secret
        return encrypt_secret(v) or ""
    except Exception:
        return ""


def _dec(v):
    if not v:
        return ""
    try:
        from crypto_util import decrypt_secret
        return decrypt_secret(v) or ""
    except Exception:
        return ""


def _uget(uid, key):
    try:
        return get_user_setting(int(uid), key) or ""
    except Exception:
        return ""


def _uset(uid, key, val):
    try:
        set_user_setting(int(uid), key, val)
    except Exception:
        pass


def access_token(uid):
    return _dec(_uget(uid, "tp_trakt_token"))


def refresh_token(uid):
    return _dec(_uget(uid, "tp_trakt_refresh"))


def two_way(uid):
    return (_uget(uid, "tp_trakt_two_way") or "0").strip() == "1"


def poll_minutes(uid):
    """0 = kapali. Gecersizse varsayilan."""
    try:
        v = int(float(_uget(uid, "tp_trakt_poll_min") or POLL_DEFAULT))
    except Exception:
        v = POLL_DEFAULT
    return v if v in POLL_CHOICES else POLL_DEFAULT


# ---------------------------------------------------------------------------
# aktarim yonu (2.19.7): both | out | in | none
# ---------------------------------------------------------------------------
# both = cift yonlu, out = yalniz NextEp -> Trakt, in = yalniz Trakt -> NextEp,
# none = senkron tamamen kapali. Eski `tp_trakt_two_way` anahtari geriye uyum
# icin korunur (1 -> both, 0 -> in) ve her yon degisiminde esitlenir.

DIR_CHOICES = ("both", "out", "in", "none")


def direction(uid):
    """Aktarim yonu (fail-soft -> 'in')."""
    try:
        d = (_uget(uid, "tp_trakt_dir") or "").strip().lower()
    except Exception:
        d = ""
    if d in DIR_CHOICES:
        return d
    # Goc: yon ayari yoksa eski cift yon anahtarindan turet.
    try:
        return "both" if two_way(uid) else "in"
    except Exception:
        return "in"


def out_enabled(uid):
    """NextEp -> Trakt acik mi?"""
    return direction(uid) in ("both", "out")


def in_enabled(uid):
    """Trakt -> NextEp acik mi?"""
    return direction(uid) in ("both", "in")


def set_direction(uid, mode):
    """Yonu yaz. -> (ok, mode). Yalniz gecerli deger kabul edilir."""
    m = str(mode or "").strip().lower()
    if m not in DIR_CHOICES:
        return False, direction(uid)
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return False, direction(uid)
    # Ice alan bir moda gecilirken cursor'u "simdi"ye cek: "yalniz disa" modunda
    # yoklama durdugu icin cursor ilerlemez; aksi halde o donemde Trakt'a dusen
    # tum izlemeler toplu gelirdi.
    try:
        if m in ("both", "in") and not in_enabled(uid):
            _uset(uid, "tp_trakt_in_cursor", _iso(int(time.time())) or "")
    except Exception:
        pass
    _uset(uid, "tp_trakt_dir", m)
    # Geriye uyum: eski surum/anahtar okuyan yerler dogru davransin.
    _uset(uid, "tp_trakt_two_way", "1" if m == "both" else "0")
    return True, m


def connected(uid):
    return bool(access_token(uid))


def _headers(token=None):
    h = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": client_id(),
        "User-Agent": TRAKT_UA,
    }
    if token:
        h["Authorization"] = "Bearer " + token
    return h


def _save_token(uid, data, freeze=False):
    tok = (data or {}).get("access_token") or ""
    ref = (data or {}).get("refresh_token") or ""
    if not tok:
        return False
    _uset(uid, "tp_trakt_token", _enc(tok))
    if ref:
        _uset(uid, "tp_trakt_refresh", _enc(ref))
    _uset(uid, "tp_trakt_token_ts", str(int(time.time())))
    if freeze:
        freeze_redirect()
    return True


def clear_token(uid):
    for k in ("tp_trakt_token", "tp_trakt_refresh", "tp_trakt_token_ts",
              "tp_trakt_user", "tp_trakt_in_cursor", "tp_trakt_out_ts",
              "tp_trakt_last_watch", "tp_trakt_checked_ts", "tp_trakt_error"):
        _uset(uid, k, "")
    try:
        set_setting("trakt_redirect_mode", "")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# OAuth device code
# ---------------------------------------------------------------------------

def device_start():
    """Device code baslat -> (ok, data|err).

    2.11: PKCE (public client) destegi — client_secret yoksa code_challenge gonderilir.
    """
    cid = client_id()
    if not cid:
        return False, "client-id"
    body = {"client_id": cid}
    verifier = ""
    if not client_secret():
        verifier = _pkce_verifier()
        body["code_challenge"] = _pkce_challenge(verifier)
        body["code_challenge_method"] = "S256"
    try:
        r = requests.post(f"{TRAKT_API}/oauth/device/code", headers=_headers(), json=body, timeout=20)
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        data = r.json()
        if verifier and isinstance(data, dict) and data.get("device_code"):
            _PKCE[data["device_code"]] = verifier
        return True, data
    except Exception as e:
        return False, str(e)[:200]


def device_poll(device_code):
    """Device token dene. -> ("ok", data) | ("pending", None) | ("error", err)."""
    cid = client_id()
    body = {"code": device_code, "client_id": cid}
    sec = client_secret()
    if sec:
        body["client_secret"] = sec
    else:
        ver = _PKCE.get(device_code) or ""
        if ver:
            body["code_verifier"] = ver
    try:
        r = requests.post(f"{TRAKT_API}/oauth/device/token", headers=_headers(), json=body, timeout=20)
    except Exception as e:
        return "error", str(e)[:200]
    if r.status_code == 200:
        _PKCE.pop(device_code, None)
        return "ok", r.json()
    if r.status_code == 400:
        try:
            err = (r.json() or {}).get("error") or "pending"
        except Exception:
            err = "pending"
        if err in ("authorization_pending", "slow_down"):
            return "pending", None
        _PKCE.pop(device_code, None)
        return "error", err
    return "error", f"HTTP {r.status_code}"


def _refresh(uid):
    """Refresh token ile yeni access token al. Aktif redirect URI'yi dener,
    olmazsa digerini de dener. -> (ok, err)."""
    ref = refresh_token(uid)
    if not ref:
        return False, "no-refresh"
    cands = []
    for u in (auth_redirect_uri(), redirect_uri(), redirect_uri_lan(), redirect_uri_url()):
        if u and u not in cands:
            cands.append(u)
    last = "no-redirect"
    for ruri in cands:
        body = {
            "refresh_token": ref,
            "client_id": client_id(),
            "redirect_uri": ruri,
            "grant_type": "refresh_token",
        }
        sec = client_secret()
        if sec:
            body["client_secret"] = sec
        try:
            r = requests.post(f"{TRAKT_API}/oauth/token", headers=_headers(), json=body, timeout=20)
        except Exception as e:
            return False, str(e)[:200]
        if r.status_code == 200:
            return (True, "") if _save_token(uid, r.json()) else (False, "save")
        last = f"HTTP {r.status_code}"
    return False, last


def _retry_after(resp):
    """Trakt 429/420 -> beklenecek saniye (metin). Retry-After yoksa 60."""
    try:
        v = int(float(resp.headers.get("Retry-After") or 0))
        if v > 0:
            return str(max(5, min(v, 1800)))
    except Exception:
        pass
    return "60"


def _get(uid, path, params=None):
    """Yetkili GET. 401'de token yenilenip bir kez tekrar denenir."""
    tok = access_token(uid)
    if not tok:
        return None, "no-token"
    for attempt in (0, 1):
        try:
            r = requests.get(f"{TRAKT_API}{path}", headers=_headers(tok), params=params or {}, timeout=25)
        except Exception as e:
            return None, str(e)[:200]
        if r.status_code == 401 and attempt == 0:
            ok, _ = _refresh(uid)
            if not ok:
                return None, "auth"
            tok = access_token(uid)
            continue
        if r.status_code in (420, 429):
            return None, "rate-limit:" + _retry_after(r)
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
        try:
            return r.json(), ""
        except Exception:
            return None, "json"
    return None, "auth"


def _post(uid, path, body):
    tok = access_token(uid)
    if not tok:
        return None, "no-token"
    for attempt in (0, 1):
        try:
            r = requests.post(f"{TRAKT_API}{path}", headers=_headers(tok), json=body, timeout=25)
        except Exception as e:
            return None, str(e)[:200]
        if r.status_code == 401 and attempt == 0:
            ok, _ = _refresh(uid)
            if not ok:
                return None, "auth"
            tok = access_token(uid)
            continue
        if r.status_code in (420, 429):
            return None, "rate-limit:" + _retry_after(r)
        if r.status_code not in (200, 201):
            return None, f"HTTP {r.status_code}"
        try:
            return r.json(), ""
        except Exception:
            return {}, ""
    return None, "auth"


def me(uid):
    """Hesap dogrulama. -> (ok, username|err)."""
    data, err = _get(uid, "/users/me")
    if not data:
        return False, err
    return True, (data.get("username") or "")


# ---------------------------------------------------------------------------
# izleme yazimi (inbound: Trakt -> NextEp)
# ---------------------------------------------------------------------------

def _stamp_last_watch(uid, title, kind, season=None, episode=None, ts=None):
    payload = {
        "ts": int(ts or time.time()),
        "title": str(title or "").strip(),
        "kind": kind or "",
        "season": season,
        "episode": episode,
    }
    _uset(uid, "tp_trakt_last_watch", json.dumps(payload, ensure_ascii=False))


def _mark_inbound(uid, tmdb_id, kind, season, episode, title, ts, direct=False):
    """Trakt izlemesini NextEp'e yaz (source='trakt').

    direct=True: manuel "Simdi kontrol et" -> soru uretmeden dogrudan izlendi
    (Jellyfin poster "izlendi" isaretlemesiyle ayni davranis).
    """
    try:
        from routes.stremio import process_signal
    except Exception:
        return
    route = "movie" if kind == "movie" else "tv"
    try:
        process_signal(
            {"route_norm": route, "provider": "tmdb", "ident": int(tmdb_id),
             "season": season, "episode": episode},
            owner_id=int(uid), source="trakt", direct=bool(direct),
        )
        _stamp_last_watch(uid, title, kind, season, episode, ts=ts)
    except Exception as e:
        print(f"[trakt] mark hata: {e}", flush=True)


def _inbound(uid, direct=False):
    """Trakt history -> NextEp. Yeni izlemeleri isler. -> islenen sayisi.

    2.19.6: sayfalama. Eski surum tek sayfa (IN_LIMIT) okuyup cursor'i
    ilerletiyordu; tek yoklamada IN_LIMIT'ten fazla yeni kayit varsa eskiler
    sessizce atlaniyordu. Artik sayfalar sirayla okunur ve cursor'dan eski
    kayda rastlaninca durulur.

    2.19.25: `tp_trakt_in_seen` ring buffer (son 100 oge anahtari) eklendi.
    Trakt `watched_at`i dakikaya yuvarladigi icin cursor'a ESIT kayit eskiden
    her yoklamada (10 sn'de bir) yeniden isleniyordu; artik ayni anahtar bir
    kez islenir. Bu, oge basina 1 TMDB sorgusunun sonsuz tekrarini keser.

    Cursor karsilastirmasi: `watched_at < cursor` atlanir (esit olan
    gorulmemisse islenir).
    """
    cursor = _uget(uid, "tp_trakt_in_cursor")
    try:
        seen = json.loads(_uget(uid, "tp_trakt_in_seen") or "[]")
        if not isinstance(seen, list):
            seen = []
    except Exception:
        seen = []
    seen_set = set(str(x) for x in seen)
    done = []
    n = 0
    newest = cursor
    pages = 0
    truncated = False
    t0 = time.time()

    def _key(typ, tmdb, season=None, ep=None, watched_at=""):
        return "%s|%s|%s|%s|%s" % (typ, tmdb, season if season is not None else "-",
                                   ep if ep is not None else "-", watched_at)

    while pages < IN_MAX_PAGES:
        pages += 1
        data, err = _get(uid, "/sync/history", {"limit": IN_LIMIT, "page": pages})
        if data is None:
            _uset(uid, "tp_trakt_error", err or "history")
            _log_inbound(uid, n, 0, cursor, t0)
            return n
        if not isinstance(data, list) or not data:
            break
        oldest = ""
        for it in reversed(data):
            try:
                watched_at = str(it.get("watched_at") or "")
                if watched_at and (not oldest or watched_at < oldest):
                    oldest = watched_at
                if cursor and watched_at and watched_at < cursor:
                    continue
                typ = (it.get("type") or "").lower()
                if typ == "movie":
                    mv = it.get("movie") or {}
                    tmdb = ((mv.get("ids") or {}).get("tmdb"))
                    title = mv.get("title") or ""
                    if not tmdb:
                        print(f"[trakt] atlandi (film id yok): {title or '?'} @ {watched_at}", flush=True)
                        continue
                    k = _key("movie", tmdb, watched_at=watched_at)
                    if k in seen_set:
                        continue
                    _mark_inbound(uid, tmdb, "movie", None, None, title, None, direct=direct)
                    seen_set.add(k)
                    done.append(k)
                    n += 1
                elif typ == "episode":
                    ep = it.get("episode") or {}
                    # 2.19.3: Trakt /sync/history'de show UST DUZEYDE gelir (episode icinde degil).
                    show = it.get("show") or ep.get("show") or {}
                    tmdb = ((show.get("ids") or {}).get("tmdb"))
                    season = ep.get("season")
                    number = ep.get("number")
                    title = show.get("title") or ""
                    if not (tmdb and season is not None and number is not None):
                        print(f"[trakt] atlandi (id/se eksik): {title or '?'} S{season}E{number} @ {watched_at}", flush=True)
                        continue
                    k = _key("tv", tmdb, season, number, watched_at)
                    if k in seen_set:
                        continue
                    _mark_inbound(uid, tmdb, "tv", int(season), int(number), title, None, direct=direct)
                    seen_set.add(k)
                    done.append(k)
                    n += 1
                if watched_at and (not newest or watched_at > newest):
                    newest = watched_at
            except Exception:
                continue
        if len(data) < IN_LIMIT:
            break
        # Bu sayfada cursor'dan eski kayit gorduysek daha fazla sayfa gereksiz.
        if cursor and oldest and oldest < cursor:
            break
        if pages == IN_MAX_PAGES:
            truncated = True
    if truncated:
        print(f"[trakt] inbound uid={uid}: {IN_MAX_PAGES} sayfa doldu, "
              f"daha eski kayitlar sonraki yoklamaya kaldi", flush=True)
    if done:
        try:
            merged = (seen + done)[-100:]
            _uset(uid, "tp_trakt_in_seen", json.dumps(merged, ensure_ascii=False))
        except Exception:
            pass
    # 2.19.3: ileri damgali bir oge cursor'i gelecege tasiyip tum akisi kilitlemesin.
    # Tavani "simdi"ye kirp; oge bir sonraki yoklamada yeniden denenir.
    now_iso = _iso(int(time.time()))
    if newest and now_iso and newest > now_iso:
        print(f"[trakt] cursor tavan (ileri damga kirpildi): {newest} -> {now_iso}", flush=True)
        newest = now_iso
    if newest and newest != cursor:
        _uset(uid, "tp_trakt_in_cursor", newest)
    _uset(uid, "tp_trakt_error", "")
    _log_inbound(uid, n, len(done), newest or cursor, t0)
    return n


def _log_inbound(uid, processed, new, cursor, t0):
    """Gelen yoklama olay satiri (10 sn'lik heartbeat degil, etkisi yazilir)."""
    try:
        import query_log
        query_log.log(
            "trakt", "GET", "/sync/history", status=200,
            ms=int((time.time() - t0) * 1000), src="net", tag="trakt.inbound",
            uid=uid,
            params={"in": processed, "new": new, "cursor": str(cursor or "")[:32]},
            level="info" if (processed or new) else "debug",
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# mutabakat (Trakt -> NextEp): Trakt'ta KALDIRILAN izlemeler (2.19.5)
# ---------------------------------------------------------------------------

def _mark_pushed(uid, movies, shows):
    """Basarili outbound POST'tan sonra 'Trakt'a yazildi' kaydini tutar (2.19.5).

    Mutabakat yalniz bu kayitlar (ve source='trakt') uzerinden kaldirma yapar;
    eski surumlerde sessizce kabul edilmeyen gonderimler kaydedilmedigi icin
    yanlislikla silinmez.
    """
    if not movies and not shows:
        return
    try:
        conn = get_db()
        try:
            now = int(time.time())
            q = (
                "INSERT INTO trakt_out_pushed (user_id, kind, tmdb_id, season, episode, ts) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, kind, tmdb_id, season, episode) "
                "DO UPDATE SET ts=excluded.ts"
            )
            for m in movies:
                tmdb = (m.get("ids") or {}).get("tmdb")
                if tmdb:
                    conn.execute(q, (int(uid), "movie", int(tmdb), 0, 0, now))
            for sh in shows:
                tmdb = (sh.get("ids") or {}).get("tmdb")
                if not tmdb:
                    continue
                for sn in sh.get("seasons") or []:
                    s_num = sn.get("number")
                    if s_num is None:
                        continue
                    for ep in sn.get("episodes") or []:
                        e_num = ep.get("number")
                        if e_num is not None:
                            conn.execute(
                                q, (int(uid), "tv", int(tmdb), int(s_num), int(e_num), now)
                            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def _reconcile(uid):
    """Trakt'ta artik izlenmeyen (kaldirilmis) ogeleri NextEp'te de kaldirir.

    Trakt history'si SILINEN ogeleri gostermez; bu yuzden guncel "izlenen
    kumesi" (/sync/watched) ile yerel durum karsilastirilir. Aday kosulu
    (yanlis silme korumasi): source='trakt' VEYA trakt_out_pushed kaydi var.
    Trakt'ta gorunen yerel izlemeler her turda tohumlanir; boylece eski
    surumde dogru gonderilmis filmler de kapsanir. Sunucu hatasinda hicbir
    sey silinmez. -> kaldirilan oge sayisi.
    """
    uid = int(uid)
    shows_data, err = _get(uid, "/sync/watched/shows", {"extended": "progress"})
    if shows_data is None:
        _uset(uid, "tp_trakt_error", err or "watched-shows")
        return 0
    tv_set, unknown = set(), set()
    for it in shows_data if isinstance(shows_data, list) else []:
        sh = it.get("show") or {}
        tmdb = (sh.get("ids") or {}).get("tmdb")
        if not tmdb:
            continue
        seasons = it.get("seasons")
        if not seasons:
            # Sezon detayi gelmedi -> bu dizi icin kaldirma YAPMA (belirsiz).
            unknown.add(int(tmdb))
            continue
        for sn in seasons:
            s_num = sn.get("number")
            if s_num is None:
                continue
            for ep in sn.get("episodes") or []:
                e_num = ep.get("number")
                if e_num is not None:
                    tv_set.add((int(tmdb), int(s_num), int(e_num)))
    mv_set, mv_ok = set(), True
    mv_data, err2 = _get(uid, "/sync/watched/movies")
    if mv_data is None:
        print(f"[trakt] mutabakat: film listesi alinamadi ({err2})", flush=True)
        mv_ok = False
    else:
        for it in mv_data if isinstance(mv_data, list) else []:
            mv = it.get("movie") or {}
            tmdb = (mv.get("ids") or {}).get("tmdb")
            if tmdb:
                mv_set.add(int(tmdb))
    removed = []
    try:
        conn = get_db()
        try:
            # 'Trakt'a yazildi' kayitlari (aday havuzu).
            pushed_tv, pushed_mv = set(), set()
            for pr in conn.execute(
                "SELECT kind, tmdb_id, season, episode FROM trakt_out_pushed WHERE user_id=?",
                (uid,),
            ).fetchall():
                if (pr["kind"] or "").lower() == "movie":
                    pushed_mv.add(int(pr["tmdb_id"]))
                else:
                    pushed_tv.add((int(pr["tmdb_id"]), int(pr["season"]), int(pr["episode"])))
            rows = conn.execute(
                "SELECT e.follow_id AS follow_id, e.season AS season, e.episode AS episode, "
                "e.source AS source, f.tmdb_id AS tmdb_id "
                "FROM episodes e JOIN followed f ON f.id=e.follow_id "
                "WHERE f.user_id=? AND f.media_type='tv' AND e.watched=1",
                (uid,),
            ).fetchall()
            mrows = []
            if mv_ok:
                mrows = conn.execute(
                    "SELECT id, tmdb_id, watched_source FROM followed "
                    "WHERE user_id=? AND media_type='movie' AND watched=1",
                    (uid,),
                ).fetchall()
            # Tohum: yerelde izlendi + Trakt'ta var -> eslenik say (eski surumde
            # dogru gonderilmis filmler de kapsanir; Trakt'ta OLMAYAN eski yerel
            # isaretler tohumlanmaz -> korunur).
            now = int(time.time())
            seed = (
                "INSERT OR IGNORE INTO trakt_out_pushed "
                "(user_id, kind, tmdb_id, season, episode, ts) VALUES (?, ?, ?, ?, ?, ?)"
            )
            for r in rows:
                if not r["tmdb_id"] or r["season"] is None or r["episode"] is None:
                    continue
                key = (int(r["tmdb_id"]), int(r["season"]), int(r["episode"]))
                if key in tv_set:
                    conn.execute(seed, (uid, "tv", key[0], key[1], key[2], now))
            for r in mrows:
                if r["tmdb_id"] and int(r["tmdb_id"]) in mv_set:
                    conn.execute(seed, (uid, "movie", int(r["tmdb_id"]), 0, 0, now))
            conn.commit()

            # Kaldirma: Trakt'ta YOK + (source='trakt' veya basariyla gonderilmis)
            for r in rows:
                tmdb = r["tmdb_id"]
                if not tmdb or r["season"] is None or r["episode"] is None:
                    continue
                key = (int(tmdb), int(r["season"]), int(r["episode"]))
                if key in tv_set:
                    continue
                if int(tmdb) in unknown:
                    continue
                src = (r["source"] or "").strip().lower()
                if src != "trakt" and key not in pushed_tv:
                    continue
                removed.append(key)
                conn.execute(
                    "UPDATE episodes SET watched=0, watched_at=NULL, source=NULL, direct_mark=0 "
                    "WHERE follow_id=? AND season=? AND episode=?",
                    (r["follow_id"], r["season"], r["episode"]),
                )
                conn.execute(
                    "DELETE FROM trakt_out_pushed WHERE user_id=? AND kind='tv' "
                    "AND tmdb_id=? AND season=? AND episode=?",
                    (uid, key[0], key[1], key[2]),
                )
            for r in mrows:
                tmdb = r["tmdb_id"]
                if not tmdb or int(tmdb) in mv_set:
                    continue
                src = (r["watched_source"] or "").strip().lower()
                if src != "trakt" and int(tmdb) not in pushed_mv:
                    continue
                removed.append(("m", int(tmdb)))
                conn.execute(
                    "UPDATE followed SET watched=0, watched_at=NULL, watched_source=NULL, "
                    "direct_mark=0 WHERE id=?",
                    (r["id"],),
                )
                conn.execute(
                    "DELETE FROM trakt_out_pushed WHERE user_id=? AND kind='movie' AND tmdb_id=?",
                    (uid, int(tmdb)),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[trakt] mutabakat hata: {e}", flush=True)
        return 0
    if not removed:
        return 0
    # Kaldirilanlar clear-apply ile geri yazilmasin: sinyal tamponunu temizle.
    try:
        from stremio_buffer import _dedupe, delete_signals
        keys = []
        for it in removed:
            if it[0] == "m":
                keys.append(_dedupe("movie", it[1], None, None, None, uid))
            else:
                keys.append(_dedupe("tv", it[0], None, it[1], it[2], uid))
        delete_signals(keys)
    except Exception:
        pass
    for it in removed:
        if it[0] == "m":
            print(f"[trakt] geri alindi (Trakt'ta izlenmedi): film tmdb={it[1]}", flush=True)
        else:
            print(f"[trakt] geri alindi (Trakt'ta izlenmedi): tmdb={it[0]} S{it[1]}E{it[2]}", flush=True)
    try:
        from ramcache import bump
        bump()
    except Exception:
        pass
    return len(removed)


# ---------------------------------------------------------------------------
# disa aktarim (outbound: NextEp -> Trakt), yalniz cift yon
# ---------------------------------------------------------------------------

def queue_remove(uid, kind, tmdb_id, season=None, episode=None):
    """Yerelde 'izlendi -> izlenmedi' gecisini disa aktarim kuyruguna yaz (2.19.4).

    Kuyruk yalniz cift yon acikken bosaltilir (poll/buton). Film icin
    season/episode 0 gonderilir; SQLite UNIQUE'te NULL'lar farkli sayildigi
    icin ayni film tekrar tekrar kuyruga girecekti.
    """
    try:
        tmdb = int(tmdb_id)
    except Exception:
        return False
    if tmdb <= 0:
        return False
    k = "movie" if (kind or "").lower() == "movie" else "tv"
    try:
        s = int(season) if season is not None else 0
        e = int(episode) if episode is not None else 0
    except Exception:
        return False
    try:
        conn = get_db()
        try:
            conn.execute(
                "INSERT INTO trakt_out_remove (user_id, kind, tmdb_id, season, episode, ts) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, kind, tmdb_id, season, episode) "
                "DO UPDATE SET ts=excluded.ts",
                (int(uid), k, tmdb, s, e, int(time.time())),
            )
            # Eslenik kaydi da dusur: bu oge artik Trakt'ta olmayacak.
            conn.execute(
                "DELETE FROM trakt_out_pushed WHERE user_id=? AND kind=? AND tmdb_id=? "
                "AND season=? AND episode=?",
                (int(uid), k, tmdb, s, e),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception:
        return False


def _still_watched(conn, uid, kind, tmdb, season, episode):
    """Kuyruktaki oge yerelde hala izlendi mi? Tekrar izlendiyse kaldirma iptal."""
    try:
        if kind == "movie":
            r = conn.execute(
                "SELECT watched FROM followed "
                "WHERE user_id=? AND tmdb_id=? AND media_type='movie'",
                (int(uid), int(tmdb)),
            ).fetchone()
        else:
            r = conn.execute(
                "SELECT e.watched AS watched FROM episodes e JOIN followed f ON f.id=e.follow_id "
                "WHERE f.user_id=? AND f.tmdb_id=? AND e.season=? AND e.episode=?",
                (int(uid), int(tmdb), int(season), int(episode)),
            ).fetchone()
        return bool(r and r["watched"])
    except Exception:
        return False


def _drop_removals(uid, items):
    if not items:
        return
    try:
        conn = get_db()
        try:
            for kind, tmdb, season, episode in items:
                conn.execute(
                    "DELETE FROM trakt_out_remove "
                    "WHERE user_id=? AND kind=? AND tmdb_id=? AND season=? AND episode=?",
                    (int(uid), kind, int(tmdb), int(season), int(episode)),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def _outbound_removals(uid):
    """Kuyruktaki 'izlenmedi' ogelerini Trakt gecmisinden sil (2.19.4).

    Basarida (not_found dahil) kuyruk satirlari dusulur; HTTP hatasinda
    satirlar kalir ve bir sonraki yoklamada yeniden denenir.
    -> gonderilen oge sayisi.
    """
    try:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT kind, tmdb_id, season, episode FROM trakt_out_remove "
                "WHERE user_id=? ORDER BY ts LIMIT 100",
                (int(uid),),
            ).fetchall()
            pending = []
            for r in rows:
                kind = (r["kind"] or "").lower()
                skip = _still_watched(conn, uid, kind, r["tmdb_id"], r["season"], r["episode"])
                pending.append((kind, r["tmdb_id"], r["season"], r["episode"], skip))
        finally:
            conn.close()
    except Exception:
        return 0
    if not pending:
        return 0
    movies, shows, drop = [], {}, []
    rm_eps = 0
    for kind, tmdb, season, episode, skip in pending:
        drop.append((kind, tmdb, season, episode))
        if skip or not tmdb:
            continue
        if kind == "movie":
            movies.append({"ids": {"tmdb": int(tmdb)}})
        else:
            slot = shows.setdefault(int(tmdb), {})
            slot.setdefault(int(season), []).append(int(episode))
            rm_eps += 1
    body = {}
    if movies:
        body["movies"] = movies
    if shows:
        body["shows"] = [
            {
                "ids": {"tmdb": t},
                "seasons": [
                    {"number": sn, "episodes": [{"number": en} for en in sorted(eps)]}
                    for sn, eps in sorted(seasons.items())
                ],
            }
            for t, seasons in shows.items()
        ]
    if not body:
        _drop_removals(uid, drop)
        return 0
    data, err = _post(uid, "/sync/history/remove", body)
    if data is None:
        _uset(uid, "tp_trakt_error", err or "out-remove")
        return 0
    _drop_removals(uid, drop)
    return len(movies) + rm_eps


def _outbound(uid):
    """Once yerelde 'izlenmedi' yapilanlari Trakt'tan siler, sonra NextEp'te
    izlenen (kaynak != trakt) film/bolumleri Trakt'a yazar (2.19.4).

    Sira onemli: 'kaldir -> tekrar izle' senaryosunda son durum izlendi kalir.
    Bolumler Trakt'in kanonik 'shows > seasons > episodes' bicimiyle gonderilir.
    """
    rm_n = _outbound_removals(uid)
    try:
        since = int(float(_uget(uid, "tp_trakt_out_ts") or 0))
    except Exception:
        since = 0
    now = int(time.time())
    movies = []
    shows = {}
    out_eps = 0
    max_ts = 0
    capped = False
    try:
        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT tmdb_id, watched_at FROM followed "
                "WHERE user_id=? AND media_type='movie' AND watched=1 "
                "AND watched_at IS NOT NULL AND watched_at>? "
                "AND LOWER(IFNULL(watched_source,''))<>'trakt' "
                "ORDER BY watched_at ASC",
                (int(uid), since),
            ).fetchall()
            for r in rows:
                if not r["tmdb_id"]:
                    continue
                # 2.19.5: 100 sinirinda cursor'u "simdi"ye degil son gonderilene
                # cek; kalanlar sonraki turda gider ve mutabakat onlari
                # "eslenmis" sanip silmez.
                if len(movies) >= 100:
                    capped = True
                    break
                ts = int(r["watched_at"])
                movies.append({"ids": {"tmdb": int(r["tmdb_id"])}, "watched_at": _iso(ts)})
                if ts > max_ts:
                    max_ts = ts
            erows = conn.execute(
                "SELECT f.tmdb_id AS tmdb_id, e.season AS season, e.episode AS episode, e.watched_at AS watched_at "
                "FROM episodes e JOIN followed f ON f.id=e.follow_id "
                "WHERE f.user_id=? AND e.watched=1 AND e.watched_at IS NOT NULL AND e.watched_at>? "
                "AND LOWER(IFNULL(f.watched_source,''))<>'trakt' "
                "ORDER BY e.watched_at ASC",
                (int(uid), since),
            ).fetchall()
            for r in erows:
                if out_eps >= 100:
                    capped = True
                    break
                if r["tmdb_id"] and r["season"] is not None and r["episode"] is not None:
                    ts = int(r["watched_at"])
                    slot = shows.setdefault(int(r["tmdb_id"]), {})
                    slot.setdefault(int(r["season"]), []).append(
                        {"number": int(r["episode"]), "watched_at": _iso(ts)}
                    )
                    out_eps += 1
                    if ts > max_ts:
                        max_ts = ts
        finally:
            conn.close()
    except Exception:
        return rm_n
    if not movies and not shows:
        _uset(uid, "tp_trakt_out_ts", str(now))
        return rm_n
    body = {}
    if movies:
        body["movies"] = movies[:100]
    if shows:
        body["shows"] = [
            {
                "ids": {"tmdb": t},
                "seasons": [
                    {"number": sn, "episodes": eps}
                    for sn, eps in sorted(seasons.items())
                ],
            }
            for t, seasons in shows.items()
        ][:100]
    data, err = _post(uid, "/sync/history", body)
    if data is None:
        _uset(uid, "tp_trakt_error", err or "out")
        return rm_n
    # 2.19.5: yalniz Trakt'in kabul ettigi gonderimleri "eslenik" isaretle.
    # Dikkat: Trakt not_found'u HER ZAMAN dondurur (bos listelerle); yalniz
    # gercekten dolu liste "kismen reddedildi" demektir.
    nf = (data or {}).get("not_found") if isinstance(data, dict) else None
    rejected = False
    if isinstance(nf, dict):
        for v in nf.values():
            if isinstance(v, list) and v:
                rejected = True
                break
            if isinstance(v, dict) and any(v.values()):
                rejected = True
                break
    if rejected:
        print(f"[trakt] outbound kismen kabul edilmedi: {sorted(nf.keys())}", flush=True)
    else:
        _mark_pushed(uid, body.get("movies") or [], body.get("shows") or [])
    if capped and max_ts:
        _uset(uid, "tp_trakt_out_ts", str(max_ts))
    else:
        _uset(uid, "tp_trakt_out_ts", str(now))
    return rm_n + len(movies) + out_eps


def _iso(epoch):
    try:
        import datetime
        return datetime.datetime.utcfromtimestamp(int(epoch)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# yoklama (job)
# ---------------------------------------------------------------------------

def poll(uid, direct=False):
    """Bir kullanici icin tek yoklama: inbound (+ cift yon ise outbound).

    direct=True yalnizca manuel "Simdi kontrol et" butonundan gelir: gelen
    izlemeler soru uretmeden dogrudan yazilir (manuel isaretleme).
    """
    uid = int(uid)
    if not connected(uid):
        return {"ok": False, "error": "no-token"}
    if not _lock.acquire(blocking=False):
        return {"ok": False, "error": "busy"}
    try:
        in_n = _inbound(uid, direct=direct) if in_enabled(uid) else 0
        # 2.19.5: Trakt'ta kaldirilan izlemeleri yerelde de kaldir (mutabakat).
        un_n = _reconcile(uid) if in_enabled(uid) else 0
        try:
            _uset(uid, "tp_trakt_reconcile_ts", str(int(time.time())))
        except Exception:
            pass
        out_n = _outbound(uid) if out_enabled(uid) else 0
        _uset(uid, "tp_trakt_checked_ts", str(int(time.time())))
        return {"ok": True, "in": in_n, "out": out_n, "un": un_n}
    finally:
        try:
            _lock.release()
        except Exception:
            pass


def poll_in(uid, direct=False):
    """Yalniz gelen yoklama (havuzun `sync-pool-in` is parcasi, 2.19.6)."""
    uid = int(uid)
    if not connected(uid):
        return {"ok": False, "error": "no-token"}
    if not in_enabled(uid):
        return {"ok": True, "in": 0, "skip": "in-off"}
    if not _lock.acquire(blocking=False):
        return {"ok": False, "error": "busy"}
    try:
        in_n = _inbound(uid, direct=direct)
        _uset(uid, "tp_trakt_checked_ts", str(int(time.time())))
        return {"ok": True, "in": in_n}
    finally:
        try:
            _lock.release()
        except Exception:
            pass


def flush_out(uid):
    """Havuz worker'i icin disa aktarim: kaldirmalar + yeni izlemeler.

    `_outbound` zaten once `trakt_out_remove` kuyrugunu bosaltir, sonra yeni
    izlemeleri yazar. -> (ok, msg); msg "ok:<n>" veya hata metni.
    """
    uid = int(uid)
    if not connected(uid):
        return True, "no-token"
    if not out_enabled(uid):
        return True, "out-off"
    if not _lock.acquire(blocking=False):
        return False, "busy"
    try:
        _uset(uid, "tp_trakt_error", "")
        n = _outbound(uid)
        err = _uget(uid, "tp_trakt_error") or ""
        if err:
            return False, str(err)
        return True, f"ok:{n}"
    except Exception as e:
        return False, f"exc:{str(e)[:120]}"
    finally:
        try:
            _lock.release()
        except Exception:
            pass


def reconcile_if_due(uid, minutes=15):
    """Mutabakati en fazla `minutes` dakikada bir calistir (2.19.6).

    Havuz aktifken yoklama 10 sn'ye indigi icin her turda `/sync/watched`
    cekmek gereksiz yuk olur; kaldirma tespiti bu araliga yayilir.
    -> kaldirilan oge sayisi (bekleme/atlanmis ise 0).
    """
    uid = int(uid)
    if not connected(uid):
        return 0
    if not in_enabled(uid):
        return 0
    try:
        last = int(float(_uget(uid, "tp_trakt_reconcile_ts") or 0))
    except Exception:
        last = 0
    now = int(time.time())
    if last and (now - last) < max(60, int(minutes) * 60):
        return 0
    if not _lock.acquire(blocking=False):
        return 0
    try:
        _uset(uid, "tp_trakt_reconcile_ts", str(now))
        return _reconcile(uid)
    except Exception as e:
        print(f"[trakt] mutabakat hata uid={uid}: {e}", flush=True)
        return 0
    finally:
        try:
            _lock.release()
        except Exception:
            pass


def status(uid):
    """Kart icin durum (fail-soft)."""
    uid = int(uid or 0)
    base = {
        "traktConfigured": configured(),
        "traktClientId": client_id(),
        "traktRedirectMode": redirect_mode(),
        "traktAuthRedirectUri": auth_redirect_uri(),
        "traktRedirectUri": redirect_uri(),
        "traktRedirectUriLan": redirect_uri_lan(),
        "traktRedirectUriUrl": redirect_uri_url(),
        "traktConnected": False,
        "traktUser": "",
        "traktTwoWay": two_way(uid),
        "traktDirection": direction(uid),
        "traktPollMin": poll_minutes(uid),
        "traktLastSignal": None,
        "traktLastWatch": None,
        "traktCheckedTs": None,
        "traktError": "",
        "traktStatus": "not-connected",
        # 2.19.6: senkron havuzu (kuyruk + yoklama araligi)
        "traktPoolPending": 0,
        "traktPoolFailed": 0,
        "traktPoolLastTs": None,
        "traktPoolLastError": "",
        "traktPoolInterval": 0,
        "traktPoolActive": False,
    }
    try:
        import sync_pool as _pool
        _st = _pool.status(uid)
        base["traktPoolPending"] = int(_st.get("pending") or 0)
        base["traktPoolFailed"] = int(_st.get("failed") or 0)
        base["traktPoolLastTs"] = _st.get("lastTs")
        base["traktPoolLastError"] = _st.get("lastError") or ""
        base["traktPoolInterval"] = int(_st.get("inInterval") or 0)
        base["traktPoolActive"] = bool(_st.get("active"))
    except Exception:
        pass
    if not connected(uid):
        return base
    base["traktConnected"] = True
    base["traktStatus"] = "ready"
    try:
        base["traktUser"] = _uget(uid, "tp_trakt_user") or ""
    except Exception:
        pass
    try:
        lw = json.loads(_uget(uid, "tp_trakt_last_watch") or "{}")
        if isinstance(lw, dict) and lw.get("title"):
            base["traktLastSignal"] = int(float(lw.get("ts"))) if lw.get("ts") else None
            base["traktLastWatch"] = {
                "kind": lw.get("kind") or "",
                "title": lw.get("title") or "",
                "season": lw.get("season"),
                "episode": lw.get("episode"),
            }
    except Exception:
        pass
    try:
        cts = _uget(uid, "tp_trakt_checked_ts")
        base["traktCheckedTs"] = int(float(cts)) if cts else None
    except Exception:
        pass
    base["traktError"] = _uget(uid, "tp_trakt_error") or ""
    now = int(time.time())
    if base["traktLastSignal"] and (now - int(base["traktLastSignal"])) <= 24 * 3600:
        base["traktStatus"] = "connected"
    return base
