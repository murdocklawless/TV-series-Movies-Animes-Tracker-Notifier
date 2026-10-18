"""Stremio izleme senkronu (Faz 29).

Stremio eklentisi (NextEp Watch Sync) altyazi kancasi uzerinden oynatma acilisini
yakalar, izlenen dizi/film/animeyi Nextep'e watched=1 olarak isler. Tek yonlu
(Stremio -> Nextep), Trakt yok, ev agi kapsaminda. UUID per-app: settings.tp_<app>_uuid.

Uclar:
  GET  /stremio/<uuid>/manifest.json                 -> manifest (static)
  GET  /stremio/logo.png                              -> eklenti logosu (manifestle ayni kaynak)
  GET  /stremio/<uuid>/subtitles/<type>/<id>.json    -> sinyal kancasi (aninda {subtitles:[]})
  GET  /api/thirdparty/status                        -> uygulama durum listesi (genisletilebilir)
  POST /api/thirdparty/stremio/refresh-uuid          -> yeni UUID (eski kurulum olur)
  POST /api/thirdparty/stremio/disconnect            -> baglantiyi kes (yazma durur)
  POST /api/seasons/clear-apply                      -> tumunu temizle + tamponu otomatik uygula
"""
import json
import os
import re
import socket
import threading
import uuid

import requests

from flask import Blueprint, jsonify, request

from db import get_db, get_setting, set_setting, get_user_setting, set_user_setting
from auth import get_current_user
from tmdb import tmdb_request, get_tmdb_info, get_tmdb_cast, get_tmdb_credits, save_details
from rate_track import acquire, record, handle_429
from poster_store import download_tmdb_poster_with_sizes, download_anime_poster_with_sizes, filesystem_path_from_web
from config import TMDB_IMAGE_BASE
from scheduler import sync_episodes, _is_doc_row
from anilist import (
    anilist_detail,
    anilist_schedule,
    _anime_title,
    _anime_cover,
    save_anime_details,
    load_anime_map,
    store_anime_map,
    resolve_external_anilist,
)
from ramcache import bump
from recommendations import remove_rec_item
from stremio_buffer import (
    record_signal,
    signals_for_tv,
    signals_for_movie,
    signals_for_anime,
    delete_signals,
    last_signal_ts,
    last_signal_row,
    clear_all_signals,
    _dedupe as _signal_dedupe,
)
from ask_store import record_decision, reset_decision

stremio_bp = Blueprint("stremio", __name__)

# Eklenti logosu ayni-kaynaktan servis edilir (/stremio/logo.png — manifestle
# ayni host/politika; ucuncu parti host kirilganligi yok). Dosya:
# static/images/stremio_nextep_plugin.png

# Genisletilebilir uygulama defteri: ileride Nuvio vb. buraya satir eklenir.
# 1.86: Plex / Jellyfin / Emby — webhook ile izleme sinyali gonderir.
THIRDPARTY_APPS = [
    {"id": "stremio", "name": "Stremio", "protocol": "stremio"},
    {"id": "plex", "name": "Plex", "protocol": "webhook"},
    {"id": "jellyfin", "name": "Jellyfin", "protocol": "webhook"},
    {"id": "emby", "name": "Emby", "protocol": "webhook"},
    {"id": "calendar", "name": "Takvim (ICS)", "protocol": "ics"},
    {"id": "remote", "name": "Uzak Bağlantı", "protocol": "wireguard"},
]

# Webhook tabanli uygulamalar (Plex / Jellyfin / Emby): /webhook/<app>/<token>
WEBHOOK_APPS = ("plex", "jellyfin", "emby")

SIGNAL_TTL = 30 * 86400  # tampon budama suresi (gecelik is)


# ---------------------------------------------------------------------------
# UUID + kurulum URL
# ---------------------------------------------------------------------------

def _uuid_setting_key(app_id):
    return f"tp_{app_id}_uuid"


def _me_uid():
    try:
        u = get_current_user()
        return int(u["id"]) if u else 0
    except Exception:
        return 0


def _get_uuid(app_id="stremio", user_id=None):
    """UUID'i dondurur; yoksa uretir (kurulum URL'si her zaman hazir olur). Faz 32: per-user."""
    key = _uuid_setting_key(app_id)
    uid = int(user_id or _me_uid() or 1)
    try:
        u = get_user_setting(uid, key)
    except Exception:
        u = None
    if not u:
        u = uuid.uuid4().hex
        try:
            set_user_setting(uid, key, u)
        except Exception:
            set_setting(key, u)
    return u


def _find_owner_by_uuid(uuid_param, app_id="stremio"):
    """Public kanca (manifest/subtitles) icin uuid -> owner user_id. Bulunamazsa 0."""
    if not uuid_param:
        return 0
    key = _uuid_setting_key(app_id)
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT user_id FROM user_settings WHERE key=? AND value=?", (key, uuid_param)
            ).fetchone()
        except Exception:
            row = None
        conn.close()
        if row:
            return int(row["user_id"])
    except Exception:
        pass
    # Geriye donuk uyumluluk: global settings'teki admin uuid'si.
    try:
        if uuid_param == get_setting(key):
            return 1
    except Exception:
        pass
    return 0


def _check_uuid(uuid_param, app_id="stremio"):
    if not uuid_param:
        return False
    if _find_owner_by_uuid(uuid_param, app_id):
        return True
    return False


def _lan_base_url():
    """Nextep'in ev agindaki adresi (kurulum URL'si icin fallback)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        finally:
            s.close()
        return f"http://{ip}:8050"
    except Exception:
        return "http://192.168.2.11:8050"


def _base_url():
    """Public taban adres (tp_base_url) varsa onu, yoksa LAN IP'yi dondurur."""
    try:
        custom = (get_setting("tp_base_url") or "").strip().rstrip("/")
        if custom:
            return custom
    except Exception:
        pass
    return _lan_base_url()


def _cors(resp):
    """Stremio addon protokolunun zorunlu CORS basligi."""
    try:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    except Exception:
        pass
    return resp


def _public_base():
    """Public (https) taban adres. 1.87: LAN'a DUSMEZ — tanimli degilse "" doner.

    (URL) cerceveleri yalniz bu adresten uretilir; boylece "Kurulum Baglantisi (URL)"
    kutusuna ASLA LAN adresi yazilmaz (LAN icin ayri cerceve var: _lan_install_url).
    """
    try:
        return (get_setting("tp_base_url") or "").strip().rstrip("/")
    except Exception:
        return ""


def _install_url(app_id, u):
    base = _public_base()
    if not base:
        # 1.87: public adres yok -> (URL) cercevesi "Public adres tanimli degil" gosterir.
        return ""
    if app_id == "calendar":
        return f"{base}/calendar/{u}/nextep.ics"
    if app_id in WEBHOOK_APPS:
        return f"{base}/webhook/{app_id}/{u}"
    return f"{base}/{app_id}/{u}/manifest.json"


def _lan_setting_raw():
    """lan_base_url KAYITLI mi? Kayitliysa degeri (bos olabilir), kayit yoksa None. 1.87.

    Onemli: "kayit yok" (None) ile "kullanici bosaltmis" ("") FARKLI ele alinir —
    kayit yoksa otomatik tespit kullanilir, kullanici bosaltmissa LAN kapali sayilir
    ve "Sunucuya Kur" ile sunucu kurulumu yapilabilir.
    """
    try:
        conn = get_db()
        row = conn.execute("SELECT value FROM settings WHERE key='lan_base_url'").fetchone()
        conn.close()
        if row is None:
            return None
        return (row[0] or "").strip().rstrip("/")
    except Exception:
        return None


def _lan_base():
    """Gecerli LAN taban adresi. Kayit yoksa otomatik tespit; kayit bos ise "" (LAN kapali)."""
    r = _lan_setting_raw()
    if r is None:
        return _lan_base_url()
    return r


def _lan_install_url(app_id, u):
    """LAN kurulum linki (webhook uclari + takvim feed'i). 1.87.

    LAN linki yalnizca AYNI AG icindeki istemciler icin gecerlidir; Stremio'ya
    verilmez (Stremio HTTPS zorunlu kilar). LAN kapaliysa bos doner.
    """
    base = _lan_base()
    if not base:
        return ""
    if app_id == "calendar":
        return f"{base}/calendar/{u}/nextep.ics"
    return f"{base}/webhook/{app_id}/{u}"


# ---------------------------------------------------------------------------
# Faz 32b: baglanti dogrulama damgalari (tam otomatik, kullanici butonu yok)
# ---------------------------------------------------------------------------

_MANIFEST_STAMP_TTL = 3600  # manifest damgasi en fazla saatte bir tazelenir


def _stamp_manifest_ts(owner_id):
    """Eklenti listesi manifest'i cekti = kurulu kaniti. Throttle'li yazar."""
    try:
        uid = int(owner_id or 0)
    except (TypeError, ValueError):
        return
    if uid <= 0:
        return
    try:
        import time as _t
        from db import get_user_setting as _gus, set_user_setting as _sus
        prev = _gus(uid, "tp_stremio_manifest_ts")
        now = int(_t.time())
        if prev:
            try:
                if now - int(float(prev)) < _MANIFEST_STAMP_TTL:
                    return
            except (TypeError, ValueError):
                pass
        _sus(uid, "tp_stremio_manifest_ts", str(now))
    except Exception:
        pass


def _stamp_verified_ts(owner_id):
    """Sinyal gercekten watched=1 yazdi = dogrulanmis baglanti kaniti."""
    try:
        uid = int(owner_id or 0)
    except (TypeError, ValueError):
        return
    if uid <= 0:
        return
    try:
        import time as _t
        from db import set_user_setting as _sus
        _sus(uid, "tp_stremio_verified_ts", str(int(_t.time())))
    except Exception:
        pass


def _tunnel_ok():
    """Ters tunel servisi ayakta mi?

    Birim KURULU DEGILSE False doner (kurulmamis = saglikli degil). Boylece
    'Stremio bagli gorunuyor ama tunnel yok' yanilgisi olmaz. Komut/izin
    hatasinda fail-soft (True) davranisi korunur."""
    try:
        import subprocess as _sp
        p = _sp.run(
            ["systemctl", "is-active", "nextep-tunnel"],
            capture_output=True, text=True, timeout=8,
        )
        out = ((p.stdout or "") + (p.stderr or "")).strip().lower()
        if "could not be found" in out or "not found" in out or "no such" in out \
                or "inactive" in out or "failed" in out:
            return False
        return p.returncode == 0 and out.startswith("active")
    except Exception:
        return True


def _tunnel_installed():
    """nextep-tunnel unit dosyasi Pi'de var mi? (kurulum gostergesi)"""
    try:
        import os as _os
        return _os.path.exists("/etc/systemd/system/nextep-tunnel.service")
    except Exception:
        return False


# 1.87: VPS kurulum profilleri -> kart durumu ("Kurulu/Kur/Onar").
# Paylasimli profil: plex/jellyfin/emby ucu de ayni "webhook" yolunu kullanir.
_PROFILE_OF_APP = {"stremio": "stremio", "calendar": "calendar",
                   "plex": "webhook", "jellyfin": "webhook", "emby": "webhook"}
_VPS_MEMO = {"ts": 0.0, "tunnel": None, "routes": None}


def _vps_state():
    """(tunnel_ok, routes) — 15 sn memo (subprocess/DB maliyeti kart basina degil)."""
    import time as _t
    now = _t.time()
    if _VPS_MEMO["tunnel"] is not None and (now - float(_VPS_MEMO["ts"] or 0)) < 15:
        return _VPS_MEMO["tunnel"], _VPS_MEMO["routes"]
    try:
        tun = _tunnel_ok()
    except Exception:
        tun = True
    routes = {}
    try:
        import json as _json
        routes = _json.loads(get_setting("vps_routes") or "{}") or {}
        if not isinstance(routes, dict):
            routes = {}
    except Exception:
        routes = {}
    _VPS_MEMO["ts"] = now
    _VPS_MEMO["tunnel"] = tun
    _VPS_MEMO["routes"] = routes
    return tun, routes


def _vps_card_state(aid):
    """Kart icin profil/rota/tunel durumu (profil yoksa bos)."""
    prof = _PROFILE_OF_APP.get(str(aid or "").lower())
    if not prof:
        return {}
    try:
        tun, routes = _vps_state()
    except Exception:
        tun, routes = True, {}
    return {
        "vpsProfile": prof,
        "vpsRouteOk": bool((routes or {}).get(prof)),
        "vpsTunnelOk": bool(tun),
    }


def _last_watch_detail(owner_id, source=None):
    """Son sinyalin gorunur detayi {kind,title,season,episode} veya None.
    Baslik, sinyal sahibinin kendi takip satirindan cozulur. 1.87: source ile filtre."""
    try:
        uid = int(owner_id or 0)
    except (TypeError, ValueError):
        return None
    if uid <= 0:
        return None
    try:
        row = last_signal_row(user_id=uid, source=source)
    except Exception:
        row = None
    if not row:
        return None
    kind = (row.get("kind") or "").strip()
    title = ""
    try:
        conn = get_db()
        if kind in ("tv", "movie") and row.get("tmdb_id") is not None:
            mt = "tv" if kind == "tv" else "movie"
            r = conn.execute(
                "SELECT title FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
                (uid, row.get("tmdb_id"), mt),
            ).fetchone()
            title = (r["title"] if r else "") or ""
        elif kind == "anime" and row.get("anilist_id") is not None:
            r = conn.execute(
                "SELECT title FROM anime WHERE user_id=? AND anilist_id=?",
                (uid, row.get("anilist_id")),
            ).fetchone()
            title = (r["title"] if r else "") or ""
        conn.close()
    except Exception:
        title = ""
    try:
        season = row.get("season")
        season = int(season) if season is not None else None
    except (TypeError, ValueError):
        season = None
    try:
        episode = row.get("episode")
        episode = int(episode) if episode is not None else None
    except (TypeError, ValueError):
        episode = None
    return {"kind": kind, "title": title, "season": season, "episode": episode}


@stremio_bp.route("/stremio/install-info.json")
def stremio_install_info():
    """Landing sayfasi icin guncel kurulum bilgileri (UUID yenilense de dogru)."""
    print("[stremio] install-info hit", flush=True)
    u = _get_uuid("stremio")
    murl = _install_url("stremio", u)
    resp = jsonify({
        "manifestUrl": murl,
        "stremioLink": murl.replace("https://", "stremio://").replace("http://", "stremio://"),
    })
    return _cors(resp)


# ---------------------------------------------------------------------------
# Manifest + sinyal kancasi
# ---------------------------------------------------------------------------

@stremio_bp.route("/stremio/<uuid_param>/manifest.json")
def stremio_manifest(uuid_param):
    ok = _check_uuid(uuid_param)
    print(f"[stremio] manifest uuid={str(uuid_param)[:8]} ok={ok}", flush=True)
    if not ok:
        return jsonify({"error": "not found"}), 404
    try:
        _stamp_manifest_ts(_find_owner_by_uuid(uuid_param))
    except Exception:
        pass
    payload = {
        "id": "nextep-tracker",
        "name": "NextEp Watch Sync",
        "version": "1.0.0",
        "description": "Syncs what you play in Stremio to NextEp as watched",
        "logo": f"{_base_url()}/stremio/logo.png",
        "resources": ["subtitles"],
        "types": ["movie", "series"],
        "idPrefixes": ["tt", "tmdb:", "tvdb:", "trakt:", "kitsu:"],
        "catalogs": [],
    }
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store"
    return _cors(resp)


@stremio_bp.route("/stremio/logo.png")
def stremio_logo():
    """Eklenti logosu (manifestle ayni kaynak; Caddy /stremio/*'i geçirir)."""
    from flask import send_file
    import os
    from config import STATIC_DIR
    resp = send_file(os.path.join(STATIC_DIR, "images", "stremio_nextep_plugin.png"), mimetype="image/png")
    resp.headers["Cache-Control"] = "no-store"
    return _cors(resp)


@stremio_bp.route("/stremio/<uuid_param>/subtitles/<stype>/<media_id>.json")
@stremio_bp.route("/stremio/<uuid_param>/subtitles/<stype>/<media_id>/<extra>.json")
def stremio_subtitles(uuid_param, stype, media_id, extra=None):
    tag = str(uuid_param)[:8]
    owner_id = _find_owner_by_uuid(uuid_param)
    if not owner_id:
        print(f"[stremio] subtitles uuid={tag} 404 type={stype} id={str(media_id)[:60]}", flush=True)
        return jsonify({"error": "not found"}), 404
    parsed = parse_stremio_id(media_id)
    if parsed:
        route_norm = "movie" if stype == "movie" else "tv"
        if route_norm != parsed["route_norm"]:
            print(f"[stremio] subtitles uuid={tag} SKIP type-mismatch route={stype} id={media_id}", flush=True)
        else:
            print(f"[stremio] subtitles uuid={tag} QUEUED uid={owner_id} type={stype} id={media_id}", flush=True)
            threading.Thread(target=process_signal, args=(parsed, owner_id,), daemon=True).start()
    else:
        print(f"[stremio] subtitles uuid={tag} SKIP parse-fail type={stype} id={str(media_id)[:60]}", flush=True)
    resp = jsonify({"subtitles": []})
    resp.headers["Cache-Control"] = "no-store"
    return _cors(resp)


def parse_stremio_id(media_id):
    """Stremio medya ID'sini cozer:
    tt:id (film), tt:id:S:E (dizi), tmdb/tvdb/trakt/kitsu icin benzer desenler.
    Hatali -> None."""
    try:
        parts = (media_id or "").strip().split(":")
        prefix = parts[0]
        rest = parts[1:]
        if re.match(r"^tt\d+$", prefix):
            if len(rest) == 0:
                return {"route_norm": "movie", "provider": "imdb", "ident": prefix, "season": None, "episode": None}
            if len(rest) == 2:
                try:
                    s, e = int(rest[0]), int(rest[1])
                except (TypeError, ValueError):
                    return None
                if s < 1 or e < 1:
                    return None
                return {"route_norm": "tv", "provider": "imdb", "ident": prefix, "season": s, "episode": e}
            return None
        if prefix in ("tmdb", "tvdb", "trakt", "kitsu"):
            if not rest or not rest[0].isdigit():
                return None
            ident = int(rest[0])
            if prefix == "tvdb":
                if len(rest) != 3:
                    return None
                try:
                    s, e = int(rest[1]), int(rest[2])
                except (TypeError, ValueError):
                    return None
                if s < 1 or e < 1:
                    return None
                return {"route_norm": "tv", "provider": prefix, "ident": ident, "season": s, "episode": e}
            if len(rest) == 1:
                return {"route_norm": "movie", "provider": prefix, "ident": ident, "season": None, "episode": None}
            if prefix == "kitsu" and len(rest) == 2:
                try:
                    e = int(rest[1])
                except (TypeError, ValueError):
                    return None
                if e < 1:
                    return None
                return {"route_norm": "tv", "provider": prefix, "ident": ident, "season": 1, "episode": e}
            if len(rest) == 3:
                try:
                    s, e = int(rest[1]), int(rest[2])
                except (TypeError, ValueError):
                    return None
                if s < 1 or e < 1:
                    return None
                return {"route_norm": "tv", "provider": prefix, "ident": ident, "season": s, "episode": e}
            return None
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Hibrit selale (D1): anime/dizi ayrimi + cozumleme + yazim
# ---------------------------------------------------------------------------

def process_signal(parsed, owner_id=0, source="stremio", direct=False):
    """Sinyali cozumleyip ilgili kola yazar. source (1.86): kaynak etiketi.

    direct (1.87): kullanici uygulamada "izlendi" olarak ISARETLEDI (Jellyfin
    poster butonu: UserDataSaved + TogglePlayed). Bu durumda ask sorulmaz ve
    E-1 kilidi uygulanmaz: manuel isaretleme kesin onaydir, dogrudan yazilir.
    """
    conn = None
    try:
        uid = int(owner_id or 0)
        if uid <= 0:
            return
        route_norm = parsed["route_norm"]
        provider = parsed["provider"]
        ident = parsed["ident"]
        season = parsed.get("season")
        episode = parsed.get("episode")
        conn = get_db()

        # 1) kitsu: direkt anime kolu
        if provider == "kitsu":
            anilist_id = _resolve_anime(conn, "kitsu", ident)
            if not anilist_id:
                print(f"[stremio] kitsu {ident} -> anilist cozulemedi, atlandi", flush=True)
                return
            _anime_branch(conn, anilist_id, season, episode, owner_id=uid, source=source, direct=direct)
            return

        # trakt: anime disinda cozum yok -> anime denenir, yoksa atla
        if provider == "trakt":
            anilist_id = _resolve_anime(conn, "trakt", ident)
            if anilist_id:
                _anime_branch(conn, anilist_id, season, episode, owner_id=uid, source=source, direct=direct)
            else:
                print(f"[stremio] trakt {ident} -> esleme yok, atlandi", flush=True)
            return

        # tmdb/imdb/tvdb -> tmdb_id cozumle
        tmdb_id, tmdb_type = _resolve_tmdb(provider, ident, route_norm)
        if not tmdb_id:
            print(f"[stremio] {provider} {ident} -> tmdb cozulemedi, atlandi", flush=True)
            return

        # 2) anime tablosu / harici esleme var mi?
        anilist_id = load_anime_map(conn, provider, ident)
        if anilist_id:
            _anime_branch(conn, anilist_id, season, episode, tmdb_id=tmdb_id, owner_id=uid, source=source, direct=direct)
            return

        # 3) TMDB sezgisi (Animation + JP) -> anime
        if _is_anime_like(tmdb_type, tmdb_id):
            resolved = _resolve_anime(conn, "tmdb", tmdb_id)
            if resolved:
                _anime_branch(conn, resolved, season, episode, tmdb_id=tmdb_id, owner_id=uid, source=source, direct=direct)
            else:
                print(f"[stremio] anime aday tmdb={tmdb_id} -> anilist eslemesi yok, atlandi", flush=True)
            return

        # 4) varsayilan dizi/film
        if tmdb_type == "tv":
            _tv_branch(conn, tmdb_id, season, episode, owner_id=uid, source=source, direct=direct)
        else:
            _movie_branch(conn, tmdb_id, owner_id=uid, source=source, direct=direct)
    except Exception as e:
        print(f"[stremio] process_signal hata: {e}", flush=True)
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass


def _resolve_anime(conn, source, external_id):
    """anime_id_map onbellegi + Kitsu uzerinden anilist_id (None = cozulemedi)."""
    anilist_id = load_anime_map(conn, source, external_id)
    if anilist_id:
        return anilist_id
    anilist_id = resolve_external_anilist(source, external_id)
    if anilist_id:
        store_anime_map(conn, source, external_id, anilist_id)
        conn.commit()
        return anilist_id
    return None


def _resolve_tmdb(provider, ident, route_norm):
    """tmdb/imdb/tvdb -> (tmdb_id, media_type). Tip uyusmazliginda (None, None)."""
    if provider == "tmdb":
        return ident, ("tv" if route_norm == "tv" else "movie")
    if provider in ("imdb", "tvdb"):
        source = "imdb_id" if provider == "imdb" else "tvdb_id"
        data = _tmdb_find(ident, source)
        if not data:
            return None, None
        want = "tv" if route_norm == "tv" else "movie"
        key = "tv_results" if want == "tv" else "movie_results"
        results = data.get(key) or []
        if not results:
            other = data.get("movie_results") if want == "tv" else data.get("tv_results")
            if other:
                return None, None
            return None, None
        item = results[0]
        return item.get("id"), want
    return None, None


def _tmdb_find(external_id, source):
    api_key = get_setting("tmdb_api_key")
    if not api_key:
        return None
    acquire("tmdb")
    try:
        r = requests.get(
            "https://api.themoviedb.org/3/find/" + str(external_id),
            params={"api_key": api_key, "external_source": source, "language": "en-US"},
            timeout=15,
        )
    except requests.RequestException:
        return None
    record("tmdb")
    if r.status_code == 429:
        handle_429("tmdb", r)
        acquire("tmdb")
        try:
            r = requests.get(
                "https://api.themoviedb.org/3/find/" + str(external_id),
                params={"api_key": api_key, "external_source": source, "language": "en-US"},
                timeout=15,
            )
        except requests.RequestException:
            return None
        record("tmdb")
    if r.status_code != 200:
        return None
    return r.json()


def _tmdb_detail(media_type, tmdb_id):
    return tmdb_request(f"/{media_type}/{tmdb_id}")


def _is_anime_like(media_type, tmdb_id):
    """TMDB sezgisi: turlerde Animation (16) + koken JP -> anime."""
    try:
        detail = _tmdb_detail(media_type, tmdb_id)
        if not detail:
            return False
        gids = {(g or {}).get("id") for g in (detail.get("genres") or [])}
        oc = detail.get("origin_country") or []
        return (16 in gids) and ("JP" in oc)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Yazim kollari
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Sirali kilit (Faz 29e): sinyal de takvim kilidine uyar
# ---------------------------------------------------------------------------

def _prev_episode_status(conn, follow_id, season, episode):
    """(S,E) icin kilit + mesaj bilgisi -> (kilit_gecer, onceki_(sezon,bolum)|None).

    Kilit kurali `_prev_watched_tv` ile aynidir:
      * E>1  -> (S, E-1)
      * E==1 -> (S-1, o sezonun son bolumu)
    Onceki satir yoksa fail-open True (senkron boslugunda engelleme yok) ve
    onceki bilgi None doner (mesajda kullanilamaz). 1.87: manuel isaretlemede
    kilit basarisizsa ask sorusunda "X. bolumu izlemeden Y. bolumu..." demek icin
    onceki (S,E) cifti gerekir.
    """
    try:
        if episode is None or season is None:
            return True, None
        if episode > 1:
            prev = (season, episode - 1)
        elif season <= 1:
            return True, None  # S1E1 her zaman gecer
        else:
            row = conn.execute(
                "SELECT MAX(episode) m FROM episodes WHERE follow_id=? AND season=?",
                (follow_id, season - 1),
            ).fetchone()
            if not row or row["m"] is None:
                print(f"[stremio] kilit fail-open: onceki sezon bos S{season-1}", flush=True)
                return True, None
            prev = (season - 1, row["m"])
        row = conn.execute(
            "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
            (follow_id, prev[0], prev[1]),
        ).fetchone()
        if row is None:
            print(f"[stremio] kilit fail-open: onceki satir yok S{prev[0]}E{prev[1]}", flush=True)
            return True, None
        return (row["watched"] == 1), prev
    except Exception as e:
        print(f"[stremio] kilit kontrol hata, fail-open: {e}", flush=True)
        return True, None


def _prev_watched_tv(conn, follow_id, season, episode):
    """(S,E) yazilmadan once onceki bolum izlenmis mi? True = kilit gecer."""
    ok, _prev = _prev_episode_status(conn, follow_id, season, episode)
    return ok


def _prev_episode_status_anime(conn, anime_db_id, episode):
    """Anime mutlak bolum kilidi -> (kilit_gecer, onceki_bolum|None). E1 her zaman gecer."""
    try:
        if episode is None or episode <= 1:
            return True, None
        prev_ep = episode - 1
        row = conn.execute(
            "SELECT watched FROM anime_episodes WHERE anime_id=? AND episode=?",
            (anime_db_id, prev_ep),
        ).fetchone()
        if row is None:
            print(f"[stremio] kilit fail-open anime: onceki satir yok ep={prev_ep}", flush=True)
            return True, None
        return (row["watched"] == 1), prev_ep
    except Exception as e:
        print(f"[stremio] kilit kontrol hata, fail-open: {e}", flush=True)
        return True, None


def _prev_watched_anime(conn, anime_db_id, episode):
    """Anime mutlak bolum kilidi: E-1 izlenmis mi? E1 her zaman gecer."""
    ok, _prev = _prev_episode_status_anime(conn, anime_db_id, episode)
    return ok


def _ask_message(kind, title, season, episode, uid, is_doc=False, lock_prev=None):
    """Izlendi-sor bildirim mesaji (kullanicinin kendi diliminde tarih-saat).

    NOT: yapim ismi mesaja YAZILMAZ — arayuzde ayri satirda (.notif-title, tip
    rengiyle) gosterilir. `title` parametresi geriye donuk uyumluluk icin durur.

    lock_prev (1.87): manuel isaretlemede E-1 kilidi basarisizsa (S,E) cifti
    verilir -> "3. bölümü izlemeden 4. bölümü izlendi işaretlemek istiyor musunuz?"
    (sezon gecisinde "2. sezon 8. bölümü izlemeden 3. sezon 1. bölümü ...").
    Anime mutlak numaralandigi icin (None, ep) verilir -> kisa bicim kullanilir.
    """
    import datetime as _dt
    try:
        from scheduler import _user_tz
        now = _dt.datetime.now(_user_tz(uid))
    except Exception:
        now = _dt.datetime.now()
    # Tarih/saat bicimi istemcide secili tz'nin ulke yereline gore kurulur
    # (gun adi + tarih sirasi + 12/24 saat); burada yalnizca yedek metin tutulur.
    stamp = now.strftime("%d.%m.%Y - %H:%M")
    if lock_prev and episode is not None:
        # Onceki bolum izlenmeden bu bolum isaretlendi (manuel isaretleme, 1.87)
        try:
            ps, pe = lock_prev
        except (TypeError, ValueError):
            ps, pe = None, None
        if pe is not None and (ps is None or (season is not None and int(ps) == int(season))):
            body = f"{int(pe)}. bölümü izlemeden {int(episode)}. bölümü izlendi işaretlemek istiyor musunuz?"
        elif pe is not None and season is not None:
            body = (f"{int(ps)}. sezon {int(pe)}. bölümü izlemeden "
                    f"{int(season)}. sezon {int(episode)}. bölümü izlendi işaretlemek istiyor musunuz?")
        elif kind == "anime":
            body = "animeyi izlediniz mi?"
        else:
            body = "diziyi izlediniz mi?"
    elif kind == "anime":
        if episode is not None:
            body = f"{int(episode)}. bölümü izlediniz mi?"
        else:
            body = "animeyi izlediniz mi?"
    elif kind == "movie":
        body = "belgeseli izlediniz mi?" if is_doc else "filmi izlediniz mi?"
    else:  # tv
        if season is not None and episode is not None:
            body = f"{int(season)}. Sezon {int(episode)}. Bölümü izlediniz mi?"
        else:
            body = "belgeseli izlediniz mi?" if is_doc else "diziyi izlediniz mi?"
    return f"{stamp}\n{body}"


def _file_exists_web(web):
    """Web yolu (/static/...) diskte gercekten var mi? (kirik yol yazmamak icin)."""
    try:
        if not web:
            return False
        fs = filesystem_path_from_web(web)
        return bool(fs) and os.path.exists(fs)
    except Exception:
        return False


def _ask_poster_fields(conn, uid, kind, tmdb_id, anilist_id):
    """Ask icin (poster_local, remote_poster_url) -> kartta poster bos kalmasin (1.87).

    poster_local yalnizca DOSYA VARSA dondurulur (kirik yol DB'ye yazilmasin).
    remote_poster_url (TMDB w500 / anime cover) kucuk resim uretilemezse indirme
    yedegi olarak `create_notification`e verilir.
    """
    poster_local = None
    remote = None
    try:
        if kind == "anime":
            row = conn.execute(
                "SELECT poster_local, cover_url FROM anime WHERE user_id=? AND anilist_id=?",
                (uid, anilist_id),
            ).fetchone()
            if row:
                p = row["poster_local"] if "poster_local" in row.keys() else None
                if _file_exists_web(p):
                    poster_local = p
                remote = (row["cover_url"] if "cover_url" in row.keys() else None) or None
        else:
            row = conn.execute(
                "SELECT poster_local, poster_path FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
                (uid, tmdb_id, kind),
            ).fetchone()
            if row:
                p = row["poster_local"] if "poster_local" in row.keys() else None
                if _file_exists_web(p):
                    poster_local = p
                pp = row["poster_path"] if "poster_path" in row.keys() else None
                if pp:
                    remote = TMDB_IMAGE_BASE + pp
    except Exception as e:
        print(f"[stremio] ask poster alanlari hata: {e}", flush=True)
    return poster_local, remote


def _create_watched_ask(uid, kind, title, tmdb_id=None, anilist_id=None, season=None, episode=None, is_doc=False, source=None, lock_prev=None):
    """ask_before_watched ON iken watched_ask bildirimi olusturur (poster/thumbs dahil).

    source (1.86): kaynak etiketi (stremio/plex/jellyfin/emby/other) — pencerede
    damga satirinda gosterilir. Bekleyen ask varsa kaynagi son gelenle tazelenir.

    lock_prev (1.87): manuel isaretlemede E-1 kilidi basarisizsa mesaj varyanti
    ("3. bölümü izlemeden 4. bölümü izlendi işaretlemek istiyor musunuz?").

    1.87 kural:
      * Bekleyen ask varsa yeni ask uretilmez (ayni oynatmanin mukerrer sinyali
        tek ask olur), kaynak tazelenir.
      * "Evet"/"Hayir" karari (`ask_decisions`) ask uretimini ENGELLEMEZ: evet ise
        izleme kaydi zaten yazilmistir (dal erken cikar), hayir ise yapim tekrar
        izlendiginde yeniden sorulur. Bu yuzden `create_notification`e
        skip_dedupe=True verilir (baslik+tarih dedupe'i ret sonrasi ayni gun
        tekrar izlemeyi bloklardi).
      * Karar deposu yalniz kalici bilgidir (ask listesi temizlense de kalir).
    """
    # Tarihten bagimsiz dedupe: ayni oge icin bekleyen (resolved=0) veya onaylanmis
    # (resolved=1) ask varsa tekrar uretme. Yalniz 'Hayir' (resolved=2) sonrasi
    # yeniden sorulabilir. Ayni oturumda gelen mükerrer sinyaller boylece engellenir.
    try:
        conn = get_db()
        try:
            dup = conn.execute(
                # CAST (TEXT) sart: IFNULL() fonksiyon sonucu kolon affinity'sini kaybeder,
                # bu yuzden metin "95396" ile int 95396 eslesmez (1.86'da webhook testinde yakalandi).
                "SELECT id, source FROM notifications WHERE type='watched_ask' AND user_id=? AND media_type=? "
                "AND IFNULL(CAST(tmdb_id AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(anilist_id AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(season AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(episode AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND COALESCE(resolved,0)<>2 LIMIT 1",
                (uid, kind, tmdb_id, anilist_id, season, episode),
            ).fetchone()
            if dup and source and (dup["source"] or None) != source:
                # Ayni bolum icin baska kaynaktan sinyal geldi -> son kaynak kazanir.
                conn.execute("UPDATE notifications SET source=? WHERE id=?", (source, dup["id"]))
                conn.commit()
        finally:
            conn.close()
        if dup:
            # Karar deposunu senkron tut (ask listesi temizlenmedikce "bekliyor").
            record_decision(uid, kind, "pending", tmdb_id=tmdb_id, anilist_id=anilist_id,
                            season=season, episode=episode, source=source or dup["source"])
            return dup["id"]
    except Exception as e:
        print(f"[stremio] ask dedupe hata: {e}", flush=True)
    try:
        import datetime as _dt
        from notification import create_notification
        kind_for_thumb = "anime" if kind == "anime" else kind
        ident = anilist_id if kind_for_thumb == "anime" else tmdb_id
        # Poster alanlari (1.87): ask kartinda kucuk resim/poster bos kalmasin.
        poster_local = None
        remote_poster_url = None
        try:
            conn_p = get_db()
            try:
                poster_local, remote_poster_url = _ask_poster_fields(conn_p, uid, kind, tmdb_id, anilist_id)
            finally:
                conn_p.close()
        except Exception as e:
            print(f"[stremio] ask poster okuma hata: {e}", flush=True)
        nid = create_notification(
            title=title or "",
            message=_ask_message(kind, title, season, episode, uid, is_doc=is_doc, lock_prev=lock_prev),
            type_name="watched_ask",
            media_type=kind_for_thumb,
            tmdb_id=tmdb_id,
            anilist_id=anilist_id,
            season=season,
            episode=episode,
            poster_local=poster_local,
            remote_poster_url=remote_poster_url,
            kind_for_thumb=kind_for_thumb,
            ident_for_thumb=ident,
            notified_date=_dt.datetime.now().strftime("%Y-%m-%d"),
            user_id=uid,
            source=source,
            skip_dedupe=True,
        )
        if nid:
            record_decision(uid, kind, "pending", tmdb_id=tmdb_id, anilist_id=anilist_id,
                            season=season, episode=episode, source=source)
        return nid
    except Exception as e:
        print(f"[stremio] ask olusturma hata: {e}", flush=True)
        return None


def _ask_enabled(uid, source=None):
    """1.88: kaynak bazli "izlendi bilgisi sor" ayari.

    Kaynaga ozel anahtar (ask_before_watched_plex|jellyfin|emby) DOLU ise o gecerlidir;
    bos ise genel ask_before_watched'a dusulur (bugunku davranis korunur).
    """
    try:
        u = int(uid or 0)
    except (TypeError, ValueError):
        return False
    if source:
        try:
            v = (get_user_setting(u, "ask_before_watched_" + str(source)) or "").strip()
            if v != "":
                return v == "1"
        except Exception:
            pass
    try:
        return get_user_setting(u, "ask_before_watched") == "1"
    except Exception:
        return False


def _refresh_ep_source(conn, follow_id, season, episode, source):
    """Zaten izlenmis bolumde kaynak tazeleme (1.86): bos kaynak ezmez, son DOLU kaynak kazanir."""
    if not source:
        return
    try:
        conn.execute(
            "UPDATE episodes SET source=? WHERE follow_id=? AND season=? AND episode=? "
            "AND watched=1 AND IFNULL(source,'')<>?",
            (source, follow_id, season, episode, source),
        )
        conn.commit()
    except Exception as e:
        print(f"[stremio] kaynak tazeleme hatasi: {e}", flush=True)


def _refresh_anime_source(conn, anime_db_id, episode, source):
    """Anime bolumunde kaynak tazeleme (bos kaynak ezmez, son dolu kaynak kazanir)."""
    if not source or episode is None:
        return
    try:
        conn.execute(
            "UPDATE anime_episodes SET source=? WHERE anime_id=? AND episode=? "
            "AND watched=1 AND IFNULL(source,'')<>?",
            (source, anime_db_id, episode, source),
        )
        conn.commit()
    except Exception as e:
        print(f"[stremio] anime kaynak tazeleme hatasi: {e}", flush=True)


def _refresh_movie_source(conn, follow_id, source):
    """Izlenmis filmde kaynak tazeleme (bos kaynak ezmez)."""
    if not source:
        return
    try:
        conn.execute(
            "UPDATE followed SET watched_source=? WHERE id=? AND watched=1 AND IFNULL(watched_source,'')<>?",
            (source, follow_id, source),
        )
        conn.commit()
    except Exception as e:
        print(f"[stremio] film kaynak tazeleme hatasi: {e}", flush=True)


def _confirm_watched(uid, kind, tmdb_id=None, anilist_id=None, season=None, episode=None, source=None):
    """Dogrudan yazimda (Jellyfin manuel "izlendi" isaretlemesi, direct=True)
    bekleyen ask'i kapatir + karar deposunu 'watched' yapar. Fail-soft.

    Manuel isaretleme kullanicinin kendi onayidir; ask sormaya gerek yok, ama
    o oge icin bekleyen ask varsa listede kalmasin diye kapatilir.
    """
    try:
        conn = get_db()
        try:
            conn.execute(
                "UPDATE notifications SET resolved=1, is_read=1 "
                "WHERE type='watched_ask' AND user_id=? AND media_type=? "
                "AND IFNULL(CAST(tmdb_id AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(anilist_id AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(season AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND IFNULL(CAST(episode AS TEXT),'-1')=IFNULL(CAST(? AS TEXT),'-1') "
                "AND COALESCE(resolved,0)=0",
                (uid, kind, tmdb_id, anilist_id, season, episode),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f"[stremio] bekleyen ask kapatma hatasi: {e}", flush=True)
    try:
        record_decision(uid, kind, "watched", tmdb_id=tmdb_id, anilist_id=anilist_id,
                        season=season, episode=episode, source=source)
    except Exception as e:
        print(f"[stremio] karar (watched) yazma hatasi: {e}", flush=True)


def unwatch_from_source(kind, tmdb_id, season=None, episode=None, owner_id=0, source=None):
    """Korumali geri alma (Jellyfin/Emby "izlendi" isaretinin kaldirilmasi).

    Kural: kayit yoksa veya kayit BASKA kaynaktan yazilmissa DOKUNULMAZ
    (ornek: Stremio'nun yazdigi bolum, Jellyfin'de isaret kaldirilinca silinmesin).
    Yalnizca `source` ile ayni kaynaktan yazilmis movie/tv kaydi geri alinir;
    ayrica sinyal tamponu satiri silinir (clear-apply geri yazmasin) ve ask
    karari sifirlanir.

    Film: `in_watched=0` de yazilir -> kart "Izlenenler" listesinden cikip
    "Takip" listesine doner (mark ile tam simetri: mark in_watched=1 yazar).
    Dizi bolumu: dizi karti listede KALIR (yalniz ilgili bolumun watched'i sifirlanir).

    Donus: "ok" | "no-record" | "source-mismatch" | "bad-media" | "error"
    """
    uid = int(owner_id or 0)
    src = (source or "").strip().lower()
    try:
        tmdb = int(tmdb_id)
    except (TypeError, ValueError):
        return "bad-media"
    if not uid or tmdb <= 0 or src not in ("jellyfin", "emby"):
        return "bad-media"
    if kind not in ("movie", "tv"):
        return "bad-media"
    if kind == "tv" and (season is None or episode is None):
        return "bad-media"
    try:
        conn = get_db()
        try:
            if kind == "movie":
                row = conn.execute(
                    "SELECT id, watched, watched_source FROM followed "
                    "WHERE user_id=? AND tmdb_id=? AND media_type='movie'", (uid, tmdb)
                ).fetchone()
                if not row or int(row["watched"] or 0) != 1:
                    return "no-record"
                if str(row["watched_source"] or "").strip().lower() != src:
                    return "source-mismatch"
                conn.execute(
                    "UPDATE followed SET watched=0, in_watched=0, watched_at=NULL, watched_source=NULL WHERE id=?",
                    (row["id"],),
                )
            else:
                frow = conn.execute(
                    "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'", (uid, tmdb)
                ).fetchone()
                if not frow:
                    return "no-record"
                row = conn.execute(
                    "SELECT watched, source FROM episodes WHERE follow_id=? AND season=? AND episode=?",
                    (frow["id"], season, episode),
                ).fetchone()
                if not row or int(row["watched"] or 0) != 1:
                    return "no-record"
                if str(row["source"] or "").strip().lower() != src:
                    return "source-mismatch"
                conn.execute(
                    "UPDATE episodes SET watched=0, watched_at=NULL, source=NULL "
                    "WHERE follow_id=? AND season=? AND episode=?",
                    (frow["id"], season, episode),
                )
            conn.commit()
        finally:
            conn.close()
        # sinyal tamponu: clear-apply'un geri yazmamasi icin satir silinir
        try:
            delete_signals([_signal_dedupe(kind, tmdb, None, season, episode, uid)])
        except Exception:
            pass
        try:
            reset_decision(uid, kind, tmdb_id=tmdb, season=season, episode=episode)
        except Exception:
            pass
        print(f"[stremio] UNWATCH ({src}): kind={kind} tmdb={tmdb} s{season} e{episode}", flush=True)
        return "ok"
    except Exception as e:
        print(f"[stremio] unwatch hatasi: {e}", flush=True)
        return "error"


def _anime_branch(conn, anilist_id, season, episode, tmdb_id=None, owner_id=0, source="stremio", direct=False):
    uid = int(owner_id or 0)
    arow = conn.execute("SELECT id, in_watched FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    if arow and (arow["in_watched"] == 1):
        _refresh_anime_source(conn, arow["id"], episode, source)
        record_signal("anime", tmdb_id, anilist_id, season, episode, user_id=uid, source=source)
        return  # izlenmiste: no-op (tampona kaydedildi)
    if episode is None:
        # anime filmi (E9): follow + (ask kapaliysa/manuel isaretlendiyse) dogrudan Izlenmis
        record_signal("anime", tmdb_id, anilist_id, season, episode, user_id=uid, source=source)
        anime_db_id = _ensure_anime_follow(conn, anilist_id, owner_id=uid)
        if _ask_enabled(uid, source) and not direct:
            if anime_db_id:
                trow = conn.execute("SELECT title FROM anime WHERE id=?", (anime_db_id,)).fetchone()
                _create_watched_ask(uid, "anime", (trow["title"] if trow else ""), tmdb_id=tmdb_id, anilist_id=anilist_id, source=source)
            bump()
            return
        if anime_db_id:
            conn.execute("UPDATE anime SET in_watched=1 WHERE id=?", (anime_db_id,))
            conn.commit()
            _stamp_verified_ts(uid)
            if direct:
                _confirm_watched(uid, "anime", tmdb_id=tmdb_id, anilist_id=anilist_id, source=source)
        bump()
        return
    # mutlak bolum: S1 bolum aynen; S2+ esleme yoksa atla (tamponsuz — dogru uygulanamaz)
    if season is not None and season != 1:
        print(f"[stremio] anime S{season} -> mutlak bolum eslemesi yok, atlandi (anilist {anilist_id})", flush=True)
        return
    anime_db_id = _ensure_anime_follow(conn, anilist_id, owner_id=uid)
    if not anime_db_id:
        return
    cur = conn.execute(
        "SELECT watched FROM anime_episodes WHERE anime_id=? AND episode=?",
        (anime_db_id, episode),
    ).fetchone()
    if cur and cur["watched"] == 1:
        _refresh_anime_source(conn, anime_db_id, episode, source)
        record_signal("anime", tmdb_id, anilist_id, season, episode, user_id=uid, source=source)
        return  # zaten izli: tamponu tazele
    lock_ok, prev_ep = _prev_episode_status_anime(conn, anime_db_id, episode)
    if _ask_enabled(uid, source) and (not direct or not lock_ok):
        trow = conn.execute("SELECT title FROM anime WHERE id=?", (anime_db_id,)).fetchone()
        record_signal("anime", tmdb_id, anilist_id, season, episode, user_id=uid, source=source)
        _create_watched_ask(uid, "anime", (trow["title"] if trow else ""), tmdb_id=tmdb_id, anilist_id=anilist_id,
                            season=season, episode=episode, source=source,
                            lock_prev=((None, prev_ep) if (direct and not lock_ok) else None))
        bump()
        return
    if not lock_ok:
        print(f"[stremio] kilit-disi sinyal atlandi (tamponsuz): anilist={anilist_id} ep={episode}", flush=True)
        return  # yazma yok, tampon yok
    record_signal("anime", tmdb_id, anilist_id, season, episode, user_id=uid, source=source)
    conn.execute(
        "INSERT INTO anime_episodes (anime_id, episode, watched, source) VALUES (?,?,1,?) "
        "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=1, source=excluded.source",
        (anime_db_id, episode, source),
    )
    conn.commit()
    _stamp_verified_ts(uid)
    if direct:
        _confirm_watched(uid, "anime", tmdb_id=tmdb_id, anilist_id=anilist_id, season=season, episode=episode, source=source)
    bump()
    print(f"[stremio] WROTE anime anilist={anilist_id} ep={episode} kaynak={source}", flush=True)


def _tv_branch(conn, tmdb_id, season, episode, owner_id=0, source="stremio", direct=False):
    uid = int(owner_id or 0)
    if season is None or episode is None:
        return  # dizi sinyali S/E'siz gelmemeli (tamponsuz)
    follow = conn.execute(
        "SELECT id, in_watched FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'", (uid, tmdb_id,)
    ).fetchone()
    if follow and follow["in_watched"] == 1 and not direct:
        _refresh_ep_source(conn, follow["id"], season, episode, source)
        record_signal("tv", tmdb_id, None, season, episode, user_id=uid, source=source)
        return  # izlenmiste: no-op (tampona kaydedildi); manuel isaretleme yine yazilir
    follow_id = _ensure_tmdb_follow(conn, "tv", tmdb_id, owner_id=uid)
    if not follow_id:
        return
    cur = conn.execute(
        "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
        (follow_id, season, episode),
    ).fetchone()
    if cur and cur["watched"] == 1:
        _refresh_ep_source(conn, follow_id, season, episode, source)
        record_signal("tv", tmdb_id, None, season, episode, user_id=uid, source=source)
        return  # zaten izli: tamponu tazele
    lock_ok, prev_pair = _prev_episode_status(conn, follow_id, season, episode)
    if _ask_enabled(uid, source) and (not direct or not lock_ok):
        trow = conn.execute("SELECT title, genres FROM followed WHERE id=?", (follow_id,)).fetchone()
        record_signal("tv", tmdb_id, None, season, episode, user_id=uid, source=source)
        _create_watched_ask(uid, "tv", (trow["title"] if trow else ""), tmdb_id=tmdb_id, season=season, episode=episode,
                            is_doc=_is_doc_row(trow) if trow else False, source=source,
                            lock_prev=(prev_pair if (direct and not lock_ok) else None))
        bump()
        return
    if not lock_ok:
        print(f"[stremio] kilit-disi sinyal atlandi (tamponsuz): tmdb={tmdb_id} S{season}E{episode}", flush=True)
        return  # yazma yok, tampon yok
    record_signal("tv", tmdb_id, None, season, episode, user_id=uid, source=source)
    import time as _t
    _now = int(_t.time())
    conn.execute(
        "INSERT INTO episodes (follow_id, season, episode, watched, watched_at, source) VALUES (?,?,?,1,?,?) "
        "ON CONFLICT(follow_id, season, episode) DO UPDATE SET watched=1, watched_at=excluded.watched_at, "
        "source=excluded.source",
        (follow_id, season, episode, _now, source),
    )
    conn.commit()
    _stamp_verified_ts(uid)
    if direct:
        _confirm_watched(uid, "tv", tmdb_id=tmdb_id, season=season, episode=episode, source=source)
    bump()
    print(f"[stremio] WROTE tv tmdb={tmdb_id} S{season}E{episode} kaynak={source}", flush=True)


def _movie_branch(conn, tmdb_id, owner_id=0, source="stremio", direct=False):
    uid = int(owner_id or 0)
    # Faz 32b: once cozumleme — cozulemeyen ID tampona yazilmaz, "Bagli" sisirmez.
    follow = conn.execute(
        "SELECT id, in_watched FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='movie'", (uid, tmdb_id,)
    ).fetchone()
    if follow and follow["in_watched"] == 1 and not direct:
        _refresh_movie_source(conn, follow["id"], source)
        record_signal("movie", tmdb_id, None, None, None, user_id=uid, source=source)
        return  # izlenmiste: no-op (tampona kaydedildi); manuel isaretleme yine yazilir
    movie_id = _ensure_tmdb_follow(conn, "movie", tmdb_id, owner_id=uid)
    if not movie_id:
        print(f"[stremio] movie tmdb={tmdb_id} cozulemedi, tampona yazilmadi", flush=True)
        return
    record_signal("movie", tmdb_id, None, None, None, user_id=uid, source=source)
    if _ask_enabled(uid, source) and not direct:
        trow = conn.execute("SELECT title, genres FROM followed WHERE id=?", (movie_id,)).fetchone()
        _create_watched_ask(uid, "movie", (trow["title"] if trow else ""), tmdb_id=tmdb_id, is_doc=_is_doc_row(trow) if trow else False, source=source)
        bump()
        return
    import time as _t
    _now = int(_t.time())
    conn.execute(
        "UPDATE followed SET watched=1, in_watched=1, watched_at=COALESCE(watched_at, ?), watched_source=? WHERE id=?",
        (_now, source, movie_id),
    )
    conn.commit()
    _stamp_verified_ts(uid)
    if direct:
        _confirm_watched(uid, "movie", tmdb_id=tmdb_id, source=source)
    bump()
    print(f"[stremio] WROTE movie tmdb={tmdb_id} kaynak={source}", flush=True)


def _ensure_tmdb_follow(conn, media_type, tmdb_id, owner_id=0):
    """Takip yoksa follow + (tv icin) sync_episodes. follow_id dondurur.
    Eszamanli sinyallere karsi yaris-guvenli (UNIQUE + ON CONFLICT). Faz 32: per-user."""
    uid = int(owner_id or 0)
    row = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?", (uid, tmdb_id, media_type)
    ).fetchone()
    if row:
        return row["id"]
    detail = _tmdb_detail(media_type, tmdb_id)
    if not detail:
        return None
    title = detail.get("title") or detail.get("name") or detail.get("original_name") or ""
    poster = detail.get("poster_path")
    info = get_tmdb_info(media_type, tmdb_id)
    release_date = detail.get("release_date") or detail.get("first_air_date")
    vote_average = (info or {}).get("vote_average") or 0
    networks = (info or {}).get("networks") or []
    conn.execute(
        "INSERT INTO followed (user_id, tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, tmdb_id, media_type) DO NOTHING",
        (uid, tmdb_id, media_type, title, poster, release_date, vote_average, json.dumps(networks)),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?", (uid, tmdb_id, media_type)
    ).fetchone()
    if not row:
        return None
    new_id = row["id"]
    if info:
        _credits = get_tmdb_credits(media_type, tmdb_id)
        save_details(conn, new_id, info, _credits.get("cast") or [], directors=_credits.get("directors") or [])
        conn.commit()
    try:
        if poster:
            w500, w185 = download_tmdb_poster_with_sizes(media_type, tmdb_id, poster)
            if w500:
                conn.execute("UPDATE followed SET poster_local=?, poster_local_w185=? WHERE id=?", (w500, w185, new_id))
                conn.commit()
            elif w185:
                conn.execute("UPDATE followed SET poster_local_w185=? WHERE id=?", (w185, new_id))
                conn.commit()
    except Exception:
        pass
    if media_type == "tv":
        new_follow = conn.execute("SELECT * FROM followed WHERE id=?", (new_id,)).fetchone()
        sync_episodes(conn, new_follow)
    try:
        remove_rec_item("shows" if media_type == "tv" else "movies", int(tmdb_id), user_id=uid)
    except Exception:
        pass
    return new_id


def _ensure_anime_follow(conn, anilist_id, owner_id=0):
    """Takip yoksa anime-follow. anime DB id dondurur; harici linkleri esler. Faz 32: per-user."""
    uid = int(owner_id or 0)
    arow = conn.execute("SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    if arow:
        return arow["id"]
    detail = anilist_detail(anilist_id)
    if not detail:
        return None
    title = _anime_title(detail)
    cover = _anime_cover(detail)
    episodes = detail.get("episodes") or 0
    status = detail.get("status")
    score = detail.get("averageScore")
    studios = [s.get("name") for s in (detail.get("studios") or {}).get("nodes") or [] if s.get("name")]
    studio = studios[0] if studios else None
    conn.execute(
        "INSERT INTO anime (user_id, anilist_id, title, cover_url, episodes, status, score, studios) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, anilist_id) DO UPDATE SET "
        "title=excluded.title, cover_url=excluded.cover_url, "
        "episodes=excluded.episodes, status=excluded.status, score=excluded.score, studios=excluded.studios",
        (uid, anilist_id, title, cover, episodes, status, score, studio),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    anime_db_id = row["id"]
    save_anime_details(conn, anime_db_id, detail)
    conn.commit()
    try:
        if cover:
            w500, w185 = download_anime_poster_with_sizes(anilist_id, cover)
            if w500 or w185:
                conn.execute("UPDATE anime SET poster_local=?, poster_local_w185=? WHERE id=?", (w500, w185, anime_db_id))
                conn.commit()
    except Exception:
        pass
    schedule = anilist_schedule(anilist_id)
    if schedule and schedule.get("airingSchedule"):
        for node in schedule["airingSchedule"].get("nodes") or []:
            conn.execute(
                "INSERT INTO anime_episodes (anime_id, episode, air_at) VALUES (?, ?, ?) "
                "ON CONFLICT(anime_id, episode) DO UPDATE SET air_at=excluded.air_at",
                (anime_db_id, node.get("episode"), node.get("airingAt")),
            )
        conn.commit()
    _store_anime_externals(conn, detail, anilist_id)
    try:
        remove_rec_item("anime", int(anilist_id))
    except Exception:
        pass
    return anime_db_id


def _store_anime_externals(conn, detail, anilist_id):
    """AniList externalLinks'ten imdb/tmdb/tvdb id'lerini anime_id_map'e isler."""
    try:
        for link in (detail.get("externalLinks") or []):
            site = (link.get("site") or "").strip().upper()
            url = (link.get("url") or "").strip()
            if site == "IMDB":
                m = re.search(r"/title/(tt\d+)", url)
                if m:
                    store_anime_map(conn, "imdb", m.group(1), anilist_id)
            elif site == "TMDB":
                m = re.search(r"/(?:tv|movie)/(\d+)", url)
                if m:
                    store_anime_map(conn, "tmdb", m.group(1), anilist_id)
            elif site == "TVDB":
                m = re.search(r"/(\d+)", url)
                if m:
                    store_anime_map(conn, "tvdb", m.group(1), anilist_id)
        conn.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Third-party durum + islemler
# ---------------------------------------------------------------------------

@stremio_bp.route("/api/thirdparty/status")
def thirdparty_status():
    apps = [_app_status(a) for a in THIRDPARTY_APPS]
    return jsonify({"apps": apps})


_CONNECTED_WINDOW = 24 * 3600  # "Bagli" rozeti icin sinyal tazelik penceresi


def _remote_app_status(base):
    """Uzak baglanti karti: Pi tüneli kurulu mu + aktif mi (fail-soft)."""
    import os as _os
    import subprocess as _sp
    try:
        from routes.remote import ensure_remote_tables as _ensure
        _ensure()
    except Exception:
        pass
    installed = _os.path.exists("/etc/wireguard/nextep.conf")
    active = False
    try:
        pr = _sp.run(["systemctl", "is-active", "--quiet", "wg-quick@nextep"], timeout=5)
        active = pr.returncode == 0
    except Exception:
        active = False
    try:
        ls = None
        if active:
            try:
                pr = _sp.run(["wg", "show", "nextep", "latest-handshakes"],
                             capture_output=True, text=True, timeout=5)
                for line in (pr.stdout or "").splitlines():
                    parts = line.split()
                    if len(parts) == 2 and parts[1].isdigit() and int(parts[1]) > 0:
                        ls = max(ls or 0, int(parts[1]))
            except Exception:
                ls = None
        if ls is None:
            hts = get_setting("remote_last_handshake") or ""
            if hts:
                ls = int(float(hts))
        if ls is None:
            tts = get_setting("vps_last_test_ts") or ""
            ls = int(float(tts)) if tts else None
        base["lastSignal"] = ls
    except Exception:
        base["lastSignal"] = None
    base["installUrl"] = None
    base["installed"] = installed
    base["tunnelOk"] = True
    if installed and active:
        base["connected"] = True
        base["status"] = "connected"
        base["note"] = "connected"
    elif installed:
        base["status"] = "ready"
        base["note"] = "ready_none"
    else:
        base["status"] = "not-connected"
        base["note"] = "not-installed"
    return base


def _app_status(app):
    import time as _t
    aid = app["id"]
    base = {
        "id": aid,
        "name": app.get("name") or aid,
        "connected": False,
        "status": "not-connected",
        "note": "not-installed",
        "tunnelOk": True,
        "tunnelInstalled": False,
        "installed": False,
        "lastSignal": None,
        "lastWatch": None,
        "installUrl": None,
    }
    base.update(_vps_card_state(aid))
    uid = _me_uid() or 1
    u = _get_uuid(aid, user_id=uid)
    if not u:
        return base
    base["installed"] = True
    base["installUrl"] = _install_url(aid, u)
    # 1.87: LAN kurulum linki (webhook uclari + takvim) — Stremio'ya verilmez.
    if aid in WEBHOOK_APPS or aid == "calendar":
        try:
            lb = _lan_base()
            base["lanBaseUrl"] = lb
            base["lanInstallUrl"] = _lan_install_url(aid, u) if lb else ""
        except Exception:
            pass
    if aid == "remote":
        return _remote_app_status(base)
    if aid in WEBHOOK_APPS:
        # Webhook uygulamalari: adres uretildi = "hazir"; ilk gercek olay "bagli" yapar.
        try:
            from db import get_user_setting as _gusw
            vts = _gusw(uid, f"tp_{aid}_verified_ts")
        except Exception:
            vts = None
        try:
            base["verifiedTs"] = int(float(vts)) if vts else None
        except Exception:
            base["verifiedTs"] = None
        # 1.87: olay HANGI adresten geldi -> kart durumu "Bagli (LAN)" / "Bagli (URL)".
        try:
            from db import get_user_setting as _gusw2
            base["verifiedVia"] = (_gusw2(uid, f"tp_{aid}_verified_via") or "").strip() or None
        except Exception:
            base["verifiedVia"] = None
        # 1.87: kartta "Son sinyal" + "xyz izlendi" (webhook'tan gelen son izleme).
        try:
            from db import get_user_setting as _guslw
            _lw = json.loads(_guslw(uid, f"tp_{aid}_last_watch") or "{}")
            if not isinstance(_lw, dict):
                _lw = {}
        except Exception:
            _lw = {}
        try:
            base["lastSignal"] = int(float(_lw.get("ts"))) if _lw.get("ts") else None
        except Exception:
            base["lastSignal"] = None
        base["lastWatch"] = {
            "kind": _lw.get("kind") or "",
            "title": _lw.get("title") or "",
            "season": _lw.get("season"),
            "episode": _lw.get("episode"),
        } if _lw.get("title") else None
        if vts:
            base["connected"] = True
            base["status"] = "connected"
            base["note"] = "connected"
        else:
            base["connected"] = False
            base["status"] = "ready"
            base["note"] = "ready_none"
        if aid == "emby":
            # 1.87: webhook Premiere gerektirdigi icin API modu durumu da eklenir.
            try:
                from emby_sync import api_status as _emby_api_status
                base.update(_emby_api_status() or {})
            except Exception as _e:
                print(f"[stremio] emby api durum hata: {_e}", flush=True)
        return base
    if aid != "stremio":
        base["connected"] = True
        base["status"] = "connected"
        base["note"] = "connected"
        # 1.87: Takvim feed'i LAN'dan mi (yerel istemci) yoksa URL'den mi (Google) cekiliyor?
        if aid == "calendar":
            try:
                from db import get_user_setting as _gusc
                base["verifiedVia"] = (_gusc(uid, "tp_calendar_verified_via") or "").strip() or None
            except Exception:
                base["verifiedVia"] = None
        return base
    tunnel = _tunnel_ok()
    base["tunnelOk"] = tunnel
    base["tunnelInstalled"] = _tunnel_installed()
    try:
        from db import get_user_setting as _gus
        mts = _gus(uid, "tp_stremio_manifest_ts")
        base["manifestTs"] = int(float(mts)) if mts else None
    except Exception:
        base["manifestTs"] = None
    try:
        from db import get_user_setting as _gus2
        vts = _gus2(uid, "tp_stremio_verified_ts")
        base["verifiedTs"] = int(float(vts)) if vts else None
    except Exception:
        base["verifiedTs"] = None
    ls = last_signal_ts(user_id=uid, source="stremio")
    base["lastSignal"] = ls
    if ls:
        base["lastWatch"] = _last_watch_detail(uid, source="stremio")
    if not tunnel:
        base["status"] = "not-connected"
        base["note"] = "tunnel"
        base["connected"] = False
        return base
    now = int(_t.time())
    if ls and (now - int(ls)) <= _CONNECTED_WINDOW:
        base["status"] = "connected"
        base["note"] = "connected"
        base["connected"] = True
    else:
        base["status"] = "ready"
        base["note"] = "ready_age" if ls else "ready_none"
        base["connected"] = False
    return base


@stremio_bp.route("/api/thirdparty/stremio/refresh-uuid", methods=["POST"])
def thirdparty_stremio_refresh_uuid():
    uid = _me_uid() or 1
    u = uuid.uuid4().hex
    set_user_setting(uid, _uuid_setting_key("stremio"), u)
    # Yeni link = temiz sayfa: eski kurulum/dogrulama damgalari tasinmaz.
    try:
        set_user_setting(uid, "tp_stremio_manifest_ts", "")
        set_user_setting(uid, "tp_stremio_verified_ts", "")
    except Exception:
        pass
    clear_all_signals(user_id=uid)
    return jsonify({"ok": True, "installUrl": _install_url("stremio", u)})


@stremio_bp.route("/api/thirdparty/stremio/disconnect", methods=["POST"])
def thirdparty_stremio_disconnect():
    uid = _me_uid() or 1
    set_user_setting(uid, _uuid_setting_key("stremio"), "")
    clear_all_signals(user_id=uid)
    return jsonify({"ok": True})


# --- Takvim (ICS) — 1.85: jenerik thirdparty deseni (Stremio'nun kardesi) ---

@stremio_bp.route("/api/thirdparty/calendar/refresh-uuid", methods=["POST"])
def thirdparty_calendar_refresh_uuid():
    uid = _me_uid() or 1
    u = uuid.uuid4().hex
    set_user_setting(uid, _uuid_setting_key("calendar"), u)
    return jsonify({"ok": True, "installUrl": _install_url("calendar", u)})


@stremio_bp.route("/api/thirdparty/calendar/disconnect", methods=["POST"])
def thirdparty_calendar_disconnect():
    uid = _me_uid() or 1
    set_user_setting(uid, _uuid_setting_key("calendar"), "")
    return jsonify({"ok": True})


# --- Webhook uygulamalari (Plex / Jellyfin / Emby) — 1.86 ---
# Adres: {base}/webhook/<app>/<uuid>. Jenerik uclar (Stremio/Takvim deseninin kardesi).

def _webhook_endpoints(app_id, action):
    if action == "refresh-uuid":
        uid = _me_uid() or 1
        u = uuid.uuid4().hex
        set_user_setting(uid, _uuid_setting_key(app_id), u)
        # Yeni adres = temiz sayfa: eski dogrulama damgasi tasinmaz.
        try:
            set_user_setting(uid, f"tp_{app_id}_verified_ts", "")
            set_user_setting(uid, f"tp_{app_id}_verified_via", "")
            set_user_setting(uid, f"tp_{app_id}_last_watch", "")
        except Exception:
            pass
        return jsonify({"ok": True, "installUrl": _install_url(app_id, u)})
    uid = _me_uid() or 1
    set_user_setting(uid, _uuid_setting_key(app_id), "")
    try:
        set_user_setting(uid, f"tp_{app_id}_verified_ts", "")
        set_user_setting(uid, f"tp_{app_id}_verified_via", "")
        set_user_setting(uid, f"tp_{app_id}_last_watch", "")
    except Exception:
        pass
    if app_id == "emby":
        # 1.87: baglanti kesilince API modu ayari da temizlenir (anahtar kasasi dahil).
        try:
            from emby_sync import clear_config as _emby_clear
            _emby_clear()
        except Exception as _e:
            print(f"[stremio] emby api temizleme hata: {_e}", flush=True)
    return jsonify({"ok": True})


@stremio_bp.route("/api/thirdparty/<app>/refresh-uuid", methods=["POST"])
def thirdparty_webhook_refresh_uuid(app):
    if app not in WEBHOOK_APPS:
        return jsonify({"error": "Bilinmeyen uygulama"}), 404
    return _webhook_endpoints(app, "refresh-uuid")


@stremio_bp.route("/api/thirdparty/<app>/disconnect", methods=["POST"])
def thirdparty_webhook_disconnect(app):
    if app not in WEBHOOK_APPS:
        return jsonify({"error": "Bilinmeyen uygulama"}), 404
    return _webhook_endpoints(app, "disconnect")


# ---------------------------------------------------------------------------
# clear-apply: tam sifirlamada tampon otomatik uygulanir
# ---------------------------------------------------------------------------

@stremio_bp.route("/api/seasons/clear-apply", methods=["POST"])
def seasons_clear_apply():
    body = request.get_json(silent=True) or {}
    anilist_id = body.get("anilist_id")
    tmdb_id = body.get("tmdb_id")
    uid = _me_uid() or 1
    conn = get_db()
    try:
        if anilist_id:
            return _clear_apply_anime(conn, anilist_id, owner_id=uid)
        if tmdb_id:
            return _clear_apply_tv(conn, tmdb_id, owner_id=uid)
        return jsonify({"error": "Eksik bilgi"}), 400
    except Exception as e:
        print(f"[stremio] clear-apply hata: {e}", flush=True)
        return jsonify({"error": "clear-apply hatasi"}), 500
    finally:
        conn.close()


def _clear_apply_tv(conn, tmdb_id, owner_id=0):
    uid = int(owner_id or 0)
    follow = conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type='tv'", (uid, tmdb_id,)
    ).fetchone()
    if not follow:
        return jsonify({"error": "Takip bulunamadı"}), 404
    conn.execute("UPDATE episodes SET watched=0, watched_at=NULL, source=NULL WHERE follow_id=?", (follow["id"],))
    conn.commit()
    signals = sorted(
        signals_for_tv(tmdb_id, user_id=uid),
        key=lambda s: ((s.get("season") or 0), (s.get("episode") or 0)),
    )
    applied = []
    import time as _t
    _now = int(_t.time())
    for s in signals:
        if s.get("season") is None or s.get("episode") is None:
            continue
        if not _prev_watched_tv(conn, follow["id"], s["season"], s["episode"]):
            print(f"[stremio] clear-apply kilit atlandi: S{s['season']}E{s['episode']}", flush=True)
            continue
        conn.execute(
            "INSERT INTO episodes (follow_id, season, episode, watched, watched_at, source) VALUES (?,?,?,1,?,?) "
            "ON CONFLICT(follow_id, season, episode) DO UPDATE SET watched=1, watched_at=excluded.watched_at, "
            "source=excluded.source",
            (follow["id"], s["season"], s["episode"], _now, s.get("source")),
        )
        applied.append({"season": s["season"], "episode": s["episode"]})
    conn.commit()
    # tam temizlik: uygulanan da atlanan da silinir (kilit-disi tampon barinmaz)
    delete_signals([s["dedupe"] for s in signals])
    bump()
    return jsonify({"ok": True, "cleared": True, "applied": applied})


def _clear_apply_anime(conn, anilist_id, owner_id=0):
    uid = int(owner_id or 0)
    arow = conn.execute("SELECT id FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
    if not arow:
        return jsonify({"error": "Takip bulunamadı"}), 404
    conn.execute("UPDATE anime_episodes SET watched=0, source=NULL WHERE anime_id=?", (arow["id"],))
    conn.commit()
    signals = sorted(signals_for_anime(anilist_id, user_id=uid), key=lambda s: (s.get("episode") or 0))
    applied = []
    for s in signals:
        if s.get("episode") is None:
            continue
        if not _prev_watched_anime(conn, arow["id"], s["episode"]):
            print(f"[stremio] clear-apply kilit atlandi anime ep={s['episode']}", flush=True)
            continue
        conn.execute(
            "INSERT INTO anime_episodes (anime_id, episode, watched, source) VALUES (?,?,1,?) "
            "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=1, source=excluded.source",
            (arow["id"], s["episode"], s.get("source")),
        )
        applied.append({"episode": s["episode"]})
    conn.commit()
    # tam temizlik: uygulanan da atlanan da silinir
    delete_signals([s["dedupe"] for s in signals])
    bump()
    return jsonify({"ok": True, "cleared": True, "applied": applied})


def prune_stremio_signals():
    """Gecelik budama (scheduler): SIGNAL_TTL'den eski sinyalleri siler."""
    try:
        from stremio_buffer import prune_signals
        prune_signals(SIGNAL_TTL)
        print("[stremio] sinyal budama tamam", flush=True)
    except Exception as e:
        print(f"[stremio] sinyal budama hata: {e}", flush=True)


def purge_ungated_signals():
    """Kilit-disi + yetim tampon satirlarini temizler (tek seferlik + bakim).
    Silinen satir sayisini dondurur. Fail-soft."""
    deleted = 0
    try:
        from stremio_buffer import all_signals
        conn = get_db()
        try:
            for r in all_signals():
                kind = r.get("kind")
                keep = True
                sig_uid = r.get("user_id")
                if kind == "tv" and r.get("tmdb_id") is not None:
                    f = conn.execute(
                        "SELECT id, in_watched, user_id FROM followed WHERE tmdb_id=? AND media_type='tv'",
                        (r["tmdb_id"],),
                    ).fetchone()
                    if f is None:
                        keep = False  # yetim: takip yok
                    elif sig_uid is not None and f["user_id"] != sig_uid:
                        keep = False  # baska kullanicinin satiri
                    elif f["in_watched"] != 1 and r.get("season") is not None and r.get("episode") is not None:
                        cur = conn.execute(
                            "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
                            (f["id"], r["season"], r["episode"]),
                        ).fetchone()
                        if not (cur and cur["watched"] == 1):
                            keep = _prev_watched_tv(conn, f["id"], r["season"], r["episode"])
                elif kind == "anime" and r.get("anilist_id") is not None:
                    a = conn.execute(
                        "SELECT id, in_watched, user_id FROM anime WHERE anilist_id=?", (r["anilist_id"],)
                    ).fetchone()
                    if a is None:
                        keep = False  # yetim: takip yok
                    elif sig_uid is not None and a["user_id"] != sig_uid:
                        keep = False
                    elif a["in_watched"] != 1 and r.get("episode") is not None:
                        cur = conn.execute(
                            "SELECT watched FROM anime_episodes WHERE anime_id=? AND episode=?",
                            (a["id"], r["episode"]),
                        ).fetchone()
                        if not (cur and cur["watched"] == 1):
                            keep = _prev_watched_anime(conn, a["id"], r["episode"])
                # movie + diger durumlar korunur
                if not keep:
                    delete_signals([r["dedupe"]])
                    deleted += 1
        finally:
            conn.close()
    except Exception as e:
        print(f"[stremio] purge hata: {e}", flush=True)
    print(f"[stremio] purge: {deleted} kilit-disi/yetim satir temizlendi", flush=True)
    return deleted