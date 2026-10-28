#!/usr/bin/env python3
"""eol — satir sonu (LF) kapisi.   [2.20.7]

Neden: repoda kanonik satir sonu LF'dir (`.gitattributes`: `* text=auto eol=lf`).
Windows'ta PowerShell `Set-Content`/`Out-File` CRLF yazar; bu dosyalar scp ile
pi'ye gidince repo ile bayt-bayt ayni olmaz. `.sh` / `.service` / `py/`
dosyalarinda CRLF servisi bozar (`bad interpreter`, systemd parse hatasi).

Kullanim:
    python py/eol.py check [klasor]   # CRLF'li metin dosyasi varsa HATA (exit 1)
    python py/eol.py fix   [klasor]   # CRLF -> LF (BOM eklemez), rapor verir

Kurallar:
  1) Yalniz metin dosyalari taranir (uzanti/binary kontrolu).
  2) .git, venv, node_modules, __pycache__, bak/, backup*/ atlanir.
  3) fix yalniz CRLF'i LF'e cevirir; icerik/karakter kodlamasi degismez.
"""
import os
import sys

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TEXT_EXT = {
    ".py", ".js", ".css", ".html", ".htm", ".json", ".md", ".sh", ".service",
    ".txt", ".yml", ".yaml", ".cfg", ".ini", ".conf", ".toml", ".sql",
    ".example", ".env", ".bat", ".cmd",
}
TEXT_NAMES = {
    "VERSION", "CHANGELOG.md", ".gitignore", ".gitattributes", ".env",
    "Dockerfile", "Makefile", "Procfile", "requirements.txt",
}
SKIP_DIRS = {
    ".git", ".venv", "venv", "node_modules", "__pycache__", ".opencode",
    "bak", "backup", "backup_pre_calendar", "log", "temp", "tmp",
    "dist", "build", ".pytest_cache",
}


def app_root(root=None):
    return os.path.abspath(root) if root else APP_ROOT


def _is_text_name(name):
    ext = os.path.splitext(name)[1].lower()
    return ext in TEXT_EXT or name in TEXT_NAMES or name.startswith(".env")


def text_files(root):
    """Tarama kapsamindaki metin dosyalari (mutlak yol)."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in SKIP_DIRS and not d.startswith("backup")
        )
        for name in sorted(filenames):
            if not _is_text_name(name):
                continue
            yield os.path.join(dirpath, name)


def _read(path):
    with open(path, "rb") as fh:
        return fh.read()


def _write(path, data):
    with open(path, "wb") as fh:
        fh.write(data)


def _crlf_count(data):
    return data.count(b"\r\n")


def scan(root):
    """-> (taranan, [(relpath, crlf_count)])"""
    root = app_root(root)
    total = 0
    bad = []
    for path in text_files(root):
        data = _read(path)
        if b"\x00" in data[:8192]:
            continue                      # ikili icerik: atla
        total += 1
        n = _crlf_count(data)
        if n:
            bad.append((os.path.relpath(path, root), n))
    return total, bad


def fix(root):
    root = app_root(root)
    fixed = []
    for path in text_files(root):
        data = _read(path)
        if b"\x00" in data[:8192]:
            continue
        n = _crlf_count(data)
        if not n:
            continue
        new = data.replace(b"\r\n", b"\n")
        if new.startswith(b"\xef\xbb\xbf"):
            new = new[3:]                 # BOM'u da temizle (statik kurali)
        _write(path, new)
        fixed.append((os.path.relpath(path, root), n))
    return fixed


def main(argv):
    cmd = (argv[1] if len(argv) > 1 else "check").lower()
    root = argv[2] if len(argv) > 2 else None
    if cmd not in ("check", "fix"):
        print("kullanim: python py/eol.py check|fix [klasor]")
        return 2
    real = app_root(root)
    if not os.path.isdir(real):
        print(f"HATA: klasor yok: {real}")
        return 2
    if cmd == "fix":
        fixed = fix(real)
        for rel, n in fixed:
            print(f"  LF'e cevrildi ({n} CRLF): {rel}")
        total, bad = scan(real)
        print(f"fix: {len(fixed)} dosya | kalan CRLF: {len(bad)} | taranan: {total}")
        return 0 if not bad else 1
    total, bad = scan(real)
    if bad:
        print(f"HATA: {len(bad)} dosyada CRLF var (kanonik: LF) — kok: {real}")
        for rel, n in bad:
            print(f"  {rel}  ({n} CRLF)")
        print("Duzeltme: python py/eol.py fix")
        return 1
    print(f"OK: {total} metin dosyasi LF — kok: {real}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
