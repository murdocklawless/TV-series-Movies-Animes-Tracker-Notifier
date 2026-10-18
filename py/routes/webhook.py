"""Plex / Jellyfin / Emby webhook'lari (1.86).

Uclar:
  POST /webhook/plex/<token>       -> Plex webhook (multipart/form-data, "payload" JSON)
  POST /webhook/jellyfin/<token>   -> Jellyfin webhook eklentisi ("Generic" JSON ya da
                                      "Generic Form" hedefi = form-urlencoded duz alanlar)
  POST /webhook/emby/<token>       -> Emby webhook eklentisi (application/json)

Jellyfin'in webhook eklentisinde iki hedef tipi var:
  * "Generic"       -> JSON govde (Handlebars sablonu, icerik tipi ayarlanabilir)
  * "Generic Form"  -> govde JSON sablonundan uretilir ama **form-urlencoded duz
    alanlar** olarak yollanir (Content-Type: application/x-www-form-urlencoded):
    NotificationType=PlaybackStop&ItemType=Movie&Name=..&Year=..
    &Provider_tmdb=..&Provider_imdb=..&PlayedToCompletion=True
"Generic Form" Tip 1.86'da desteklenmiyordu (govde "json yok" diye atiliyordu,
kart "Hazir" kaliyordu). Bu yol `_normalize_flat` ile karsilanir.

NOT (Generic Form): bu hedefte boolean alanlar **string** gelir ("True"/"False"),
bu yuzden `Played`/`PlayedToCompletion` karsilastirmalari `_truthy` ile yapilir
(aksi takdirde gercek izleme "tamamlanmamis" sayilip atilirdi). Ayrica saglayici
kimlikleri seri seviyesi degil, **item (bolum) seviyesi** `Provider_*` alanlaridir;
bu yuzden dizi cozumlemesinde `_season_has_episode` dogrulamasi + isim aramasi
yolu belirleyicidir.

NOT (UserDataSaved / posterdeki "izlendi" butonu) 1.87: Jellyfin'de uygulama
icinden "izlendi" isaretlemek PlaybackStop degil `UserDataSaved` olayi uretir
(SaveReason=TogglePlayed). Bu olay yalnizca TogglePlayed/UpdateUserData icin
kabul edilir (oynatma ilerlemesi, puan, favori kayitlari atlanir):
  * Played=True  -> ask sorulmadan **dogrudan izlendi** yazilir (process_signal
    direct=True: E-1 kilidi de uygulanmaz, manuel isaretleme kesin onaydir).
  * Played=False -> **korumali** geri alma (`stremio.unwatch_from_source`):
    yalniz ayni kaynaktan (jellyfin/emby) yazilmis movie/tv kaydi izlenmediye
    cevrilir; Stremio/manual kayitlar korunur. Sezon/dizi isaretlemeleri kapsam disi.

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
import re

from flask import Blueprint, jsonify, request

from db import set_user_setting
from tmdb import tmdb_request

from routes.stremio import (
    WEBHOOK_APPS,
    _find_owner_by_uuid,
    _resolve_tmdb,
    process_signal,
    unwatch_from_source,
)

webhook_bp = Blueprint("webhook", __name__)

# Kabul edilen "izlendi" olaylari
_PLEX_WATCHED = {"media.scrobble"}
_OTHER_WATCHED = ("playbackstop", "playback.stop", "playbackstopped", "played", "scrobble",
                  "userdatasaved", "item.markplayed", "item.markunplayed")

# Uygulama icinden MANUEL isaretleme olaylari (ask sorulmaz / geri alma yapilir):
#   Jellyfin: userdatasaved (+SaveReason) · Emby: item.markplayed / item.markunplayed
_MANUAL_EVENTS = ("userdatasaved", "item.markplayed", "item.markunplayed")
_MANUAL_PLAYED_EVENTS = ("userdatasaved", "item.markplayed")

# UserDataSaved (uygulama icinden manuel "izlendi") yalniz bu kayit nedenleri icin
# kabul edilir; oynatma ilerlemesi/puan/favori kayitlari islenmez (bildirim spam'i olmaz).
_USERDATA_REASONS = ("toggleplayed", "updateuserdata")

_PREF = {"tmdb": 0, "tvdb": 1, "imdb": 2, "plex": 9}

_TRUE = ("true", "1", "yes", "on")
_MISSING = object()


# ---------------------------------------------------------------------------
# kucuk yardimcilar
# ---------------------------------------------------------------------------

def _int(v):
    try:
        i = int(v)
        return i if i > 0 else None
    except (TypeError, ValueError):
        return None


def _truthy(v):
    """Boolean alani esnek oku ('Generic Form' hedefi "True"/"False" string yollar)."""
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in _TRUE


def _ci(d, key):
    """Sozlukte alani buyuk/kucuk harf duyarsiz ara; yoksa _MISSING."""
    if not isinstance(d, dict):
        return _MISSING
    if key in d:
        return d[key]
    lk = str(key).strip().lower()
    for k, v in d.items():
        if str(k).strip().lower() == lk:
            return v
    return _MISSING


def _fg(body, *names):
    """Duz form govdesinde ilk dolu alani dondur (buyuk/kucuk harf duyarsiz)."""
    for n in names:
        v = _ci(body, n)
        if v is not _MISSING and v is not None and str(v).strip() != "":
            return v
    return None


def _event_type(body):
    """Govdedeki olay tipi (NotificationType/Notification/Event) — kucuk harf."""
    return str(_fg(body, "NotificationType", "Notification", "Event") or "").strip().lower()


def _pref(pair):
    return _PREF.get(pair[0], 5)


def _flat_candidates(body):
    """'Generic Form' duz alanlari -> aday listesi.

    Provider_tmdb=332562&Provider_imdb=tt1517451 -> [('tmdb','332562'), ('imdb','tt1517451')]
    """
    out = []
    if not isinstance(body, dict):
        return out
    for k, v in body.items():
        key = str(k).strip().lower()
        if not key.startswith("provider_"):
            continue
        prov = key[len("provider_"):].strip()
        val = str(v or "").strip()
        if prov and val:
            out.append((prov, val))
    return sorted(out, key=_pref)


# Jellyfin'de yanlis kutuphane tipi (ornek: "Filmler" -> Torrents kok dizini) dizi
# bolumlerini **Movie** nesnesi yapar ve adi dosya adi olur:
#   Name="Fallout.S01E08.The.Beginning", saglayici kimligi yok.
# Boyle bir baslikta SxxExx varsa oge dizi olarak ele alinir; TMDB'de isim
# aramasi + sezon/bolum dogrulamasi yapildigi icin yanlis yapima yazilmaz.
_EP_RE = re.compile(r"(?i)^(.+?)[\s._-]*\bs(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)")


def _episode_from_title(title):
    """Basliktan SxxExx ayikla -> (seri_adi, sezon, bolum) | None."""
    if not title:
        return None
    m = _EP_RE.match(str(title).strip())
    if not m:
        return None
    name = re.sub(r"[._]+", " ", m.group(1))
    name = re.sub(r"\s+", " ", name).strip(" -")
    if not name:
        return None
    return name, int(m.group(2)), int(m.group(3))


def _tv_from_title(title, candidates):
    """Baslik SxxExx tasiyorsa dizi ogesi uret (yoksa None)."""
    ep = _episode_from_title(title)
    if not ep:
        return None
    name, season, episode = ep
    return {
        "kind": "tv",
        "title": name,
        "year": None,
        "candidates": list(candidates or []),
        "season": season,
        "episode": episode,
    }


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
    # Jellyfin "Generic Form" hedefi: JSON degil, form-urlencoded duz alanlar
    # (ServerId=..&NotificationType=PlaybackStop&ItemType=Movie&Provider_tmdb=..).
    if request.form:
        return dict(request.form), ""
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
    "Generic Form" hedefinde degerler string gelir ("True"/"False") -> _truthy.
    """
    has_flag = False
    for src in (item, body):
        if not isinstance(src, dict):
            continue
        v = _ci(src, "Played")
        if v is not _MISSING:
            has_flag = True
            if _truthy(v):
                return True
        ud = _ci(src, "UserData")
        if isinstance(ud, dict) and _ci(ud, "Played") is not _MISSING:
            has_flag = True
            if _truthy(_ci(ud, "Played")):
                return True
    for src in (item, body):
        if not isinstance(src, dict):
            continue
        v = _ci(src, "PlayedToCompletion")
        if v is not _MISSING:
            has_flag = True
            if _truthy(v):
                return True
    pi = _ci(body, "PlaybackInfo") if isinstance(body, dict) else _MISSING
    if isinstance(pi, dict) and _ci(pi, "PlayedToCompletion") is not _MISSING:
        has_flag = True
        if _truthy(_ci(pi, "PlayedToCompletion")):
            return True
    return not has_flag


def _is_flat_form(body):
    """"Generic Form" hedefi mi? (Item nesnesi yok, duz alanlar var)"""
    if not isinstance(body, dict) or isinstance(body.get("Item"), dict):
        return False
    return ("ItemType" in body) or ("SeriesName" in body)


def _normalize_flat(body):
    """"Generic Form" govdesi -> ortak sozluk. (item, hata) dondurur.

    Alanlar: ItemType ("Movie"/"Episode"/"Season"/"Series"), Name, SeriesName,
    SeasonNumber, EpisodeNumber, Year, Provider_tmdb/Provider_imdb/Provider_tvdb.
    """
    itype = str(_fg(body, "ItemType") or "").strip().lower()
    series_name = str(_fg(body, "SeriesName") or "").strip()
    if itype == "movie":
        title = _fg(body, "Name") or ""
        tv = _tv_from_title(title, _flat_candidates(body))
        if tv:
            return tv, ""
        return {
            "kind": "movie",
            "title": title,
            "year": _fg(body, "Year"),
            "candidates": _flat_candidates(body),
            "season": None,
            "episode": None,
        }, ""
    if itype in ("episode", "season") or (not itype and series_name):
        return {
            "kind": "tv",
            "title": series_name or _fg(body, "Name") or "",
            "year": None,
            "candidates": _flat_candidates(body),
            "season": _int(_fg(body, "SeasonNumber", "ParentIndexNumber")),
            "episode": _int(_fg(body, "EpisodeNumber", "IndexNumber")),
        }, ""
    return None, f"atlanan tip: {itype or '?'}"


def _normalize_json(body, ignore_played=False):
    """Jellyfin / Emby webhook govdesi -> ortak sozluk. (item, hata) dondurur.

    ignore_played (1.87): "izlendi" isaretinin KALDIRILMASI (Played=False) icin
    kullanilir; geri alma yolunda oge haritasi yine gerekir ama Played kapisi atlanir.
    """
    nt = str(body.get("NotificationType") or body.get("Notification") or body.get("Event") or "").strip().lower()
    if nt and not any(k in nt for k in _OTHER_WATCHED):
        return None, f"atlanan olay: {nt}"
    if _is_flat_form(body):
        # Jellyfin "Generic Form": duz alanlar (form-urlencoded)
        if not ignore_played and not _played_to_end(body, body):
            return None, "tamamlanmamis (Played=false)"
        return _normalize_flat(body)
    item = body.get("Item") if isinstance(body.get("Item"), dict) else body
    if not isinstance(item, dict):
        return None, "Item yok"
    if not ignore_played and not _played_to_end(body, item):
        return None, "tamamlanmamis (Played=false)"
    itype = str(item.get("Type") or item.get("type") or "").strip().lower()
    season = _int(item.get("ParentIndexNumber", item.get("SeasonNumber")))
    episode = _int(item.get("IndexNumber", item.get("EpisodeNumber")))
    series_name = item.get("SeriesName") or ""
    if itype == "movie":
        tv = _tv_from_title(item.get("Name"), _pairs(item.get("ProviderIds")))
        if tv:
            return tv, ""
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
        tv = _tv_from_title(item.get("Name"), _pairs(item.get("ProviderIds")))
        if tv:
            return tv, ""
        return {
            "kind": "movie",
            "title": item.get("Name") or "",
            "year": item.get("ProductionYear"),
            "candidates": _pairs(item.get("ProviderIds")),
            "season": None,
            "episode": None,
        }, ""
    return None, f"atlanan tip: {itype}"


def request_via():
    """Olay LAN uzerinden mi geldi? -> "lan" | "url"  (1.87)

    Kart durumunda "Bagli (LAN)" / "Bagli (URL)" gostermek icin kullanilir.
    Gelen istegin Host'u: localhost / ozel IP blogu (10/172.16-31/192.168/169.254)
    / .local adi ya da kayitli-tespit edilen LAN adresi ise "lan" sayilir.
    """
    try:
        host = (request.headers.get("Host") or request.headers.get("X-Forwarded-Host") or "").strip().lower()
    except Exception:
        host = ""
    h = host.split(":")[0].strip().strip("[]")
    if not h:
        return "url"
    if h in ("localhost", "127.0.0.1", "::1") or h.endswith(".local"):
        return "lan"
    try:
        if h.startswith(("10.", "192.168.", "169.254.")):
            return "lan"
        if h.startswith("172.") and 16 <= int(h.split(".")[1]) <= 31:
            return "lan"
    except Exception:
        pass
    try:
        from routes.stremio import _lan_base
        lh = (_lan_base() or "").split("://")[-1].split("/")[0].split(":")[0].strip().lower()
        if lh and lh == h:
            return "lan"
    except Exception:
        pass
    return "url"


def _stamp_last_watch(uid, app, item, kind, season=None, episode=None):
    """Kartta "Son sinyal" + "xyz izlendi" gosterimi icin son izlenen oge. 1.87.

    Baslik payload'dan alinir (takip listesinde olmayan oge icin de gorunur).
    """
    try:
        import time as _t
        set_user_setting(int(uid), f"tp_{app}_last_watch", json.dumps({
            "ts": int(_t.time()),
            "title": str(item.get("title") or "").strip(),
            "kind": kind,
            "season": season,
            "episode": episode,
        }, ensure_ascii=False))
    except Exception:
        pass


def _stamp_verified(uid, app):
    """Ilk gercek olay = dogrulanmis baglanti kaniti (kart durumu 'Bagli').

    1.87: olayin HANGI adresten geldigi de kaydedilir (kart: "Bagli (LAN)" / "Bagli (URL)").
    """
    try:
        import time as _t
        set_user_setting(int(uid), f"tp_{app}_verified_ts", str(int(_t.time())))
        set_user_setting(int(uid), f"tp_{app}_verified_via", request_via())
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
        # Teshis: govdenin ilk parcasini log'a dus (taninmayan hedef/sablon icin).
        snippet = ""
        try:
            snippet = (request.get_data(as_text=True) or "")[:300].replace("\n", " ")
        except Exception:
            snippet = ""
        print(f"[webhook] {app} payload okunamadi: {err} | {snippet}", flush=True)
        return jsonify({"ok": True, "skipped": err or "payload"})

    # --- 1.87: uygulama icinden manuel "izlendi/izlenmedi" -------------------
    # Jellyfin: NotificationType=UserDataSaved + SaveReason=TogglePlayed
    # Emby    : Event=item.markplayed / item.markunplayed  (webhook, Premiere)
    # Plex    : boyle bir olay YOK (yalniz oynatma olaylari)
    nt = "" if app == "plex" else _event_type(raw)
    if nt == "userdatasaved":
        reason = str(_fg(raw, "SaveReason") or "").strip().lower()
        if reason not in _USERDATA_REASONS:
            # Ilerleme/puan/favori kayitlari: nextep'i ilgilendirmez.
            print(f"[webhook] {app} atlandi: kayit nedeni '{reason or '?'}' (yalniz {'/'.join(_USERDATA_REASONS)})", flush=True)
            return jsonify({"ok": True, "skipped": f"kayit nedeni: {reason or '?'}"})
    played_flag = _played_to_end(raw, raw)
    if nt == "item.markplayed":
        played_flag = True     # olay adi durumu bildirir (govdede Played olmayabilir)
    elif nt == "item.markunplayed":
        played_flag = False
    manual = nt in _MANUAL_EVENTS
    unmark = manual and (not played_flag)
    direct = nt in _MANUAL_PLAYED_EVENTS
    if manual:
        print(f"[webhook] {app} manuel olay: {nt} -> {'direct' if direct else 'unmark'}", flush=True)

    if app == "plex":
        item, err = _normalize_plex(raw)
    else:
        item, err = _normalize_json(raw, ignore_played=unmark)
    if not item:
        print(f"[webhook] {app} atlandi: {err}", flush=True)
        return jsonify({"ok": True, "skipped": err or "atlandi"})

    _stamp_verified(uid, app)

    if unmark:
        # Isaret kaldirma: KORUMALI geri alma (yalniz ayni kaynaktan yazilmis kayit).
        if item.get("kind") == "movie":
            tmdb_id = _int(_resolve_movie(item))
            season, episode = None, None
        else:
            tmdb_id = _int(_resolve_show(item))
            season, episode = _int(item.get("season")), _int(item.get("episode"))
        if not tmdb_id:
            print(f"[webhook] {app} unmark: cozulemedi ({item.get('title')!r})", flush=True)
            return jsonify({"ok": True, "unmark": "cozulemedi"})
        res = unwatch_from_source(
            "movie" if item.get("kind") == "movie" else "tv",
            tmdb_id, season=season, episode=episode, owner_id=uid, source=app,
        )
        print(f"[webhook] {app} unmark: {res} tmdb={tmdb_id} s{season} e{episode} ({item.get('title')!r})", flush=True)
        return jsonify({"ok": True, "unmark": res, "tmdb_id": tmdb_id})

    if item.get("kind") == "movie":
        tmdb_id = _int(_resolve_movie(item))
        if not tmdb_id:
            print(f"[webhook] {app} film cozulemedi: {item.get('title')!r}", flush=True)
            return jsonify({"ok": True, "skipped": "cozulemedi"})
        process_signal(
            {"route_norm": "movie", "provider": "tmdb", "ident": tmdb_id, "season": None, "episode": None},
            owner_id=uid,
            source=app,
            direct=direct,
        )
        _stamp_last_watch(uid, app, item, "movie")
        return jsonify({"ok": True, "kind": "movie", "tmdb_id": tmdb_id, "direct": direct})

    tmdb_id = _int(_resolve_show(item))
    if not tmdb_id:
        print(f"[webhook] {app} dizi cozulemedi: {item.get('title')!r}", flush=True)
        return jsonify({"ok": True, "skipped": "cozulemedi"})
    season, episode = _int(item.get("season")), _int(item.get("episode"))
    if season is None or episode is None:
        # Sezon/dizi isaretlemesi (ItemType=Season/Series): kapsam disi.
        print(f"[webhook] {app} sezon/bolum eksik: {item.get('title')!r}", flush=True)
        return jsonify({"ok": True, "skipped": "sezon/bolum yok"})
    process_signal(
        {"route_norm": "tv", "provider": "tmdb", "ident": tmdb_id, "season": season, "episode": episode},
        owner_id=uid,
        source=app,
        direct=direct,
    )
    _stamp_last_watch(uid, app, item, "tv", season, episode)
    return jsonify({"ok": True, "kind": "tv", "tmdb_id": tmdb_id, "season": season, "episode": episode, "direct": direct})
