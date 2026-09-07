"""Stremio izleme sinyali tamponu (Faz 29).

Her altyazi sinyali stremio_signals tablosuna yazilir (tekrar sinyalde ts tazelenir);
clear-apply islemi uygulanan satirlari siler; gecelik is 30 günden eski satirlari budar.
cache_store/bump/TTL'den bagimsizdir — restart/isleyen isler temizlemez.
"""
import time

from db import get_db


def _dedupe(kind, tmdb_id, anilist_id, season, episode, user_id=0):
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    return f"{uid}|{kind}|{tmdb_id or ''}|{anilist_id or ''}|{season or ''}|{episode or ''}"


def record_signal(kind, tmdb_id, anilist_id, season, episode, user_id=0):
    """Sinyali tampona yazar (var ise ts tazelenir). Fail-soft. Faz 32: per-user."""
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO stremio_signals (dedupe, kind, tmdb_id, anilist_id, season, episode, ts, user_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(dedupe) DO UPDATE SET ts=excluded.ts, user_id=excluded.user_id",
            (_dedupe(kind, tmdb_id, anilist_id, season, episode, uid),
             kind, tmdb_id, anilist_id, season, episode, int(time.time()), uid),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def signals_for_tv(tmdb_id, user_id=0):
    try:
        return _rows("SELECT dedupe, season, episode, ts FROM stremio_signals WHERE kind='tv' AND tmdb_id=? AND user_id=?", (tmdb_id, int(user_id or 0)))
    except Exception:
        return _rows("SELECT dedupe, season, episode, ts FROM stremio_signals WHERE kind='tv' AND tmdb_id=?", (tmdb_id,))


def signals_for_movie(tmdb_id, user_id=0):
    try:
        return _rows("SELECT dedupe, ts FROM stremio_signals WHERE kind='movie' AND tmdb_id=? AND user_id=?", (tmdb_id, int(user_id or 0)))
    except Exception:
        return _rows("SELECT dedupe, ts FROM stremio_signals WHERE kind='movie' AND tmdb_id=?", (tmdb_id,))


def signals_for_anime(anilist_id, user_id=0):
    try:
        return _rows("SELECT dedupe, episode, ts FROM stremio_signals WHERE kind='anime' AND anilist_id=? AND user_id=?", (anilist_id, int(user_id or 0)))
    except Exception:
        return _rows("SELECT dedupe, episode, ts FROM stremio_signals WHERE kind='anime' AND anilist_id=?", (anilist_id,))


def all_signals(user_id=None):
    """Tampondaki tum satirlar (purge/bakim icin). user_id verilirse filtreler."""
    try:
        if user_id is not None:
            return _rows("SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts, user_id FROM stremio_signals WHERE user_id=? ORDER BY ts", (int(user_id),))
    except Exception:
        pass
    try:
        return _rows("SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts FROM stremio_signals ORDER BY ts", ())
    except Exception:
        return _rows("SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts, user_id FROM stremio_signals ORDER BY ts", ())


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


def last_signal_row(user_id=None):
    """En son sinyal satirinin tamami (detay gosterimi icin) veya None. Faz 32b: per-user."""
    try:
        conn = get_db()
        if user_id is not None:
            try:
                row = conn.execute(
                    "SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts, user_id"
                    " FROM stremio_signals WHERE user_id=? ORDER BY ts DESC LIMIT 1",
                    (int(user_id),),
                ).fetchone()
            except Exception:
                row = conn.execute(
                    "SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts"
                    " FROM stremio_signals ORDER BY ts DESC LIMIT 1"
                ).fetchone()
        else:
            row = conn.execute(
                "SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts"
                " FROM stremio_signals ORDER BY ts DESC LIMIT 1"
            ).fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception:
        return None


def last_signal_ts(user_id=None):
    """En son sinyal zamani (epoch saniye) veya None. Faz 32: per-user."""
    try:
        conn = get_db()
        if user_id is not None:
            try:
                row = conn.execute("SELECT MAX(ts) m FROM stremio_signals WHERE user_id=?", (int(user_id),)).fetchone()
            except Exception:
                row = conn.execute("SELECT MAX(ts) m FROM stremio_signals").fetchone()
        else:
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


def clear_all_signals(user_id=None):
    """Tum sinyalleri temizler (baglanti kesilince). user_id verilirse yalniz onu. Fail-soft."""
    try:
        conn = get_db()
        if user_id is not None:
            try:
                conn.execute("DELETE FROM stremio_signals WHERE user_id=?", (int(user_id),))
            except Exception:
                conn.execute("DELETE FROM stremio_signals")
        else:
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