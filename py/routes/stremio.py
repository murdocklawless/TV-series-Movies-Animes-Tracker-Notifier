"""Stremio izleme senkronu (Faz 29).

Stremio eklentisi (NextEp Watch Sync) altyazi kancasi uzerinden oynatma acilisini
yakalar, izlenen dizi/film/animeyi Nextep'e watched=1 olarak isler. Tek yonlu
(Stremio -> Nextep), Trakt yok, ev agi kapsaminda. UUID per-app: settings.tp_<app>_uuid.

Uclar:
  GET  /stremio/<uuid>/manifest.json                 -> manifest (static)
  GET  /stremio/<uuid>/subtitles/<type>/<id>.json    -> sinyal kancasi (aninda {subtitles:[]})
  GET  /api/thirdparty/status                        -> uygulama durum listesi (genisletilebilir)
  POST /api/thirdparty/stremio/refresh-uuid          -> yeni UUID (eski kurulum olur)
  POST /api/thirdparty/stremio/disconnect            -> baglantiyi kes (yazma durur)
  POST /api/seasons/clear-apply                      -> tumunu temizle + tamponu otomatik uygula
"""
import json
import re
import socket
import threading
import uuid

import requests

from flask import Blueprint, jsonify, request

from db import get_db, get_setting, set_setting
from tmdb import tmdb_request, get_tmdb_info, get_tmdb_cast, save_details
from poster_store import download_tmdb_poster_with_sizes, download_anime_poster_with_sizes
from scheduler import sync_episodes
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
    clear_all_signals,
)

stremio_bp = Blueprint("stremio", __name__)

# Genisletilebilir uygulama defteri: ileride Nuvio vb. buraya satir eklenir.
THIRDPARTY_APPS = [
    {"id": "stremio", "name": "Stremio", "protocol": "stremio"},
]

SIGNAL_TTL = 30 * 86400  # tampon budama suresi (gecelik is)


# ---------------------------------------------------------------------------
# UUID + kurulum URL
# ---------------------------------------------------------------------------

def _uuid_setting_key(app_id):
    return f"tp_{app_id}_uuid"


def _get_uuid(app_id="stremio"):
    """UUID'i dondurur; yoksa uretir (kurulum URL'si her zaman hazir olur)."""
    key = _uuid_setting_key(app_id)
    u = get_setting(key)
    if not u:
        u = uuid.uuid4().hex
        set_setting(key, u)
    return u


def _check_uuid(uuid_param, app_id="stremio"):
    if not uuid_param:
        return False
    return uuid_param == get_setting(_uuid_setting_key(app_id))


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


def _install_url(app_id, u):
    return f"{_base_url()}/{app_id}/{u}/manifest.json"


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
    payload = {
        "id": "nextep-tracker",
        "name": "NextEp Watch Sync",
        "version": "1.0.0",
        "description": "Syncs what you play in Stremio to NextEp as watched",
        "resources": ["subtitles"],
        "types": ["movie", "series"],
        "idPrefixes": ["tt", "tmdb:", "tvdb:", "trakt:", "kitsu:"],
        "catalogs": [],
    }
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store"
    return _cors(resp)


@stremio_bp.route("/stremio/<uuid_param>/subtitles/<stype>/<media_id>.json")
@stremio_bp.route("/stremio/<uuid_param>/subtitles/<stype>/<media_id>/<extra>.json")
def stremio_subtitles(uuid_param, stype, media_id, extra=None):
    tag = str(uuid_param)[:8]
    if not _check_uuid(uuid_param):
        print(f"[stremio] subtitles uuid={tag} 404 type={stype} id={str(media_id)[:60]}", flush=True)
        return jsonify({"error": "not found"}), 404
    parsed = parse_stremio_id(media_id)
    if parsed:
        route_norm = "movie" if stype == "movie" else "tv"
        if route_norm != parsed["route_norm"]:
            print(f"[stremio] subtitles uuid={tag} SKIP type-mismatch route={stype} id={media_id}", flush=True)
        else:
            print(f"[stremio] subtitles uuid={tag} QUEUED type={stype} id={media_id}", flush=True)
            threading.Thread(target=process_signal, args=(parsed,), daemon=True).start()
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

def process_signal(parsed):
    conn = None
    try:
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
            _anime_branch(conn, anilist_id, season, episode)
            return

        # trakt: anime disinda cozum yok -> anime denenir, yoksa atla
        if provider == "trakt":
            anilist_id = _resolve_anime(conn, "trakt", ident)
            if anilist_id:
                _anime_branch(conn, anilist_id, season, episode)
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
            _anime_branch(conn, anilist_id, season, episode, tmdb_id=tmdb_id)
            return

        # 3) TMDB sezgisi (Animation + JP) -> anime
        if _is_anime_like(tmdb_type, tmdb_id):
            resolved = _resolve_anime(conn, "tmdb", tmdb_id)
            if resolved:
                _anime_branch(conn, resolved, season, episode, tmdb_id=tmdb_id)
            else:
                print(f"[stremio] anime aday tmdb={tmdb_id} -> anilist eslemesi yok, atlandi", flush=True)
            return

        # 4) varsayilan dizi/film
        if tmdb_type == "tv":
            _tv_branch(conn, tmdb_id, season, episode)
        else:
            _movie_branch(conn, tmdb_id)
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
    try:
        r = requests.get(
            "https://api.themoviedb.org/3/find/" + str(external_id),
            params={"api_key": api_key, "external_source": source, "language": "en-US"},
            timeout=15,
        )
    except requests.RequestException:
        return None
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

def _prev_watched_tv(conn, follow_id, season, episode):
    """(S,E) yazilmadan once onceki bolum izlenmis mi? True = kilit gecer.
    Onceki satir yoksa fail-open True + log (senkron boslugunda engelleme yok)."""
    try:
        if episode is None or season is None:
            return True
        if episode > 1:
            row = conn.execute(
                "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
                (follow_id, season, episode - 1),
            ).fetchone()
            if row is None:
                print(f"[stremio] kilit fail-open: onceki satir yok S{season}E{episode-1}", flush=True)
                return True
            return row["watched"] == 1
        if season <= 1:
            return True  # S1E1 her zaman gecer
        prev = conn.execute(
            "SELECT MAX(episode) m FROM episodes WHERE follow_id=? AND season=?",
            (follow_id, season - 1),
        ).fetchone()
        if not prev or prev["m"] is None:
            print(f"[stremio] kilit fail-open: onceki sezon bos S{season-1}", flush=True)
            return True
        row = conn.execute(
            "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
            (follow_id, season - 1, prev["m"]),
        ).fetchone()
        if row is None:
            return True
        return row["watched"] == 1
    except Exception as e:
        print(f"[stremio] kilit kontrol hata, fail-open: {e}", flush=True)
        return True


def _prev_watched_anime(conn, anime_db_id, episode):
    """Anime mutlak bolum kilidi: E-1 izlenmis mi? E1 her zaman gecer."""
    try:
        if episode is None or episode <= 1:
            return True
        row = conn.execute(
            "SELECT watched FROM anime_episodes WHERE anime_id=? AND episode=?",
            (anime_db_id, episode - 1),
        ).fetchone()
        if row is None:
            print(f"[stremio] kilit fail-open anime: onceki satir yok ep={episode-1}", flush=True)
            return True
        return row["watched"] == 1
    except Exception as e:
        print(f"[stremio] kilit kontrol hata, fail-open: {e}", flush=True)
        return True


def _anime_branch(conn, anilist_id, season, episode, tmdb_id=None):
    arow = conn.execute("SELECT id, in_watched FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
    if arow and (arow["in_watched"] == 1):
        record_signal("anime", tmdb_id, anilist_id, season, episode)
        return  # izlenmiste: no-op (tampona kaydedildi)
    if episode is None:
        # anime filmi (E9): follow + dogrudan Izlenmis
        record_signal("anime", tmdb_id, anilist_id, season, episode)
        anime_db_id = _ensure_anime_follow(conn, anilist_id)
        if anime_db_id:
            conn.execute("UPDATE anime SET in_watched=1 WHERE id=?", (anime_db_id,))
            conn.commit()
        bump()
        return
    # mutlak bolum: S1 bolum aynen; S2+ esleme yoksa atla (tamponsuz — dogru uygulanamaz)
    if season is not None and season != 1:
        print(f"[stremio] anime S{season} -> mutlak bolum eslemesi yok, atlandi (anilist {anilist_id})", flush=True)
        return
    anime_db_id = _ensure_anime_follow(conn, anilist_id)
    if not anime_db_id:
        return
    cur = conn.execute(
        "SELECT watched FROM anime_episodes WHERE anime_id=? AND episode=?",
        (anime_db_id, episode),
    ).fetchone()
    if cur and cur["watched"] == 1:
        record_signal("anime", tmdb_id, anilist_id, season, episode)
        return  # zaten izli: tamponu tazele
    if not _prev_watched_anime(conn, anime_db_id, episode):
        print(f"[stremio] kilit-disi sinyal atlandi (tamponsuz): anilist={anilist_id} ep={episode}", flush=True)
        return  # yazma yok, tampon yok
    record_signal("anime", tmdb_id, anilist_id, season, episode)
    conn.execute(
        "INSERT INTO anime_episodes (anime_id, episode, watched) VALUES (?,?,1) "
        "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=1",
        (anime_db_id, episode),
    )
    conn.commit()
    bump()
    print(f"[stremio] WROTE anime anilist={anilist_id} ep={episode}", flush=True)


def _tv_branch(conn, tmdb_id, season, episode):
    if season is None or episode is None:
        return  # dizi sinyali S/E'siz gelmemeli (tamponsuz)
    follow = conn.execute(
        "SELECT id, in_watched FROM followed WHERE tmdb_id=? AND media_type='tv'", (tmdb_id,)
    ).fetchone()
    if follow and follow["in_watched"] == 1:
        record_signal("tv", tmdb_id, None, season, episode)
        return  # izlenmiste: no-op (tampona kaydedildi)
    follow_id = _ensure_tmdb_follow(conn, "tv", tmdb_id)
    if not follow_id:
        return
    cur = conn.execute(
        "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
        (follow_id, season, episode),
    ).fetchone()
    if cur and cur["watched"] == 1:
        record_signal("tv", tmdb_id, None, season, episode)
        return  # zaten izli: tamponu tazele
    if not _prev_watched_tv(conn, follow_id, season, episode):
        print(f"[stremio] kilit-disi sinyal atlandi (tamponsuz): tmdb={tmdb_id} S{season}E{episode}", flush=True)
        return  # yazma yok, tampon yok
    record_signal("tv", tmdb_id, None, season, episode)
    conn.execute(
        "INSERT INTO episodes (follow_id, season, episode, watched) VALUES (?,?,?,1) "
        "ON CONFLICT(follow_id, season, episode) DO UPDATE SET watched=1",
        (follow_id, season, episode),
    )
    conn.commit()
    bump()
    print(f"[stremio] WROTE tv tmdb={tmdb_id} S{season}E{episode}", flush=True)


def _movie_branch(conn, tmdb_id):
    record_signal("movie", tmdb_id, None, None, None)
    follow = conn.execute(
        "SELECT id, in_watched FROM followed WHERE tmdb_id=? AND media_type='movie'", (tmdb_id,)
    ).fetchone()
    if follow and follow["in_watched"] == 1:
        return  # izlenmiste: no-op
    movie_id = _ensure_tmdb_follow(conn, "movie", tmdb_id)
    if not movie_id:
        return
    conn.execute("UPDATE followed SET watched=1, in_watched=1 WHERE id=?", (movie_id,))
    conn.commit()
    bump()
    print(f"[stremio] WROTE movie tmdb={tmdb_id}", flush=True)


def _ensure_tmdb_follow(conn, media_type, tmdb_id):
    """Takip yoksa follow + (tv icin) sync_episodes. follow_id dondurur.
    Eszamanli sinyallere karsi yaris-guvenli (UNIQUE + ON CONFLICT)."""
    row = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type=?", (tmdb_id, media_type)
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
        "INSERT INTO followed (tmdb_id, media_type, title, poster_path, release_date, vote_average, networks) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(tmdb_id, media_type) DO NOTHING",
        (tmdb_id, media_type, title, poster, release_date, vote_average, json.dumps(networks)),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type=?", (tmdb_id, media_type)
    ).fetchone()
    if not row:
        return None
    new_id = row["id"]
    if info:
        save_details(conn, new_id, info, get_tmdb_cast(media_type, tmdb_id))
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
        remove_rec_item("shows" if media_type == "tv" else "movies", int(tmdb_id))
    except Exception:
        pass
    return new_id


def _ensure_anime_follow(conn, anilist_id):
    """Takip yoksa anime-follow. anime DB id dondurur; harici linkleri esler."""
    arow = conn.execute("SELECT id FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
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
        "INSERT INTO anime (anilist_id, title, cover_url, episodes, status, score, studios) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(anilist_id) DO UPDATE SET "
        "title=excluded.title, cover_url=excluded.cover_url, "
        "episodes=excluded.episodes, status=excluded.status, score=excluded.score, studios=excluded.studios",
        (anilist_id, title, cover, episodes, status, score, studio),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
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


def _app_status(app):
    aid = app["id"]
    base = {
        "id": aid,
        "name": app.get("name") or aid,
        "connected": False,
        "lastSignal": None,
        "installUrl": None,
    }
    u = _get_uuid(aid)
    if u:
        base["installUrl"] = _install_url(aid, u)
        if aid == "stremio":
            base["lastSignal"] = last_signal_ts()
            # "Bagli" = en az bir sinyal alindi (ilk sinyalle onaylanir)
            base["connected"] = base["lastSignal"] is not None
        else:
            base["connected"] = True
    return base


@stremio_bp.route("/api/thirdparty/stremio/refresh-uuid", methods=["POST"])
def thirdparty_stremio_refresh_uuid():
    u = uuid.uuid4().hex
    set_setting(_uuid_setting_key("stremio"), u)
    return jsonify({"ok": True, "installUrl": _install_url("stremio", u)})


@stremio_bp.route("/api/thirdparty/stremio/disconnect", methods=["POST"])
def thirdparty_stremio_disconnect():
    set_setting(_uuid_setting_key("stremio"), "")
    clear_all_signals()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# clear-apply: tam sifirlamada tampon otomatik uygulanir
# ---------------------------------------------------------------------------

@stremio_bp.route("/api/seasons/clear-apply", methods=["POST"])
def seasons_clear_apply():
    body = request.get_json(silent=True) or {}
    anilist_id = body.get("anilist_id")
    tmdb_id = body.get("tmdb_id")
    conn = get_db()
    try:
        if anilist_id:
            return _clear_apply_anime(conn, anilist_id)
        if tmdb_id:
            return _clear_apply_tv(conn, tmdb_id)
        return jsonify({"error": "Eksik bilgi"}), 400
    except Exception as e:
        print(f"[stremio] clear-apply hata: {e}", flush=True)
        return jsonify({"error": "clear-apply hatasi"}), 500
    finally:
        conn.close()


def _clear_apply_tv(conn, tmdb_id):
    follow = conn.execute(
        "SELECT id FROM followed WHERE tmdb_id=? AND media_type='tv'", (tmdb_id,)
    ).fetchone()
    if not follow:
        return jsonify({"error": "Takip bulunamadı"}), 404
    conn.execute("UPDATE episodes SET watched=0 WHERE follow_id=?", (follow["id"],))
    conn.commit()
    signals = sorted(
        signals_for_tv(tmdb_id),
        key=lambda s: ((s.get("season") or 0), (s.get("episode") or 0)),
    )
    applied = []
    for s in signals:
        if s.get("season") is None or s.get("episode") is None:
            continue
        if not _prev_watched_tv(conn, follow["id"], s["season"], s["episode"]):
            print(f"[stremio] clear-apply kilit atlandi: S{s['season']}E{s['episode']}", flush=True)
            continue
        conn.execute(
            "INSERT INTO episodes (follow_id, season, episode, watched) VALUES (?,?,?,1) "
            "ON CONFLICT(follow_id, season, episode) DO UPDATE SET watched=1",
            (follow["id"], s["season"], s["episode"]),
        )
        applied.append({"season": s["season"], "episode": s["episode"]})
    conn.commit()
    # tam temizlik: uygulanan da atlanan da silinir (kilit-disi tampon barinmaz)
    delete_signals([s["dedupe"] for s in signals])
    bump()
    return jsonify({"ok": True, "cleared": True, "applied": applied})


def _clear_apply_anime(conn, anilist_id):
    arow = conn.execute("SELECT id FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
    if not arow:
        return jsonify({"error": "Takip bulunamadı"}), 404
    conn.execute("UPDATE anime_episodes SET watched=0 WHERE anime_id=?", (arow["id"],))
    conn.commit()
    signals = sorted(signals_for_anime(anilist_id), key=lambda s: (s.get("episode") or 0))
    applied = []
    for s in signals:
        if s.get("episode") is None:
            continue
        if not _prev_watched_anime(conn, arow["id"], s["episode"]):
            print(f"[stremio] clear-apply kilit atlandi anime ep={s['episode']}", flush=True)
            continue
        conn.execute(
            "INSERT INTO anime_episodes (anime_id, episode, watched) VALUES (?,?,1) "
            "ON CONFLICT(anime_id, episode) DO UPDATE SET watched=1",
            (arow["id"], s["episode"]),
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
                if kind == "tv" and r.get("tmdb_id") is not None:
                    f = conn.execute(
                        "SELECT id, in_watched FROM followed WHERE tmdb_id=? AND media_type='tv'",
                        (r["tmdb_id"],),
                    ).fetchone()
                    if f is None:
                        keep = False  # yetim: takip yok
                    elif f["in_watched"] != 1 and r.get("season") is not None and r.get("episode") is not None:
                        cur = conn.execute(
                            "SELECT watched FROM episodes WHERE follow_id=? AND season=? AND episode=?",
                            (f["id"], r["season"], r["episode"]),
                        ).fetchone()
                        if not (cur and cur["watched"] == 1):
                            keep = _prev_watched_tv(conn, f["id"], r["season"], r["episode"])
                elif kind == "anime" and r.get("anilist_id") is not None:
                    a = conn.execute(
                        "SELECT id, in_watched FROM anime WHERE anilist_id=?", (r["anilist_id"],)
                    ).fetchone()
                    if a is None:
                        keep = False  # yetim: takip yok
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