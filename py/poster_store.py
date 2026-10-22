import os
import shutil
import time

import requests

from config import STATIC_DIR, TMDB_IMAGE_BASE

POSTER_ROOT = os.path.join(STATIC_DIR, "images", "posters")
# w500 / w185 / thumbnail alt klasorler
SHOWS_W500_DIR = os.path.join(POSTER_ROOT, "shows", "w500")
SHOWS_W185_DIR = os.path.join(POSTER_ROOT, "shows", "w185")
SHOWS_THUMB_DIR = os.path.join(POSTER_ROOT, "shows", "thumbnail")
MOVIES_W500_DIR = os.path.join(POSTER_ROOT, "movies", "w500")
MOVIES_W185_DIR = os.path.join(POSTER_ROOT, "movies", "w185")
MOVIES_THUMB_DIR = os.path.join(POSTER_ROOT, "movies", "thumbnail")
ANIME_W500_DIR = os.path.join(POSTER_ROOT, "anime", "w500")
ANIME_W185_DIR = os.path.join(POSTER_ROOT, "anime", "w185")
ANIME_THUMB_DIR = os.path.join(POSTER_ROOT, "anime", "thumbnail")

# Backward compat flat dirs (eski migrasyon)
SHOWS_DIR = os.path.join(POSTER_ROOT, "shows")
MOVIES_DIR = os.path.join(POSTER_ROOT, "movies")
ANIME_DIR = os.path.join(POSTER_ROOT, "anime")

_KIND_W500 = {
    "tv": SHOWS_W500_DIR,
    "show": SHOWS_W500_DIR,
    "shows": SHOWS_W500_DIR,
    "movie": MOVIES_W500_DIR,
    "movies": MOVIES_W500_DIR,
    "anime": ANIME_W500_DIR,
}
_KIND_W185 = {
    "tv": SHOWS_W185_DIR,
    "show": SHOWS_W185_DIR,
    "shows": SHOWS_W185_DIR,
    "movie": MOVIES_W185_DIR,
    "movies": MOVIES_W185_DIR,
    "anime": ANIME_W185_DIR,
}
_KIND_THUMB = {
    "tv": SHOWS_THUMB_DIR,
    "show": SHOWS_THUMB_DIR,
    "shows": SHOWS_THUMB_DIR,
    "movie": MOVIES_THUMB_DIR,
    "movies": MOVIES_THUMB_DIR,
    "anime": ANIME_THUMB_DIR,
}
_KIND_DIR = _KIND_W500  # fallback
_KIND_BASE = {
    "tv": SHOWS_DIR,
    "show": SHOWS_DIR,
    "shows": SHOWS_DIR,
    "movie": MOVIES_DIR,
    "movies": MOVIES_DIR,
    "anime": ANIME_DIR,
}


def _ensure_dirs():
    for d in (SHOWS_W500_DIR, SHOWS_W185_DIR, SHOWS_THUMB_DIR, MOVIES_W500_DIR, MOVIES_W185_DIR, MOVIES_THUMB_DIR, ANIME_W500_DIR, ANIME_W185_DIR, ANIME_THUMB_DIR):
        os.makedirs(d, exist_ok=True)


def _ext_from_url(url, fallback=".jpg"):
    u = (url or "").split("?")[0].split("#")[0]
    if "." in u:
        ext = "." + u.rsplit(".", 1)[-1].lower()
        if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            if ext == ".jpeg":
                ext = ".jpg"
            return ext
    return fallback


def _web_to_fs(web_path):
    if not web_path:
        return None
    if web_path.startswith("/static/"):
        return os.path.join(STATIC_DIR, web_path[len("/static/"):].lstrip("/"))
    rel = web_path.lstrip("/").replace("static/", "", 1) if web_path.startswith("/static/") else web_path.lstrip("/")
    return os.path.join(STATIC_DIR, rel)


def poster_local_path(kind, ident, size="w500"):
    """Return web path like /static/images/posters/shows/w500/<id>.jpg"""
    k = (kind or "").lower()
    if size == "w185":
        base = _KIND_W185.get(k)
        prefix = {"tv": "shows", "show": "shows", "shows": "shows", "movie": "movies", "movies": "movies", "anime": "anime"}.get(k, k)
    elif size == "thumbnail":
        base = _KIND_THUMB.get(k)
        prefix = {"tv": "shows", "show": "shows", "shows": "shows", "movie": "movies", "movies": "movies", "anime": "anime"}.get(k, k)
    else:
        base = _KIND_W500.get(k)
        prefix = {"tv": "shows", "show": "shows", "shows": "shows", "movie": "movies", "movies": "movies", "anime": "anime"}.get(k, k)
    if not base:
        return None
    # try existing exts
    for ext in (".jpg", ".png", ".webp", ".jpeg"):
        cand = os.path.join(base, f"{ident}{ext}")
        if os.path.exists(cand):
            return f"/static/images/posters/{prefix}/{size}/{ident}{ext}"
    # also check flat old location for migration fallback
    flat_base = _KIND_BASE.get(k)
    if flat_base:
        for ext in (".jpg", ".png", ".webp", ".jpeg"):
            if os.path.exists(os.path.join(flat_base, f"{ident}{ext}")):
                return f"/static/images/posters/{prefix}/{size}/{ident}{ext}"
    # default jpg
    return f"/static/images/posters/{prefix}/{size}/{ident}.jpg"


def filesystem_path_from_web(web_path):
    return _web_to_fs(web_path)


def versioned_web_path(web_path):
    """Poster web yoluna dosya mtime'ini ?v= olarak ekler (cache-busting).
    Dosya yoksa ya da yol /static/ degilse oldugu gibi dondurur."""
    if not web_path or not str(web_path).startswith("/static/"):
        return web_path
    try:
        v = int(os.path.getmtime(_web_to_fs(web_path)))
    except OSError:
        return web_path
    sep = "&" if "?" in web_path else "?"
    return f"{web_path}{sep}v={v}"


def _generate_thumb(w500_path, thumb_path, width=45):
    """w500 dosyadan thumbnail uret (genislik width). Pillow yoksa kopyala."""
    try:
        os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
    except Exception:
        pass
    try:
        from PIL import Image
        with Image.open(w500_path) as im:
            if im.mode in ("RGBA", "LA"):
                bg = Image.new("RGB", im.size, (0, 0, 0))
                bg.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            w, h = im.size
            if w <= width:
                shutil.copy2(w500_path, thumb_path)
                return True
            new_w = width
            new_h = int(h * new_w / w)
            try:
                resample = Image.Resampling.LANCZOS
            except AttributeError:
                resample = Image.LANCZOS
            im2 = im.resize((new_w, new_h), resample)
            ext = os.path.splitext(thumb_path)[1].lower()
            if ext == ".png":
                im2.save(thumb_path, "PNG", optimize=True)
            else:
                im2.save(thumb_path, "JPEG", quality=82, optimize=True)
            return True
    except ImportError:
        try:
            shutil.copy2(w500_path, thumb_path)
            return True
        except Exception:
            return False
    except Exception:
        try:
            shutil.copy2(w500_path, thumb_path)
            return True
        except Exception:
            return False


def _generate_w185(w500_path, w185_path):
    """w500 dosyadan w185 thumb uret (genislik 185px). Pillow yoksa kopyala."""
    try:
        os.makedirs(os.path.dirname(w185_path), exist_ok=True)
    except Exception:
        pass
    try:
        from PIL import Image
        with Image.open(w500_path) as im:
            # convert to RGB if needed for jpg
            if im.mode in ("RGBA", "LA"):
                bg = Image.new("RGB", im.size, (0, 0, 0))
                bg.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            w, h = im.size
            if w <= 185:
                # already small, copy
                shutil.copy2(w500_path, w185_path)
                return True
            new_w = 185
            new_h = int(h * new_w / w)
            # Pillow >=10 uses Resampling
            try:
                resample = Image.Resampling.LANCZOS
            except AttributeError:
                resample = Image.LANCZOS
            im2 = im.resize((new_w, new_h), resample)
            # preserve ext: if png keep png else jpg
            ext = os.path.splitext(w185_path)[1].lower()
            if ext == ".png":
                im2.save(w185_path, "PNG", optimize=True)
            else:
                im2.save(w185_path, "JPEG", quality=82, optimize=True)
            return True
    except ImportError:
        # Pillow yok -> kopyala
        try:
            shutil.copy2(w500_path, w185_path)
            return True
        except Exception:
            return False
    except Exception:
        # fallback copy
        try:
            shutil.copy2(w500_path, w185_path)
            return True
        except Exception:
            return False


def download_poster(kind, ident, remote_url, ext_hint=None):
    """Download remote_url to w500 + generate w185. Returns (w500_web, w185_web) or (None,None)."""
    if not remote_url or not ident or not kind:
        return None, None
    _ensure_dirs()
    k = (kind or "").lower()
    w500_dir = _KIND_W500.get(k)
    w185_dir = _KIND_W185.get(k)
    if not w500_dir or not w185_dir:
        return None, None
    ext = ext_hint or _ext_from_url(remote_url)
    if k in ("tv", "show", "shows", "movie", "movies"):
        ext = ".jpg"
    w500_path = os.path.join(w500_dir, f"{ident}{ext}")
    w185_path = os.path.join(w185_dir, f"{ident}{ext}")
    # also check flat old existing -> migrate if found
    flat_path = None
    for e in (".jpg", ".png", ".webp"):
        fp = os.path.join(_KIND_BASE.get(k, ""), f"{ident}{e}")
        if os.path.exists(fp) and not os.path.exists(w500_path):
            try:
                shutil.copy2(fp, w500_path)
            except Exception:
                pass
            break
    # if both exist, return
    if os.path.exists(w500_path) and os.path.exists(w185_path):
        return poster_local_path(k, ident, "w500"), poster_local_path(k, ident, "w185")
    # if w500 exists but w185 not, generate w185
    if os.path.exists(w500_path) and not os.path.exists(w185_path):
        _generate_w185(w500_path, w185_path)
        return poster_local_path(k, ident, "w500"), poster_local_path(k, ident, "w185")
    # need to download w500
    if not os.path.exists(w500_path):
        tmp_path = w500_path + ".tmp"
        t0 = time.time()
        try:
            r = requests.get(remote_url, stream=True, timeout=15)
            try:
                import query_log
                query_log.log("img", "GET", "/poster", status=r.status_code,
                              ms=int((time.time() - t0) * 1000), src="net",
                              tag="img", level="debug")
            except Exception:
                pass
            if r.status_code != 200:
                return None, None
            ctype = (r.headers.get("Content-Type") or "").lower()
            if ctype and "image" not in ctype and "octet-stream" not in ctype:
                pass
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            if os.path.getsize(tmp_path) == 0:
                os.remove(tmp_path)
                return None, None
            os.replace(tmp_path, w500_path)
        except Exception:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return None, None
    # generate w185 if missing
    if not os.path.exists(w185_path):
        _generate_w185(w500_path, w185_path)
    return poster_local_path(k, ident, "w500"), poster_local_path(k, ident, "w185")


def download_tmdb_poster(media_type, tmdb_id, poster_path):
    """Backward compat: returns w500 web path, but also ensures w185. Use download_poster_with_sizes for both."""
    if not poster_path or not tmdb_id:
        return None
    remote = TMDB_IMAGE_BASE + poster_path
    kind = "tv" if media_type == "tv" else "movie"
    w500, _ = download_poster(kind, tmdb_id, remote)
    return w500


def download_tmdb_poster_with_sizes(media_type, tmdb_id, poster_path):
    if not poster_path or not tmdb_id:
        return None, None
    remote = TMDB_IMAGE_BASE + poster_path
    kind = "tv" if media_type == "tv" else "movie"
    return download_poster(kind, tmdb_id, remote)


def download_anime_poster(anilist_id, cover_url):
    if not cover_url or not anilist_id:
        return None
    w500, _ = download_poster("anime", anilist_id, cover_url)
    return w500


def download_anime_poster_with_sizes(anilist_id, cover_url):
    if not cover_url or not anilist_id:
        return None, None
    return download_poster("anime", anilist_id, cover_url)


def ensure_thumbnail(kind, ident, remote_url=None):
    """Ensure 45x68 thumbnail exists. w500 -> thumb 45px, else remote fetch 1x.
    Returns web path or None. Also ensures w500/w185 exist via download_poster fallback."""
    if not ident or not kind:
        return None
    _ensure_dirs()
    k = (kind or "").lower()
    thumb_dir = _KIND_THUMB.get(k)
    if not thumb_dir:
        return None
    # determine ext
    ext = ".jpg"
    # try to find existing w500 ext first
    w500_web = poster_local_path(k, ident, "w500")
    w500_fs = filesystem_path_from_web(w500_web) if w500_web else None
    if w500_fs and os.path.exists(w500_fs):
        ext = os.path.splitext(w500_fs)[1] or ".jpg"
    elif remote_url:
        ext = _ext_from_url(remote_url)
        if k in ("tv", "show", "shows", "movie", "movies"):
            ext = ".jpg"
    thumb_path = os.path.join(thumb_dir, f"{ident}{ext}")
    if os.path.exists(thumb_path):
        return poster_local_path(k, ident, "thumbnail")
    # if w500 exists, generate from it
    if w500_fs and os.path.exists(w500_fs):
        _generate_thumb(w500_fs, thumb_path, width=45)
        # 1.87: uretim BASARISIZ olabilir (bozuk dosya vb.) -> yol UYDURMA.
        # poster_local_path() var olmayan dosya icin de yol dondurur; bu yuzden
        # once gercekten olustu mu diye bakilir (aksi halde DB'ye kirik yol yazilir
        # ve arayuzde resim 404 olup poster hic gorunmez).
        if os.path.exists(thumb_path):
            return poster_local_path(k, ident, "thumbnail")
        print(f"[poster] thumb uretilemedi (w500'den): {k}:{ident}", flush=True)
    # else remote fetch w500 then thumb
    if remote_url:
        w500_web2, _ = download_poster(k, ident, remote_url)
        if w500_web2:
            w500_fs2 = filesystem_path_from_web(w500_web2)
            if w500_fs2 and os.path.exists(w500_fs2):
                thumb_path2 = os.path.join(thumb_dir, f"{ident}{os.path.splitext(w500_fs2)[1] or '.jpg'}")
                _generate_thumb(w500_fs2, thumb_path2, width=45)
                if os.path.exists(thumb_path2):
                    return poster_local_path(k, ident, "thumbnail")
    print(f"[poster] thumb yok -> None: {k}:{ident}", flush=True)
    return None


def delete_poster_by_web(web_path):
    if not web_path:
        return
    try:
        fs = filesystem_path_from_web(web_path)
        if fs and os.path.exists(fs):
            os.remove(fs)
        tmp = (fs + ".tmp") if fs else None
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
    except Exception:
        pass


def delete_poster(kind, ident):
    for size in ("w500", "w185", "thumbnail"):
        web = poster_local_path(kind, ident, size)
        if web:
            delete_poster_by_web(web)
        # also try all exts
        prefix = {"tv": "shows", "show": "shows", "shows": "shows", "movie": "movies", "movies": "movies", "anime": "anime"}.get((kind or "").lower(), kind)
        for ext in (".jpg", ".png", ".webp", ".jpeg"):
            for sz in ("w500", "w185", "thumbnail"):
                delete_poster_by_web(f"/static/images/posters/{prefix}/{sz}/{ident}{ext}")
    # also clean old flat location
    for ext in (".jpg", ".png", ".webp", ".jpeg"):
        delete_poster_by_web(f"/static/images/posters/{ {'tv':'shows','movie':'movies','anime':'anime'}.get((kind or '').lower(), kind)}/{ident}{ext}")

