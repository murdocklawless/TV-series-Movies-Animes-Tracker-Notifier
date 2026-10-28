"""Kart dışa/içe aktarma uçları (2.20.4).

GET  /api/cards/export?format=json|csv  -> tek dosya (attachment)
POST /api/cards/import/preview          -> kuru çalıştırma özeti (JSON ya da CSV)
POST /api/cards/import/apply            -> birleştirerek yaz (var olanı atlar)

Ağır iş `cards_transfer.py`'de; burada yalnız HTTP katmanı var.
Biçim dosya adı/ilk karakterden algılanır: `.csv` ya da `{`/`[` ile
başlamayan içerik CSV sayılır.
"""
import datetime
import json

from flask import Blueprint, Response, jsonify, request

import cards_transfer
from auth import get_current_user
from db import get_db, db_version_get
from messages_i18n import t
from ramcache import bump

cards_bp = Blueprint("cards", __name__)


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


def _load_import():
    """Yüklenen dosyayı JSON ya da CSV olarak çözer. (cards, csv_info) döner."""
    f = request.files.get("file")
    if f is not None:
        raw = f.read(cards_transfer.MAX_BYTES + 1)
    else:
        raw = request.get_data(cache=False)
    if raw is not None and len(raw) > cards_transfer.MAX_BYTES:
        raise cards_transfer.ImportError_("too_big")
    name = ((f.filename if f is not None else "") or "").lower()
    is_csv = name.endswith(".csv")
    if not is_csv:
        head = (raw or b"")[:64].lstrip(b"\xef\xbb\xbf").lstrip()
        is_csv = bool(head) and head[:1] not in (b"{", b"[")
    if is_csv:
        cards, info = cards_transfer.parse_csv(raw)
        return cards, info
    return cards_transfer.parse_payload(raw), None


@cards_bp.route("/api/cards/import/preview", methods=["POST"])
def cards_import_preview():
    uid = _uid()
    if not uid:
        return _err("cards_err_auth", 401)
    try:
        cards, csv_info = _load_import()
    except cards_transfer.ImportError_ as e:
        return _err("cards_err_" + e.code)
    conn = get_db()
    try:
        info = cards_transfer.preview_import(conn, uid, cards)
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
        cards, csv_info = _load_import()
    except cards_transfer.ImportError_ as e:
        return _err("cards_err_" + e.code)
    conn = get_db()
    try:
        info = cards_transfer.apply_import(conn, uid, cards)
    finally:
        conn.close()
    try:
        bump()  # liste cache'leri tazelensin (kartlar hemen gorunsun)
    except Exception:
        pass
    info["ok"] = True
    if csv_info:
        info["csv"] = csv_info
    return jsonify(info)
