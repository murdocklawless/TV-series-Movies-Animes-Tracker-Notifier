# Uygulama güncelleme motoru: VERSION karşılaştırma, snapshot, senkron, pip, rollback.
import base64
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

import requests

from config import BASE_DIR
from db import get_setting, set_setting, db_version_get, db_version_set

REPO_SLUG = "murdocklawless/TV-series-Movies-Animes-Tracker-Notifier"
BRANCH = "main"
REMOTE_VERSION_URL = f"https://raw.githubusercontent.com/{REPO_SLUG}/{BRANCH}/VERSION"
REMOTE_CHANGELOG_URL = f"https://raw.githubusercontent.com/{REPO_SLUG}/{BRANCH}/CHANGELOG.md"
SNAP_ROOT = "/etc/snapshot/app-update"
JUST_UPDATED_MARK = os.path.join(SNAP_ROOT, ".just-updated")
KEEP_SNAPS = 5
UPDATE_WINDOW_SEC = 30 * 60

SYNC_TREES = ("py", "static", "requirements", "service", "sh")
SYNC_FILES = ("VERSION", "CHANGELOG.md")
SKIP_DIRS = {"venv", "__pycache__", ".git", "bak", "backup", "tmp_push", ".opencode", "md"}
SKIP_FILES = {".env", ".smtp_secret"}


def _ver_tuple(v):
    parts = re.findall(r"\d+", str(v or ""))
    return tuple(int(p) for p in parts) if parts else ()


def local_version():
    try:
        with open(os.path.join(BASE_DIR, "VERSION"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def fetch_remote_version(timeout=20):
    r = requests.get(REMOTE_VERSION_URL, timeout=timeout)
    r.raise_for_status()
    return r.text.strip()


def check_update():
    """(local, remote, available, known) — ağ hatasında (local, "", False, True).

    Tablo gerçeğin evidir: dosya farklıysa sessizce tablo değeriyle eşitlenir
    (aynıysa dokunulmaz). Bilinmeyen yerel sürüm "en eski" sayılır → körlenme yok."""
    try:
        db_ver = db_version_get()
    except Exception:
        db_ver = ""
    file_ver = local_version()
    if db_ver and file_ver != db_ver:
        try:
            _write_version_file(db_ver)
        except Exception as e:
            print(f"app-update version sync failed: {e}", flush=True)
    local = db_ver or file_ver
    try:
        remote = fetch_remote_version()
    except Exception as e:
        print(f"app-update check failed: {e}", flush=True)
        return local, "", False, True
    if remote:
        try:
            set_setting("app_remote_version", remote)
        except Exception:
            pass
    try:
        published = fetch_published_versions()
    except Exception:
        published = set()
    known = True if not published else ((not local) or local in published)
    if known:
        available = bool(remote and _ver_tuple(remote) > _ver_tuple(local))
    else:
        available = bool(remote)
    return local, remote, available, known


def _write_version_file(number):
    path = os.path.join(BASE_DIR, "VERSION")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(str(number).strip() + "\n")
    os.replace(tmp, path)


KNOWN_VERSIONS_TTL = 20 * 3600


def _git_version_history(timeout=20):
    """Git'teki VERSION geçmişi: dosyaya dokunan commit'lerin içerikleri (GitHub API)."""
    out = set()
    headers = {"Accept": "application/vnd.github+json"}
    url = f"https://api.github.com/repos/{REPO_SLUG}/commits?path=VERSION&sha={BRANCH}&per_page=100"
    r = requests.get(url, timeout=timeout, headers=headers)
    r.raise_for_status()
    commits = r.json()
    if not isinstance(commits, list):
        return out
    for c in commits:
        sha = (c or {}).get("sha")
        if not sha:
            continue
        cr = requests.get(
            f"https://api.github.com/repos/{REPO_SLUG}/contents/VERSION?ref={sha}",
            timeout=timeout, headers=headers,
        )
        cr.raise_for_status()
        body = cr.json() or {}
        try:
            val = base64.b64decode(body.get("content") or "").decode("utf-8", "replace").strip()
        except Exception:
            continue
        if val:
            out.add(val)
    return out


def fetch_published_versions():
    """Yayınlanmış sürüm kümesi: uzak CHANGELOG başlıkları + git VERSION geçmişi + uzak VERSION.

    Sonuç günlük önbelleğe alınır (settings.app_known_versions); tamamen ulaşılamazsa
    boş küme döner (çağıran fail-open davranır)."""
    try:
        raw = get_setting("app_known_versions")
        ts = float(get_setting("app_known_versions_ts") or 0)
        if raw and (time.time() - ts) < KNOWN_VERSIONS_TTL:
            cached = json.loads(raw)
            if isinstance(cached, list):
                return set(cached)
    except Exception:
        pass
    versions = set()
    try:
        versions.update(e["version"] for e in parse_changelog(fetch_remote_changelog()))
    except Exception as e:
        print(f"app-update published/changelog failed: {e}", flush=True)
    try:
        versions.update(_git_version_history())
    except Exception as e:
        print(f"app-update published/git failed: {e}", flush=True)
    try:
        versions.add(fetch_remote_version())
    except Exception:
        pass
    versions = {v for v in versions if v}
    if versions:
        try:
            set_setting("app_known_versions", json.dumps(sorted(versions)))
            set_setting("app_known_versions_ts", str(time.time()))
        except Exception:
            pass
    return versions


def fetch_remote_changelog(timeout=20):
    r = requests.get(REMOTE_CHANGELOG_URL, timeout=timeout)
    r.raise_for_status()
    return r.text


def parse_changelog(text):
    """CHANGELOG.md -> [{version, date, tr:[...], en:[...]}] (dosya sırası, yeni önce).

    Başlık formatı: `## X.Y - GG/AA/YYYY-SS:DD` (tarih opsiyonel, eski başlıklar çalışır)."""
    out = []
    cur = None
    sec = None
    for raw in (text or "").splitlines():
        line = raw.strip()
        m = re.match(r"^##\s+(\S+)(?:\s*-\s*(\S+))?", line)
        if m:
            cur = {"version": m.group(1), "date": m.group(2) or "", "tr": [], "en": []}
            out.append(cur)
            sec = None
            continue
        m = re.match(r"^###\s+(TR|EN)\s*$", line, re.IGNORECASE)
        if m and cur is not None:
            sec = m.group(1).lower()
            continue
        if cur is not None and sec in ("tr", "en") and line.startswith("- "):
            cur[sec].append(line[2:].strip())
    return [e for e in out if e["tr"] or e["en"]]


def changelog_between(text, local, remote):
    """(local, remote] aralığındaki kayıtlar, yeni sürüm önce."""
    lv, rv = _ver_tuple(local), _ver_tuple(remote)
    res = []
    for e in parse_changelog(text):
        v = _ver_tuple(e["version"])
        if v and (not lv or v > lv) and (not rv or v <= rv):
            res.append(e)
    res.sort(key=lambda e: _ver_tuple(e["version"]), reverse=True)
    return res


def _snap_dir(ts=None):
    ts = ts or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    d = os.path.join(SNAP_ROOT, ts)
    os.makedirs(d, exist_ok=True)
    return d


def prune_snaps(keep=KEEP_SNAPS):
    try:
        entries = sorted(
            (os.path.join(SNAP_ROOT, n) for n in os.listdir(SNAP_ROOT)),
            key=os.path.getmtime,
        )
        dirs = [d for d in entries if os.path.isdir(d)]
        for old in dirs[:-keep] if len(dirs) > keep else []:
            shutil.rmtree(old, ignore_errors=True)
    except Exception as e:
        print(f"app-update prune failed: {e}", flush=True)


def _venv_python():
    cand = os.path.join(BASE_DIR, "venv", "bin", "python")
    return cand if os.path.isfile(cand) else sys.executable


def take_snapshot():
    """pip freeze + kod tgz + requirements kopyası. Klasör yolunu döner."""
    d = _snap_dir()
    try:
        with open(os.path.join(d, "pip-freeze.txt"), "w", encoding="utf-8") as f:
            subprocess.run(
                [_venv_python(), "-m", "pip", "freeze"],
                stdout=f, stderr=subprocess.DEVNULL, timeout=120, check=False,
            )
    except Exception as e:
        print(f"app-update freeze failed: {e}", flush=True)
    try:
        with tarfile.open(os.path.join(d, "code.tar.gz"), "w:gz") as tar:
            for tree in SYNC_TREES:
                src = os.path.join(BASE_DIR, tree)
                if os.path.isdir(src):
                    for root, dirs, files in os.walk(src):
                        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
                        for fn in files:
                            if fn in SKIP_FILES or fn.endswith(".db"):
                                continue
                            full = os.path.join(root, fn)
                            tar.add(full, os.path.relpath(full, BASE_DIR))
            for fn in SYNC_FILES:
                full = os.path.join(BASE_DIR, fn)
                if os.path.isfile(full):
                    tar.add(full, fn)
    except Exception as e:
        print(f"app-update code snap failed: {e}", flush=True)
    try:
        req = os.path.join(BASE_DIR, "requirements", "requirements.txt")
        if os.path.isfile(req):
            shutil.copy2(req, os.path.join(d, "requirements.txt"))
    except Exception:
        pass
    prune_snaps()
    return d


def _file_hash(path):
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return ""


def _sync_tree(src_root, dst_root):
    for tree in SYNC_TREES:
        src = os.path.join(src_root, tree)
        dst = os.path.join(dst_root, tree)
        if not os.path.isdir(src):
            continue
        if os.path.isdir(dst):
            shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(
            src, dst,
            ignore=shutil.ignore_patterns(
                "venv", "__pycache__", ".git", "bak", "backup", "tmp_push",
                ".opencode", "md", ".env", ".smtp_secret", "*.db",
            ),
        )
    for fn in SYNC_FILES:
        src = os.path.join(src_root, fn)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(dst_root, fn))


def apply_update(remote_url=None):
    """Klonla -> snapshot -> senkron -> (gerekirse) pip -> restart zamanla.
    (from_ver, to_ver) döner; hata fırlatır."""
    from notifications import notify_all

    local = local_version()
    tmp = tempfile.mkdtemp(prefix="nextep-update-")
    try:
        slug = remote_url or f"https://github.com/{REPO_SLUG}.git"
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", BRANCH, slug, tmp],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            timeout=300, check=True,
        )
        new_req = os.path.join(tmp, "requirements", "requirements.txt")
        old_req = os.path.join(BASE_DIR, "requirements", "requirements.txt")
        pip_needed = _file_hash(new_req) != _file_hash(old_req)
        snap = take_snapshot()
        _sync_tree(tmp, BASE_DIR)
        pip_log = os.path.join(snap, "pip.log")
        if pip_needed and os.path.isfile(new_req):
            with open(pip_log, "w", encoding="utf-8") as log:
                subprocess.run(
                    [_venv_python(), "-m", "pip", "install", "-r", new_req],
                    stdout=log, stderr=subprocess.STDOUT, timeout=900,
                )
            with open(pip_log, encoding="utf-8", errors="replace") as log:
                tail = log.read()[-2000:]
            if "Successfully installed" not in tail and "Requirement already satisfied" not in tail:
                raise RuntimeError(f"pip kurulumu doğrulanamadı (bkz. {pip_log})")
        to_ver = local_version()
        try:
            db_version_set(to_ver)
        except Exception as e:
            print(f"app-update version record failed: {e}", flush=True)
        try:
            with open(JUST_UPDATED_MARK, "w", encoding="utf-8") as f:
                f.write(f"{time.time():.0f}\n{local}\n{to_ver}\n")
        except OSError as e:
            print(f"app-update mark failed: {e}", flush=True)
        print(f"app-update applied {local} -> {to_ver} (pip={pip_needed})", flush=True)
        t = threading.Timer(3.0, _restart_service)
        t.daemon = True
        t.start()
        return local, to_ver
    except Exception:
        try:
            notify_all("NextEp güncellemesi başarısız oldu, sistem eski sürümde çalışmaya devam ediyor.")
        except Exception:
            pass
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _restart_service():
    try:
        subprocess.run(["systemctl", "restart", "nextep"], timeout=60, check=False)
    except Exception as e:
        print(f"app-update restart failed: {e}", flush=True)


def just_updated_within(sec=UPDATE_WINDOW_SEC):
    try:
        with open(JUST_UPDATED_MARK, encoding="utf-8") as f:
            ts = float(f.read().split("\n")[0].strip())
        return (time.time() - ts) < sec
    except (OSError, ValueError):
        return False


def clear_just_updated():
    try:
        os.remove(JUST_UPDATED_MARK)
    except OSError:
        pass


def rollback(reason=""):
    """Son snapshot'a dön: önce kod, sonra freeze. True/False döner."""
    from notifications import notify_all

    try:
        entries = sorted(
            (os.path.join(SNAP_ROOT, n) for n in os.listdir(SNAP_ROOT)),
            key=os.path.getmtime,
        )
        snaps = [d for d in entries if os.path.isdir(d)]
        if not snaps:
            print("app-update rollback: snapshot yok", flush=True)
            return False
        snap = snaps[-1]
        code = os.path.join(snap, "code.tar.gz")
        if os.path.isfile(code):
            with tarfile.open(code, "r:gz") as tar:
                tar.extractall(BASE_DIR)
            print(f"app-update rollback: kod geri alındı ({os.path.basename(snap)})", flush=True)
        freeze = os.path.join(snap, "pip-freeze.txt")
        if os.path.isfile(freeze) and os.path.getsize(freeze) > 0:
            subprocess.run(
                [_venv_python(), "-m", "pip", "install", "-r", freeze],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=900, check=False,
            )
            print("app-update rollback: pip freeze geri kuruldu", flush=True)
        try:
            with open(JUST_UPDATED_MARK, encoding="utf-8") as f:
                _lines = f.read().split("\n")
            if len(_lines) > 1 and _lines[1].strip():
                db_version_set(_lines[1].strip())
        except Exception:
            try:
                db_version_set(local_version())
            except Exception:
                pass
        clear_just_updated()
        _restart_service()
        try:
            notify_all(f"NextEp güncellemesi geri alındı.{(' Neden: ' + reason) if reason else ''} Sistem önceki çalışan sürüme döndürüldü.")
        except Exception:
            pass
        return True
    except Exception as e:
        print(f"app-update rollback failed: {e}", flush=True)
        return False


def localhost_healthy(timeout=10):
    import os as _os

    port = _os.environ.get("PORT", "8050")
    base = f"http://127.0.0.1:{port}"
    try:
        r = requests.get(base + "/", timeout=timeout)
        if r.status_code != 200:
            return False
        r = requests.get(base + "/api/followed", timeout=timeout)
        return r.status_code == 200
    except Exception:
        return False
