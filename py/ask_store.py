"""Izlendi-sor karar deposu (ask_decisions) — 1.87.

Evet/Hayir karari bildirim satirlarindan BAGIMSIZ tutulur; boylece
"tum ask'leri temizle" islemi kararlari unutturmaz (yalniz bekleyenler silinir).

state:
  pending  -> ask uretildi, henuz cevap yok
  watched  -> "Evet" (izlendi olarak isaretlendi)
  rejected -> "Hayir" (izlenmedi olarak isaretlendi)

Kural (routes.stremio._create_watched_ask):
  * Evet  -> izleme kaydi zaten yazilir (episodes/followed/anime), tekrar sorulmaz.
  * Hayir -> yapim tekrar izlendiginde YENIDEN sorulur (ret engellemez).
  * Bekleyen ask varken ayni oynatmanin mukerrer sinyali tek ask olur.
Karar deposu engelleme icin kullanilmaz (bayat karar ask'i tikamasin); kaynak
gercegi izleme tablolaridir, bu tablo kalici "ne cevap verdim" bilgisidir.
"""
import time

from db import get_db

STATES = ("pending", "watched", "rejected")


def ask_key(user_id, media_type, tmdb_id=None, anilist_id=None, season=None, episode=None):
    """Karar anahtari (stremio_signals.dedupe bicimiyle ayni desen)."""
    return (f"{int(user_id or 0)}|{media_type or ''}|{tmdb_id or ''}|"
            f"{anilist_id or ''}|{season or ''}|{episode or ''}")


def record_decision(user_id, media_type, state, tmdb_id=None, anilist_id=None,
                    season=None, episode=None, source=None):
    """Karari yaz/tazele (UPSERT). Fail-soft -> True/False."""
    if state not in STATES:
        print(f"[ask_store] gecersiz durum: {state}", flush=True)
        return False
    try:
        conn = get_db()
        try:
            conn.execute(
                "INSERT INTO ask_decisions "
                "(dedupe, user_id, media_type, tmdb_id, anilist_id, season, episode, state, source, ts) "
                "VALUES (?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(dedupe) DO UPDATE SET state=excluded.state, "
                "source=COALESCE(excluded.source, source), ts=excluded.ts",
                (ask_key(user_id, media_type, tmdb_id, anilist_id, season, episode),
                 int(user_id or 0), media_type, tmdb_id, anilist_id, season, episode,
                 state, source, int(time.time())),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception as e:
        print(f"[ask_store] karar yazma hatasi: {e}", flush=True)
        return False


def get_decision(user_id, media_type, tmdb_id=None, anilist_id=None, season=None, episode=None):
    """Karar satiri (dict: state/source/ts) veya None. Fail-soft."""
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT state, source, ts FROM ask_decisions WHERE dedupe=?",
                (ask_key(user_id, media_type, tmdb_id, anilist_id, season, episode),),
            ).fetchone()
        finally:
            conn.close()
        return dict(row) if row else None
    except Exception:
        return None


def reset_decision(user_id, media_type, tmdb_id=None, anilist_id=None, season=None, episode=None):
    """Karari sil (manuel geri alma). Fail-soft -> True/False."""
    try:
        conn = get_db()
        try:
            conn.execute(
                "DELETE FROM ask_decisions WHERE dedupe=?",
                (ask_key(user_id, media_type, tmdb_id, anilist_id, season, episode),),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception as e:
        print(f"[ask_store] karar silme hatasi: {e}", flush=True)
        return False


def clear_pending(user_id):
    """Ask listesi temizligi: YALNIZ bekleyen kararlar silinir; watched/rejected kalir."""
    try:
        conn = get_db()
        try:
            conn.execute(
                "DELETE FROM ask_decisions WHERE state='pending' AND user_id=?",
                (int(user_id or 0),),
            )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception as e:
        print(f"[ask_store] bekleyen temizleme hatasi: {e}", flush=True)
        return False
