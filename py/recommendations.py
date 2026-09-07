"""Öneri motoru: favori türler + takip profili üzerinden TMDB/AniList'ten
kişiselleştirilmiş öneriler üretir. Payload'lar gen/TTL'den bağımsız olarak
RAM sözlüğü + rec_cache tablosunda tutulur (restart sonrası da yaşar);
rotasyon (rec_seen) ile her yenilemede farklı kartlar gelir, profil değişince
bölüm bazlı parmak izi üzerinden geçersizleşir."""
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from db import get_db, get_setting, set_setting, today_str, get_user_setting, set_user_setting

try:
    from auth import get_current_user as _rec_current_user
except Exception:
    _rec_current_user = None


def _rec_uid(user_id=None):
    if user_id is not None:
        try:
            return int(user_id or 0)
        except (TypeError, ValueError):
            return 0
    try:
        if _rec_current_user is not None:
            from flask import has_request_context
            if has_request_context():
                u = _rec_current_user()
                return int(u["id"]) if u else 0
    except Exception:
        pass
    return 0


def _pget(uid, key):
    """Faz 32: uid>0 ise kisisel ayar, yoksa global."""
    try:
        if int(uid or 0) > 0:
            v = get_user_setting(int(uid), key)
            if v is not None:
                return v
    except Exception:
        pass
    return get_setting(key)


def _pset(uid, key, value):
    try:
        if int(uid or 0) > 0:
            set_user_setting(int(uid), key, value)
            return
    except Exception:
        pass
    set_setting(key, value)
from tmdb import tmdb_request, _genre_names_to_ids, _genre_ids_for_media
from anilist import _anime_title, _anime_cover, _anime_next_ep, anilist_recommend

LIMIT = 18      # bölüm başına gösterilen öneri (3 satir tam dolar)
BUFFER = 60     # hariç tutmalar sonrası doldurmak için toplanan aday sayısı
SEEN_CAP = 36   # rotasyon geçmişi (FIFO) — iki tam rotasyonu (18+18) kapsar
DETAIL_TTL = 7 * 86400   # kart detayı (networks/status) tazelik süresi

_rec_lock = threading.Lock()
_rec_ram = {}   # {media: {"items": [...], "fp": str}} — gen/TTL bağımsız


def section_fingerprint(conn, kind, user_id=None):
    """Bölüm bazlı profil parmak izi: bir bölümü etkileyen değişimler yalnızca
    o bölümü geçersiz kılar (diğer bölümlere dokunulmaz). Faz 32: per-user."""
    uid = _rec_uid(user_id)
    parts = []
    if kind == "anime":
        parts.append(",".join(sorted(_load_genre_list("fav_anime_genres", user_id=uid))))
        tbl = "anime"
    else:
        parts.append(",".join(sorted(_load_genre_list("fav_genres", user_id=uid))))
        mt = "tv" if kind == "shows" else "movie"
        gs = set()
        if uid > 0:
            rows = conn.execute(
                "SELECT genres FROM followed WHERE user_id=? AND media_type=?", (uid, mt)
            ).fetchall()
        else:
            rows = conn.execute("SELECT genres FROM followed WHERE media_type=?", (mt,)).fetchall()
        for r in rows:
            try:
                g = json.loads(r["genres"] or "[]")
            except (ValueError, TypeError):
                continue
            if isinstance(g, list):
                gs.update(x for x in g if x)
        parts.append(",".join(sorted(gs)))
        return "|".join(parts)
    gs = set()
    if uid > 0:
        arows = conn.execute("SELECT genres FROM anime WHERE user_id=?", (uid,)).fetchall()
    else:
        arows = conn.execute("SELECT genres FROM " + tbl).fetchall()
    for r in arows:
        try:
            g = json.loads(r["genres"] or "[]")
        except (ValueError, TypeError):
            continue
        if isinstance(g, list):
            gs.update(x for x in g if x)
    parts.append(",".join(sorted(gs)))
    return "|".join(parts)


def _rec_key(kind, user_id=None):
    return f"{_rec_uid(user_id)}:{kind}"


def _load_rec_row(kind, user_id=None):
    uid = _rec_uid(user_id)
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT payload, fp FROM rec_cache WHERE user_id=? AND media=?", (uid, kind)
            ).fetchone()
        except Exception:
            row = conn.execute("SELECT payload, fp FROM rec_cache WHERE media=?", (kind,)).fetchone()
        conn.close()
        return row
    except Exception:
        return None


def load_rec_section(conn, kind, user_id=None):
    """Geçerli öneri payload'ını döndürür (yoksa/fp değişmişse None).
    Sıra: RAM sözlüğü -> rec_cache tablosu (restart sonrası). Faz 32: per-user."""
    uid = _rec_uid(user_id)
    fp = section_fingerprint(conn, kind, user_id=uid)
    rk = _rec_key(kind, uid)
    with _rec_lock:
        entry = _rec_ram.get(rk)
        if entry and entry.get("fp") == fp:
            return entry["items"]
    row = _load_rec_row(kind, uid)
    if row and row["fp"] == fp:
        try:
            items = json.loads(row["payload"])
            if isinstance(items, list):
                with _rec_lock:
                    _rec_ram[rk] = {"items": items, "fp": fp}
                return items
        except (ValueError, TypeError):
            pass
    return None


def save_rec_section(kind, items, fp, user_id=None):
    uid = _rec_uid(user_id)
    rk = _rec_key(kind, uid)
    with _rec_lock:
        _rec_ram[rk] = {"items": items, "fp": fp}
    try:
        conn = get_db()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO rec_cache (user_id, media, payload, ts, fp) VALUES (?, ?, ?, ?, ?)",
                (uid, kind, json.dumps(items, ensure_ascii=False), time.time(), fp),
            )
        except Exception:
            conn.execute(
                "INSERT OR REPLACE INTO rec_cache (media, payload, ts, fp) VALUES (?, ?, ?, ?)",
                (kind, json.dumps(items, ensure_ascii=False), time.time(), fp),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass


def append_to_rec_section(kind, new_items, fp, user_id=None):
    """Dolgu modunda üretilen kartları kalıcı payload'a ekler (fp eşleşiyorsa)."""
    if not new_items:
        return
    uid = _rec_uid(user_id)
    rk = _rec_key(kind, uid)
    payload_json = None
    with _rec_lock:
        entry = _rec_ram.get(rk)
        if not entry or entry.get("fp") != fp:
            row = None  # RAM yoksa DB'den denenir (aşağıda)
        else:
            have = {(i.get("tmdb_id"), i.get("anilist_id")) for i in entry["items"]}
            merged = list(entry["items"])
            for n in new_items:
                keypair = (n.get("tmdb_id"), n.get("anilist_id"))
                if keypair not in have:
                    merged.append(n)
                    have.add(keypair)
            entry["items"] = merged[-LIMIT:]
            payload_json = json.dumps(entry["items"], ensure_ascii=False)
    if payload_json is None:
        row = _load_rec_row(kind, uid)
        if row and row["fp"] == fp:
            try:
                items = json.loads(row["payload"])
                if isinstance(items, list):
                    have = {(i.get("tmdb_id"), i.get("anilist_id")) for i in items}
                    merged = list(items)
                    for n in new_items:
                        keypair = (n.get("tmdb_id"), n.get("anilist_id"))
                        if keypair not in have:
                            merged.append(n)
                            have.add(keypair)
                    merged = merged[-LIMIT:]
                    payload_json = json.dumps(merged, ensure_ascii=False)
                    with _rec_lock:
                        _rec_ram[rk] = {"items": merged, "fp": fp}
            except (ValueError, TypeError):
                return
        else:
            return
    try:
        conn = get_db()
        try:
            conn.execute(
                "UPDATE rec_cache SET payload=?, ts=? WHERE user_id=? AND media=?",
                (payload_json, time.time(), uid, kind),
            )
        except Exception:
            conn.execute("UPDATE rec_cache SET payload=?, ts=? WHERE media=?", (payload_json, time.time(), kind))
        conn.commit()
        conn.close()
    except Exception:
        pass


def remove_rec_item(kind, ident, user_id=None):
    """Takip edilen/izlenmiş öğeyi kalıcı payload'dan çıkarır (diğer kartlara
    dokunmaz — sorgu yapılmaz). Faz 32: per-user (uid verilmezse tum RAM girdileri)."""
    try:
        ident = int(ident)
    except (TypeError, ValueError):
        return False
    uids = [_rec_uid(user_id)] if _rec_uid(user_id) else [k.split(":")[0] for k in list(_rec_ram.keys()) if k.endswith(f":{kind}")]
    if not uids:
        uids = [0]
    ok = False
    for u in uids:
        try:
            uid = int(u)
        except (TypeError, ValueError):
            uid = 0
        rk = _rec_key(kind, uid)
        payload_json = None
        with _rec_lock:
            entry = _rec_ram.get(rk)
            if entry:
                kept = [
                    i for i in entry["items"]
                    if i.get("tmdb_id") != ident and i.get("anilist_id") != ident
                ]
                if len(kept) != len(entry["items"]):
                    entry["items"] = kept
                    payload_json = json.dumps(kept, ensure_ascii=False)
        if payload_json is None:
            continue
        try:
            conn = get_db()
            try:
                conn.execute(
                    "UPDATE rec_cache SET payload=? WHERE user_id=? AND media=?",
                    (payload_json, uid, kind),
                )
            except Exception:
                conn.execute("UPDATE rec_cache SET payload=? WHERE media=?", (payload_json, kind))
            conn.commit()
            conn.close()
        except Exception:
            pass
        ok = True
    return ok


def refresh_all_sections(user_id=None):
    """Gecede bir scheduler'in çağırdığı tam tazeleme: 3 bölümü rotasyonla
    yeniler ve kalıcı katmana yazar; eski kart detaylarını temizler. Fail-soft.
    Faz 32: user_id verilirse yalniz o kullanici, yoksa tum aktif kullanicilar."""
    uids = []
    if _rec_uid(user_id):
        uids = [_rec_uid(user_id)]
    else:
        try:
            conn0 = get_db()
            uids = [r["id"] for r in conn0.execute(
                "SELECT id FROM users WHERE status='active'").fetchall()]
            conn0.close()
        except Exception:
            uids = [0]
        if not uids:
            uids = [0]
    for uid in uids:
        conn = get_db()
        try:
            for kind in ("shows", "movies", "anime"):
                try:
                    fp = section_fingerprint(conn, kind, user_id=uid)
                    items = generate_recommendations(conn, kind, user_id=uid)
                except TypeError:
                    fp = section_fingerprint(conn, kind)
                    items = generate_recommendations(conn, kind)
                try:
                    save_rec_section(kind, items, fp, user_id=uid)
                except TypeError:
                    save_rec_section(kind, items, fp)
            cutoff = time.time() - 30 * 86400
            conn.execute("DELETE FROM rec_detail WHERE ts < ?", (cutoff,))
            conn.commit()
        finally:
            conn.close()


def _load_seen(user_id=None):
    raw = _pget(_rec_uid(user_id), "rec_seen")
    d = json.loads(raw) if raw else {}
    return {
        "shows": d.get("shows") or [],
        "movies": d.get("movies") or [],
        "anime": d.get("anime") or [],
    }


def _save_seen(seen, user_id=None):
    _pset(_rec_uid(user_id), "rec_seen", json.dumps(seen, ensure_ascii=False))


def _load_genre_list(key, user_id=None):
    raw = _pget(_rec_uid(user_id), key)
    vals = json.loads(raw) if raw else []
    return [v for v in vals if v] if isinstance(vals, list) else []


def _load_rec_hidden(user_id=None):
    """'Bir daha gösterme' gizlemeleri: settings.rec_hidden kalıcı katman.
    cache_store/bump/TTL'den bağımsızdir — restart/gece isi geri getirmez.
    Faz 32: per-user."""
    raw = _pget(_rec_uid(user_id), "rec_hidden")
    try:
        d = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        d = {}
    out = {}
    for kind in ("shows", "movies", "anime"):
        v = d.get(kind)
        out[kind] = v if isinstance(v, dict) else {}
    return out


def _save_rec_hidden(data, user_id=None):
    _pset(_rec_uid(user_id), "rec_hidden", json.dumps(data, ensure_ascii=False))


def _hidden_ids(kind, user_id=None):
    """Gizlenen öğe id kümesi. KALICIDIR: kayıt yalnızca kullanıcı Geri Al
    (unhide) dediğinde silinir; süre/TTL/gece isi geri getirmez."""
    hidden = _load_rec_hidden(user_id=user_id).get(kind) or {}
    ids = set()
    for k in hidden:
        try:
            ids.add(int(k))
        except (TypeError, ValueError):
            continue
    return ids


def hide_rec_item(kind, ident, title="", poster=None, user_id=None):
    """Öğeyi kalıcı olarak gizler (varsa üzerine yazar). Faz 32: per-user."""
    try:
        ident = int(ident)
    except (TypeError, ValueError):
        return False
    if kind not in ("shows", "movies", "anime"):
        return False
    uid = _rec_uid(user_id)
    with _rec_lock:
        data = _load_rec_hidden(user_id=uid)
        data[kind][str(ident)] = {
            "ts": time.time(),
            "title": title or "",
            "poster": poster or "",
        }
        _save_rec_hidden(data, user_id=uid)
    return True


def unhide_rec_item(kind, ident, user_id=None):
    """Gizlemeyi kaldırır; öğe sonraki üretimde yeniden aday olur."""
    try:
        ident = str(int(ident))
    except (TypeError, ValueError):
        return False
    uid = _rec_uid(user_id)
    with _rec_lock:
        data = _load_rec_hidden(user_id=uid)
        if ident not in data.get(kind, {}):
            return False
        del data[kind][ident]
        _save_rec_hidden(data, user_id=uid)
    return True


def list_rec_hidden(kind, user_id=None):
    """Bir bölümün gizlenenleri: [{id,title,ts,poster}] — başlığa göre isim sıralı."""
    hidden = _load_rec_hidden(user_id=user_id).get(kind) or {}
    items = []
    for k, v in hidden.items():
        try:
            ident = int(k)
        except (TypeError, ValueError):
            continue
        v = v or {}
        items.append(
            {
                "id": ident,
                "title": v.get("title") or "",
                "ts": v.get("ts") or 0,
                "poster": v.get("poster") or "",
            }
        )
    items.sort(key=lambda x: (x["title"] or "").lower())
    return items


def _profile_fingerprint(conn, user_id=None):
    """Favori türler + takip türlerinin özeti; değişirse rotasyon sıfırlanır."""
    uid = _rec_uid(user_id)
    parts = []
    for key in ("fav_genres", "fav_anime_genres"):
        parts.append(",".join(sorted(_load_genre_list(key, user_id=uid))))
    if uid > 0:
        frows = conn.execute("SELECT genres FROM followed WHERE user_id=?", (uid,)).fetchall()
        arows = conn.execute("SELECT genres FROM anime WHERE user_id=?", (uid,)).fetchall()
    else:
        frows = conn.execute("SELECT genres FROM followed").fetchall()
        arows = conn.execute("SELECT genres FROM anime").fetchall()
    for _tbl, _rows in (("followed", frows), ("anime", arows)):
        gs = set()
        for r in _rows:
            try:
                g = json.loads(r["genres"] or "[]")
            except (ValueError, TypeError):
                continue
            if isinstance(g, list):
                gs.update(x for x in g if x)
        parts.append(",".join(sorted(gs)))
    return "|".join(parts)


def _followed_ids(conn, kind, user_id=None):
    uid = _rec_uid(user_id)
    if kind == "anime":
        if uid > 0:
            rows = conn.execute("SELECT anilist_id FROM anime WHERE user_id=?", (uid,)).fetchall()
        else:
            rows = conn.execute("SELECT anilist_id FROM anime").fetchall()
        return {r["anilist_id"] for r in rows if r["anilist_id"]}
    mt = "tv" if kind == "shows" else "movie"
    if uid > 0:
        rows = conn.execute("SELECT tmdb_id FROM followed WHERE user_id=? AND media_type=?", (uid, mt,)).fetchall()
    else:
        rows = conn.execute("SELECT tmdb_id FROM followed WHERE media_type=?", (mt,)).fetchall()
    return {r["tmdb_id"] for r in rows if r["tmdb_id"]}


def build_profile(conn, kind, user_id=None):
    """(birincil_favori_türler, yedek_takip_türleri) — isim listeleri."""
    uid = _rec_uid(user_id)
    fav = _load_genre_list("fav_anime_genres" if kind == "anime" else "fav_genres", user_id=uid)
    freq = {}
    if kind == "anime":
        if uid > 0:
            rows = conn.execute("SELECT genres, in_watched FROM anime WHERE user_id=?", (uid,)).fetchall()
        else:
            rows = conn.execute("SELECT genres, in_watched FROM anime").fetchall()
    else:
        mt = "tv" if kind == "shows" else "movie"
        if uid > 0:
            rows = conn.execute(
                "SELECT genres, in_watched FROM followed WHERE user_id=? AND media_type=?", (uid, mt,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT genres, in_watched FROM followed WHERE media_type=?", (mt,)
            ).fetchall()
    for r in rows:
        w = 2 if (r["in_watched"] == 1) else 1
        try:
            g = json.loads(r["genres"] or "[]")
        except (ValueError, TypeError):
            continue
        if isinstance(g, list):
            for x in g:
                if x:
                    freq[x] = freq.get(x, 0) + w
    fallback = [g for g, _c in sorted(freq.items(), key=lambda kv: -kv[1])[:6]]
    return fav, fallback


def _fetch_tmdb_candidates(media_type, genre_ids, wanted):
    """Discover'tan aday toplar (sayfa 1-3). genre_ids boşsa popularite fallback.
    with_genres OR için '|' kullanir (virgül AND demektir); 10759 film tarafinda
    genisletilir."""
    gids = _genre_ids_for_media(genre_ids, media_type) if genre_ids else []
    out = []
    seen = set()
    for page in (1, 2, 3):
        params = {
            "sort_by": "popularity.desc",
            "vote_average.gte": 6,
            "page": page,
            "include_adult": "false",
        }
        if gids:
            params["with_genres"] = "|".join(str(g) for g in gids)
        data = tmdb_request(f"/discover/{media_type}", params)
        if not data:
            break
        results = data.get("results") or []
        if not results:
            break
        for it in results:
            tid = it.get("id")
            if not tid or tid in seen:
                continue
            seen.add(tid)
            out.append(
                {
                    "id": tid,
                    "tmdb_id": tid,
                    "media_type": media_type,
                    "title": it.get("title") or it.get("name") or "",
                    "poster_path": it.get("poster_path"),
                    "release_date": it.get("release_date") or it.get("first_air_date"),
                    "vote_average": it.get("vote_average") or 0,
                    "genre_ids": it.get("genre_ids") or [],
                }
            )
            if len(out) >= wanted:
                return out
    return out


def _fetch_anime_candidates(genre_names, wanted):
    media = anilist_recommend(genre_names, per_page=wanted)
    out = []
    for m in media:
        mid = m.get("id")
        if not mid:
            continue
        ep, air_at = _anime_next_ep(m)
        out.append(
            {
                "id": mid,
                "anilist_id": mid,
                "media_type": "anime",
                "title": _anime_title(m),
                "cover_url": _anime_cover(m),
                "score": m.get("averageScore"),
                "format": m.get("format"),
                "status": m.get("status"),
                "genres": m.get("genres") or [],
                "next_episode": ep,
                "airing_at": air_at,
            }
        )
    return out


def _pool_candidates(kind, names, wanted):
    if kind == "anime":
        return _fetch_anime_candidates(names, wanted)
    gids = _genre_names_to_ids(names) if names else []
    return _fetch_tmdb_candidates("tv" if kind == "shows" else "movie", gids, wanted)


def _attach_tv_details(items):
    """Dizi önerileri için networks (ilk 3) + status çeker. Önce rec_detail
    tablosuna bakar (7 gün taze); eksikleri paralel TMDB'den çekip upsert eder.
    Fail-soft: hata durumunda boş kalır."""
    now = time.time()
    cached = {}
    missing = []
    try:
        conn = get_db()
        for it in items:
            tid = it["tmdb_id"]
            row = conn.execute(
                "SELECT networks, status, ts FROM rec_detail WHERE kind='tv' AND id=?",
                (tid,),
            ).fetchone()
            if row and now - (row["ts"] or 0) < DETAIL_TTL:
                try:
                    cached[tid] = (json.loads(row["networks"] or "[]"), row["status"])
                    continue
                except (ValueError, TypeError):
                    pass
            missing.append(it)
        conn.close()
    except Exception:
        missing = list(items)

    def fetch(item):
        try:
            data = tmdb_request(f"/tv/{item['tmdb_id']}")
            if not data:
                return item["tmdb_id"], [], None
            nets = [n.get("name") for n in (data.get("networks") or []) if n.get("name")][:3]
            return item["tmdb_id"], nets, data.get("status")
        except Exception:
            return item["tmdb_id"], [], None

    results = {}
    if missing:
        with ThreadPoolExecutor(max_workers=8) as ex:
            results = {tid: (nets, status) for tid, nets, status in ex.map(fetch, missing)}

    if results:
        try:
            conn = get_db()
            for tid, (nets, status) in results.items():
                if nets or status:
                    conn.execute(
                        "INSERT OR REPLACE INTO rec_detail (kind, id, networks, status, ts) "
                        "VALUES ('tv', ?, ?, ?, ?)",
                        (tid, json.dumps(nets), status, now),
                    )
            conn.commit()
            conn.close()
        except Exception:
            pass

    for it in items:
        tid = it["tmdb_id"]
        if tid in cached:
            nets, status = cached[tid]
        elif tid in results:
            nets, status = results[tid]
        else:
            nets, status = [], None
        it["networks"] = nets
        it["tv_status"] = status


def _can_move_watched(item):
    """İzlenmişe taşı butonu yalnızca tamamlanmış öğelerde çıkar:
    anime FINISHED/CANCELLED, dizi Ended/Canceled/Cancelled, film yayınlanmış."""
    if item.get("media_type") == "anime":
        return item.get("status") in ("FINISHED", "CANCELLED")
    if item.get("media_type") == "tv":
        return item.get("tv_status") in ("Ended", "Canceled", "Cancelled")
    rd = item.get("release_date")
    if not rd:
        return False
    return rd <= today_str()


def generate_fill(conn, kind, exclude_ids, limit, user_id=None):
    """Kart kaldirildiktan sonra eksik slotu doldurmak icin yeni adaylar uretir.
    rec_seen'e DOKUNMAZ (ana rotasyon bozulmaz); takip edilen + exclude_ids
    + gorulmus + gizlenen kartlari haric tutar. Faz 32: per-user."""
    uid = _rec_uid(user_id)
    followed = _followed_ids(conn, kind, user_id=uid)
    seen = _load_seen(user_id=uid)
    hidden = _hidden_ids(kind, user_id=uid)
    fav, fallback = build_profile(conn, kind, user_id=uid)
    primary = fav if fav else fallback

    pool_list = _pool_candidates(kind, primary, BUFFER)
    if fav and fallback:
        fb = _pool_candidates(kind, fallback, BUFFER)
        pool_ids = {c["id"] for c in pool_list}
        pool_list += [c for c in fb if c["id"] not in pool_ids]

    blocked = followed | set(exclude_ids) | set(seen[kind]) | hidden
    chosen = [c for c in pool_list if c["id"] not in blocked][:limit]

    # Kıtlık yedekleri: rotasyon (seen) esnetilir ama gizlenenler ASLA dönmez.
    hard_base = followed | set(exclude_ids) | hidden

    if len(chosen) < limit:
        chosen = [c for c in pool_list if c["id"] not in hard_base][:limit]

    if not chosen:
        pool_list = _pool_candidates(kind, None, BUFFER)
        chosen = [c for c in pool_list if c["id"] not in hard_base][:limit]

    if kind == "shows":
        _attach_tv_details(chosen)

    for c in chosen:
        c["can_move_watched"] = _can_move_watched(c)

    return [{k: v for k, v in c.items() if k != "id"} for c in chosen]


def generate_recommendations(conn, kind, user_id=None):
    """Tek bölüm (shows/movies/anime) için öneri listesi üretir + rotasyonu işler.
    Faz 32: per-user."""
    uid = _rec_uid(user_id)
    seen = _load_seen(user_id=uid)
    try:
        fp = _profile_fingerprint(conn, user_id=uid)
    except TypeError:
        fp = _profile_fingerprint(conn)
    stored_fp = _pget(uid, "rec_profile_fp")
    if stored_fp != fp:
        seen = {"shows": [], "movies": [], "anime": []}
        _pset(uid, "rec_profile_fp", fp)

    followed = _followed_ids(conn, kind, user_id=uid)
    hidden = _hidden_ids(kind, user_id=uid)
    fav, fallback = build_profile(conn, kind, user_id=uid)
    primary = fav if fav else fallback

    pool_list = _pool_candidates(kind, primary, BUFFER)
    if fav and fallback:
        fb = _pool_candidates(kind, fallback, BUFFER)
        seen_ids = {c["id"] for c in pool_list}
        pool_list += [c for c in fb if c["id"] not in seen_ids]

    exclude = followed | set(seen[kind]) | hidden
    chosen = [c for c in pool_list if c["id"] not in exclude][:LIMIT]

    # Rotasyon esnetilir; takip ve gizlenenler kalıcı engel olarak kalır.
    hard = followed | hidden
    if len(chosen) < LIMIT:
        chosen = [c for c in pool_list if c["id"] not in hard][:LIMIT]
        seen[kind] = []

    if not chosen:
        # hiç profil yok: popularite fallback
        pool_list = _pool_candidates(kind, None, BUFFER)
        chosen = [c for c in pool_list if c["id"] not in hard][:LIMIT]

    if kind == "shows":
        _attach_tv_details(chosen)

    for c in chosen:
        c["can_move_watched"] = _can_move_watched(c)

    seen[kind] = (seen[kind] + [c["id"] for c in chosen])[-SEEN_CAP:]
    _save_seen(seen, user_id=uid)

    return [{k: v for k, v in c.items() if k != "id"} for c in chosen]