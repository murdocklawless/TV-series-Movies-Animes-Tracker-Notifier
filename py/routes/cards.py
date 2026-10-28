"""Kart dışa/içe aktarma uçları (2.22.0).

GET  /api/cards/export?format=json|csv     -> tek dosya (attachment)
POST /api/cards/import/preview             -> kuru çalıştırma özeti (+verify)
POST /api/cards/import/apply               -> DB snapshot + birleştirerek yaz
GET  /api/cards/import/history             -> son içe aktarmalar (kullanıcı bazlı)

Ağır iş `cards_transfer.py`'de; burada yalnız HTTP katmanı, snapshot/budama ve
`import_log` kaydı var. Biçim dosya adı/ilk karakterden algılanır.
"""
import datetime
import json
import os
import shutil
import sqlite3

from flask import Blueprint, Response, jsonify, request

import cards_transfer
from auth import get_current_user
from config import BASE_DIR
from db import get_db, db_version_get
from messages_i18n import t
from ramcache import bump

cards_bp = Blueprint("cards", __name__)

MAX_IMPORT_SNAPS = 10      # bak/import_* klasörlerinden saklanan en yeni sayı
_SNAP_PREFIX = "import_"


def _uid():
    """Oturumdaki kullanıcı id'si (yoksa 0)."""
    try:
        u = get_current_user()
        return int(u["id"]) if u else 0
    except Exception:
        return 0


def _err(code, status=400, **kw):
    body = {"error": code, "message": t(code)}
    body.update(kw)
    return jsonify(body), status


def _stamp():
    try:
        return datetime.datetime.now().strftime("%Y%m%d-%H%M")
    except Exception:
        return "export"


# ------------------------------------------------------------------ dışa aktar
@cards_bp.route("/api/cards/export")
def cards_export():
    uid = _uid()
    if not uid:
        return _err("cards_err_auth", 401)
    fmt = (request.args.get("format") or "json").strip().lower()
    conn = get_db()
    try:
        version = db_version_get()
        if fmt == "csv":
            body = cards_transfer.export_csv(conn, uid, version)
        else:
            body = json.dumps(cards_transfer.export_cards(conn, uid, version),
                              ensure_ascii=False, separators=(",", ":"))
    finally:
        conn.close()
    stamp = _stamp()
    if fmt == "csv":
        resp = Response(body.encode("utf-8"), mimetype="text/csv")
        resp.headers["Content-Disposition"] = 'attachment; filename="nextep-cards-%s.csv"' % stamp
    else:
        resp = Response(body, mimetype="application/json; charset=utf-8")
        resp.headers["Content-Disposition"] = 'attachment; filename="nextep-cards-%s.json"' % stamp
    resp.headers["Cache-Control"] = "no-store"
    return resp


# --------------------------------------------------- içe aktarma: snapshot/log
def _snap_root():
    return os.path.join(BASE_DIR, "bak")


def _prune_snapshots():
    """bak/import_* klasörlerinden en yeni MAX_IMPORT_SNAPS tanesini bırakır."""
    root = _snap_root()
    try:
        dirs = sorted(d for d in os.listdir(root)
                      if d.startswith(_SNAP_PREFIX) and os.path.isdir(os.path.join(root, d)))
    except OSError:
        return
    for d in dirs[:-MAX_IMPORT_SNAPS]:
        try:
            shutil.rmtree(os.path.join(root, d), ignore_errors=True)
        except Exception:
            pass


def _snapshot_db(conn):
    """Apply öncesi tutarlı DB kopyası (SQLite backup API). `bak/...` yolu döner."""
    name = _SNAP_PREFIX + datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    folder = os.path.join(_snap_root(), name)
    try:
        os.makedirs(folder, exist_ok=True)
        dst = sqlite3.connect(os.path.join(folder, "nextep.db.pre"))
        try:
            conn.backup(dst)
        finally:
            dst.close()
        _prune_snapshots()
        return "bak/" + name
    except Exception as e:
        print(f"[cards.import] snapshot fail: {e}", flush=True)
        return ""


def _verify_flag():
    v = str(request.form.get("verify") or "").strip().lower()
    return v in ("1", "true", "on", "yes")


def _load_import():
    """Yüklenen dosyayı çözer. (cards, csv_info, fmt, filename) döner."""
    f = request.files.get("file")
    if f is not None:
        raw = f.read(cards_transfer.MAX_BYTES + 1)
    else:
        raw = request.get_data(cache=False)
    if raw is not None and len(raw) > cards_transfer.MAX_BYTES:
        raise cards_transfer.ImportError_("too_big")
    filename = ((f.filename if f is not None else "") or "")
    is_csv = filename.lower().endswith(".csv")
    if not is_csv:
        head = (raw or b"")[:64].lstrip(b"\xef\xbb\xbf").lstrip()
        is_csv = bool(head) and head[:1] not in (b"{", b"[")
    if is_csv:
        cards, info = cards_transfer.parse_csv(raw)
        return cards, info, "csv", filename
    return cards_transfer.parse_payload(raw), None, "json", filename


@cards_bp.route("/api/cards/import/preview", methods=["POST"])
def cards_import_preview():
    uid = _uid()
    if not uid:
        return _err("cards_err_auth", 401)
    try:
        cards, csv_info, _fmt, _name = _load_import()
    except cards_transfer.ImportError_ as e:
        return _err("cards_err_" + e.code)
    conn = get_db()
    try:
        info = cards_transfer.preview_import(conn, uid, cards, verify=_verify_flag())
    finally:
        conn.close()
    info["ok"] = True
    if csv_info:
        info["csv"] = csv_info
    return jsonify(info)


@cards_bp.route("/api/cards/import/apply", methods=["POST"])
def cards_import_apply():
    uid = _uid()
    if not uid:
        return _err("cards_err_auth", 401)
    try:
        cards, csv_info, fmt, filename = _load_import()
    except cards_transfer.ImportError_ as e:
        return _err("cards_err_" + e.code)
    conn = get_db()
    snapshot = ""
    try:
        snapshot = _snapshot_db(conn)          # yazmadan önce tutarlı kopya
        info = cards_transfer.apply_import(conn, uid, cards, verify=_verify_flag())
        try:
            conn.execute(
                "INSERT INTO import_log (user_id, ts, format, filename, total, added,"
                " skipped, unverified, snapshot, extra) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (uid, int(datetime.datetime.now().timestamp()), fmt, filename[:200],
                 len(cards), info.get("added", 0), info.get("skipped", 0),
                 info.get("unverified", 0), snapshot,
                 json.dumps(csv_info or {}, ensure_ascii=False)),
            )
            conn.commit()
        except Exception as e:
            print(f"[cards.import] log fail: {e}", flush=True)
    finally:
        conn.close()
    try:
        bump()  # liste cache'leri tazelensin (kartlar hemen gorunsun)
    except Exception:
        pass
    info["ok"] = True
    info["snapshot"] = snapshot
    if csv_info:
        info["csv"] = csv_info
    return jsonify(info)


@cards_bp.route("/api/cards/import/history")
def cards_import_history():
    uid = _uid()
    if not uid:
        return _err("cards_err_auth", 401)
    try:
        limit = int(request.args.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(50, limit))
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, ts, format, filename, total, added, skipped, unverified, snapshot"
            " FROM import_log WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT ?",
            (uid, limit),
        ).fetchall()
    except Exception:
        rows = []
    finally:
        conn.close()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})
