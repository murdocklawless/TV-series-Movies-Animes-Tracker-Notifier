#!/usr/bin/env python3
"""jsver — NextEp frontend cache-buster (tek build damgasi) araci.   [2.19]

Neden: ayni modul iki farkli ?v= URL'si ile yuklenirse tarayici modulu iki kez
degerlendirir; modul govdesindeki toggle dinleyicileri birbirini iptal eder
(Ayarlar/disli menusu, akordeonlar acilmaz). Tek damga bu hata sinifini
yapisal olarak kaldirir.

Kullanim (sh yok):
    python3 py/jsver.py check [klasor]        # yayin oncesi + guncelleme kapisi
    python3 py/jsver.py bump                  # build +1, tum ?v= damgalarini esitler
    python3 py/jsver.py set 640               # build = 640
    python3 py/jsver.py hooks                 # .git/hooks/pre-push kurar
    python3 py/jsver.py release "mesaj" [--push] [--yes]

Kurallar:
 1) Bir modul 2+ farkli ?v= ile import ediliyorsa  -> HATA (cift yukleme)
 2) __NX_BUILD varsa ve bir damga build'e esit degilse -> HATA
 3) __NX_BUILD yoksa (eski sema) yalniz 1. kural uygulanir; eski surumler engellenmez
"""
import os
import re
import subprocess
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IMPORT_RE = re.compile(r"\./([a-z0-9_]+\.js)\?v=(\d+)")
STAMP_RE = re.compile(r"(\./[a-z0-9_]+\.js)\?v=\d+")
BUILD_RE = re.compile(r'__NX_BUILD\s*=\s*"(\d+)"')
INDEX_RE = re.compile(r"(static/js/nextep\.js)\?v=(\d+)")


def app_root(root=None):
    return os.path.abspath(root) if root else APP_ROOT


def _jsdir(root):
    return os.path.join(app_root(root), "static", "js")


def _index(root):
    return os.path.join(app_root(root), "static", "index.html")


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore", newline="") as fh:
            return fh.read()
    except OSError:
        return ""


def _write(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def _js_files(root):
    jdir = _jsdir(root)
    if not os.path.isdir(jdir):
        return []
    return [os.path.join(jdir, f) for f in sorted(os.listdir(jdir)) if f.endswith(".js")]


def scan(root=None):
    """(build, {modul: set(surum)}, index_surum) dondurur."""
    vers = {}
    for path in _js_files(root):
        for m in IMPORT_RE.finditer(_read(path)):
            vers.setdefault(m.group(1), set()).add(m.group(2))
    build = ""
    npath = os.path.join(_jsdir(root), "nextep.js")
    bm = BUILD_RE.search(_read(npath))
    if bm:
        build = bm.group(1)
    index_ver = ""
    im = INDEX_RE.search(_read(_index(root)))
    if im:
        index_ver = im.group(2)
    return build, vers, index_ver


def check_root(root=None):
    """Sorun listesi. Bos liste = temiz. (Kapi ve acilis kontrolu bunu kullanir.)"""
    build, vers, index_ver = scan(root)
    probs = []
    for mod in sorted(vers):
        vs = sorted(vers[mod])
        if len(vs) > 1:
            probs.append(f"{mod} cok surumlu: {', '.join(vs)}")
    if build:
        for mod in sorted(vers):
            for v in sorted(vers[mod]):
                if v != build:
                    probs.append(f"{mod} v={v} (build={build})")
        if not index_ver:
            probs.append("index.html'de nextep.js?v= bulunamadi")
        elif index_ver != build:
            probs.append(f"index.html nextep.js?v={index_ver} (build={build})")
    return probs


def report(root=None):
    build, vers, index_ver = scan(root)
    print(f"build: {build or '?'}")
    print("--- modul -> surum ---")
    for mod in sorted(vers):
        for v in sorted(vers[mod]):
            print(f"{mod} {v}")
    probs = check_root(root)
    if probs:
        print("HATA: " + "; ".join(probs))
    else:
        print(f"OK: tum moduller tek surumde (build={build or '?'})")
    return probs


def stamp(n, root=None):
    """Tum ?v= damgalarini + build + index.html sorgusunu tek numaraya ceker."""
    n = str(int(n))
    root = app_root(root)
    changed = 0
    for path in _js_files(root):
        txt = _read(path)
        new = STAMP_RE.sub(lambda m: f"{m.group(1)}?v={n}", txt)
        if os.path.basename(path) == "nextep.js":
            new = BUILD_RE.sub(f'__NX_BUILD = "{n}"', new)
        if new != txt:
            _write(path, new)
            changed += 1
    idx = _index(root)
    idx_changed = False
    if os.path.isfile(idx):
        txt = _read(idx)
        new = re.sub(r"(static/js/nextep\.js)\?v=\d+", lambda m: f"{m.group(1)}?v={n}", txt)
        if new != txt:
            _write(idx, new)
            idx_changed = True
    print(f"build={n} - {changed} js dosyasi damgalandi - index.html {'guncellendi' if idx_changed else 'degismedi'}")
    return n


def max_used(root=None):
    build, vers, index_ver = scan(root)
    nums = [int(v) for vs in vers.values() for v in vs]
    if build:
        nums.append(int(build))
    if index_ver:
        nums.append(int(index_ver))
    return max(nums) if nums else 0


def bump(root=None):
    """build = max(bilinen damgalar) + 1 — gecmiste kullanilmis numaraya donmez."""
    n = max_used(root) + 1
    stamp(n, root)
    return n


def install_hook(root=None, quiet=False):
    """pre-push kancasi: push edilecek depoda damga zinciri bozuksa push'u reddeder.
    Kanca yalnizca mekanik bir zarftir; tum mantik bu dosyada (Python)."""
    root = app_root(root)
    hooks = os.path.join(root, ".git", "hooks")
    if not os.path.isdir(hooks):
        raise SystemExit(f"git deposu degil (hooks yok): {root}")
    path = os.path.join(hooks, "pre-push")
    body = (
        "#!/bin/sh\n"
        "# NextEp: yayin oncesi JS damga kontrolu — mantik py/jsver.py icinde.\n"
        "# Zincir bozuksa push reddedilir (cift modul yuklemesi = olu buton).\n"
        'ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"\n'
        f'[ -n "$ROOT" ] || ROOT="{root}"\n'
        '[ -f "$ROOT/py/jsver.py" ] || exit 0\n'
        'PY="$ROOT/venv/bin/python"\n'
        '[ -x "$PY" ] || PY=python3\n'
        'exec "$PY" "$ROOT/py/jsver.py" check "$ROOT"\n'
    )
    _write(path, body)
    try:
        os.chmod(path, 0o755)
    except OSError:
        pass
    if not quiet:
        print(f"pre-push kancasi kuruldu: {path}")
    return path


def _git(root, *args, timeout=60):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()


def release(msg=None, push=False, yes=False, root=None):
    """check -> (JS degistiyse) bump -> commit (+ --push).
    Mesaj verilmezse yalniz kontrol eder ve siradaki komutlari yazar (kuru calisma)."""
    root = app_root(root)
    probs = check_root(root)
    if probs:
        print("YAYIN DURDURULDU — js damga zinciri bozuk:")
        for p in probs:
            print("  - " + p)
        print("Onarim: python3 py/jsver.py bump")
        return 1

    js_changed = ""
    try:
        _rc, js_changed, _err = _git(root, "status", "--porcelain", "--", "static/js", "static/index.html")
    except Exception:
        pass
    ver = _read(os.path.join(root, "VERSION")).strip() or "?"
    if not msg:
        print(f"surum: {ver} - damga zinciri temiz")
        if js_changed:
            print("JS/static degismis -> yayin damgasi bump edilecek (kuru calisma: dosya degistirilmedi)")
        print("siradaki adimlar:")
        print('  git add -A && git commit -m "v%s: <aciklama>"' % ver)
        print("  git push")
        print('otomatik: python3 py/jsver.py release "<aciklama>" --yes [--push]')
        return 0

    if not yes:
        print(f'Onay yok: python3 py/jsver.py release "{msg}" --yes [--push]')
        return 2

    if js_changed:
        bump(root)
        report(root)
        probs = check_root(root)
        if probs:
            print("YAYIN DURDURULDU — bump sonrasi zincir hala bozuk:")
            for p in probs:
                print("  - " + p)
            return 1

    _rc, behind, _err = _git(root, "rev-list", "--count", "HEAD..origin/main")
    if behind and behind.isdigit() and int(behind) > 0 and push:
        print(f"PUSH ENGELLENDI: yerel dal origin/main'in {behind} commit gerisinde. Once senkronize et.")
        return 1

    rc, out, err = _git(root, "add", "-A")
    if rc != 0:
        print(f"git add hatasi: {err}")
        return 1
    rc, out, err = _git(root, "diff", "--cached", "--quiet")
    if rc == 0:
        print("Yayinlanacak degisiklik yok (calisma agaci temiz).")
        return 0
    rc, out, err = _git(root, "commit", "-m", f"v{ver}: {msg}")
    if rc != 0:
        print(f"git commit hatasi: {err or out}")
        return 1
    print(f"commit: v{ver}: {msg}")
    if push:
        rc, out, err = _git(root, "push", timeout=300)
        if rc != 0:
            print(f"git push hatasi: {err}")
            return 1
        print("push: ok")
    return 0


def startup_report(root=None):
    """Sunucu acilisinda tek satir durum (py/nextep.py cagirir)."""
    build, vers, _iv = scan(root)
    probs = check_root(root)
    if probs:
        print(f"[ui] UYARI js surum zinciri bozuk: {'; '.join(probs)} -> python3 py/jsver.py bump", flush=True)
    else:
        print(f"[ui] js surum zinciri temiz (build={build or '?'}, {len(vers)} modul)", flush=True)
    return probs


def _main(argv):
    cmd = argv[1] if len(argv) > 1 else "check"
    args = argv[2:]
    if cmd == "check":
        return 1 if report(args[0] if args else None) else 0
    if cmd == "bump":
        bump(args[0] if args else None)
        return 1 if check_root(args[0] if args else None) else 0
    if cmd == "set":
        if not args:
            print("kullanim: python3 py/jsver.py set <N>", file=sys.stderr)
            return 2
        stamp(args[0])
        return 1 if check_root() else 0
    if cmd == "hooks":
        install_hook()
        return 0
    if cmd == "release":
        msg = None
        push = "--push" in args
        yes = "--yes" in args
        for a in args:
            if not a.startswith("--"):
                msg = a
                break
        return release(msg, push=push, yes=yes)
    print("kullanim: python3 py/jsver.py [check [klasor] | bump | set N | hooks | release \"mesaj\" [--push] [--yes]]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
