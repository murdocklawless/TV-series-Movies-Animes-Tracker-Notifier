"""Stremio izleme sinyali tamponu (Faz 29).

Her altyazi sinyali stremio_signals tablosuna yazilir (tekrar sinyalde ts tazelenir);
clear-apply islemi uygulanan satirlari siler; gecelik is 30 günden eski satirlari budar.
cache_store/bump/TTL'den bagimsizdir — restart/isleyen isler temizlemez.
"""
import time

from db import get_db


def _dedupe(kind, tmdb_id, anilist_id, season, episode):
    return f"{kind}|{tmdb_id or ''}|{anilist_id or ''}|{season or ''}|{episode or ''}"


def record_signal(kind, tmdb_id, anilist_id, season, episode):
    """Sinyali tampona yazar (var ise ts tazelenir). Fail-soft."""
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO stremio_signals (dedupe, kind, tmdb_id, anilist_id, season, episode, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(dedupe) DO UPDATE SET ts=excluded.ts",
            (_dedupe(kind, tmdb_id, anilist_id, season, episode),
             kind, tmdb_id, anilist_id, season, episode, int(time.time())),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def signals_for_tv(tmdb_id):
    return _rows("SELECT dedupe, season, episode, ts FROM stremio_signals WHERE kind='tv' AND tmdb_id=?", (tmdb_id,))


def signals_for_movie(tmdb_id):
    return _rows("SELECT dedupe, ts FROM stremio_signals WHERE kind='movie' AND tmdb_id=?", (tmdb_id,))


def signals_for_anime(anilist_id):
    return _rows("SELECT dedupe, episode, ts FROM stremio_signals WHERE kind='anime' AND anilist_id=?", (anilist_id,))


def all_signals():
    """Tampondaki tum satirlar (purge/bakim icin)."""
    return _rows("SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts FROM stremio_signals ORDER BY ts", ())


def delete_signals(dedupes):
    """Verilen dedupe anahtarlarini tampondan siler. Fail-soft."""
    if not dedupes:
        return
    try:
        conn = get_db()
        for d in dedupes:
            conn.execute("DELETE FROM stremio_signals WHERE dedupe=?", (d,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def last_signal_ts():
    """En son sinyal zamani (epoch saniye) veya None."""
    try:
        conn = get_db()
        row = conn.execute("SELECT MAX(ts) m FROM stremio_signals").fetchone()
        conn.close()
        return row["m"] if row and row["m"] is not None else None
    except Exception:
        return None


def prune_signals(max_age=30 * 86400):
    """Eski sinyalleri budar (gecelik is). Fail-soft."""
    try:
        conn = get_db()
        conn.execute("DELETE FROM stremio_signals WHERE ts < ?", (int(time.time()) - max_age,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def clear_all_signals():
    """Tum sinyalleri temizler (baglanti kesilince). Fail-soft."""
    try:
        conn = get_db()
        conn.execute("DELETE FROM stremio_signals")
        conn.commit()
        conn.close()
    except Exception:
        pass


def _rows(sql, params):
    try:
        conn = get_db()
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []