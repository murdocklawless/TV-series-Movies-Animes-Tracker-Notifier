import os
import sqlite3
import json
import datetime
from zoneinfo import ZoneInfo

from config import DB_PATH


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS version (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            number TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS followed (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id INTEGER,
            media_type TEXT,
            title TEXT,
            poster_path TEXT,
            release_date TEXT,
            notified INTEGER DEFAULT 0,
            vote_average REAL DEFAULT 0
        )"""
    )
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(followed)").fetchall()]
    if "vote_average" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN vote_average REAL DEFAULT 0")
    if "networks" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN networks TEXT")
    if "overview" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN overview TEXT")
    if "genres" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN genres TEXT")
    if "tagline" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN tagline TEXT")
    if "runtime" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN runtime INTEGER")
    if "number_of_seasons" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN number_of_seasons INTEGER")
    if "number_of_episodes" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN number_of_episodes INTEGER")
    if "status" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN status TEXT")
    if "season_list" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN season_list TEXT")
    if "vote_count" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN vote_count INTEGER")
    if "first_air_date" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN first_air_date TEXT")
    if "watched" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN watched INTEGER DEFAULT 0")
    if "in_watched" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN in_watched INTEGER DEFAULT 0")
    if "localized" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN localized TEXT")
    if "poster_local" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN poster_local TEXT")
    if "poster_local_w185" not in cols:
        conn.execute("ALTER TABLE followed ADD COLUMN poster_local_w185 TEXT")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS episodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follow_id INTEGER,
            season INTEGER,
            episode INTEGER,
            air_date TEXT,
            air_time INTEGER,
            notified INTEGER DEFAULT 0,
            watched INTEGER DEFAULT 0,
            name TEXT,
            UNIQUE(follow_id, season, episode)
        )"""
    )
    ecols = [r["name"] for r in conn.execute("PRAGMA table_info(episodes)").fetchall()]
    if "watched" not in ecols:
        conn.execute("ALTER TABLE episodes ADD COLUMN watched INTEGER DEFAULT 0")
    if "name" not in ecols:
        conn.execute("ALTER TABLE episodes ADD COLUMN name TEXT")
    if "air_time" not in ecols:
        conn.execute("ALTER TABLE episodes ADD COLUMN air_time INTEGER")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS cast (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follow_id INTEGER,
            person_id INTEGER,
            name TEXT,
            character TEXT,
            profile_path TEXT,
            sort_order INTEGER DEFAULT 0
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS genres (
            source TEXT NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(source, name)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS anime (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anilist_id INTEGER UNIQUE,
            title TEXT,
            cover_url TEXT,
            episodes INTEGER DEFAULT 0,
            status TEXT,
            score REAL,
            notified INTEGER DEFAULT 0
        )"""
    )
    acols = [r["name"] for r in conn.execute("PRAGMA table_info(anime)").fetchall()]
    if "score" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN score REAL")
    if "studios" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN studios TEXT")
    if "banner" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN banner TEXT")
    if "description" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN description TEXT")
    if "format" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN format TEXT")
    if "duration" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN duration INTEGER")
    if "genres" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN genres TEXT")
    if "start_date" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN start_date TEXT")
    if "in_watched" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN in_watched INTEGER DEFAULT 0")
    if "poster_local" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN poster_local TEXT")
    if "poster_local_w185" not in acols:
        conn.execute("ALTER TABLE anime ADD COLUMN poster_local_w185 TEXT")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS anime_cast (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id INTEGER,
            person_id INTEGER,
            name TEXT,
            image TEXT,
            sort_order INTEGER DEFAULT 0
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS anime_episodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id INTEGER,
            episode INTEGER,
            air_at INTEGER,
            notified INTEGER DEFAULT 0,
            watched INTEGER DEFAULT 0,
            UNIQUE(anime_id, episode)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            tmdb_id INTEGER,
            anilist_id INTEGER,
            media_type TEXT,
            season INTEGER,
            episode INTEGER,
            poster_local TEXT,
            thumbnail_local TEXT,
            is_read INTEGER DEFAULT 0,
            notified_date TEXT,
            created_at INTEGER NOT NULL
        )"""
    )
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_media ON notifications(media_type, tmdb_id)")
    except Exception:
        pass
    # Kalici cache: genel liste cache'i (restart sonrasi restore icin)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS cache_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            ts REAL NOT NULL
        )"""
    )
    # Oneri payload kaliciligi (gen/TTL'den bagimsiz; fp + guncelleme ile yonetilir)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS rec_cache (
            media TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            ts REAL NOT NULL,
            fp TEXT
        )"""
    )
    # Kart detay cache'i (dizi networks/status; rotasyon tekrarlarinda sorgu atilmaz)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS rec_detail (
            kind TEXT NOT NULL,
            id INTEGER NOT NULL,
            networks TEXT,
            status TEXT,
            ts REAL NOT NULL,
            PRIMARY KEY(kind, id)
        )"""
    )
    # Favori oyuncu/tur liste cache'i (actor limitsiz, genre 30; guncellik fp=today)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS fav_listing_cache (
            kind TEXT NOT NULL,
            ident TEXT NOT NULL,
            payload TEXT NOT NULL,
            ts REAL NOT NULL,
            fp TEXT,
            PRIMARY KEY(kind, ident)
        )"""
    )
    # Stremio -> izlendi sinyal tamponu (Stremio izleme senkronu, Faz 29).
    # Her altyazi sinyali kaydedilir; clear-apply uygulayinca satir silinir; gecelik budanir.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS stremio_signals (
            dedupe TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            tmdb_id INTEGER,
            anilist_id INTEGER,
            season INTEGER,
            episode INTEGER,
            ts INTEGER NOT NULL
        )"""
    )
    # Harici anime ID eslemeleri (kitsu/tmdb/imdb/tvdb/trakt -> anilist_id). Kalici onbellek.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS anime_id_map (
            source TEXT NOT NULL,
            external_id TEXT NOT NULL,
            anilist_id INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            PRIMARY KEY(source, external_id)
        )"""
    )
    # Eszamanli Stremio sinyallerinde cift follow olusmasin (Faz 29b yaris duzeltmesi)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_followed_tmdb ON followed(tmdb_id, media_type)"
    )
    # Faz 30 coklu kullanici: hesaplar, oturumlar, sifre sifirlama istekleri, kaba-kuvvet kilidi.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            status TEXT NOT NULL DEFAULT 'pending',
            force_pw_change INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            device TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"
    )
    # Faz 31d: kalp-atisi son gorulme (cevrimici = taze last_seen).
    cols_s = [r["name"] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
    if "last_seen" not in cols_s:
        conn.execute("ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
    # Faz 32: coklu uyelik veri izolasyonu — her kartin sahibi (user_id).
    # Mevcut satirlar ilk admin'e (id=1) yazilir; yeni uyeler bos baslar.
    cols_f = [r["name"] for r in conn.execute("PRAGMA table_info(followed)").fetchall()]
    if "user_id" not in cols_f:
        conn.execute("ALTER TABLE followed ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
    cols_a = [r["name"] for r in conn.execute("PRAGMA table_info(anime)").fetchall()]
    if "user_id" not in cols_a:
        conn.execute("ALTER TABLE anime ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
    # anime.anilist_id tabloda UNIQUE idi — farkli kullanicilar ayni animeyi
    # takip edebilsin diye (user_id, anilist_id) ikilisine cevrilir (tablo rebuild).
    try:
        sql = (conn.execute("SELECT sql FROM sqlite_master WHERE name='anime'").fetchone() or {})["sql"] or ""
        if "anilist_id INTEGER UNIQUE" in sql or "anilist_id UNIQUE" in sql:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS anime_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1,
                    anilist_id INTEGER NOT NULL,
                    title TEXT,
                    cover_url TEXT,
                    episodes INTEGER DEFAULT 0,
                    status TEXT,
                    score REAL,
                    notified INTEGER DEFAULT 0,
                    studios TEXT,
                    banner TEXT,
                    description TEXT,
                    format TEXT,
                    duration INTEGER,
                    genres TEXT,
                    start_date TEXT,
                    in_watched INTEGER DEFAULT 0,
                    poster_local TEXT,
                    poster_local_w185 TEXT,
                    UNIQUE(user_id, anilist_id)
                )"""
            )
            conn.execute(
                """INSERT OR IGNORE INTO anime_new
                    (id, user_id, anilist_id, title, cover_url, episodes, status, score,
                     notified, studios, banner, description, format, duration, genres,
                     start_date, in_watched, poster_local, poster_local_w185)
                    SELECT id, COALESCE(user_id, 1), anilist_id, title, cover_url, episodes,
                     status, score, notified, studios, banner, description, format, duration,
                     genres, start_date, in_watched, poster_local, poster_local_w185
                    FROM anime"""
            )
            conn.execute("DROP TABLE anime")
            conn.execute("ALTER TABLE anime_new RENAME TO anime")
    except Exception:
        pass
    try:
        conn.execute("DROP INDEX IF EXISTS idx_followed_tmdb")
    except Exception:
        pass
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_followed_user_tmdb ON followed(user_id, tmdb_id, media_type)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_followed_user ON followed(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_anime_user ON anime(user_id)"
    )
    # Faz 32: kisisel ayarlar (global settings tablosundan ayri).
    conn.execute(
        """CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY(user_id, key)
        )"""
    )
    # Faz 32: stremio sinyal tamponu per-user (uuid per-user'a bagli).
    cols_sig = [r["name"] for r in conn.execute("PRAGMA table_info(stremio_signals)").fetchall()]
    if "user_id" not in cols_sig:
        conn.execute("ALTER TABLE stremio_signals ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
    # Faz 32: oneri payload'i per-user (restart sonrasi da yasar).
    cols_rc = [r["name"] for r in conn.execute("PRAGMA table_info(rec_cache)").fetchall()]
    if "user_id" not in cols_rc:
        conn.execute("ALTER TABLE rec_cache ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1")
    try:
        conn.execute("DROP INDEX IF EXISTS idx_rec_cache_media")
    except Exception:
        pass
    # Faz 31: kisisel bildirimler (rol degisimi) icin hedef kullanici; 0 = herkese acik.
    cols_n = [r["name"] for r in conn.execute("PRAGMA table_info(notifications)").fetchall()]
    if "user_id" not in cols_n:
        conn.execute("ALTER TABLE notifications ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT ''
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS login_attempts (
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0,
            locked_until INTEGER NOT NULL DEFAULT 0
        )"""
    )
    # Faz 32: rec_cache PK media -> PK(user_id, media) rebuild.
    try:
        rcsql = (conn.execute("SELECT sql FROM sqlite_master WHERE name='rec_cache'").fetchone() or {})["sql"] or ""
        if "PRIMARY KEY(user_id" not in rcsql and "PRIMARY KEY (user_id" not in rcsql:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS rec_cache_new (
                    user_id INTEGER NOT NULL DEFAULT 1,
                    media TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    ts REAL NOT NULL,
                    fp TEXT,
                    PRIMARY KEY(user_id, media)
                )"""
            )
            try:
                conn.execute(
                    """INSERT OR IGNORE INTO rec_cache_new (user_id, media, payload, ts, fp)
                        SELECT COALESCE(user_id, 1), media, payload, ts, fp FROM rec_cache"""
                )
            except Exception:
                pass
            conn.execute("DROP TABLE rec_cache")
            conn.execute("ALTER TABLE rec_cache_new RENAME TO rec_cache")
    except Exception:
        pass
    try:
        conn.execute("UPDATE followed SET user_id=1 WHERE user_id IS NULL OR user_id=0")
    except Exception:
        pass
    try:
        conn.execute("UPDATE anime SET user_id=1 WHERE user_id IS NULL OR user_id=0")
    except Exception:
        pass
    conn.commit()
    conn.close()
    try:
        ensure_user_settings_migrated()
    except Exception:
        pass


ENV_KEYS = {
    "tmdb_api_key": "TMDB_API_KEY",
    "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
    "telegram_chat_id": "TELEGRAM_CHAT_ID",
    "notify_hour": "NOTIFY_HOUR",
    "notification_hour": "NOTIFICATION_HOUR",
    "sync_hour": "SYNC_HOUR",
    "genre_hour": "GENRE_HOUR",
    "data_hour": "DATA_HOUR",
    "anime_notification_hour": "ANIME_NOTIFICATION_HOUR",
    "rec_hour": "REC_HOUR",
    "backup_hour": "BACKUP_HOUR",
    "backup_mode": "BACKUP_MODE",
    "backup_rsync_host": "BACKUP_RSYNC_HOST",
    "backup_rsync_port": "BACKUP_RSYNC_PORT",
    "backup_rsync_path": "BACKUP_RSYNC_PATH",
    "backup_rsync_user": "BACKUP_RSYNC_USER",
    "backup_samba_host": "BACKUP_SAMBA_HOST",
    "backup_samba_port": "BACKUP_SAMBA_PORT",
    "backup_samba_share": "BACKUP_SAMBA_SHARE",
    "backup_samba_user": "BACKUP_SAMBA_USER",
    "app_auto_update": "APP_AUTO_UPDATE",
    "app_update_hour": "APP_UPDATE_HOUR",
    "timezone": "TIMEZONE",
    "language": "LANGUAGE",
    "ntfy_topic": "NTFY_TOPIC",
}


def get_setting(key):
    env_name = ENV_KEYS.get(key)
    if env_name and os.environ.get(env_name):
        return os.environ.get(env_name)
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def today_str():
    """Seçili zaman diliminde bugünün tarihi (YYYY-MM-DD)."""
    tz_name = get_setting("timezone") or "Europe/Istanbul"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Europe/Istanbul")
    return datetime.datetime.now(tz).strftime("%Y-%m-%d")


def set_setting(key, value):
    conn = get_db()
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()


# Faz 32: kisisel (per-user) ayar anahtarlari. Bunlar user_settings tablosunda
# saklanir; global settings tablosundaki ayni isimli deger yalnizca ilk kurulum
# / geriye donuk uyumluluk icin varsayilan olarak okunur.
PERSONAL_KEYS = {
    "language",
    "timezone",
    "fav_actors",
    "fav_anime_chars",
    "fav_genres",
    "fav_anime_genres",
    "notification_hour",
    "notif_center_enabled",
    "notif_center_time",
    "notif_center_poster",
    "notif_center_hide_read",
    "notif_center_limit",
    "telegram_enabled",
    "telegram_chat_id",
    "ntfy_enabled",
    "ntfy_topic",
    "discord_enabled",
    "discord_webhook_url",
    "email_enabled",
    "email_to",
    "tp_stremio_uuid",
    "tp_base_url",
    "rec_seen",
    "rec_hidden",
    "rec_profile_fp",
}

# Faz 32: yalniz admin yazabilir (uye POST'unda 403). GET'te uyeye salt-okunur gosterilir.
GLOBAL_ADMIN_ONLY_KEYS = {
    "tmdb_api_key",
    "telegram_bot_token",
    "brevo_api_key",
    "email_from",
    "email_provider",
    "smtp_preset",
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_pass",
    "backup_rsync_pass",
    "backup_samba_pass",
    "backup_rsync_key",
}


def get_user_setting(user_id, key):
    """Kisisel ayar: once user_settings, yoksa global settings (migration varsayilani)."""
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        return None
    if uid <= 0:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE user_id=? AND key=?", (uid, key)
        ).fetchone()
        if row is not None:
            return row["value"]
    finally:
        conn.close()
    # Geriye donuk uyumluluk: henuz kisisellestirilmemis anahtar globalden gelir.
    return get_setting(key)


def set_user_setting(user_id, key, value):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value",
            (int(user_id), key, value),
        )
        conn.commit()
    finally:
        conn.close()


def ensure_user_settings_migrated():
    """Mevcut global degerleri ilk admin + mevcut uyelere kisisel varsayilan olarak kopyalar.
    user_settings bos olan (user_id, key) ikililerine global degeri yazar; uzerine yazmaz.
    tp_stremio_uuid: admin globali korur, diger uyelere fresh uuid uretir (paylasim yok)."""
    import uuid as _uuid

    conn = get_db()
    try:
        users = [dict(r) for r in conn.execute("SELECT id FROM users").fetchall()]
        if not users:
            return
        for u in users:
            uid = u["id"]
            for key in PERSONAL_KEYS:
                try:
                    has = conn.execute(
                        "SELECT 1 FROM user_settings WHERE user_id=? AND key=?", (uid, key)
                    ).fetchone()
                except Exception:
                    has = True
                if has:
                    continue
                if key == "tp_stremio_uuid":
                    if uid == 1:
                        grow = conn.execute(
                            "SELECT value FROM settings WHERE key='tp_stremio_uuid'"
                        ).fetchone()
                        val = (grow["value"] if grow else "") or _uuid.uuid4().hex
                    else:
                        val = _uuid.uuid4().hex
                elif key == "discord_webhook_url":
                    grow = conn.execute(
                        "SELECT value FROM settings WHERE key='discord_webhook_url'"
                    ).fetchone()
                    val = (grow["value"] if grow else "") or ""
                else:
                    grow = conn.execute(
                        "SELECT value FROM settings WHERE key=?", (key,)
                    ).fetchone()
                    if grow is None:
                        continue
                    val = grow["value"]
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)",
                        (uid, key, val),
                    )
                except Exception:
                    pass
        conn.commit()
    finally:
        conn.close()


def db_version_get():
    """version tablosundaki gerçek sürüm (yoksa "")."""
    try:
        conn = get_db()
        row = conn.execute("SELECT number FROM version WHERE id=1").fetchone()
        conn.close()
        return (row["number"] or "").strip() if row else ""
    except Exception:
        return ""


def db_version_set(number):
    """Gerçek sürümü version tablosuna yazar (upsert, tek satır)."""
    conn = get_db()
    conn.execute(
        "INSERT INTO version (id, number, updated_at) VALUES (1, ?, datetime('now')) "
        "ON CONFLICT(id) DO UPDATE SET number=excluded.number, updated_at=excluded.updated_at",
        (str(number or "").strip(),),
    )
    conn.commit()
    conn.close()


def _safe_json_list(value):
    if not value:
        return []
    try:
        v = json.loads(value)
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []
