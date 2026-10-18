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


def record_signal(kind, tmdb_id, anilist_id, season, episode, user_id=0, source=None):
    """Sinyali tampona yazar (var ise ts + kaynak tazelenir). Fail-soft. Faz 32: per-user.

    source (1.86): sinyalin geldigi kaynak (stremio/plex/jellyfin/emby/other).
    Ayni bolum icin yeni sinyal gelirse kaynak da tazelenir (son kaynak kazanir).
    """
    try:
        uid = int(user_id or 0)
    except (TypeError, ValueError):
        uid = 0
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO stremio_signals (dedupe, kind, tmdb_id, anilist_id, season, episode, ts, user_id, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(dedupe) DO UPDATE SET ts=excluded.ts, user_id=excluded.user_id, source=excluded.source",
            (_dedupe(kind, tmdb_id, anilist_id, season, episode, uid),
             kind, tmdb_id, anilist_id, season, episode, int(time.time()), uid, source),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def signals_for_tv(tmdb_id, user_id=0):
    try:
        return _rows("SELECT dedupe, season, episode, ts, source FROM stremio_signals WHERE kind='tv' AND tmdb_id=? AND user_id=?", (tmdb_id, int(user_id or 0)))
    except Exception:
        return _rows("SELECT dedupe, season, episode, ts FROM stremio_signals WHERE kind='tv' AND tmdb_id=?", (tmdb_id,))


def signals_for_movie(tmdb_id, user_id=0):
    try:
        return _rows("SELECT dedupe, ts, source FROM stremio_signals WHERE kind='movie' AND tmdb_id=? AND user_id=?", (tmdb_id, int(user_id or 0)))
    except Exception:
        return _rows("SELECT dedupe, ts FROM stremio_signals WHERE kind='movie' AND tmdb_id=?", (tmdb_id,))


def signals_for_anime(anilist_id, user_id=0):
    try:
        return _rows("SELECT dedupe, episode, ts, source FROM stremio_signals WHERE kind='anime' AND anilist_id=? AND user_id=?", (anilist_id, int(user_id or 0)))
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


def _signal_filter(user_id=None, source=None):
    """(where, params) — per-user + KAYNAK filtresi. 1.87.

    source="stremio" -> stremio VEYA eski kayitsiz (NULL) satirlar; boylece Stremio
    karti yalniz kendi addon'undan gelen sinyalleri gosterir (emby/jellyfin/plex
    sinyalleri orada gorunmez).
    """
    where, params = "", []
    if user_id is not None:
        where += " AND user_id=?"
        params.append(int(user_id))
    if source:
        if str(source) == "stremio":
            where += " AND (source='stremio' OR source IS NULL)"
        else:
            where += " AND source=?"
            params.append(str(source))
    return where, tuple(params)


def last_signal_row(user_id=None, source=None):
    """En son sinyal satirinin tamami (detay gosterimi icin) veya None. Faz 32b: per-user."""
    where, params = _signal_filter(user_id, source)
    # user_id kolonu olmayan cok eski DB'ler icin ikinci deneme (kolon haric).
    for extra in (", user_id", ""):
        try:
            conn = get_db()
            try:
                row = conn.execute(
                    "SELECT dedupe, kind, tmdb_id, anilist_id, season, episode, ts" + extra +
                    " FROM stremio_signals WHERE 1=1" + where + " ORDER BY ts DESC LIMIT 1",
                    params,
                ).fetchone()
            finally:
                conn.close()
            return dict(row) if row else None
        except Exception:
            continue
    return None


def last_signal_ts(user_id=None, source=None):
    """En son sinyal zamani (epoch saniye) veya None. Faz 32: per-user. 1.87: kaynak filtreli."""
    where, params = _signal_filter(user_id, source)
    where_old, params_old = _signal_filter(None, source)
    for w, p in ((where, params), (where_old, params_old)):
        try:
            conn = get_db()
            try:
                row = conn.execute(
                    "SELECT MAX(ts) m FROM stremio_signals WHERE 1=1" + w, p
                ).fetchone()
            finally:
                conn.close()
            return row["m"] if row and row["m"] is not None else None
        except Exception:
            continue
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