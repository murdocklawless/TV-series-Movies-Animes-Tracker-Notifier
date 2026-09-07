import json
import datetime

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
    ("anime_episode_today", "anime"),
    ("anime_hiatus", "anime"),
    ("anime_cancelled", "anime"),
    ("anime_finished", "anime"),
    ("anime_releasing", "anime"),
    ("anime_episodes", "anime"),
    ("anime_unwatched_bulk", "anime"),
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
        return True
    except Exception as e:
        print(f"user job build uid={uid} failed: {e}", flush=True)
        return False


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


def sync_episodes(conn, follow):
    """Takip edilen dizinin tüm sezon/bölüm tarihlerini episodes tablosuna işler."""
    if follow["media_type"] != "tv":
        return
    data = tmdb_request(f"/tv/{follow['tmdb_id']}")
    if not data:
        return
    tvmaze_times = None
    for t in (data.get("original_name"), data.get("name"), follow["title"]):
        if t:
            tvmaze_times = _tvmaze_episode_times(t)
            if tvmaze_times is not None:
                break
    for season in data.get("seasons", []):
        season_number = season.get("season_number")
        if season_number is None or season_number == 0:
            continue
        season_data = tmdb_request(f"/tv/{follow['tmdb_id']}/season/{season_number}")
        if not season_data:
            continue
        for ep in season_data.get("episodes", []):
            ep_num = ep.get("episode_number")
            air_date = ep.get("air_date")
            if not air_date:
                continue
            ep_name = ep.get("name") or ""
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
                "INSERT INTO episodes (follow_id, season, episode, air_date, air_time, name) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(follow_id, season, episode) "
                "DO UPDATE SET air_date=excluded.air_date, air_time=excluded.air_time, name=excluded.name",
                (follow["id"], season_number, ep_num, air_date, air_time, ep_name),
            )
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


def sync_releases():
    """Takip edilen dizi/film verilerini TMDB/TVMaze'den güncelleyip DB'ye işler (dizi bölümleri + film detayları, anime hariç)."""
    conn = get_db()
    follows = conn.execute("SELECT * FROM followed").fetchall()
    for follow in follows:
        if follow["media_type"] == "tv":
            sync_episodes(conn, follow)
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
                    save_details(conn, follow["id"], info, get_tmdb_cast("movie", follow["tmdb_id"]))
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
                "status_ended": "#22c55e", "anime_finished": "#22c55e", "movie_today": "#22c55e",
                "status_canceled": "#ef4444", "anime_cancelled": "#ef4444",
                "status_pilot": "#60a5fa", "season_planned": "#60a5fa", "movie_rescheduled": "#60a5fa", "anime_episodes": "#60a5fa",
                "status_returning": "#f97316", "season_production": "#f97316", "season_upcoming": "#f97316",
                "episode_today": "#f97316", "season_start": "#f97316", "anime_episode_today": "#f97316",
                "unwatched_bulk": "#f97316", "anime_unwatched_bulk": "#f97316",
                "vote_threshold": "#22c55e", "networks_changed": "#d4a017", "anime_hiatus": "#f59e0b", "anime_releasing": "#22c55e",
            }
            eff_color = status_color or cmap.get(type_name, "#22c55e")
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
        from notifications import notify_all
        notify_all(message, remote_url, card=card, user_id=uid)
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
    for r in conn.execute("SELECT * FROM followed WHERE user_id=? AND media_type='tv'", (uid,)).fetchall():
        # 1 episode_today (merkez + dis push tek geciste; makbuz notified_date=today dedupe'u)
        rows = conn.execute("SELECT season, episode, air_date FROM episodes WHERE follow_id=? AND air_date=?", (r["id"], today)).fetchall()
        for ep in rows:
            msg = f"{r['title']} S{ep['season']:02d}E{ep['episode']:02d} Bugün Yayınlanacak"
            _notif_create(r["title"], msg, "episode_today", media_type="tv", tmdb_id=r["tmdb_id"], season=ep["season"], episode=ep["episode"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=today, remote_url=TMDB_IMAGE_BASE + r["poster_path"] if r["poster_path"] else None, user_id=uid)
        # 2 season_start today via season_list
        try:
            sl = json.loads(r["season_list"] or "[]")
            for s in sl:
                if s.get("air_date") == today and s.get("season_number"):
                    msg = f"{r['title']} {s['season_number']}. Sezon Bugün Başlıyor"
                    _notif_create(r["title"], msg, "season_start", media_type="tv", tmdb_id=r["tmdb_id"], season=s["season_number"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=today, user_id=uid)
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
                        _notif_create(r["title"], f"{r['title']} 4. Sezon Planlanıyor" if "Sezon" not in r["title"] else f"{r['title']} Planlanıyor", "season_planned", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "In Production":
                        _notif_create(r["title"], f"{r['title']} 4. Sezon Yapım Aşamasında", "season_production", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Ended":
                        _notif_create(r["title"], f"{r['title']} Bitti", "status_ended", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status in ("Canceled", "Cancelled"):
                        _notif_create(r["title"], f"{r['title']} İptal Edildi", "status_canceled", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Pilot":
                        _notif_create(r["title"], f"{r['title']} Pilot Bölüm", "status_pilot", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
                    elif status == "Returning Series":
                        _notif_create(r["title"], f"{r['title']} Yeni Sezon Bekleniyor", "status_returning", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=status, user_id=uid)
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
                _notif_create(r["title"], f"{r['title']} {cand}. Sezon Yakında", "season_upcoming", media_type="tv", tmdb_id=r["tmdb_id"], season=cand, poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=f"upcoming_{cand}", user_id=uid)
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
            last = conn.execute("SELECT created_at FROM notifications WHERE type='unwatched_bulk' AND tmdb_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1", (r["tmdb_id"], uid)).fetchone()
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
                    _notif_create(r["title"], f"{r['title']} {cnt} bölüm birikti", "unwatched_bulk", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=bulk_key, user_id=uid)
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
                _notif_create(r["title"], f"{r['title']} puanı yükseldi: {prev:.1f} → {cur:.1f}", "vote_threshold", media_type="tv", tmdb_id=r["tmdb_id"], poster_path=r["poster_path"], kind="tv", ident=r["tmdb_id"], notified_date=f"vote_{cur:.1f}", user_id=uid)
            snap[key] = cur
            # save back later
            from db import set_setting
            _sset(uid, "notif_vote_snapshot", json.dumps(snap))
        except Exception:
            pass
    # 14 movie today
    for m in conn.execute("SELECT * FROM followed WHERE user_id=? AND media_type='movie'", (uid,)).fetchall():
        if m["release_date"] == today:
            _notif_create(m["title"], f"{m['title']} Bugün Vizyona Girdi", "movie_today", media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=today, user_id=uid)
        # 15 movie rescheduled snapshot
        try:
            snap_raw = _sget(uid, "notif_movie_snapshot") or "{}"
            snap = json.loads(snap_raw) if snap_raw else {}
            key = f"movie_{m['tmdb_id']}"
            prev = snap.get(key)
            cur = m["release_date"]
            if prev and prev != cur and cur:
                _notif_create(m["title"], f"{m['title']} vizyon tarihi değişti: {prev} → {cur}", "movie_rescheduled", media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=cur, user_id=uid)
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
                _notif_create(m["title"], f"{m['title']} platform bilgisi güncellendi", "networks_changed", media_type="movie", tmdb_id=m["tmdb_id"], poster_path=m["poster_path"], kind="movie", ident=m["tmdb_id"], notified_date=cur, user_id=uid)
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
    for a in conn.execute("SELECT * FROM anime WHERE user_id=?", (uid,)).fetchall():
        # 17 episode today
        rows = conn.execute("SELECT episode, air_at FROM anime_episodes WHERE anime_id=? AND air_at IS NOT NULL", (a["id"],)).fetchall()
        for ae in rows:
            try:
                d = datetime.datetime.fromtimestamp(ae["air_at"], datetime.timezone.utc).date().isoformat()
                if d == today:
                    _notif_create(a["title"], f"{a['title']} {ae['episode']}. Bölüm Bugün Yayında", "anime_episode_today", media_type="anime", anilist_id=a["anilist_id"], episode=ae["episode"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=today, user_id=uid)
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
                _notif_create(a["title"], f"{a['title']} Ara Verdi", "anime_hiatus", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "CANCELLED":
            if status_changed:
                _notif_create(a["title"], f"{a['title']} İptal Edildi", "anime_cancelled", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "FINISHED":
            if status_changed:
                _notif_create(a["title"], f"{a['title']} Bitti", "anime_finished", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
        elif status == "RELEASING":
            if prev == "NOT_YET_RELEASED" and status == "RELEASING":
                _notif_create(a["title"], f"{a['title']} Yayına Başladı", "anime_releasing", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=status, user_id=uid)
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
                _notif_create(a["title"], f"{a['title']} bölüm sayısı {prev} → {cur}", "anime_episodes", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=str(cur), user_id=uid)
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
                    _notif_create(a["title"], f"{a['title']} {cnt} bölüm birikti", "anime_unwatched_bulk", media_type="anime", anilist_id=a["anilist_id"], cover_url=a["cover_url"], kind="anime", ident=a["anilist_id"], notified_date=bulk_key, user_id=uid)
        except StopIteration:
            pass
        except Exception:
            pass
    conn.close()
    bump()


def backfill_votes():
    """Takip edilen dizi/film ve anime verilerini TMDB/AniList'ten güncel çekip DB'yi yeniler."""
    conn = get_db()
    for row in conn.execute("SELECT * FROM followed").fetchall():
        info = get_tmdb_info(row["media_type"], row["tmdb_id"])
        if info:
            conn.execute(
                "UPDATE followed SET vote_average=?, networks=?, release_date=? WHERE id=?",
                (
                    info.get("vote_average") or 0,
                    json.dumps(info.get("networks") or []),
                    info.get("release_date") or row["release_date"],
                    row["id"],
                ),
            )
            save_details(conn, row["id"], info, get_tmdb_cast(row["media_type"], row["tmdb_id"]))
        if row["media_type"] == "tv":
            sync_episodes(conn, row)
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


def _reset_stale_watched(conn):
    """in_watched=1 olup artık tamamlanmamış (yeni bölüm yayınlanan) yapımları izlenmişten çıkarır."""
    for r in conn.execute(
        "SELECT id FROM followed WHERE media_type='tv' AND in_watched=1"
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM episodes WHERE follow_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total > 0 and total != watched_cnt:
            conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
    for r in conn.execute(
        "SELECT id FROM followed WHERE media_type='movie' AND in_watched=1"
    ).fetchall():
        watched = conn.execute(
            "SELECT watched FROM followed WHERE id=?", (r["id"],)
        ).fetchone()["watched"]
        if not (watched == 1):
            conn.execute("UPDATE followed SET in_watched=0 WHERE id=?", (r["id"],))
    for r in conn.execute(
        "SELECT id FROM anime WHERE in_watched=1"
    ).fetchall():
        total = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=?", (r["id"],)
        ).fetchone()["c"]
        watched_cnt = conn.execute(
            "SELECT COUNT(*) c FROM anime_episodes WHERE anime_id=? AND watched=1", (r["id"],)
        ).fetchone()["c"]
        if total > 0 and total != watched_cnt:
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


def backup_job():
    """Yedekleme cron'u (fail-soft): Database veya Herşeyi yedekle moduna göre rsync/samba hedefe."""
    try:
        mode = (get_setting("backup_mode") or "").strip()
        if not mode:
            return
        # hedef çıkarımı: tek dolu ise o, ikisi dolu ise son seçilen (backup_last_target), yoksa rsync'e fallback
        rsync_host = (get_setting("backup_rsync_host") or "").strip()
        samba_host = (get_setting("backup_samba_host") or "").strip()
        samba_share = (get_setting("backup_samba_share") or "").strip()
        rsync_dolu = bool(rsync_host)
        samba_dolu = bool(samba_host and samba_share)
        target = None
        if rsync_dolu and not samba_dolu:
            target = "rsync"
        elif samba_dolu and not rsync_dolu:
            target = "samba"
        elif rsync_dolu and samba_dolu:
            last = (get_setting("backup_last_target") or "").strip().lower()
            target = last if last in ("rsync", "samba") else "rsync"
        if not target:
            # Hedef yok (rsync/samba girilmemis): bos yere calisma, sessiz gec
            return
        # şimdilik stub: logla, gerçek rsync/samba implementasyonu Faz sonrası eklenecek
        print(f"backup_job mode={mode} target={target or 'none'} hour={get_setting('backup_hour') or '03:00'}", flush=True)
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

    # Öneriler: bağımsız saat (rec_hour), yoksa data_hour+15 fallback
    rec_raw = get_setting("rec_hour")
    if rec_raw:
        rec_h, rec_m = parse_notify_hour(rec_raw)
    else:
        total_min = data_h * 60 + data_m + 15
        rec_h = (total_min // 60) % 24
        rec_m = total_min % 60
    if SCHEDULER.get_job("rec_refresh"):
        SCHEDULER.remove_job("rec_refresh")
    SCHEDULER.add_job(
        refresh_recommendations_job,
        "cron",
        hour=rec_h,
        minute=rec_m,
        timezone=tz,
        id="rec_refresh",
        misfire_grace_time=3600,
    )
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
        print("next backup:", SCHEDULER.get_job("backup_job").next_run_time, flush=True)
    except Exception:
        pass
    try:
        print("next app update:", SCHEDULER.get_job("app_update_job").next_run_time, flush=True)
    except Exception:
        pass


def start_scheduler():
    sync_genres()
    schedule_releases()