"""Plex / Jellyfin / Emby webhook'lari (1.86).

Uclar:
  POST /webhook/plex/<token>       -> Plex webhook (multipart/form-data, "payload" JSON)
  POST /webhook/jellyfin/<token>   -> Jellyfin webhook eklentisi (application/json)
  POST /webhook/emby/<token>       -> Emby webhook eklentisi (application/json)

Token = kullanicinin `tp_<app>_uuid` degeri (Ayarlar -> Ucuncu Parti Apps kartindaki
adres). Yanlis/bos token -> **404** (Takvim ucuyla ayni desen; ag taramasina bilgi vermez).

Akis: payload -> (tip, dizi/film adi, S/E, saglayici kimlikleri) -> TMDB kimligi
(once saglayici kimligi — sezon/bolum ile dogrulanir — yoksa isim aramasi) ->
Stremio cekirdegi (`routes.stremio.process_signal`, source=app). Boylece
`ask_before_watched` ayari, E-1 kilit kontrolu, sinyal tamponu ve watched yazimi
ayni yoldan isler; kaynak etiketi (source) uygulama adiyla saklanir.

NOT: dizi bolumlerinde Plex/Jellyfin cogu zaman **bolum seviyesi** saglayici
kimlikleri gonderir; seri kimligi bulunamazsa isimle TMDB aramasi yapilir ve
sezon/bolum TMDB tarafinda dogrulanir. Istemci webhook sablonu seri kimliklerini
(ornek: "SeriesProviderIds") de gonderirse cozumleme kesin olur.
"""
import json

from flask import Blueprint, jsonify, request

from db import set_user_setting
from tmdb import tmdb_request

from routes.stremio import (
    WEBHOOK_APPS,
    _find_owner_by_uuid,
    _resolve_tmdb,
    process_signal,
)

webhook_bp = Blueprint("webhook", __name__)

# Kabul edilen "izlendi" olaylari
_PLEX_WATCHED = {"media.scrobble"}
_OTHER_WATCHED = ("playbackstop", "playback.stop", "playbackstopped", "played", "scrobble")

_PREF = {"tmdb": 0, "tvdb": 1, "imdb": 2, "plex": 9}


# ---------------------------------------------------------------------------
# kucuk yardimcilar
# ---------------------------------------------------------------------------

def _int(v):
    try:
        i = int(v)
        return i if i > 0 else None
    except (TypeError, ValueError):
        return None


def _pref(pair):
    return _PREF.get(pair[0], 5)


def _pairs(d):
    """{'Tmdb': '123', 'Imdb': 'tt..'} -> [('tmdb','123'), ('imdb','tt..')] (boslar atlanir)."""
    out = []
    if not isinstance(d, dict):
        return out
    for k, v in d.items():
        if v is None or v == "":
            continue
        out.append((str(k).strip().lower(), str(v).strip()))
    return sorted(out, key=_pref)


def _split_ident(ident):
    """'123/1/5' -> ('123', 1, 5) — Plex eski ajan guid bicimi (seri/sezon/bolum)."""
    if "/" not in ident:
        return ident, None, None
    parts = [p for p in ident.split("/") if p != ""]
    if len(parts) >= 3:
        return parts[0], _int(parts[1]), _int(parts[2])
    return (parts[0] if parts else ident), None, None


def _series_ids(item):
    """Seri seviyesi saglayici kimlikleri (varsa) — bolum payload'inda nadiren bulunur."""
    for key in ("SeriesProviderIds", "SeriesProviderId"):
        d = item.get(key)
        if isinstance(d, dict) and d:
            return d
    s = item.get("Series")
    if isinstance(s, dict) and isinstance(s.get("ProviderIds"), dict) and s["ProviderIds"]:
        return s["ProviderIds"]
    return {}


def _season_has_episode(tmdb_id, season, episode):
    """TMDB sezon verisi bu bolumu dogruluyor mu? -> (kabul, kesin)

    Veri yoksa (henuz TMDB'de olmayan bolum / istek hatasi) kabul=True, kesin=False:
    bilinmezlik adayi elemez. Veri varsa ve bolum yoksa kesin reddedilir.
    """
    if not tmdb_id or season is None or episode is None:
        return True, False
    try:
        data = tmdb_request(f"/tv/{tmdb_id}/season/{season}", lang="en-US")
    except Exception:
        data = None
    if not data or not data.get("episodes"):
        return True, False
    for ep in data["episodes"]:
        try:
            if int(ep.get("episode_number") or -1) == int(episode):
                return True, True
        except (TypeError, ValueError):
            continue
    return False, True


def _search_ids(media, name, year=None, with_year=False):
    """TMDB aramasi -> en iyi 3 aday id listesi (sirali)."""
    if not name:
        return []
    data = None
    if with_year and year:
        params = {"query": name}
        params["first_air_date_year" if media == "tv" else "year"] = _int(year) or year
        data = tmdb_request(f"/search/{media}", params)
    if not data:
        data = tmdb_request(f"/search/{media}", {"query": name})
    results = (data or {}).get("results") or []
    out = []
    for r in results[:3]:
        rid = r.get("id")
        if rid:
            out.append(rid)
    return out


def _resolve_show(item):
    """Dizi kimligi: saglayici kimlikleri (dogrulanmis) -> isim aramasi. None = cozulemedi."""
    season, episode = item.get("season"), item.get("episode")
    for provider, ident in item.get("candidates") or []:
        if provider not in ("tmdb", "tvdb", "imdb"):
            continue
        base, s2, e2 = _split_ident(ident)
        if s2 is not None and (season is None or episode is None):
            season, episode = s2, e2
            item["season"], item["episode"] = season, episode
        tmdb_id, _mt = _resolve_tmdb(provider, base, "tv")
        if not tmdb_id:
            continue
        ok, kesin = _season_has_episode(tmdb_id, season, episode)
        if ok:
            print(f"[webhook] dizi cozuldu: {provider}:{base} -> tmdb={tmdb_id} (kesin={kesin})", flush=True)
            return tmdb_id
        print(f"[webhook] {provider}:{base} -> tmdb={tmdb_id} sezon/bolum uyusmadi, sonraki aday", flush=True)
    name = (item.get("title") or "").strip()
    for cand in _search_ids("tv", name):
        ok, kesin = _season_has_episode(cand, season, episode)
        if ok:
            print(f"[webhook] dizi isim aramasi: {name!r} -> tmdb={cand} (kesin={kesin})", flush=True)
            return cand
    return None


def _resolve_movie(item):
    """Film kimligi: saglayici kimlikleri -> isim+yil aramasi. None = cozulemedi."""
    for provider, ident in item.get("candidates") or []:
        if provider not in ("tmdb", "tvdb", "imdb"):
            continue
        base, _s, _e = _split_ident(ident)
        tmdb_id, _mt = _resolve_tmdb(provider, base, "movie")
        if tmdb_id:
            print(f"[webhook] film cozuldu: {provider}:{base} -> tmdb={tmdb_id}", flush=True)
            return tmdb_id
    name = (item.get("title") or "").strip()
    ids = _search_ids("movie", name, item.get("year"), with_year=True)
    if not ids:
        ids = _search_ids("movie", name)
    if ids:
        print(f"[webhook] film isim aramasi: {name!r} -> tmdb={ids[0]}", flush=True)
        return ids[0]
    return None


# ---------------------------------------------------------------------------
# payload okuma + normalizasyon
# ---------------------------------------------------------------------------

def _read_payload(app):
    if app == "plex":
        p = request.form.get("payload")
        if not p:
            return None, "payload yok"
        try:
            return json.loads(p), ""
        except Exception:
            return None, "payload json degil"
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data, ""
    p = request.form.get("payload") or request.form.get("data")
    if p:
        try:
            return json.loads(p), ""
        except Exception:
            return None, "payload json degil"
    return None, "json yok"


def _normalize_plex(payload):
    """Plex media.scrobble -> ortak sozluk. (item, hata) dondurur."""
    md = payload.get("Metadata") or {}
    ev = str(payload.get("event") or "").strip().lower()
    if ev not in _PLEX_WATCHED:
        return None, f"atlanan olay: {ev or '?'}"
    itype = str(md.get("type") or "").strip().lower()
    cands = []
    for g in (md.get("Guid") or []):
        gid = str((g or {}).get("id") or "")
        if "://" in gid:
            p, i = gid.split("://", 1)
            if p and i:
                cands.append((p.strip().lower(), i.strip()))
    cands.sort(key=_pref)
    if itype == "movie":
        return {
            "kind": "movie",
            "title": md.get("title") or "",
            "year": md.get("year"),
            "candidates": cands,
            "season": None,
            "episode": None,
        }, ""
    if itype != "episode":
        return None, f"atlanan tip: {itype or '?'}"
    return {
        "kind": "tv",
        "title": md.get("grandparentTitle") or "",
        "year": None,  # bolum yili = serinin ilk yayin yili degil -> isim aramasinda kullanilmaz
        "candidates": cands,
        "season": _int(md.get("parentIndex")),
        "episode": _int(md.get("index")),
    }, ""


def _played_to_end(body, item):
    """Jellyfin/Emby: olay gercekten "izlendi" mi?

    Played alani varsa True olmali; hicbir alan yoksa (basit/sablon payload)
    olay tipi PlaybackStop oldugu icin kabul edilir (fail-open).
    """
    has_flag = False
    for src in (item, body):
        if not isinstance(src, dict):
            continue
        if "Played" in src:
            has_flag = True
            if src.get("Played") is True:
                return True
        ud = src.get("UserData")
        if isinstance(ud, dict) and "Played" in ud:
            has_flag = True
            if ud.get("Played") is True:
                return True
    for src in (item, body):
        if isinstance(src, dict) and "PlayedToCompletion" in src:
            has_flag = True
            if src.get("PlayedToCompletion") is True:
                return True
    pi = body.get("PlaybackInfo") if isinstance(body, dict) else None
    if isinstance(pi, dict) and "PlayedToCompletion" in pi:
        has_flag = True
        if pi.get("PlayedToCompletion") is True:
            return True
    return not has_flag


def _normalize_json(body):
    """Jellyfin / Emby webhook govdesi -> ortak sozluk. (item, hata) dondurur."""
    nt = str(body.get("NotificationType") or body.get("Notification") or body.get("Event") or "").strip().lower()
    if nt and not any(k in nt for k in _OTHER_WATCHED):
        return None, f"atlanan olay: {nt}"
    item = body.get("Item") if isinstance(body.get("Item"), dict) else body
    if not isinstance(item, dict):
        return None, "Item yok"
    if not _played_to_end(body, item):
        return None, "tamamlanmamis (Played=false)"
    itype = str(item.get("Type") or item.get("type") or "").strip().lower()
    season = _int(item.get("ParentIndexNumber", item.get("SeasonNumber")))
    episode = _int(item.get("IndexNumber", item.get("EpisodeNumber")))
    series_name = item.get("SeriesName") or ""
    if itype == "movie":
        return {
            "kind": "movie",
            "title": item.get("Name") or "",
            "year": item.get("ProductionYear"),
            "candidates": _pairs(item.get("ProviderIds")),
            "season": None,
            "episode": None,
        }, ""
    if itype in ("episode", "season") or (not itype and (series_name or season is not None)):
        return {
            "kind": "tv",
            "title": series_name or item.get("Name") or "",
            "year": None,
            "candidates": _pairs(_series_ids(item)),
            "season": season,
            "episode": episode,
        }, ""
    if not itype:
        return {
            "kind": "movie",
            "title": item.get("Name") or "",
            "year": item.get("ProductionYear"),
            "candidates": _pairs(item.get("ProviderIds")),
            "season": None,
            "episode": None,
        }, ""
    return None, f"atlanan tip: {itype}"


def _stamp_verified(uid, app):
    """Ilk gercek olay = dogrulanmis baglanti kaniti (kart durumu 'Bagli')."""
    try:
        import time as _t
        set_user_setting(int(uid), f"tp_{app}_verified_ts", str(int(_t.time())))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# uc
# ---------------------------------------------------------------------------

@webhook_bp.route("/webhook/<app>/<token>", methods=["POST"])
def webhook_event(app, token):
    app = str(app or "").strip().lower()
    if app not in WEBHOOK_APPS:
        return jsonify({"error": "not found"}), 404
    uid = _find_owner_by_uuid(token, app)
    if not uid:
        return jsonify({"error": "not found"}), 404

    raw, err = _read_payload(app)
    if raw is None:
        print(f"[webhook] {app} payload okunamadi: {err}", flush=True)
        return jsonify({"ok": True, "skipped": err or "payload"})

    if app == "plex":
        item, err = _normalize_plex(raw)
    else:
        item, err = _normalize_json(raw)
    if not item:
        print(f"[webhook] {app} atlandi: {err}", flush=True)
        return jsonify({"ok": True, "skipped": err or "atlandi"})

    _stamp_verified(uid, app)

    if item.get("kind") == "movie":
        tmdb_id = _int(_resolve_movie(item))
        if not tmdb_id:
            print(f"[webhook] {app} film cozulemedi: {item.get('title')!r}", flush=True)
            return jsonify({"ok": True, "skipped": "cozulemedi"})
        process_signal(
            {"route_norm": "movie", "provider": "tmdb", "ident": tmdb_id, "season": None, "episode": None},
            owner_id=uid,
            source=app,
        )
        return jsonify({"ok": True, "kind": "movie", "tmdb_id": tmdb_id})

    tmdb_id = _int(_resolve_show(item))
    if not tmdb_id:
        print(f"[webhook] {app} dizi cozulemedi: {item.get('title')!r}", flush=True)
        return jsonify({"ok": True, "skipped": "cozulemedi"})
    season, episode = _int(item.get("season")), _int(item.get("episode"))
    if season is None or episode is None:
        print(f"[webhook] {app} sezon/bolum eksik: {item.get('title')!r}", flush=True)
        return jsonify({"ok": True, "skipped": "sezon/bolum yok"})
    process_signal(
        {"route_norm": "tv", "provider": "tmdb", "ident": tmdb_id, "season": season, "episode": episode},
        owner_id=uid,
        source=app,
    )
    return jsonify({"ok": True, "kind": "tv", "tmdb_id": tmdb_id, "season": season, "episode": episode})
