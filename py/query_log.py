"""Sorgu gunlugu (05:00 devirli JSONL).

Amac
----
Her **dis HTTP istegi** tek satir JSON olarak `log/query.log` dosyasina yazilir:
hangi kural (`tag`), hangi bolum (`sec`), hangi kart (`card`/`ids`), hangi servis,
kac ms, hangi HTTP kodu, agdan mi onbellekten mi (`src`).

Dosya duzeni
------------
    log/query.log                 -> canli hesap gunu (JSONL)
    log/query-YYYY-MM-DD.jsonl    -> 05:00'te devredilen gun (30 gun saklanir)
    log/query-YYYY-MM-DD.md       -> o gunun otomatik ozeti (365 gun saklanir)

Hesap gunu 05:00'te devreder: 05:00-05:10 gece partisi yeni gune yazilir.

Satir bicimi (2.19.26)
----------------------
`t` tam ISO yerel zamandir (ms duyarli) ve **tarihin tek kaynagi** odur; ayrica
`d` alani YAZILMAZ (eski satirlarda kalmis olabilir, okuyan yok). Hangi gune ait
oldugu dosya adindan da bellidir: canli dosya tek hesap gunu tutar, 05:00'te
`query-YYYY-MM-DD.jsonl` olarak devreder.

Kurallar
--------
* Fail-soft: yazma hatasi istek akisini ASLA bozmaz (log sessizce kapanir).
* Gizlilik: `api_key`, `token`, `secret`, `password`, `authorization` alanlari
  ve degerleri yazilmaz.
* Tek satir 4 KB'i gecerse kirpilir.
* Seviye: `info` (varsayilan) / `debug` (img, emby gibi gurultulu kalemler).
"""

import contextvars
import datetime
import json
import os
import re
import threading
import time

from config import BASE_DIR

LOG_DIR = os.environ.get("QUERY_LOG_DIR") or os.path.join(BASE_DIR, "log")
LIVE_NAME = "query.log"
ROTATE_HOUR = 5           # hesap gunu siniri (yerel saat)
JSONL_KEEP_DAYS = 30
MD_KEEP_DAYS = 365
MAX_LINE = 4096

_SECRET_RE = re.compile(
    r"(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|bearer)",
    re.IGNORECASE,
)

_lock = threading.RLock()
_LEVEL = "info"
_LEVELS = {"info": 1, "debug": 2}
_day = None                # su anki hesap gunu (YYYY-MM-DD)
_disabled = False
_warned = False
_runs = {}                 # run_id -> sayaclar

# Baglam (thread basina): run kimligi + etiket + bolum + uid
_ctx_run = contextvars.ContextVar("qlog_run", default=None)
_ctx_tag = contextvars.ContextVar("qlog_tag", default=None)
_ctx_sec = contextvars.ContextVar("qlog_sec", default=None)
_ctx_uid = contextvars.ContextVar("qlog_uid", default=None)
_ctx_card = contextvars.ContextVar("qlog_card", default=None)


# ---------------------------------------------------------------------------
# zaman / gun siniri
# ---------------------------------------------------------------------------

def billing_now():
    """Hesap gununun simdiki ani (05:00 siniri)."""
    return datetime.datetime.now()


def billing_day(dt=None):
    """05:00 sinirina gore gun anahtari (YYYY-MM-DD)."""
    dt = dt or datetime.datetime.now()
    shifted = dt - datetime.timedelta(hours=ROTATE_HOUR)
    return shifted.date().isoformat()


def billing_day_start(dt=None):
    """Hesap gununun baslangic epoch'i (05:00)."""
    dt = dt or datetime.datetime.now()
    start = dt.replace(hour=ROTATE_HOUR, minute=0, second=0, microsecond=0)
    if dt < start:
        start -= datetime.timedelta(days=1)
    return start.timestamp()


# ---------------------------------------------------------------------------
# yapilandirma
# ---------------------------------------------------------------------------

def configure(level=None, enabled=True):
    """Seviye/aktiflik ayari (nextep.py acilista cagirir)."""
    global _LEVEL, _disabled
    try:
        lv = str(level or "info").strip().lower()
    except Exception:
        lv = "info"
    _LEVEL = lv if lv in _LEVELS else "info"
    _disabled = not bool(enabled)


def enabled():
    return not _disabled


# ---------------------------------------------------------------------------
# baglam yonetimi
# ---------------------------------------------------------------------------

def _new_run_id(flow):
    flow = str(flow or "run")
    safe = "".join(c if (c.isalnum() or c in "._-") else "-" for c in flow)[:40]
    return "%s-%s-%04x" % (safe, datetime.datetime.now().strftime("%Y%m%d-%H%M%S"),
                           int(time.time() * 1000) % 0xFFFF)


def begin_run(flow, sec=None, card=None, uid=None):
    """Yeni is (run) baslatir; donen kimlik satirlara `run` olarak yazilir."""
    rid = _new_run_id(flow)
    _ctx_run.set(rid)
    if sec is not None:
        _ctx_sec.set(sec)
    if card is not None:
        _ctx_card.set(card)
    if uid is not None:
        _ctx_uid.set(uid)
    with _lock:
        _runs[rid] = {"t0": time.monotonic(), "flow": flow, "sec": sec,
                      "requests": 0, "cache_hits": 0, "errors": 0}
        if len(_runs) > 64:                       # sizinti korumasi
            for k in sorted(_runs, key=lambda x: _runs[x]["t0"])[:16]:
                _runs.pop(k, None)
    return rid


def end_run(errors=None, card_count=None):
    """Aktif isi kapatir; `run_end` ozet satiri yazar."""
    rid = _ctx_run.get()
    if not rid:
        return
    with _lock:
        st = _runs.pop(rid, None) or {}
    if st:
        try:
            log("run", method="END", path=st.get("flow") or "", src="meta",
                tag=st.get("flow") or "-", level="info", extra={
                    "kind": "run_end",
                    "run": rid,
                    "requests": st.get("requests", 0),
                    "cache_hits": st.get("cache_hits", 0),
                    "errors": st.get("errors", 0) if errors is None else int(errors),
                    "cards": card_count,
                    "ms": int((time.monotonic() - st.get("t0", time.monotonic())) * 1000),
                })
        except Exception:
            pass
    _ctx_run.set(None)
    # Baglam sizmasin: ayni is parcacigi sonraki istegi eski etiketle loglamasin.
    _ctx_tag.set(None)
    _ctx_sec.set(None)
    _ctx_card.set(None)
    _ctx_uid.set(None)


def set_tag(tag):
    _ctx_tag.set(tag)


def set_sec(sec):
    _ctx_sec.set(sec)


def set_uid(uid):
    _ctx_uid.set(uid)


class tag_ctx:
    """`with tag_ctx("feed.detail"):` — blok icindeki satirlara etiket verir."""

    def __init__(self, tag, sec=None):
        self.tag = tag
        self.sec = sec
        self._prev_tag = None
        self._prev_sec = None

    def __enter__(self):
        self._prev_tag = _ctx_tag.get()
        self._prev_sec = _ctx_sec.get()
        if self.tag:
            _ctx_tag.set(self.tag)
        if self.sec:
            _ctx_sec.set(self.sec)
        return self

    def __exit__(self, *exc):
        _ctx_tag.set(self._prev_tag)
        _ctx_sec.set(self._prev_sec)
        return False


def snapshot():
    """Thread'e tasinacak baglam kopyasi (ThreadPoolExecutor icin)."""
    return {
        "run": _ctx_run.get(),
        "tag": _ctx_tag.get(),
        "sec": _ctx_sec.get(),
        "uid": _ctx_uid.get(),
        "card": _ctx_card.get(),
    }


def bind(snap):
    """`snapshot()` ciktisini bu thread'e uygular (worker basinda cagrilir)."""
    if not snap:
        return
    _ctx_run.set(snap.get("run"))
    _ctx_tag.set(snap.get("tag"))
    _ctx_sec.set(snap.get("sec"))
    _ctx_uid.set(snap.get("uid"))
    _ctx_card.set(snap.get("card"))


# ---------------------------------------------------------------------------
# yazma
# ---------------------------------------------------------------------------

def _live_path():
    return os.path.join(LOG_DIR, LIVE_NAME)


def _clean_params(params):
    """Gizli alanlari ayiklar; degerleri kisaltir."""
    if not isinstance(params, dict):
        return None
    out = {}
    for k, v in params.items():
        try:
            key = str(k)
        except Exception:
            continue
        if _SECRET_RE.search(key):
            out[key] = "***"
            continue
        if isinstance(v, (dict, list)):
            try:
                s = json.dumps(v, ensure_ascii=False)
            except Exception:
                s = str(v)
        else:
            s = v
        if isinstance(s, str) and len(s) > 200:
            s = s[:200] + "~"
        out[key] = s
    return out


def _rotate_locked():
    """Gun degistiyse canli dosyayi devreder (kilit altinda cagrilir)."""
    global _day
    today = billing_day()
    if _day is None:
        _day = today
        return
    if today == _day:
        return
    old = _day
    _day = today
    live = _live_path()
    try:
        if os.path.exists(live) and os.path.getsize(live) > 0:
            target = os.path.join(LOG_DIR, "query-%s.jsonl" % old)
            if os.path.exists(target):
                target = os.path.join(LOG_DIR, "query-%s-%d.jsonl" % (old, int(time.time())))
            os.replace(live, target)
            threading.Thread(target=_post_rotate, args=(target,), daemon=True).start()
    except Exception as e:
        _warn("rotate", e)


def _post_rotate(path):
    """Devredilen dosyanin ozetini yazar + eski dosyalari budar (arka plan)."""
    try:
        summarize_file(path)
    except Exception as e:
        _warn("summary", e)
    try:
        prune()
    except Exception as e:
        _warn("prune", e)


def _warn(where, exc):
    global _warned
    if _warned:
        return
    _warned = True
    try:
        print("[query_log] %s hata: %s" % (where, exc), flush=True)
    except Exception:
        pass


def log(svc, method="GET", path="", params=None, status=0, ms=0, src="net",
        tag=None, sec=None, card=None, ids=None, uid=None, level="info",
        err="", extra=None):
    """Tek satir yazar. Hata durumunda sessizce doner (fail-soft)."""
    if _disabled:
        return
    if _LEVELS.get(str(level).lower(), 1) > _LEVELS.get(_LEVEL, 1):
        return
    now = datetime.datetime.now()
    rec = {
        "t": now.isoformat(timespec="milliseconds"),
        "svc": str(svc or "-"),
        "m": str(method or "GET").upper(),
        "p": str(path or ""),
    }
    q = _clean_params(params)
    if q:
        rec["q"] = q
    if status:
        rec["st"] = int(status)
    if ms:
        rec["ms"] = int(ms)
    rec["src"] = src
    rec["tag"] = str(tag or _ctx_tag.get() or "-")
    rid = _ctx_run.get()
    if rid:
        rec["run"] = rid
    s = sec if sec is not None else _ctx_sec.get()
    if s:
        rec["sec"] = s
    c = card if card is not None else _ctx_card.get()
    if c:
        rec["card"] = c
    if ids:
        rec["ids"] = ids
    u = uid if uid is not None else _ctx_uid.get()
    if u:
        rec["u"] = u
    if err:
        rec["err"] = str(err)[:300]
    if extra:
        try:
            rec.update(extra)
        except Exception:
            pass

    if rid:
        with _lock:
            st = _runs.get(rid)
            if st is not None:
                if str(rec.get("m")) == "END":
                    pass
                elif src == "cache":
                    st["cache_hits"] += 1
                else:
                    st["requests"] += 1
                if status and int(status) >= 400:
                    st["errors"] += 1
                elif str(status) == "0":
                    st["errors"] += 1

    try:
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        try:
            line = json.dumps(rec, ensure_ascii=True, separators=(",", ":"))
        except Exception:
            return
    if len(line) > MAX_LINE:
        line = line[:MAX_LINE] + '"}'
    try:
        with _lock:
            _rotate_locked()
            os.makedirs(LOG_DIR, exist_ok=True)
            with open(_live_path(), "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as e:
        _warn("write", e)


# ---------------------------------------------------------------------------
# okuma: gunluk toplam / pik (rate_track restart toparlamasi)
# ---------------------------------------------------------------------------

def _iter_records(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except Exception:
                    continue
    except FileNotFoundError:
        return
    except Exception as e:
        _warn("read", e)
        return


def stats_today(service, window_sec=10, since=None):
    """Bugun (05:00'dan beri) agdan yapilan istek sayisi + pencere pik dolulugu.

    2.20.1: `since` (epoch) verilirse yalniz o andan SONRAKI kayitlar sayilir.
    Panel sayaci 05:00 hesap gunune hizalanirken, 05:00 ile dosya devri
    arasindaki boslukta canli dosyada hala duran ONCEKI gun kayitlari
    sayilmasin diye kullanilir (aksi halde panel 2 gunu toplar).
    """
    window_sec = int(window_sec or 10)
    try:
        since = float(since) if since else None
    except (TypeError, ValueError):
        since = None
    total = 0
    stamps = []
    for rec in _iter_records(_live_path()):
        if rec.get("svc") != service or rec.get("src") != "net":
            continue
        try:
            ts = datetime.datetime.fromisoformat(rec.get("t")).timestamp()
        except Exception:
            continue
        if since is not None and ts < since:
            continue
        total += 1
        stamps.append(ts)
    peak = 0
    if stamps:
        stamps.sort()
        j = 0
        for i, ts in enumerate(stamps):
            while stamps[j] <= ts - window_sec:
                j += 1
            if (i - j + 1) > peak:
                peak = i - j + 1
    return total, peak


def day_totals(day=None):
    """Bir gunun servis bazli toplamlari {svc: {net, cache, errors}}."""
    day = day or billing_day()
    path = _live_path() if day == billing_day() else os.path.join(LOG_DIR, "query-%s.jsonl" % day)
    out = {}
    for rec in _iter_records(path):
        svc = rec.get("svc") or "-"
        slot = out.setdefault(svc, {"net": 0, "cache": 0, "errors": 0})
        if rec.get("src") == "net":
            slot["net"] += 1
        elif rec.get("src") == "cache":
            slot["cache"] += 1
        try:
            if int(rec.get("st") or 0) >= 400 or str(rec.get("st")) == "0":
                slot["errors"] += 1
        except Exception:
            pass
    return out


# ---------------------------------------------------------------------------
# ozet
# ---------------------------------------------------------------------------

def _fmt_table(rows, headers):
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


def summarize_file(jsonl_path, md_path=None):
    """JSONL dosyasindan gunluk Markdown ozeti uretir. -> md yolu"""
    if md_path is None:
        md_path = re.sub(r"\.jsonl$", ".md", jsonl_path)
    by_tag = {}
    by_sec = {}
    by_path = {}
    by_card = {}
    by_hour = {}
    slow = []
    errors = []
    net = cache = 0
    for rec in _iter_records(jsonl_path):
        if rec.get("kind") == "run_end":
            continue
        src = rec.get("src")
        if src == "net":
            net += 1
        elif src == "cache":
            cache += 1
        tag = rec.get("tag") or "-"
        t = by_tag.setdefault(tag, [0, 0, 0])
        t[0] += 1
        try:
            if int(rec.get("st") or 0) >= 400 or str(rec.get("st")) == "0":
                t[2] += 1
        except Exception:
            pass
        sec = rec.get("sec")
        if sec:
            by_sec[sec] = by_sec.get(sec, 0) + 1
        p = rec.get("p")
        if p:
            by_path[p] = by_path.get(p, 0) + 1
        card = rec.get("card")
        if isinstance(card, dict) and card.get("tmdb_id"):
            key = "tmdb:%s" % card.get("tmdb_id")
            by_card[key] = by_card.get(key, 0) + 1
        try:
            hh = str(rec.get("t") or "")[11:13]
            if hh:
                by_hour[hh] = by_hour.get(hh, 0) + 1
        except Exception:
            pass
        try:
            ms = int(rec.get("ms") or 0)
            if ms:
                slow.append((ms, p or "", tag))
        except Exception:
            pass
        if rec.get("err"):
            errors.append((str(rec.get("t"))[11:19], tag, p or "", rec.get("err")))
    day = os.path.basename(jsonl_path)[6:16] if os.path.basename(jsonl_path).startswith("query-") else billing_day()
    top_hour = max(by_hour.items(), key=lambda kv: kv[1]) if by_hour else ("-", 0)
    slow.sort(reverse=True)
    rep = [(p, n) for p, n in by_path.items() if n >= 5]
    rep.sort(key=lambda kv: kv[1], reverse=True)
    lines = [
        "# Sorgu gunlugu · %s (05:00 → 05:00)" % day,
        "",
        "Toplam **%d** ag istegi · **%d** onbellek isabeti · **%d** hata" % (net, cache, len(errors)),
        "En yogun saat: **%s** (%d istek)" % (top_hour[0], top_hour[1]),
        "",
        "## Kurala gore",
        _fmt_table([(k, v[0], v[2]) for k, v in sorted(by_tag.items(), key=lambda kv: kv[1][0], reverse=True)[:25]],
                   ["tag", "istek", "hata"]),
    ]
    if by_sec:
        lines += ["", "## Bolume gore",
                  _fmt_table([(k, v) for k, v in sorted(by_sec.items(), key=lambda kv: kv[1], reverse=True)[:20]],
                             ["sec", "istek"])]
    if by_card:
        lines += ["", "## En cok sorgulanan kartlar",
                  _fmt_table([(k, v) for k, v in sorted(by_card.items(), key=lambda kv: kv[1], reverse=True)[:10]],
                             ["kart", "istek"])]
    lines += ["", "## Saatlik dagilim",
              _fmt_table([(h, by_hour.get(h, 0)) for h in ["%02d" % i for i in range(24)]], ["saat", "istek"])]
    if rep:
        lines += ["", "## Tekrar eden sorgular (ayni URL >= 5)",
                  _fmt_table([(p, n) for p, n in rep[:15]], ["path", "istek"])]
    if slow:
        lines += ["", "## En yavas 10 istek",
                  _fmt_table([(ms, p, tg) for ms, p, tg in slow[:10]], ["ms", "path", "tag"])]
    if errors:
        lines += ["", "## Hatalar (ilk 20)",
                  _fmt_table(errors[:20], ["saat", "tag", "path", "hata"])]
    text = "\n".join(lines) + "\n"
    try:
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception as e:
        _warn("summary-write", e)
    return md_path


def prune():
    """Eski dosyalari budar: jsonl 30 gun, md 365 gun."""
    now = time.time()
    try:
        for name in os.listdir(LOG_DIR):
            full = os.path.join(LOG_DIR, name)
            if not os.path.isfile(full):
                continue
            if name == LIVE_NAME:
                continue
            keep_days = MD_KEEP_DAYS if name.endswith(".md") else JSONL_KEEP_DAYS
            try:
                age = (now - os.path.getmtime(full)) / 86400.0
            except OSError:
                continue
            if age > keep_days:
                try:
                    os.remove(full)
                except OSError:
                    pass
    except Exception as e:
        _warn("prune", e)
