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
    conn.commit()
    conn.close()


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


def _safe_json_list(value):
    if not value:
        return []
    try:
        v = json.loads(value)
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []
