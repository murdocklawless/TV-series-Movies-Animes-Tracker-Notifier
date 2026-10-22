import json
import datetime
import functools

from apscheduler.schedulers.background import BackgroundScheduler
from zoneinfo import ZoneInfo

from config import TMDB_IMAGE_BASE, STATIC_DIR
from db import get_db, get_setting, today_str, get_db as _get_db2
from tvmaze import _tvmaze_episode_times
import os
from tmdb import (
    tmdb_request,
    get_tmdb_info,
    get_tmdb_cast,
    get_tmdb_credits,
    save_details,
    _fetch_tmdb_genres,
)
from anilist import anilist_detail, anilist_schedule, save_anime_details, _fetch_anilist_genres
from notifications import notify_all
from ramcache import bump

# Tüm bildirim tipleri (anahtar, grup) — ayarlar modalı ve tip filtrelemesi tek kaynak
NOTIF_TYPES = [
    ("episode_today", "tv"),
    ("season_start", "tv"),
    ("season_planned", "tv"),
    ("season_production", "tv"),
    ("status_ended", "tv"),
    ("status_canceled", "tv"),
    ("status_pilot", "tv"),
    ("status_returning", "tv"),
    ("season_upcoming", "tv"),
    ("unwatched_bulk", "tv"),
    ("vote_threshold", "tv"),
    ("movie_today", "movie"),
    ("movie_rescheduled", "movie"),
    ("networks_changed", "movie"),
    ("doc_movie_today", "belgesel"),
    ("doc_movie_rescheduled", "belgesel"),
    ("doc_networks_changed", "belgesel"),
    ("doc_episode_today", "belgesel"),
    ("doc_season_start", "belgesel"),
    ("doc_season_planned", "belgesel"),
    ("doc_season_production", "belgesel"),
    ("doc_status_ended", "belgesel"),
    ("doc_status_canceled", "belgesel"),
    ("doc_status_pilot", "belgesel"),
    ("doc_status_returning", "belgesel"),
    ("doc_season_upcoming", "belgesel"),
    ("doc_unwatched_bulk", "belgesel"),
    ("doc_vote_threshold", "belgesel"),
    ("anime_episode_today", "anime"),
    ("anime_hiatus", "anime"),
    ("anime_cancelled", "anime"),
    ("anime_finished", "anime"),
    ("anime_releasing", "anime"),
    ("anime_episodes", "anime"),
    ("anime_unwatched_bulk", "anime"),
    ("member_pending", "member"),
    ("password_reset", "member"),
]

# Faz 32c: NOTIF_PUSH_EXCLUDED kaldirildi — tum tipler tek kisisel akistan
# (merkez + dis push birlikte) gecer; ayri "bugun" push yolu yok.


def _notif_enabled(type_name, user_id=None):
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    if uid > 0:
        try:
            from db import get_user_setting
            v = get_user_setting(uid, f"notif_{type_name}")
            if v is not None:
                return v != "0"
        except Exception:
            pass
    return get_setting(f"notif_{type_name}") != "0"


DOC_GENRES = {
    "documentary", "documentaries", "belgesel", "doku", "dokus", "documentaire", "documentaires",
    "documental", "documentales", "documentario", "documentari", "документальный", "доку",
    "وثائقي", "وثائقيات", "documentário", "documentários", "dokument", "dokumenty",
    "ドキュメンタリー", "다큐멘터리", "纪录片",
}


def _is_doc_row(row):
    """followed satirindaki genres (JSON isim listesi) belgesel iceriyor mu (isDocItem eslenigi)."""
    try:
        g = row["genres"]
    except Exception:
        g = None
    try:
        gs = json.loads(g or "[]")
    except Exception:
        return False
    for x in gs:
        if str(x or "").strip().lower() in DOC_GENRES:
            return True
    return False


def _doc_type(is_doc, base):
    """Belgesel ise doc_ on ekli tip, degilse taban tip."""
    return ("doc_" + base) if is_doc else base


def _active_uids():
    """Bildirim uretilecek aktif kullanicilar. Yoksa [1] (tek-kullanici mirasi)."""
    try:
        conn = get_db()
        rows = conn.execute("SELECT id FROM users WHERE status='active' ORDER BY id").fetchall()
        conn.close()
        uids = [int(r["id"]) for r in rows]
        return uids or [1]
    except Exception:
        return [1]


def _sget(uid, key):
    """Faz 32: snapshot anahtarlari per-user (yoksa global miras)."""
    try:
        from db import get_user_setting
        v = get_user_setting(int(uid), key)
        if v is not None:
            return v
    except Exception:
        pass
    return get_setting(key)


def _sset(uid, key, value):
    try:
        from db import set_user_setting
        set_user_setting(int(uid), key, value)
    except Exception:
        from db import set_setting as _ss
        _ss(key, value)


def _user_tz(uid):
    """Kullanicinin saat dilimi (gecersizse global, o da bozuksa Istanbul)."""
    try:
        from db import get_user_setting
        v = get_user_setting(int(uid), "timezone")
        if v:
            return ZoneInfo(v)
    except Exception:
        pass
    try:
        return ZoneInfo(get_setting("timezone") or "Europe/Istanbul")
    except Exception:
        return ZoneInfo("Europe/Istanbul")


def _user_today(uid):
    """Kullanicinin kendi diliminde bugunun tarihi (YYYY-MM-DD)."""
    try:
        import datetime as _dt
        return _dt.datetime.now(_user_tz(uid)).strftime("%Y-%m-%d")
    except Exception:
        return today_str()


def _user_hour(uid):
    """Kullanicinin Bildirim Saati (yoksa global miras, o da yoksa 09:05)."""
    try:
        v = _sget(uid, "notification_hour")
        if v:
            return v
    except Exception:
        pass
    try:
        v = get_setting("notification_hour")
        if v:
            return v
    except Exception:
        pass
    return "09:05"


def _run_user_notifications(uid):
    """Tek kullaniinin tum bildirim kontrolleri (tv + anime). Fail-soft."""
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return
    try:
        check_notifications(user_id=uid)
    except Exception as e:
        print(f"user_notif tv uid={uid} failed: {e}", flush=True)
    try:
        check_anime_notifications(user_id=uid)
    except Exception as e:
        print(f"user_notif anime uid={uid} failed: {e}", flush=True)
    # dizi+film+belgesel+anime: tampona birikenler tek ozet mailde gonderilir.
    try:
        from notifications import flush_email_digest
        flush_email_digest(uid)
    except Exception as e:
        print(f"user_notif digest uid={uid} failed: {e}", flush=True)


def _user_job_id(uid):
    return f"user_notif_{int(uid)}"


def build_user_jobs(uid):
    """Kullanicinin bildirim job'unu kurar (yoksa acar, varsa dakikaya yazar).
    Pasif/silinmis kullaniciya job kurulmaz (varsa kaldirilir). Tam-dakika cron."""
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return False
    try:
        conn = get_db()
        row = conn.execute("SELECT status FROM users WHERE id=?", (uid,)).fetchone()
        conn.close()
        active = bool(row and row["status"] == "active")
    except Exception:
        active = False
    jid = _user_job_id(uid)
    try:
        if SCHEDULER.get_job(jid):
            SCHEDULER.remove_job(jid)
    except Exception:
        pass
    if not active:
        return False
    try:
        h, m = parse_notify_hour(_user_hour(uid))
        tz = _user_tz(uid)
        SCHEDULER.add_job(
            _run_user_notifications,
            "cron",
            hour=h,
            minute=m,
            timezone=tz,
            args=[uid],
            id=jid,
            misfire_grace_time=3600,
        )
        # 2.19.6: Trakt yoklamasi senkron havuzunda (sync-pool-in). Burada
        # yalnizca eski surumden kalan per-user job temizlenir.
        try:
            _tjid = f"trakt_poll_{uid}"
            if SCHEDULER.get_job(_tjid):
                SCHEDULER.remove_job(_tjid)
        except Exception as _te:
            print(f"trakt job cleanup uid={uid} failed: {_te}", flush=True)
        return True
    except Exception as e:
        print(f"user job build uid={uid} failed: {e}", flush=True)
        return False


def _run_trakt_poll(uid):
    """2.03: Trakt yoklama (inbound + mutabakat + cift yon ise outbound).

    2.19.6: periyodik yoklama artik havuzda; bu islev yalniz elle/manuel
    tetikleme icin korunur.
    """
    try:
        import trakt as _trakt
        res = _trakt.poll(uid)
        if res.get("ok") and (res.get("in") or res.get("out") or res.get("un")):
            print(f"[trakt] poll uid={uid} in={res.get('in')} un={res.get('un')} "
                  f"out={res.get('out')}", flush=True)
    except Exception as e:
        print(f"[trakt] poll hata uid={uid}: {e}", flush=True)


def remove_user_jobs(uid):
    """Kullanicinin bildirim job'unu kaldirir (yoksa no-op). Fail-soft."""
    try:
        jid = _user_job_id(uid)
        if SCHEDULER.get_job(jid):
            SCHEDULER.remove_job(jid)
    except Exception:
        pass


def reschedule_user_jobs(uid):
    """Saat/timezone degisiminde job'u taze degerlerle yeniden yazar."""
    return build_user_jobs(uid)


def _extract_platform_networks(raw):
    try:
        vals = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(vals, list) and vals:
            v = str(vals[0] or "").strip()
            if v:
                return v
    except Exception:
        pass
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return ""


def _build_card(title, media_type=None, tmdb_id=None, anilist_id=None, poster_path=None, cover_url=None, remote_url=None, score=None, platform=None, status_line=None, status_color=None, user_id=None):
    """E-posta karti icin dict kurar — web UI kartlariyla ayni yapi (ad/etiket/puan/platform/status)."""
    mt = (media_type or ("anime" if anilist_id else "tv")).lower()
    if mt not in ("tv", "movie", "anime"):
        mt = "tv"
    # poster
    poster = (remote_url or "").strip()
    if not poster:
        if poster_path:
            poster = TMDB_IMAGE_BASE + poster_path
        elif cover_url:
            poster = cover_url
    # score/platform DB'den dene eger verilmemisse (Faz 32c: sinyal sahibinin satiri)
    sc = score
    pf = platform
    if sc is None or pf is None:
        try:
            uid = int(user_id or 0)
        except (TypeError, ValueError):
            uid = 0
        try:
            conn = get_db()
            if mt in ("tv", "movie") and tmdb_id:
                if uid > 0:
                    row = conn.execute("SELECT vote_average, networks, release_date FROM followed WHERE user_id=? AND tmdb_id=?", (uid, tmdb_id,)).fetchone()
                else:
                    row = conn.execute("SELECT vote_average, networks, release_date FROM followed WHERE tmdb_id=?", (tmdb_id,)).fetchone()
                if row:
                    if sc is None:
                        sc = row["vote_average"]
                    if pf is None:
                        pf = _extract_platform_networks(row["networks"])
            elif mt == "anime" and anilist_id:
                if uid > 0:
                    row = conn.execute("SELECT score, studios FROM anime WHERE user_id=? AND anilist_id=?", (uid, anilist_id,)).fetchone()
                else:
                    row = conn.execute("SELECT score, studios FROM anime WHERE anilist_id=?", (anilist_id,)).fetchone()
                if row:
                    if sc is None:
                        sc = row["score"]
                    if pf is None and row["studios"]:
                        pf = str(row["studios"]).strip()
            conn.close()
        except Exception:
            pass
    card = {
        "title": title,
        "media_type": mt,
        "score": sc,
        "platform": pf or "",
        "poster_url": poster or "",
        "status_line": status_line or "",
        "status_color": status_color or "#22c55e",
    }
    return card


def _fetch_show_bundle(tmdb_id, extra_titles=()):
    """/tv + sezon verisini bir kez çeker.
    Dönüş: {"seasons": {no: season_data}, "tvmaze_times": ...} ya da None.
    extra_titles: TVmaze saat eşleşmesi için denenecek ek başlıklar."""
    data = tmdb_request(f"/tv/{tmdb_id}")
    if not data:
        return None
    tvmaze_times = None
    titles = [data.get("original_name"), data.get("name")]
    titles.extend(extra_titles or ())
    for t in titles:
        if t:
            tvmaze_times = _tvmaze_episode_times(t)
            if tvmaze_times is not None:
                break
    seasons = {}
    for season in data.get("seasons", []):
        season_number = season.get("season_number")
        if season_number is None or season_number == 0:
            continue
        season_data = tmdb_request(f"/tv/{tmdb_id}/season/{season_number}")
        if season_data:
            seasons[season_number] = season_data
    return {"seasons": seasons, "tvmaze_times": tvmaze_times}


def _write_episodes(conn, follow, bundle):
    """Bölüm satırlarını tek follow_id'ye yazar. Upsert yalnız tarih/saat/ad/süre
    yazar — watched/notified dahil kullanıcı verilerine DOKUNULMAZ.
    Per-bölüm runtime kaydedilir; show runtime NULL ise ilk mevcut bölüm
    süresi ile doldurulur (COALESCE fallback'i için)."""
    follow_id = follow["id"]
    seasons = bundle.get("seasons") or {}
    tvmaze_times = bundle.get("tvmaze_times")
    hint = None
    for season_number, season_data in seasons.items():
        for ep in season_data.get("episodes", []):
            ep_num = ep.get("episode_number")
            air_date = ep.get("air_date")
            if not air_date:
                continue
            ep_name = ep.get("name") or ""
            ep_runtime = ep.get("runtime")
            if ep_runtime:
                hint = hint or ep_runtime
            air_time = None
            if tvmaze_times is not None:
                air_time = tvmaze_times.get((season_number, ep_num))
            if air_time:
                try:
                    air_date = datetime.datetime.fromtimestamp(
                        air_time, datetime.timezone.utc
                    ).date().isoformat()
                except (ValueError, OSError, OverflowError):
                    air_date = ep.get("air_date")
            conn.execute(
                "INSERT INTO episodes (follow_id, season, episode, air_date, air_time, name, runtime) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(follow_id, season, episode) "
                "DO UPDATE SET air_date=excluded.air_date, air_time=excluded.air_time, "
                "name=excluded.name, runtime=excluded.runtime",
                (follow_id, season_number, ep_num, air_date, air_time, ep_name, ep_runtime),
            )
    try:
        cur_rt = follow["runtime"] if ("runtime" in follow.keys()) else None
    except Exception:
        cur_rt = None
    if hint and not cur_rt:
        try:
            conn.execute("UPDATE followed SET runtime=? WHERE id=? AND runtime IS NULL", (hint, follow_id))
        except Exception:
            pass


def save_watch_snapshot(conn, uid, kind, ident, payload_items):
    """Taşınırken otomatik işaretlenen bölümlerin kaydı (geri taşımada restore)."""
    conn.execute(
        "INSERT OR REPLACE INTO watched_snapshot (user_id, kind, ident, payload) VALUES (?, ?, ?, ?)",
        (uid, kind, ident, json.dumps(payload_items)),
    )


def pop_watch_snapshot(conn, uid, kind, ident):
    """Snapshot'ı okuyup siler; kayıt yoksa None döner."""
    row = conn.execute(
        "SELECT payload FROM watched_snapshot WHERE user_id=? AND kind=? AND ident=?",
        (uid, kind, ident),
    ).fetchone()
    if row is None:
        return None
    conn.execute(
        "DELETE FROM watched_snapshot WHERE user_id=? AND kind=? AND ident=?",
        (uid, kind, ident),
    )
    try:
        return json.loads(row["payload"])
    except (ValueError, TypeError):
        return None


def sync_episodes(conn, follow):
    """Takip edilen dizinin tüm sezon/bölüm tarihlerini episodes tablosuna işler."""
    if follow["media_type"] != "tv":
        return
    try:
        bundle = _fetch_show_bundle(follow["tmdb_id"], (follow["title"],))
    except Exception:
        return
    if not bundle:
        return
    _write_episodes(conn, follow, bundle)
    conn.commit()


def sync_episodes_multi(conn, follows):
    """Aynı diziyi takip eden TÜM satırlar için tek fetch + satır-bazlı yazım
    (aile ölçeği tekillemesi). Fetch paylaşılır, yazımlar follow_id bazlıdır;
    watched dahil kullanıcı verilerine dokunulmaz. Satır hatası diğerlerini
    durdurmaz (fail-soft)."""
    groups = {}
    for follow in follows:
        if follow["media_type"] != "tv":
            continue
        groups.setdefault((follow["media_type"], follow["tmdb_id"]), []).append(follow)
    for (_mt, tmdb_id), rows in groups.items():
        try:
            bundle = _fetch_show_bundle(tmdb_id, [r["title"] for r in rows])
        except Exception:
            continue
        if not bundle:
            continue
        for r in rows:
            try:
                _write_episodes(conn, r, bundle)
            except Exception:
                continue
    conn.commit()


def build_episode_message(title, media_type, season, episode, date, poster_path=None):
    media_label = "Dizi" if media_type == "tv" else "Film"
    text = (
        f"*{title}* yeni bölüm yayında!\n\n"
        f"{media_label} - Sezon {season} · Bölüm {episode}\n"
        f"Tarih: {date}"
    )
    if poster_path:
        return text, TMDB_IMAGE_BASE + poster_path
    return text, None


def build_movie_message(title, date, poster_path=None):
    text = f"*{title}* bugün yayında!\n\nFilm - Tarih: {date}"
    if poster_path:
        return text, TMDB_IMAGE_BASE + poster_path
    return text, None


def _logged_job(flow):
    """Is (run) grubu: isin tum dis istekleri tek `run` kimligiyle loglanir (2.19.25)."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            try:
                import query_log
                query_log.begin_run(flow)
            except Exception:
                query_log = None
            try:
                return fn(*a, **kw)
            finally:
                try:
                    if query_log:
                        query_log.end_run()
                except Exception:
                    pass
        return wrapper
    return deco


@_logged_job("sync.releases")
def sync_releases():
    """Takip edilen dizi/film verilerini TMDB/TVMaze'den güncelleyip DB'ye işler (dizi bölümleri + film detayları, anime hariç)."""
    conn = get_db()
    follows = conn.execute("SELECT * FROM followed").fetchall()
    # Dizi sezon taraması grup başına tek fetch (aile tekillemesi)
    sync_episodes_multi(conn, follows)
    for follow in follows:
        if follow["media_type"] == "tv":
            continue
        elif follow["media_type"] == "movie":
            try:
                info = get_tmdb_info("movie", follow["tmdb_id"])
                if info:
                    conn.execute(
                        "UPDATE followed SET vote_average=?, networks=?, release_date=? WHERE id=?",
                        (
                            info.get("vote_average") or 0,
                            json.dumps(info.get("networks") or []),
                            info.get("release_date") or follow["release_date"],
                            follow["id"],
                        ),
                    )
                    _credits = get_tmdb_credits("movie", follow["tmdb_id"])
                    save_details(conn, follow["id"], info, _credits.get("cast") or [], directors=_credits.get("directors") or [])
            except Exception:
                pass
    conn.commit()
    conn.close()
    bump()


def _notif_create(title, message, type_name, media_type=None, tmdb_id=None, anilist_id=None, season=None, episode=None, poster_path=None, cover_url=None, kind=None, ident=None, notified_date=None, remote_url=None, card=None, score=None, platform=None, status_line=None, status_color=None, user_id=None):
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    try:
        # tip kapalıysa hiçbir kanala gitmez (per-user)
        if not _notif_enabled(type_name, user_id=uid):
            return
        # dedupe: aynı bildirim daha önce üretildiyse HİÇBİR kanala gidemez
        # (bildirim merkezi + telegram + ntfy + discord + e-posta)
        from notification import is_duplicate_notification
        if is_duplicate_notification(type_name, title, season=season, episode=episode, tmdb_id=tmdb_id, anilist_id=anilist_id, notified_date=notified_date, user_id=uid):
            return
        from notification import create_notification
        # derive remote url if not given
        if not remote_url:
            if poster_path:
                remote_url = TMDB_IMAGE_BASE + poster_path
            elif cover_url:
                remote_url = cover_url
        # determine kind/ident if not given
        if not kind:
            if media_type == "anime" or anilist_id:
                kind = "anime"
            elif media_type == "movie":
                kind = "movie"
            elif media_type == "tv":
                kind = "tv"
        if not ident:
            ident = anilist_id if kind == "anime" else tmdb_id
        # poster_local for display
        poster_local = None
        try:
            from poster_store import poster_local_path
            if kind and ident:
                poster_local = poster_local_path(kind, ident, "w500")
                # verify exists, else None
                from poster_store import filesystem_path_from_web
                if poster_local:
                    fs = filesystem_path_from_web(poster_local)
                    if not fs or not os.path.exists(fs):
                        poster_local = None
        except Exception:
            poster_local = None
        # bildirim merkezi (in-app) — kendi anahtarıyla açılır/kapanır (per-user)
        try:
            from db import get_user_setting as _gus
            _center = _gus(uid, "notif_center_enabled")
            if _center is None:
                _center = get_setting("notif_center_enabled")
        except Exception:
            _center = get_setting("notif_center_enabled")
        if _center != "0":
            create_notification(title, message, type_name, media_type=media_type, tmdb_id=tmdb_id, anilist_id=anilist_id, season=season, episode=episode, poster_local=poster_local, remote_poster_url=remote_url, kind_for_thumb=kind, ident_for_thumb=ident, notified_date=notified_date, user_id=uid)
        # kartli e-posta icin card hazirla (web UI #0f1117/#171a23 replikasi)
        if card is None:
            # status renk haritasi (discord embed ile ayni)
            cmap = {
                "status_ended": "#22c55e", "anime_finished": "#22c55e",
                "status_canceled": "#ef4444", "anime_cancelled": "#ef4444",
                "status_pilot": "#60a5fa", "season_planned": "#60a5fa", "movie_rescheduled": "#60a5fa", "anime_episodes": "#60a5fa",
                "status_returning": "#f97316", "season_production": "#f97316", "season_upcoming": "#f97316",
                "season_start": "#f97316",
                "unwatched_bulk": "#f97316", "anime_unwatched_bulk": "#f97316",
                "vote_threshold": "#22c55e", "networks_changed": "#d4a017", "anime_hiatus": "#f59e0b", "anime_releasing": "#22c55e",
                # bugun yayinda/vizyonda: kart mavisi
                "episode_today": "#60a5fa", "anime_episode_today": "#60a5fa", "movie_today": "#60a5fa",
            }
            _base_color = type_name[4:] if type_name.startswith("doc_") else type_name
            eff_color = status_color or cmap.get(type_name) or cmap.get(_base_color, "#22c55e")
            eff_sl = status_line
            if eff_sl is None:
                # message'den title'i syir, kisa status satiri olustur
                if message and title and message.startswith(title):
                    eff_sl = message[len(title):].strip(" -:–—\n")
                eff_sl = (eff_sl or message or "").strip()[:120]
            try:
                card = _build_card(title, media_type=media_type, tmdb_id=tmdb_id, anilist_id=anilist_id, poster_path=poster_path, cover_url=cover_url, remote_url=remote_url, score=score, platform=platform, status_line=eff_sl, status_color=eff_color, user_id=uid)
            except Exception:
                card = None
        # dış kanal push'u — tek noktadan tüm kanallar (telegram+ntfy+discord+e-posta).
        # Faz 32c: tum tipler ayni kisisel akistan gecer; ayri push yolu yok.
        # E-posta tampona tutulur; kosu sonunda tek ozet mail atilir.
        from notifications import notify_all
        # Dis push metnine yapim adini ekle (bildirim merkezi title'i zaten ayri gosterir;
        # mesajlardan "{title} " oneki kaldirilmisti -> push isimsiz kaliyordu).
        push_text = message
        if title and message and not str(message).startswith(str(title)):
            push_text = f"{title} {message}"
        notify_all(push_text, remote_url, card=card, user_id=uid, hold_email=True)
    except Exception as e:
        print(f"notif create failed {type_name} {title}: {e}")


def check_notifications(user_id=None):
    """19 senaryo için bildirim üretir (in-app). Dedupe ile günde bir kez.
    Faz 32: user_id verilmezse tum aktif kullanicilar icin sirayla calisir."""
    if user_id is None:
        for uid in _active_uids():
            try:
                check_notifications(user_id=uid)
            except Exception as e:
                print(f"check_notifications uid={uid} failed: {e}")
        return
    uid = int(user_id or 0)
    today = _user_today(uid)
    now_ts = int(datetime.datetime.now().timestamp())
    conn = get_db()
    # 1-2: TV episode today + season start today
    for r in conn.execute("SELECT * FROM followed WHERE user_id=? AND media_type='tv' AND COALESCE(archived,0)=0", (uid,)).fetchall():
        is_doc = _is_doc_row(r)
        # 1 episode_today (merkez + dis push tek geciste; makbuz notified_date=today dedupe'u)
        rows = conn.execute("SELECT season, episode, air_date FROM episodes WHERE follow_id=? AND air_date=?", (r["id"], today)).fetchall()
        for ep in rows:
            msg = f"{ep['season']}. Sezon {ep['episode']}. Bölüm Bugün Yayınlanacak"
            _notif_create(r["title"], msg, _doc_type(is_doc, "episode_today"), media_type="tv", tmdb_id=r["tmdb_id"], season=ep["season"], episode=ep["episode"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=today, remote_url=TMDB_IMAGE_BASE + r["poster_path"] if r["poster_path"] else None, user_id=uid)
        # 2 season_start today via season_list
        try:
            sl = json.loads(r["season_list"] or "[]")
            for s in sl:
                if s.get("air_date") == today and s.get("season_number"):
                    msg = f"{s['season_number']}. Sezon Bugün Başlıyor"
                    _notif_create(r["title"], msg, _doc_type(is_doc, "season_start"), media_type="tv", tmdb_id=r["tmdb_id"], season=s["season_number"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=today, user_id=uid)
        except Exception:
            pass
        # 3-8 status — snapshot bazlı: yalnızca durum DEĞİŞİNCE bir kez bildirilir
        status = (r["status"] or "").strip()
        if status:
            try:
                snap = json.loads(_sget(uid, "notif_tv_status") or "{}")
                key = f"tv_{r['tmdb_id']}"
                prev = snap.get(key)
                fire = prev is not None and prev != status
                if fire:
                    if status == "Planned":
                        _notif_create(r["title"], "4. Sezon Planlanıyor" if "Sezon" not in r["title"] else "Planlanıyor", _doc_type(is_doc, "season_planned"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "In Production":
                        _notif_create(r["title"], "4. Sezon Yapım Aşamasında", _doc_type(is_doc, "season_production"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Ended":
                        _notif_create(r["title"], "Bitti", _doc_type(is_doc, "status_ended"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status in ("Canceled", "Cancelled"):
                        _notif_create(r["title"], "İptal Edildi", _doc_type(is_doc, "status_canceled"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Pilot":
                        _notif_create(r["title"], "Pilot Bölüm", _doc_type(is_doc, "status_pilot"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Returning Series":
                        _notif_create(r["title"], "Yeni Sezon Bekleniyor", _doc_type(is_doc, "status_returning"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                snap[key] = status
                from db import set_setting
                _sset(uid, "notif_tv_status", json.dumps(snap))
            except Exception:
                pass
        # 9 season upcoming (season count increase but no date)
        # 9 season upcoming — yalnızca sezon sayısı ARTTIĞINDA bir kez bildirilir
        try:
            sl = json.loads(r["season_list"] or "[]")
            cand = next((s.get("season_number") for s in sl if s.get("season_number") and not s.get("air_date")), None)
            snap = json.loads(_sget(uid, "notif_season_upcoming") or "{}")
            key = f"tv_{r['tmdb_id']}"
            prev = snap.get(key)
            if cand and prev is not None and cand > prev:
                _notif_create(r["title"], f"{cand}. Sezon Yakında", _doc_type(is_doc, "season_upcoming"), media_type="tv", tmdb_id=r["tmdb_id"], season=cand, poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=f"upcoming_{cand}", user_id=uid)
            if cand:
                snap[key] = cand
                from db import set_setting
                _sset(uid, "notif_season_upcoming", json.dumps(snap))
        except Exception:
            pass
        # 10-11 rescheduled / removed would need snapshot; skip for now but create generic if air_date changed recently? Use episodes table already has latest, snapshot via settings
        # 12 unwatched_bulk — sadece takipte (in_watched!=1 ve izlenmemişe atılmamış) için.
        # Kapılar: started>=1, cnt>=3, aktifte dün-yayın şartı; 7-gün kayan pencere (son bulk <7 gün ise sessiz).
        try:
            if int(r["in_watched"] or 0) == 1:
                raise StopIteration  # izlenmişe atılmış → artık takipte değil
            # izlenmemişe atılmış kart takipten çıkmıştır (takipte değilse episodes/follow silinir; kalan izlenmemiş sorgusu zaten fire'ı engeller)
            started = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)).fetchone()["c"]
            if started < 1:
                raise StopIteration
            # 7-gün kayan pencere: son bulk bildiriminden 7 gün dolmadıysa ateşleme yok
            last = conn.execute("SELECT created_at FROM notifications WHERE type=? AND tmdb_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1", (_doc_type(is_doc, "unwatched_bulk"), r["tmdb_id"], uid)).fetchone()
            if last and (now_ts - int(last["created_at"] or 0)) < 7 * 86400:
                raise StopIteration
            bulk_status = (r["status"] or "").strip()
            finished = bulk_status in ("Ended", "Canceled", "Cancelled")
            fire = False
            bulk_key = today  # notified_date artık günün tarihi (dedupe ikinci kapı)
            if not finished:
                yesterday = (datetime.date.fromisoformat(today) - datetime.timedelta(days=1)).isoformat()
                aired_yesterday = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND air_date=?", (r["id"], yesterday)).fetchone()["c"]
                if aired_yesterday > 0:
                    fire = True
                else:
                    fire = False
            else:
                fire = True
            if fire:
                cnt = conn.execute("SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=0 AND air_date IS NOT NULL AND air_date < ?", (r["id"], today)).fetchone()["c"]
                if cnt >= 3:
                    _notif_create(r["title"], f"{cnt} bölüm birikti", _doc_type(is_doc, "unwatched_bulk"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=bulk_key, user_id=uid)
        except StopIteration:
            pass
        except Exception:
            pass
        # 13 vote threshold: check vote_average jump stored in settings snapshot
        try:
            snap_raw = _sget(uid, "notif_vote_snapshot") or "{}"
            snap = json.loads(snap_raw) if snap_raw else {}
            key = f"tv_{r['tmdb_id']}"
            prev = snap.get(key)
            cur = r["vote_average"] or 0
            if prev is not None and cur - prev >= 0.5 and (r["vote_count"] or 0) > 100:
                _notif_create(r["title"], f"puanı yükseldi: {prev:.1f} → {cur:.1f}", _doc_type(is_doc, "vote_threshold"), media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=f"vote_{cur:.1f}", user_id=uid)
            snap[key] = cur
            # save back later
            from db import set_setting
            _sset(uid, "notif_vote_snapshot", json.dumps(snap))
        except Exception:
            pass
    # 14 movie today
    for m in conn.execute("SELECT * FROM followed WHERE user_id=? AND media_type='movie' AND COALESCE(archived,0)=0", (uid,)).fetchall():
        is_doc = _is_doc_row(m)
        if m["release_date"] == today:
            _notif_create(m["title"], "Bugün Vizyona Girdi", _doc_type(is_doc, "movie_today"), media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=today, user_id=uid)
        # 15 movie rescheduled snapshot
        try:
            snap_raw = _sget(uid, "notif_movie_snapshot") or "{}"
            snap = json.loads(snap_raw) if snap_raw else {}
            key = f"movie_{m['tmdb_id']}"
            prev = snap.get(key)
            cur = m["release_date"]
            if prev and prev != cur and cur:
                _notif_create(m["title"], f"vizyon tarihi değişti: {prev} → {cur}", _doc_type(is_doc, "movie_rescheduled"), media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=cur, user_id=uid)
            snap[key] = cur
            from db import set_setting
            _sset(uid, "notif_movie_snapshot", json.dumps(snap))
        except Exception:
            pass
        # 16 networks changed
        try:
            snap_raw = _sget(uid, "notif_network_snapshot") or "{}"
            snap = json.loads(snap_raw) if snap_raw else {}
            key = f"net_{m['tmdb_id']}"
            prev = snap.get(key)
            cur = m["networks"]
            if prev and prev != cur and cur:
                _notif_create(m["title"], "Platform bilgisi güncellendi", _doc_type(is_doc, "networks_changed"), media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=cur, user_id=uid)
            snap[key] = cur
            from db import set_setting
            _sset(uid, "notif_network_snapshot", json.dumps(snap))
        except Exception:
            pass
    conn.close()
    bump()


def check_anime_notifications(user_id=None):
    """Anime için ayrı cron: bugün bölümü + durum değişimleri.
    Faz 32: user_id verilmezse tum aktif kullanicilar icin sirayla calisir."""
    if user_id is None:
        for uid in _active_uids():
            try:
                check_anime_notifications(user_id=uid)
            except Exception as e:
                print(f"check_anime uid={uid} failed: {e}")
        return
    uid = int(user_id or 0)
    today = _user_today(uid)
    conn = get_db()
    for a in conn.execute("SELECT * FROM anime WHERE user_id=? AND COALESCE(archived,0)=0", (uid,)).fetchall():
        # 17 episode today
        rows = conn.execute("SELECT episode, air_at FROM anime_episodes WHERE anime_id=? AND air_at IS NOT NULL", (a["id"],)).fetchall()
        for ae in rows:
            try:
                d = datetime.datetime.fromtimestamp(ae["air_at"], datetime.timezone.utc).date().isoformat()
                if d == today:
                    _notif_create(a["title"], f"{ae['episode']}. Bölüm Bugün Yayında", "anime_episode_today", media_type="anime", anilist_id=a["anilist_id"], episode=ae["episode"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=today, user_id=uid)
            except Exception:
                pass
        # 18-19 anime durumları — snapshot bazlı: yalnızca durum DEĞİŞİNCE bir kez
        status = (a["status"] or "").strip()
        snap = {}
        key = f"anime_{a['anilist_id']}"
        prev = None
        try:
            snap = json.loads(_sget(uid, "notif_anime_status") or "{}")
            prev = snap.get(key)
        except Exception:
            pass
        status_changed = prev is not None and prev != status
        if status == "HIATUS":
            if status_changed:
                _notif_create(a["title"], "Ara Verdi", "anime_hiatus", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "CANCELLED":
            if status_changed:
                _notif_create(a["title"], "İptal Edildi", "anime_cancelled", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "FINISHED":
            if status_changed:
                _notif_create(a["title"], "Bitti", "anime_finished", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "RELEASING":
            if prev == "NOT_YET_RELEASED" and status == "RELEASING":
                _notif_create(a["title"], "Yayına Başladı", "anime_releasing", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        if status:
            try:
                snap[key] = status
                from db import set_setting
                _sset(uid, "notif_anime_status", json.dumps(snap))
            except Exception:
                pass
        try:
            snap_raw = _sget(uid, "notif_anime_ep") or "{}"
            snap = json.loads(snap_raw) if snap_raw else {}
            key = f"ae_{a['anilist_id']}"
            prev = snap.get(key)
            cur = a["episodes"]
            if prev and prev != cur:
                _notif_create(a["title"], f"bölüm sayısı {prev} → {cur}", "anime_episodes", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=str(cur), user_id=uid)
            snap[key] = cur
            from db import set_setting
            _sset(uid, "notif_anime_ep", json.dumps(snap))
        except Exception:
            pass
        # 20 anime_unwatched_bulk — sadece takipte (in_watched!=1) için.
        # Kapılar: started>=1, cnt>=3, RELEASING'te dün-yayın şartı; 7-gün kayan pencere.
        try:
            if int(a["in_watched"] or 0) == 1:
                raise StopIteration  # izlenmişe atılmış → artık takipte değil
            started = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (a["id"],)).fetchone()["c"]
            if started < 1:
                raise StopIteration
            last = conn.execute("SELECT created_at FROM notifications WHERE type='anime_unwatched_bulk' AND anilist_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1", (a["anilist_id"], uid)).fetchone()
            if last and (now_ts - int(last["created_at"] or 0)) < 7 * 86400:
                raise StopIteration
            a_status = (a["status"] or "").strip()
            finished = a_status in ("FINISHED", "CANCELLED", "HIATUS")
            fire = False
            bulk_key = today
            if not finished:
                yesterday = (datetime.date.fromisoformat(today) - datetime.timedelta(days=1)).isoformat()
                aired_yesterday = False
                for ae in conn.execute("SELECT air_at FROM anime_episodes WHERE anime_id=? AND air_at IS NOT NULL AND watched=0", (a["id"],)).fetchall():
                    if datetime.datetime.fromtimestamp(ae["air_at"], datetime.timezone.utc).date().isoformat() == yesterday:
                        aired_yesterday = True
                        break
                if aired_yesterday:
                    fire = True
            else:
                fire = True
            if fire:
                cnt = conn.execute("SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=0 AND air_at IS NOT NULL AND air_at < ?", (a["id"], int(datetime.datetime.now(datetime.timezone.utc).timestamp()))).fetchone()["c"]
                if cnt >= 3:
                    _notif_create(a["title"], f"{cnt} bölüm birikti", "anime_unwatched_bulk", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=bulk_key, user_id=uid)
        except StopIteration:
            pass
        except Exception:
            pass
    conn.close()
    bump()


@_logged_job("backfill")
def backfill_votes():
    """Takip edilen dizi/film ve anime verilerini TMDB/AniList'ten güncel çekip DB'yi yeniler."""
    conn = get_db()
    # Sezon taraması sync_releases'in işidir (05:10); burada tekrarlanmaz (A).
    # info/cast grup başına tek fetch (aile tekillemesi), yazım satır-bazlıdır.
    groups = {}
    for row in conn.execute("SELECT * FROM followed").fetchall():
        groups.setdefault((row["media_type"], row["tmdb_id"]), []).append(row)
    for (_mt, _tid), rows in groups.items():
        try:
            info = get_tmdb_info(_mt, _tid)
        except Exception:
            continue
        if not info:
            continue
        try:
            _credits = get_tmdb_credits(_mt, _tid)
            cast = _credits.get("cast") or []
            directors = _credits.get("directors") or []
        except Exception:
            cast = []
            directors = []
        for row in rows:
            try:
                conn.execute(
                    "UPDATE followed SET vote_average=?, networks=?, release_date=? WHERE id=?",
                    (
                        info.get("vote_average") or 0,
                        json.dumps(info.get("networks") or []),
                        info.get("release_date") or row["release_date"],
                        row["id"],
                    ),
                )
                save_details(conn, row["id"], info, cast, directors=directors)
            except Exception:
                continue
    for row in conn.execute("SELECT * FROM anime").fetchall():
        detail = anilist_detail(row["anilist_id"])
        if detail:
            studios = [s.get("name") for s in (detail.get("studios") or {}).get("nodes") or [] if s.get("name")]
            conn.execute(
                "UPDATE anime SET score=?, studios=?, episodes=? WHERE id=?",
                (
                    detail.get("averageScore"),
                    studios[0] if studios else None,
                    detail.get("episodes") or row["episodes"],
                    row["id"],
                ),
            )
            save_anime_details(conn, row["id"], detail)
            schedule = anilist_schedule(row["anilist_id"])
            if schedule and schedule.get("airingSchedule"):
                for node in schedule["airingSchedule"].get("nodes") or []:
                    conn.execute(
                        "INSERT INTO anime_episodes (anime_id, episode, air_at) "
                        "VALUES (?, ?, ?) "
                        "ON CONFLICT(anime_id, episode) DO UPDATE SET air_at=excluded.air_at",
                        (row["id"], node.get("episode"), node.get("airingAt")),
                    )
    _reset_stale_watched(conn)
    conn.commit()
    conn.close()
    bump()


def early_watched_threshold():
    """Ayarlardaki erken-izlenmiş eşiği (gün). Değer yoksa/geçersizse 14."""
    try:
        v = int(get_setting("early_watched_days") or 14)
    except (TypeError, ValueError):
        return 14
    return v if v > 0 else 14


def _days_until_date(date_str, today=None):
    try:
        d = datetime.date.fromisoformat(str(date_str or "").strip())
    except ValueError:
        return None
    try:
        t = datetime.date.fromisoformat(today or today_str())
    except ValueError:
        return None
    return (d - t).days


def can_early_watch_tv(conn, follow_id, threshold=None):
    """Yayınına eşikten fazla gün kalan ve yayınlanmış bölümü eksiksiz izlenmiş dizi erken-izlenebilir."""
    thr = threshold if threshold is not None else early_watched_threshold()
    today = today_str()
    try:
        aired_open = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=0 AND (air_date IS NULL OR air_date<=?)",
            (follow_id, today),
        ).fetchone()["c"]
    except Exception:
        return False
    if aired_open:
        return False
    try:
        row = conn.execute(
            "SELECT MIN(air_date) m FROM episodes WHERE follow_id=? AND air_date IS NOT NULL AND air_date>?",
            (follow_id, today),
        ).fetchone()
    except Exception:
        return False
    if not row or not row["m"]:
        return False
    days = _days_until_date(row["m"], today)
    return days is not None and days > thr


def can_early_watch_movie(release_date, threshold=None):
    """Vizyonuna eşikten fazla gün kalan film erken-izlenebilir."""
    thr = threshold if threshold is not None else early_watched_threshold()
    if not release_date:
        return False
    days = _days_until_date(release_date)
    return days is not None and days > thr


def can_early_watch_anime(conn, anime_id, threshold=None):
    """Yayınına eşikten fazla gün kalan ve yayınlanmış bölümü eksiksiz izlenmiş anime erken-izlenebilir."""
    thr = threshold if threshold is not None else early_watched_threshold()
    now = int(datetime.datetime.now().timestamp())
    try:
        aired_open = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=0 AND (air_at IS NULL OR air_at<=?)",
            (anime_id, now),
        ).fetchone()["c"]
    except Exception:
        return False
    if aired_open:
        return False
    try:
        row = conn.execute(
            "SELECT MIN(air_at) m FROM anime_episodes WHERE anime_id=? AND air_at IS NOT NULL AND air_at>?",
            (anime_id, now),
        ).fetchone()
    except Exception:
        return False
    if not row or not row["m"]:
        return False
    try:
        days = (int(row["m"]) - now) // 86400
    except (TypeError, ValueError):
        return False
    return days > thr


def is_final_status(kind, status):
    """Geri dönmeyecek statü: dizi Ended/Canceled, anime FINISHED/CANCELLED, film Released."""
    s = str(status or "").strip()
    if kind == "anime":
        return s in ("FINISHED", "CANCELLED")
    if kind == "movie":
        return s == "Released"
    return s in ("Ended", "Canceled", "Cancelled")


def _reset_stale_watched(conn):
    """in_watched=1 olup artık tamamlanmamış (yeni bölüm yayınlanan) yapımları izlenmişten çıkarır.
    Erken-izlenmiş (yayını eşikten uzak) olanlar korunur; tarihi eşiğe inenler otomatik Takip'e döner."""
    for r in conn.execute(
        "SELECT id, status FROM followed WHERE media_type='tv' AND in_watched=1 AND COALESCE(archived,0)=0"
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total <= 0:
            continue
        if total == watched_cnt:
            continue
        try:
            st = r["status"] if "status" in r.keys() else None
            if is_final_status("tv", st):
                continue
        except Exception:
            pass
        if can_early_watch_tv(conn, r["id"]):
            continue
        conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
    for r in conn.execute(
        "SELECT id, release_date, status FROM followed WHERE media_type='movie' AND in_watched=1 AND COALESCE(archived,0)=0"
    ).fetchall():
        watched = conn.execute(
            "SELECT watched FROM followed WHERE id=?", (r["id"],)
        ).fetchone()["watched"]
        if watched == 1:
            continue
        try:
            st = r["status"] if "status" in r.keys() else None
            if is_final_status("movie", st):
                continue
        except Exception:
            pass
        try:
            rel = r["release_date"] if "release_date" in r.keys() else None
        except Exception:
            rel = None
        if can_early_watch_movie(rel):
            continue
        conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
    for r in conn.execute(
        "SELECT id, status FROM anime WHERE in_watched=1 AND COALESCE(archived,0)=0"
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total <= 0:
            continue
        if total == watched_cnt:
            continue
        try:
            st = r["status"] if "status" in r.keys() else None
            if is_final_status("anime", st):
                continue
        except Exception:
            pass
        if can_early_watch_anime(conn, r["id"]):
            continue
        conn.execute("UPDATE anime SET in_watched=0 WHERE id=?", (r["id"],))


def sync_genres():
    """TMDB ve AniList türlerini DB'ye işler; eksikleri ekler."""
    conn = get_db()
    for source, names in (("tmdb", _fetch_tmdb_genres()), ("anilist", _fetch_anilist_genres())):
        for name in names:
            conn.execute(
                "INSERT OR IGNORE INTO genres (source, name) VALUES (?, ?)",
                (source, name),
            )
    conn.commit()
    conn.close()
    bump()
    print("sync_genres tamam", len(_tmdb_genre_names()), len(_anilist_genre_names()), flush=True)


def refresh_recommendations_job():
    """Öneri bölümlerini gecede bir kez rotasyonla tazeler (fail-soft):
    erişim yoksa eski kartlar durur, kullanıcı etkilenmez."""
    try:
        from recommendations import refresh_all_sections
        refresh_all_sections()
        print("rec refresh tamam", flush=True)
    except Exception as e:
        print("rec refresh failed:", e, flush=True)


def feed_refresh_job(source):
    """Oneriler beslemesi: bir kaynagin ham cache'lerini tazeler (fail-soft)."""
    try:
        from feed import refresh_feed_source
        refresh_feed_source(source)
        print(f"feed refresh tamam ({source})", flush=True)
    except Exception as e:
        print(f"feed refresh failed ({source}): {e}", flush=True)


def refresh_fav_listings_job():
    """Favori oyuncu/tur listelerini guncelle (fail-soft, rec_hour ile ayni saatte)."""
    try:
        from fav_listings import refresh_all_fav_listings
        refresh_all_fav_listings()
        print("fav listings refresh tamam", flush=True)
    except Exception as e:
        print("fav listings refresh failed:", e, flush=True)


def stremio_prune_job():
    """Stremio sinyal tamponunu buda (gecelik, fail-soft)."""
    try:
        from routes.stremio import prune_stremio_signals
        prune_stremio_signals()
    except Exception as e:
        print("stremio prune failed:", e, flush=True)


def geo_refresh_job():
    """Pi konumunu tazele (gunde 1, fail-soft): DB bayatsa cozer, ulke
    degismisse takipci tz'leri gecerir + geo_moved_at damgalar."""
    try:
        from geo import refresh_pi_geo
        refresh_pi_geo()
    except Exception as e:
        print("geo refresh failed:", e, flush=True)


def pwdreset_prune_job():
    """3 gunu dolan active sifre isteklerini done isaretle (gecelik, fail-soft)."""
    try:
        import datetime as _dt
        cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=3)).strftime("%Y-%m-%d %H:%M")
        conn = get_db()
        try:
            conn.execute(
                "UPDATE password_resets SET status='done' WHERE status='active' AND created_at < ?",
                (cutoff,),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print("pwdreset prune failed:", e, flush=True)


MAINT_BACKUP_KEEP = 30


def _maint_backup():
    """Yerel DB anlik goruntusu (VACUUM INTO, kilitsiz) + 30 rotasyon.
    Donus: yedek yolu. Patlarsa exception (job durur + admin uyarilir)."""
    import datetime as _dt
    from config import BASE_DIR, DB_PATH
    d = os.path.join(BASE_DIR, "backup", "db")
    os.makedirs(d, exist_ok=True)
    ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(d, "nextep-%s.db" % ts)
    conn = get_db()
    try:
        safe = path.replace("'", "''")
        conn.execute("VACUUM INTO '%s'" % safe)
    finally:
        conn.close()
    files = sorted(f for f in os.listdir(d) if f.startswith("nextep-") and f.endswith(".db"))
    while len(files) > MAINT_BACKUP_KEEP:
        try:
            os.remove(os.path.join(d, files.pop(0)))
        except Exception:
            break
    return path


def _maint_orphan_scan():
    """Yetim sayimi (salt-okunur): [(tablo, adet)]. Silme YOK."""
    out = []
    conn = get_db()
    try:
        for tbl in ("user_settings", "sessions", "password_resets", "followed",
                    "anime", "stremio_signals", "rec_cache", "notifications"):
            try:
                n = conn.execute(
                    "SELECT COUNT(*) c FROM %s WHERE user_id <> 0 AND user_id NOT IN (SELECT id FROM users)" % tbl
                ).fetchone()["c"]
            except Exception:
                n = 0
            out.append((tbl, int(n or 0)))
        for tbl, col, parent in (("episodes", "follow_id", "followed"),
                                ("cast", "follow_id", "followed"),
                                ("anime_episodes", "anime_id", "anime"),
                                ("anime_cast", "anime_id", "anime")):
            try:
                n = conn.execute(
                    "SELECT COUNT(*) c FROM %s WHERE %s NOT IN (SELECT id FROM %s)" % (tbl, col, parent)
                ).fetchone()["c"]
            except Exception:
                n = 0
            out.append((tbl, int(n or 0)))
        try:
            titles = conn.execute(
                "SELECT DISTINCT title FROM notifications WHERE type IN ('member_pending','password_reset')"
            ).fetchall()
            dead = 0
            for r in titles:
                t = (r["title"] or "").strip()
                if not t:
                    continue
                if not conn.execute("SELECT 1 FROM users WHERE username=? LIMIT 1", (t,)).fetchone():
                    dead += conn.execute(
                        "SELECT COUNT(*) c FROM notifications WHERE title=? AND type IN ('member_pending','password_reset')",
                        (t,),
                    ).fetchone()["c"]
            out.append(("member_notif_dead", int(dead)))
        except Exception:
            out.append(("member_notif_dead", 0))
    finally:
        conn.close()
    return out


def _maint_alert(err):
    """Yedek patlarsa adminlere push (dolu kanallar; mail haric, merkez yok)."""
    try:
        from db import get_user_setting
        from messages_i18n import render as _render
        from notifications import send_discord, send_ntfy, send_telegram
        conn = get_db()
        try:
            admins = [int(r["id"]) for r in conn.execute(
                "SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id").fetchall()]
        finally:
            conn.close()
        for uid in admins:
            try:
                lang = (get_user_setting(uid, "language") or "tr-TR").split("-")[0]
                msg = _render("maint_backup_failed", lang, err=str(err)[:200])
                for fn in (send_telegram, send_ntfy, send_discord):
                    try:
                        fn(msg, user_id=uid)
                    except Exception:
                        pass
            except Exception:
                continue
    except Exception:
        pass


def db_maint_job():
    """Haftalik bakim (fail-soft): once yerel yedek (+30 rotasyon), sonra
    yetim taramasi (journal-only). Yedek patlarsa tarama KOSMAZ."""
    try:
        try:
            import query_log
            query_log.prune()          # 2.19.25: log/ budama (jsonl 30g, md 365g)
        except Exception:
            pass
    except Exception:
        pass
    try:
        try:
            path = _maint_backup()
            print("db maint backup:", path, flush=True)
        except Exception as e:
            print("db maint backup failed:", e, flush=True)
            _maint_alert(e)
            return
        try:
            findings = _maint_orphan_scan()
        except Exception as e:
            print("db maint scan failed:", e, flush=True)
            return
        total = sum(v for _, v in findings)
        if total:
            print("db maint orphans: " + ", ".join("%s=%d" % (k, v) for k, v in findings if v), flush=True)
        else:
            print("db maint clean", flush=True)
    except Exception as e:
        print("db maint failed:", e, flush=True)


def emby_sync_job():
    """Emby API senkronu (webhook'suz, 1.87) — yedek yoklama + durum tazeleme."""
    try:
        import emby_sync
        emby_sync.sync_once()
    except Exception as e:
        print(f"[emby] senkron job hata: {e}", flush=True)


def emby_token_health_job():
    """1.94 — Access Token gecerlilik kontrolu + otomatik yenileme."""
    try:
        import emby_sync
        # Token/parola hic yoksa sessizce gec.
        if not emby_sync.access_token() and not emby_sync.auth_password():
            return
        # force=False: yanlis parola sonrasi backoff'a uy (hesap kilitlenmesini onle).
        res = emby_sync.ensure_token(force=False)
        if not res.get("ok") and res.get("error") not in ("skipped",):
            print(f"[emby] token kontrol: {res.get('error')}", flush=True)
        elif res.get("renewed"):
            print("[emby] access token otomatik yenilendi", flush=True)
    except Exception as e:
        print(f"[emby] token kontrol hata: {e}", flush=True)


def app_update_job():
    """Uygulama güncelleme cron'u (fail-soft): yeni sürüm + oto-açık ise günceller."""
    try:
        from app_update import (
            check_update, apply_update, localhost_healthy,
            just_updated_within, rollback, UPDATE_WINDOW_SEC,
        )
        from notifications import notify_all

        local, remote, available, _known = check_update()
        if not available:
            return
        auto = (get_setting("app_auto_update") or "0").strip() == "1"
        if not auto:
            print(f"app_update_job: yeni sürüm mevcut ({local} -> {remote}), oto kapalı — beklendi", flush=True)
            return
        print(f"app_update_job: güncelleniyor ({local} -> {remote})", flush=True)
        try:
            from_ver, to_ver = apply_update()
        except Exception as e:
            print(f"app_update_job failed: {e}", flush=True)
            return
        # Restart sonrası sağlık bekle (uygulama ~40 sn'de açılır)
        ok = False
        for _ in range(12):
            import time as _t
            _t.sleep(10)
            if localhost_healthy(timeout=10):
                ok = True
                break
        if ok:
            print(f"app_update_job: {from_ver} -> {to_ver} sağlıklı", flush=True)
            try:
                notify_all(f"NextEp güncellendi: {from_ver} → {to_ver}.")
            except Exception:
                pass
        else:
            print("app_update_job: güncelleme sonrası sağlıksız — rollback", flush=True)
            rollback(reason=f"{from_ver} → {to_ver} sonrası sağlık kontrolü başarısız")
    except Exception as e:
        print(f"app_update_job failed: {e}", flush=True)


def jsver_check_job():
    """2.19: JS damga zinciri denetimi (fail-soft).

    Ayni modul iki farkli ?v= ile yuklenirse tarayici modulu iki kez degerlendirir;
    modul govdesindeki toggle dinleyicileri birbirini iptal eder (disli menusu /
    akordeonlar acilmaz). Bozuk zincir sessiz kalmasin: gunde 1 kez kanallara bildirim.
    """
    try:
        from jsver import check_root
        from db import set_setting

        probs = check_root()
        if not probs:
            print("[ui] js kontrol: temiz", flush=True)
            return
        msg = " | ".join(probs)
        print(f"[ui] UYARI js surum zinciri bozuk: {msg}", flush=True)
        sig = f"{today_str()}|{msg}"
        if (get_setting("jsver_last_alert") or "").strip() == sig:
            return
        set_setting("jsver_last_alert", sig)
        notify_all(
            "NextEp: JS sürüm damgası bozuk — Ayarlar (dişli) gibi butonlar çalışmayabilir. "
            "Sunucuda: python3 py/jsver.py bump"
        )
    except Exception as e:
        print(f"[ui] js kontrol hatasi: {e}", flush=True)


def backup_job():
    """Yedekleme cron'u (fail-soft): dolu olan TÜM hedeflere (rsync+samba) yollar."""
    try:
        mode = (get_setting("backup_mode") or "").strip()
        if not mode:
            return
        from backup_core import resolve_targets, do_backup

        targets = resolve_targets()
        if not targets:
            # Hedef yok (rsync/samba girilmemis): bos yere calisma, sessiz gec
            return
        try:
            results, remote_name = do_backup(mode, targets)
        except Exception as e:
            print("backup job failed:", e, flush=True)
            return
        for target in targets:
            ok, msg = results.get(target, (False, "bilinmeyen"))
            print("backup_job %s mode=%s %s %s" % ("ok" if ok else "fail", mode, target, ("%s %s" % (remote_name, msg or "")).strip()), flush=True)
    except Exception as e:
        print("backup job failed:", e, flush=True)


def _tmdb_genre_names():
    conn = get_db()
    rows = conn.execute("SELECT name FROM genres WHERE source='tmdb' ORDER BY name").fetchall()
    conn.close()
    return [r["name"] for r in rows]


def _anilist_genre_names():
    conn = get_db()
    rows = conn.execute("SELECT name FROM genres WHERE source='anilist' ORDER BY name").fetchall()
    conn.close()
    return [r["name"] for r in rows]


SCHEDULER = BackgroundScheduler()


def parse_notify_hour(value):
    h = m = 0
    try:
        parts = (value or "09:00").split(":")
        h = int(parts[0]) % 24
        m = int(parts[1]) % 60
    except (ValueError, IndexError):
        h, m = 9, 0
    return h, m


def schedule_releases():
    # DB'de bozuk bir timezone degeri varsa job'lar olmesin; Istanbul'a dus
    try:
        tz = ZoneInfo(get_setting("timezone") or "Europe/Istanbul")
    except Exception:
        tz = ZoneInfo("Europe/Istanbul")

    sync_h, sync_m = parse_notify_hour(get_setting("sync_hour") or "09:00")
    if SCHEDULER.get_job("release_sync"):
        SCHEDULER.remove_job("release_sync")
    SCHEDULER.add_job(
        sync_releases,
        "cron",
        hour=sync_h,
        minute=sync_m,
        timezone=tz,
        id="release_sync",
        misfire_grace_time=3600,
    )

    genre_h, genre_m = parse_notify_hour(get_setting("genre_hour") or "05:00")
    if SCHEDULER.get_job("genre_sync"):
        SCHEDULER.remove_job("genre_sync")
    SCHEDULER.add_job(
        sync_genres,
        "cron",
        hour=genre_h,
        minute=genre_m,
        timezone=tz,
        id="genre_sync",
        misfire_grace_time=3600,
    )

    data_h, data_m = parse_notify_hour(get_setting("data_hour") or "05:10")
    if SCHEDULER.get_job("follow_data_sync"):
        SCHEDULER.remove_job("follow_data_sync")
    SCHEDULER.add_job(
        backfill_votes,
        "cron",
        hour=data_h,
        minute=data_m,
        timezone=tz,
        id="follow_data_sync",
        misfire_grace_time=3600,
    )

    # Öneriler bölümü rotasyonu kaldırıldı (yerini feed aldı); rec_hour yalnız fav için.
    rec_raw = get_setting("rec_hour")
    if rec_raw:
        rec_h, rec_m = parse_notify_hour(rec_raw)
    else:
        total_min = data_h * 60 + data_m + 15
        rec_h = (total_min // 60) % 24
        rec_m = total_min % 60
    if SCHEDULER.get_job("rec_refresh"):
        SCHEDULER.remove_job("rec_refresh")
    if SCHEDULER.get_job("fav_refresh"):
        SCHEDULER.remove_job("fav_refresh")
    SCHEDULER.add_job(
        refresh_fav_listings_job,
        "cron",
        hour=rec_h,
        minute=rec_m,
        timezone=tz,
        id="fav_refresh",
        misfire_grace_time=3600,
    )

    # Öneriler beslemesi (feed): kaynak başına haftalık gün + saat
    try:
        from feed import get_feed_schedule
        feed_sched = get_feed_schedule()
    except Exception:
        feed_sched = {}
    for _src, _cfg in feed_sched.items():
        _jid = f"feed_refresh_{_src}"
        if SCHEDULER.get_job(_jid):
            SCHEDULER.remove_job(_jid)
        try:
            _fh, _fm = parse_notify_hour((_cfg or {}).get("time") or "04:00")
            SCHEDULER.add_job(
                feed_refresh_job,
                "cron",
                day_of_week=int((_cfg or {}).get("dow", 0)) % 7,
                hour=_fh,
                minute=_fm,
                timezone=tz,
                args=[_src],
                id=_jid,
                misfire_grace_time=3600,
            )
        except Exception:
            pass


    # Faz 32c: kisisel Bildirim Saati — uye basina tek cron, tam dakikasinda.
    # Eski global job'lar (release_check/notification_check/anime_check/ticker) emekli.
    for _gone in ("release_check", "notification_check", "anime_check", "notification_ticker"):
        try:
            if SCHEDULER.get_job(_gone):
                SCHEDULER.remove_job(_gone)
        except Exception:
            pass
    _built = 0
    for _uid in _active_uids():
        try:
            if build_user_jobs(_uid):
                _built += 1
        except Exception as e:
            print(f"user job build uid={_uid} failed: {e}", flush=True)

    backup_h, backup_m = parse_notify_hour(get_setting("backup_hour") or "03:00")
    if SCHEDULER.get_job("backup_job"):
        SCHEDULER.remove_job("backup_job")
    SCHEDULER.add_job(
        backup_job,
        "cron",
        hour=backup_h,
        minute=backup_m,
        timezone=tz,
        id="backup_job",
        misfire_grace_time=3600,
    )

    # Stremio sinyal tamponu budama: gecelik (backup saati sonrasi sabit 03:30)
    if SCHEDULER.get_job("stremio_prune"):
        SCHEDULER.remove_job("stremio_prune")
    SCHEDULER.add_job(
        stremio_prune_job,
        "cron",
        hour=3,
        minute=30,
        timezone=tz,
        id="stremio_prune",
        misfire_grace_time=3600,
    )

    # Pi konumu: gunluk sessiz tazeleme (ulke degisimi + takipci tz gecisi)
    if SCHEDULER.get_job("geo_refresh"):
        SCHEDULER.remove_job("geo_refresh")
    SCHEDULER.add_job(
        geo_refresh_job,
        "cron",
        hour=4,
        minute=20,
        timezone=tz,
        id="geo_refresh",
        misfire_grace_time=3600,
    )

    # Sifre istekleri: 3 gunu dolan active satirlari done isaretle
    if SCHEDULER.get_job("pwdreset_prune"):
        SCHEDULER.remove_job("pwdreset_prune")
    SCHEDULER.add_job(
        pwdreset_prune_job,
        "cron",
        hour=4,
        minute=40,
        timezone=tz,
        id="pwdreset_prune",
        misfire_grace_time=3600,
    )

    # Database Bakim: pazartesi (yedek + yetim taramasi, journal-only)
    maint_h, maint_m = parse_notify_hour(get_setting("maint_hour") or "05:45")
    if SCHEDULER.get_job("db_maint"):
        SCHEDULER.remove_job("db_maint")
    SCHEDULER.add_job(
        db_maint_job,
        "cron",
        day_of_week="mon",
        hour=maint_h,
        minute=maint_m,
        timezone=tz,
        id="db_maint",
        misfire_grace_time=3600,
    )

    app_h, app_m = parse_notify_hour(get_setting("app_update_hour") or "04:00")
    if SCHEDULER.get_job("app_update_job"):
        SCHEDULER.remove_job("app_update_job")
    SCHEDULER.add_job(
        app_update_job,
        "cron",
        hour=app_h,
        minute=app_m,
        timezone=tz,
        id="app_update_job",
        misfire_grace_time=3600,
    )

    # 2.19: JS damga zinciri denetimi — acilista 90 sn sonra + gunde 1 (bildirim gunde 1)
    for _jid in ("jsver_check_boot", "jsver_check_daily"):
        if SCHEDULER.get_job(_jid):
            SCHEDULER.remove_job(_jid)
    SCHEDULER.add_job(
        jsver_check_job,
        "date",
        run_date=datetime.datetime.now(tz) + datetime.timedelta(seconds=90),
        id="jsver_check_boot",
        misfire_grace_time=300,
    )
    SCHEDULER.add_job(
        jsver_check_job,
        "cron",
        hour=6,
        minute=10,
        timezone=tz,
        id="jsver_check_daily",
        misfire_grace_time=3600,
    )

    # 1.87: Emby API senkronu — WebSocket aninda tetikler, bu is yedek yoklama.
    # Ayar yoksa hizli no-op'tur (configured() False).
    if SCHEDULER.get_job("emby_sync"):
        SCHEDULER.remove_job("emby_sync")
    SCHEDULER.add_job(
        emby_sync_job,
        "interval",
        minutes=15,
        id="emby_sync",
        misfire_grace_time=600,
        max_instances=1,
        coalesce=True,
    )

    # 1.94: Access Token 5 dk'da bir kontrol edilir; 401/403'te otomatik yenilenir.
    if SCHEDULER.get_job("emby_token_health"):
        SCHEDULER.remove_job("emby_token_health")
    SCHEDULER.add_job(
        emby_token_health_job,
        "interval",
        minutes=5,
        id="emby_token_health",
        misfire_grace_time=120,
        max_instances=1,
        coalesce=True,
    )

    if not SCHEDULER.running:
        SCHEDULER.start()
    print("next release sync:", SCHEDULER.get_job("release_sync").next_run_time, flush=True)
    try:
        _ujobs = sorted(j.id for j in SCHEDULER.get_jobs() if (j.id or "").startswith("user_notif_"))
        print(f"user notif jobs ({len(_ujobs)}):", _ujobs, flush=True)
    except Exception:
        pass
    try:
        print("next rec refresh:", SCHEDULER.get_job("rec_refresh").next_run_time, flush=True)
    except Exception:
        pass
    try:
        print("next fav refresh:", SCHEDULER.get_job("fav_refresh").next_run_time, flush=True)
    except Exception:
        pass
    try:
        _fjobs = sorted(j.id for j in SCHEDULER.get_jobs() if (j.id or "").startswith("feed_refresh_"))
        print(f"feed refresh jobs ({len(_fjobs)}):", _fjobs, flush=True)
    except Exception:
        pass
    try:
        print("next backup:", SCHEDULER.get_job("backup_job").next_run_time, flush=True)
    except Exception:
        pass
    try:
        print("next app update:", SCHEDULER.get_job("app_update_job").next_run_time, flush=True)
    except Exception:
        pass
    try:
        print("next jsver check:", SCHEDULER.get_job("jsver_check_daily").next_run_time, flush=True)
    except Exception:
        pass


def start_scheduler():
    sync_genres()
    try:
        geo_refresh_job()
    except Exception:
        pass
    # 1.87: Emby API modu (ayar varsa) — WS dinleyici + acilista bir senkron.
    # 1.94: once access token'i kontrol/yenile, sonra WS'i token ile ac.
    try:
        import emby_sync
        try:
            emby_sync.ensure_token()
        except Exception as _te:
            print(f"[emby] acilis token kontrol hata: {_te}", flush=True)
        emby_sync.start_listener()
        emby_sync.sync_async()
    except Exception as e:
        print(f"[emby] baslatma hata: {e}", flush=True)
    schedule_releases()