"""Kart dışa/içe aktarma — tek JSON dosyası (2.20.4).

Kapsam: `followed` (dizi / film / belgesel) + `anime` kartları; durum
bayrakları (izlenmiş / izlenmemiş / arşiv / ertelenmiş) ve bölüm bazlı
izleme geçmişi. Dışa aktarma kullanıcı bazlıdır (oturumdaki uid).

İçe aktarma "birleştir" modunda çalışır: hedefte aynı kimlik varsa kart
ATLANIR, yoksa metadata + durum + bölümler yazılır. Böylece veri kaybı
riski olmadan tekrar tekrar içe aktarılabilir.

Kimlik: followed -> (user_id, tmdb_id, media_type), anime -> (user_id, anilist_id).
Taşınmayanlar: id, user_id, poster_local*, added_at / *_check_at çapaları
(hedef kurulumda yeniden hesaplanır).
"""
import csv
import datetime
import io
import json
import re
import sqlite3
import time

from urllib.parse import quote, unquote

FORMAT = 1
MAX_BYTES = 5 * 1024 * 1024
MAX_CARDS = 20000
MAX_EPS = 50000

# type: followed.media_type ("tv" | "movie" | "doc") + "anime"
FOLLOW_TYPES = ("tv", "movie", "doc")

FOLLOW_META = (
    "title", "poster_path", "release_date", "vote_average", "watch_status",
    "networks", "overview", "genres", "tagline", "runtime",
    "number_of_seasons", "number_of_episodes", "status", "season_list",
    "vote_count", "first_air_date", "localized",
)
FOLLOW_STATE = (
    "watched", "in_watched", "deferred", "archived",
    "watched_at", "watched_source", "direct_mark",
)
# anime tablosundaki "episodes" kolonu BÖLÜM SAYISIDIR; dosyada
# "episode_count" olarak taşınır (dosyadaki "episodes" = izleme listesi).
ANIME_META = (
    "title", "cover_url", "status", "score", "studios", "banner",
    "description", "format", "duration", "genres", "start_date",
)
ANIME_STATE = ("in_watched", "deferred", "archived")

FOLLOW_EP_COLS = ("season", "episode", "air_date", "air_time", "name", "runtime", "watched", "watched_at")
ANIME_EP_COLS = ("episode", "air_at", "watched", "watched_at")

_COL_CACHE = {}


class ImportError_(Exception):
    """İçe aktarma hatası — kod frontend'de i18n anahtarına çevrilir."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _pick(row, names):
    """sqlite3.Row içinden yalnız var olan kolonları alır (şema sürümü güvenliği)."""
    try:
        keys = set(row.keys())
    except Exception:
        keys = set()
    return {n: row[n] for n in names if n in keys}


def _table_cols(conn, table):
    """Hedef kurulumun gerçek kolonları (eski/yeni şema farkına dayanıklılık)."""
    if table in _COL_CACHE:
        return _COL_CACHE[table]
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(%s)" % table).fetchall()}
    except Exception:
        cols = set()
    _COL_CACHE[table] = cols
    return cols


def _as_int(v):
    try:
        if v is None or v == "":
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_episodes(raw, cols):
    out = []
    if not isinstance(raw, list):
        return out
    for e in raw[:MAX_EPS]:
        if not isinstance(e, dict):
            continue
        ep = {c: e[c] for c in cols if c in e}
        if ep.get(cols[0]) is not None:
            out.append(ep)
    return out


# ---------------------------------------------------------------- dışa aktar
def export_cards(conn, uid, version=""):
    """Kullanıcının tüm kartlarını (dizi/film/belgesel/anime) JSON sözlüğü yapar."""
    cards = []
    for r in conn.execute(
        "SELECT * FROM followed WHERE user_id=? ORDER BY id", (uid,)
    ).fetchall():
        card = {"type": (r["media_type"] or "movie"), "tmdb_id": r["tmdb_id"]}
        card.update(_pick(r, FOLLOW_META))
        card["state"] = _pick(r, FOLLOW_STATE)
        eps = conn.execute(
            "SELECT season, episode, air_date, air_time, name, runtime, watched, watched_at "
            "FROM episodes WHERE follow_id=? ORDER BY season, episode",
            (r["id"],),
        ).fetchall()
        card["episodes"] = [dict(e) for e in eps]
        cards.append(card)

    for a in conn.execute(
        "SELECT * FROM anime WHERE user_id=? ORDER BY id", (uid,)
    ).fetchall():
        card = {"type": "anime", "anilist_id": a["anilist_id"]}
        card.update(_pick(a, ANIME_META))
        card["episode_count"] = a["episodes"] if "episodes" in a.keys() else None
        card["state"] = _pick(a, ANIME_STATE)
        aeps = conn.execute(
            "SELECT episode, air_at, watched, watched_at "
            "FROM anime_episodes WHERE anime_id=? ORDER BY episode",
            (a["id"],),
        ).fetchall()
        card["episodes"] = [dict(e) for e in aeps]
        cards.append(card)

    counts = {t: 0 for t in FOLLOW_TYPES + ("anime",)}
    for c in cards:
        counts[c["type"]] = counts.get(c["type"], 0) + 1

    return {
        "app": "nextep",
        "format": FORMAT,
        "version": version or "",
        "exported_at": datetime.datetime.now().replace(microsecond=0).isoformat(),
        "counts": counts,
        "cards": cards,
    }


# ---------------------------------------------------------------- içe aktar
def parse_payload(raw):
    """Yüklenen baytları doğrular ve normalize edilmiş kart listesi döndürür."""
    if raw is None:
        raise ImportError_("no_file")
    if not raw.strip():
        raise ImportError_("empty")
    if len(raw) > MAX_BYTES:
        raise ImportError_("too_big")
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise ImportError_("bad_format")
    if not isinstance(data, dict) or (data.get("app") or "") != "nextep":
        raise ImportError_("bad_format")
    if _as_int(data.get("format")) != FORMAT:
        raise ImportError_("bad_format")
    raw_cards = data.get("cards")
    if not isinstance(raw_cards, list):
        raise ImportError_("bad_format")
    if len(raw_cards) > MAX_CARDS:
        raise ImportError_("too_many")

    cards, seen = [], set()
    for c in raw_cards:
        card = _norm_card(c)
        key = ("anime", card["anilist_id"]) if card["type"] == "anime" \
            else (card["type"], card["tmdb_id"])
        if key in seen:
            continue
        seen.add(key)
        cards.append(card)
    if not cards:
        raise ImportError_("empty")
    return cards


def _norm_card(c):
    if not isinstance(c, dict):
        raise ImportError_("bad_format")
    t = str(c.get("type") or "").strip().lower()
    if t == "anime":
        aid = _as_int(c.get("anilist_id"))
        if not aid:
            raise ImportError_("bad_format")
        card = {"type": "anime", "anilist_id": aid}
        card.update({k: c[k] for k in ANIME_META if k in c})
        if "episode_count" in c:
            card["episodes_count"] = _as_int(c.get("episode_count"))
        card["state"] = {k: v for k, v in (c.get("state") or {}).items() if k in ANIME_STATE} \
            if isinstance(c.get("state"), dict) else {}
        card["episodes"] = _as_episodes(c.get("episodes"), ANIME_EP_COLS)
        return card
    if t not in FOLLOW_TYPES:
        raise ImportError_("bad_format")
    tid = _as_int(c.get("tmdb_id"))
    if not tid:
        raise ImportError_("bad_format")
    card = {"type": t, "tmdb_id": tid}
    card.update({k: c[k] for k in FOLLOW_META if k in c})
    card["state"] = {k: v for k, v in (c.get("state") or {}).items() if k in FOLLOW_STATE} \
        if isinstance(c.get("state"), dict) else {}
    card["episodes"] = _as_episodes(c.get("episodes"), FOLLOW_EP_COLS)
    return card


def _existing(conn, uid, card):
    if card["type"] == "anime":
        return conn.execute(
            "SELECT id FROM anime WHERE user_id=? AND anilist_id=?",
            (uid, card["anilist_id"]),
        ).fetchone()
    return conn.execute(
        "SELECT id FROM followed WHERE user_id=? AND tmdb_id=? AND media_type=?",
        (uid, card["tmdb_id"], card["type"]),
    ).fetchone()


def preview_import(conn, uid, cards, verify=False):
    """Kuru çalıştırma: tür bazında kart/bölüm/dakika özeti (yeni/mevcut dahil).

    verify=True: her kartın TMDB'de var olduğu doğrulanır (1 istek/kart, 1 saat
    önbellekli); doğrulanamayanlar `unverified` olarak sayılır.
    """
    types = {}
    new = exist = eps = weps = unverified = 0
    for card in cards:
        buckets = types.setdefault(card["type"], {
            "total": 0, "new": 0, "existing": 0, "unverified": 0,
            "episodes": 0, "watched": 0, "unwatched": 0,
            "watched_min": 0, "unwatched_min": 0,
        })
        buckets["total"] += 1
        tot, w, wm, um = _card_ep_stats(card)
        buckets["episodes"] += tot
        buckets["watched"] += w
        buckets["unwatched"] += max(0, tot - w)
        buckets["watched_min"] += wm
        buckets["unwatched_min"] += um
        eps += tot
        weps += w
        if verify and not _verify_one(card["type"], card.get("tmdb_id") or card.get("anilist_id")):
            unverified += 1
            buckets["unverified"] += 1
        if _existing(conn, uid, card):
            exist += 1
            buckets["existing"] += 1
        else:
            new += 1
            buckets["new"] += 1
    return {
        "total": len(cards),
        "new": new,
        "existing": exist,
        "unverified": unverified,
        "episodes": eps,
        "watched_episodes": weps,
        "types": types,
    }


_VERIFY_TTL = 3600
_verify_cache = {}


def _verify_one(kind, ident):
    """Kart kimliği TMDB'de gerçekten var mı? Anime atlanır (AniList'e gidilmez)."""
    if kind == "anime":
        return True
    try:
        ident = int(ident or 0)
    except (TypeError, ValueError):
        ident = 0
    if not ident:
        return False
    key = (kind, ident)
    now = time.time()
    hit = _verify_cache.get(key)
    if hit and now - hit[0] < _VERIFY_TTL:
        return hit[1]
    ok = False
    try:
        from tmdb import tmdb_request  # döngüsel import olmasın diye geç yükleme
        media = "tv" if kind == "tv" else "movie"
        data = tmdb_request("/%s/%d" % (media, ident), {}, tag="cards.verify")
        ok = bool(data and data.get("id"))
    except Exception:
        ok = False
    _verify_cache[key] = (now, ok)
    return ok


def _card_ep_stats(card):
    """(toplam_bölüm, izlenen_bölüm, izlenen_dk, izlenmeyen_dk).

    Süre: bölümün `runtime`'ı → yoksa yapımın `runtime`'ı (anime: `duration`).
    Film/belgesel 1 bölüm sayılır. Bölüm satırı olmayan kartlarda süre 0 döner.
    """
    kind = card.get("type")
    fallback = card.get("duration") if kind == "anime" else card.get("runtime")
    try:
        fallback = int(fallback or 0)
    except (TypeError, ValueError):
        fallback = 0
    eps = card.get("episodes") or []
    if not eps:
        if kind in ("movie", "doc"):
            st = card.get("state") or {}
            w = 1 if (_as_int(st.get("watched")) == 1 or _as_int(st.get("in_watched")) == 1) else 0
            return 1, w, (fallback if w else 0), (0 if w else fallback)
        total = card.get("number_of_episodes") or card.get("episodes_count") or 0
        try:
            total = int(total or 0)
        except (TypeError, ValueError):
            total = 0
        return total, 0, 0, 0
    total = len(eps)
    w = wm = um = 0
    for e in eps:
        rt = _as_int(e.get("runtime")) or fallback
        rt = rt or 0
        if _as_int(e.get("watched")) == 1:
            w += 1
            wm += rt
        else:
            um += rt
    return total, w, wm, um


def _insert(conn, table, row):
    """Kolonları hedef şemaya göre süzer, satırı ekler. Eklenen id döner."""
    cols = _table_cols(conn, table)
    use = [c for c in row if c in cols]
    if not use:
        raise sqlite3.IntegrityError("no column")
    cur = conn.execute(
        "INSERT INTO %s (%s) VALUES (%s)" % (table, ", ".join(use), ", ".join("?" for _ in use)),
        [row[c] for c in use],
    )
    return cur.lastrowid


def _insert_ignore(conn, table, row):
    """Şemaya göre süzerek INSERT OR IGNORE. Eklenen satır sayısı (0/1) döner."""
    cols = _table_cols(conn, table)
    use = [c for c in row if c in cols]
    if not use:
        return 0
    cur = conn.execute(
        "INSERT OR IGNORE INTO %s (%s) VALUES (%s)"
        % (table, ", ".join(use), ", ".join("?" for _ in use)),
        [row[c] for c in use],
    )
    return cur.rowcount or 0


def _mark_watched(conn, table, where_sql, args, watched_at, now):
    """Bölümü izlendi işaretler — kolonlar hedef şemada varsa (eski şema güvenliği)."""
    cols = _table_cols(conn, table)
    sets = []
    if "watched" in cols:
        sets.append("watched=1")
    if "watched_at" in cols:
        sets.append("watched_at=COALESCE(watched_at, ?)")
        args = [watched_at or now] + list(args)
    if not sets:
        return
    conn.execute(
        "UPDATE %s SET %s WHERE %s" % (table, ", ".join(sets), where_sql),
        args,
    )


def apply_import(conn, uid, cards, now=None, verify=False):
    """Yeni kartları + bölümlerini yazar. Var olan kart atlanır (birleştir).

    verify=True ise TMDB'de bulunamayan kartlar eklenmez (unverified sayacı).
    """
    now = int(now or datetime.datetime.now().timestamp())
    added = skipped = eps_added = unverified = 0
    for card in cards:
        if verify and not _verify_one(card["type"], card.get("tmdb_id") or card.get("anilist_id")):
            unverified += 1
            continue
        if _existing(conn, uid, card):
            skipped += 1
            continue
        list_eps = card.get("episodes") or []
        try:
            if card["type"] == "anime":
                row = {"user_id": uid, "anilist_id": card["anilist_id"]}
                row.update({k: v for k, v in card.items() if k in ANIME_META})
                row["episodes"] = card.get("episodes_count")
                row.update({k: v for k, v in (card.get("state") or {}).items() if k in ANIME_STATE})
                aid = _insert(conn, "anime", row)
                if not aid:
                    got = conn.execute(
                        "SELECT id FROM anime WHERE user_id=? AND anilist_id=?",
                        (uid, card["anilist_id"]),
                    ).fetchone()
                    aid = got["id"] if got else None
                if not aid:
                    skipped += 1
                    continue
                for e in list_eps:
                    ep_no = _as_int(e.get("episode"))
                    if not ep_no:
                        continue
                    eps_added += _insert_ignore(conn, "anime_episodes", {
                        "anime_id": aid, "episode": ep_no, "air_at": e.get("air_at"),
                        "watched": _as_int(e.get("watched")) or 0, "watched_at": e.get("watched_at"),
                    })
                    if _as_int(e.get("watched")) == 1:
                        _mark_watched(conn, "anime_episodes", "anime_id=? AND episode=?",
                                      [aid, ep_no], e.get("watched_at"), now)
            else:
                row = {"user_id": uid, "tmdb_id": card["tmdb_id"], "media_type": card["type"]}
                row.update({k: v for k, v in card.items() if k in FOLLOW_META})
                row.update({k: v for k, v in (card.get("state") or {}).items() if k in FOLLOW_STATE})
                fid = _insert(conn, "followed", row)
                for e in list_eps:
                    season, ep_no = _as_int(e.get("season")), _as_int(e.get("episode"))
                    if season is None or ep_no is None:
                        continue
                    eps_added += _insert_ignore(conn, "episodes", {
                        "follow_id": fid, "season": season, "episode": ep_no,
                        "air_date": e.get("air_date"), "air_time": e.get("air_time"),
                        "name": e.get("name"),
                        "runtime": e.get("runtime"), "watched": _as_int(e.get("watched")) or 0,
                        "watched_at": e.get("watched_at"),
                    })
                    if _as_int(e.get("watched")) == 1:
                        _mark_watched(conn, "episodes", "follow_id=? AND season=? AND episode=?",
                                      [fid, season, ep_no], e.get("watched_at"), now)
        except sqlite3.IntegrityError:
            skipped += 1
            continue
        added += 1
    conn.commit()
    return {"added": added, "skipped": skipped, "episodes": eps_added, "unverified": unverified}


# ------------------------------------------------------------ CSV (tam yedek)
# JSON ile AYNI kapsam: kart metadata'sının tamamı + TÜM bölüm satırları
# (yayın tarihi, saat, izlendi, izlenme zamanı, süre, ad). Ayırıcı ";" +
# UTF-8 BOM + CRLF → Türkçe Excel'de tek tıkla açılır (Geçmiş CSV'si deseni).
CSV_COLUMNS = (
    "type", "tmdb_id", "anilist_id", "title", "year", "date", "status",
    "vote_average", "vote_count", "runtime", "seasons", "total_eps",
    "watched_eps", "watch_status", "genres", "networks", "studios", "overview",
    "description", "tagline", "localized", "format", "banner", "poster_path",
    "cover_url", "state", "in_watched", "archived", "deferred", "watched",
    "watched_at", "watched_source", "season_list", "episodes",
)
CSV_DELIM = ";"


def _as_float(v):
    try:
        if v is None or v == "":
            return None
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _flat(text):
    """Serbest metni TEK satıra indirir (CSV'de kayıt fiziksel olarak tek satır
    kalsın). Paragraf sonları boşluğa döner; JSON tarafı metni aynen korur."""
    s = str(text if text is not None else "")
    s = s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ").replace("\t", " ")
    return re.sub(r"\s{2,}", " ", s).strip()


def _csv_year(card):
    for key in ("first_air_date", "release_date", "start_date"):
        v = str(card.get(key) or "").strip()
        if len(v) >= 4 and v[:4].isdigit():
            return v[:4]
    return ""


def _csv_date(card):
    """Tam tarih (YYYY-AA-GG) — CSV'den geri yüklerken sıralama bozulmasın."""
    for key in ("first_air_date", "release_date", "start_date"):
        v = str(card.get(key) or "").strip()
        if len(v) >= 10 and v[4] == "-" and v[7] == "-":
            return v[:10]
    return ""


def _csv_state(state):
    """Tek kelimelik durum: archived > watched > deferred > unwatched."""
    state = state or {}
    if _as_int(state.get("archived")) == 1:
        return "archived"
    if _as_int(state.get("watched")) == 1 or _as_int(state.get("in_watched")) == 1:
        return "watched"
    if _as_int(state.get("deferred")) == 1:
        return "deferred"
    return "unwatched"


def _csv_episodes(card):
    """TÜM bölümler (izlenmemişler dahil).
    Alanlar: `kod~air_date~air_epoch~watched~watched_at~runtime~ad`
    (anime: `E5~~1700000000~1~1700500000~~Ad`; ad percent-encoded)."""
    out = []
    for e in card.get("episodes") or []:
        if card["type"] == "anime":
            code = "E%s" % _as_int(e.get("episode"))
            air_date = ""
            air_epoch = _as_int(e.get("air_at"))
        else:
            code = "S%sE%s" % (_as_int(e.get("season")), _as_int(e.get("episode")))
            air_date = str(e.get("air_date") or "")
            air_epoch = _as_int(e.get("air_time"))
        out.append("~".join([
            code, air_date,
            str(air_epoch or ""),
            str(_as_int(e.get("watched")) or 0),
            str(_as_int(e.get("watched_at")) or ""),
            str(_as_int(e.get("runtime")) or ""),
            quote(_flat(e.get("name")), safe=""),
        ]))
    return ",".join(out)


def export_csv(conn, uid, version=""):
    """Kullanıcının kartlarını TAM CSV metnine çevirir (BOM'lu, CRLF)."""
    data = export_cards(conn, uid, version)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=CSV_DELIM, lineterminator="\r\n")
    w.writerow(CSV_COLUMNS)
    for c in data["cards"]:
        st = c.get("state") or {}
        eps = c.get("episodes") or []
        anime = c["type"] == "anime"

        def pick(key, flat=False):
            v = c.get(key)
            if v is None:
                return ""
            return _flat(v) if flat else v

        total = c.get("episode_count") if anime else c.get("number_of_episodes")
        if not total:
            total = len(eps)
        weps = sum(1 for e in eps if _as_int(e.get("watched")) == 1)
        w.writerow([
            c["type"],
            "" if anime else pick("tmdb_id"),
            pick("anilist_id") if anime else "",
            pick("title", True), _csv_year(c), _csv_date(c), pick("status", True),
            pick("score") if anime else pick("vote_average"),
            "" if anime else pick("vote_count"),
            pick("duration") if anime else pick("runtime"),
            "" if anime else pick("number_of_seasons"),
            total, weps,
            "" if anime else pick("watch_status", True),
            pick("genres", True),
            "" if anime else pick("networks", True),
            pick("studios", True) if anime else "",
            "" if anime else pick("overview", True),
            pick("description", True) if anime else "",
            "" if anime else pick("tagline", True),
            "" if anime else pick("localized", True),
            pick("format", True) if anime else "",
            pick("banner", True) if anime else "",
            "" if anime else pick("poster_path", True),
            pick("cover_url", True) if anime else "",
            _csv_state(st),
            _as_int(st.get("in_watched")) or 0,
            _as_int(st.get("archived")) or 0,
            _as_int(st.get("deferred")) or 0,
            _as_int(st.get("watched")) or 0,
            _as_int(st.get("watched_at")) or "",
            _flat(st.get("watched_source") or ""),
            "" if anime else pick("season_list", True),
            _csv_episodes(c),
        ])
    return "\ufeff" + buf.getvalue()


def _norm_header(h):
    return (h or "").strip().lower().replace("\ufeff", "").replace("-", "_").replace(" ", "_")


def _episodes_from_csv(text, kind):
    """`S1E1~tarih~saat~izlendi~izlenme~süre~ad` (yeni) ya da eski
    `S1E1|ts` / `S1E1` biçimini bölüm listesine çevirir."""
    out = []
    for tok in str(text or "").split(","):
        tok = tok.strip()
        if not tok:
            continue
        if "~" in tok:
            parts = tok.split("~")
            parts += [""] * (7 - len(parts))
            code, air_date, air_epoch, watched, watched_at, runtime, name = parts[:7]
        else:
            code, _, watched_at = tok.partition("|")
            air_date = air_epoch = runtime = name = ""
            watched = "1"  # eski biçim yalnız izlenenleri taşıyordu
        code = code.strip().upper()
        season = ep_no = None
        if code.startswith("S") and "E" in code:
            s, _, e = code.partition("E")
            season, ep_no = _as_int(s[1:]), _as_int(e)
        elif code.startswith("E"):
            ep_no = _as_int(code[1:])
        if ep_no is None:
            continue
        w = _as_int(watched)
        if w is None:
            w = 1
        if kind == "anime":
            if season is not None:
                continue
            out.append({
                "episode": ep_no,
                "air_at": _as_int(air_epoch),
                "watched": w,
                "watched_at": _as_int(watched_at),
            })
            continue
        out.append({
            "season": season if season is not None else 1,
            "episode": ep_no,
            "air_date": air_date or None,
            "air_time": _as_int(air_epoch),
            "watched": w,
            "watched_at": _as_int(watched_at),
            "runtime": _as_int(runtime),
            "name": unquote(name) if name else None,
        })
    return out


def parse_csv(raw):
    """CSV yedeğini normalize kart listesine çevirir. (cards, info) döndürür."""
    if raw is None:
        raise ImportError_("no_file")
    if not raw.strip():
        raise ImportError_("empty")
    if len(raw) > MAX_BYTES:
        raise ImportError_("too_big")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", "replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise ImportError_("empty")
    head = lines[0]
    delim = CSV_DELIM if head.count(CSV_DELIM) >= head.count(",") else ","
    try:
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    except csv.Error:
        raise ImportError_("bad_format")
    if not rows:
        raise ImportError_("empty")
    header = [_norm_header(h) for h in rows[0]]
    if not any(h in header for h in ("type", "tmdb_id", "anilist_id", "title")):
        raise ImportError_("bad_format")
    idx = {h: i for i, h in enumerate(header) if h}

    info = {"rows": 0, "ok": 0, "no_id": 0, "bad": 0}
    cards, seen = [], set()
    for r in rows[1:]:
        if not r or not any(str(x).strip() for x in r):
            continue
        info["rows"] += 1

        def g(key):
            i = idx.get(key)
            if i is None or i >= len(r):
                return ""
            return str(r[i] or "").strip()

        kind = (g("type") or "").lower() or "movie"
        if kind not in FOLLOW_TYPES + ("anime",):
            info["bad"] += 1
            continue
        title, year = g("title"), g("year")
        date = g("date")
        if not (len(date) >= 10 and date[4] == "-" and date[7] == "-"):
            date = ("%s-01-01" % year) if year.isdigit() else ""
        if kind == "anime":
            aid = _as_int(g("anilist_id"))
            if not aid:
                info["no_id"] += 1
                continue
            card = {"type": "anime", "anilist_id": aid}
            if title:
                card["title"] = title
            for col in ("status", "genres", "studios", "banner", "description",
                        "format", "cover_url"):
                val = g(col)
                if val:
                    card[col] = val
            sc = _as_float(g("vote_average"))
            if sc is not None:
                card["score"] = sc
            dur = _as_int(g("runtime"))
            if dur:
                card["duration"] = dur
            te = _as_int(g("total_eps"))
            if te is not None:
                card["episodes_count"] = te
            if date:
                card["start_date"] = date
            card["state"] = {
                "in_watched": _as_int(g("in_watched")) or 0,
                "deferred": _as_int(g("deferred")) or 0,
                "archived": _as_int(g("archived")) or 0,
            }
            card["episodes"] = _episodes_from_csv(g("episodes"), "anime")
            key = ("anime", aid)
        else:
            tid = _as_int(g("tmdb_id"))
            if not tid:
                info["no_id"] += 1
                continue
            card = {"type": kind, "tmdb_id": tid}
            if title:
                card["title"] = title
            for col in ("status", "watch_status", "genres", "networks", "overview",
                        "tagline", "localized", "poster_path", "season_list"):
                val = g(col)
                if val:
                    card[col] = val
            va = _as_float(g("vote_average"))
            if va is not None:
                card["vote_average"] = va
            vc = _as_int(g("vote_count"))
            if vc is not None:
                card["vote_count"] = vc
            rt = _as_int(g("runtime"))
            if rt:
                card["runtime"] = rt
            se = _as_int(g("seasons"))
            if se:
                card["number_of_seasons"] = se
            te = _as_int(g("total_eps"))
            if te is not None:
                card["number_of_episodes"] = te
            if date:
                card["first_air_date" if kind == "tv" else "release_date"] = date
            card["state"] = {
                "watched": _as_int(g("watched")) or 0,
                "in_watched": _as_int(g("in_watched")) or 0,
                "deferred": _as_int(g("deferred")) or 0,
                "archived": _as_int(g("archived")) or 0,
                "watched_at": _as_int(g("watched_at")),
                "watched_source": g("watched_source") or None,
            }
            card["episodes"] = _episodes_from_csv(g("episodes"), kind)
            key = (kind, tid)
        if key in seen:
            continue
        seen.add(key)
        cards.append(card)
        info["ok"] += 1
    if not cards:
        raise ImportError_("no_rows")
    return cards, info
