"""VPS + ters tunel kurulumu (YALNIZ PYTHON).

`py/routes/remote.py` tarafindan cagrilir. SSH katmani (vps_run) ve log
cagrisi (log) disaridan enjekte edilir; boylece bu modul remote.py'ye
bagimli olmaz (dairesel import yok).

Kapsam:
  - web sunucusu tespiti (port sahibi) + secenek uretimi
  - Caddy / nginx / apache2 site kurulumu (config Python string'i)
  - Pi'de autossh + ters tunel unit'i (sablondan)
  - Pi WireGuard istemcisi (sh/nextep_remote.sh muadili)
  - kill-switch / "Sunucu Degistir" yerel temizligi

Ilke: hicbir servis otomatik durdurulmaz/silinmez. Portu baska servis
tutuyorsa yalniz bilgi verilir (elle bosaltma istenir).
"""
import os
import re
import shutil
import subprocess
import time

from config import BASE_DIR

WEB_SERVERS = ("caddy", "nginx", "apache2")
# Desteklenmeyen ama "web sunucusu" olarak taninan surecler (yalniz bilgi).
KNOWN_OTHER = ("lighttpd", "openlitespeed", "litespeed", "lshttpd", "haproxy",
               "traefik", "envoy", "angie", "openresty", "varnishd", "varnish",
               "zoraxy", "httpd", "apache", "nginx", "caddy", "iis", "w3wp")

TUNNEL_UNIT = "/etc/systemd/system/nextep-tunnel.service"
TUNNEL_KEY = "/root/.ssh/vps_tunnel"
TUNNEL_KNOWN_HOSTS = "/root/.ssh/known_hosts_vps"
WG_CONF = "/etc/wireguard/nextep.conf"
WG_SRC = "/root/nextep.conf"
AUTOSSH_BIN = "/usr/bin/autossh"
MARK = "nextep-vps-setup"
TEMPLATE_REL = os.path.join("service", "nextep-tunnel.service.template")


# --------------------------------------------------------------------------
# kucuk yardimcilar
# --------------------------------------------------------------------------

def _step(log, name, state):
    try:
        log(f"STEP:{name}:{state}")
    except Exception:
        pass


def _pi_run(cmd, input_text=None, timeout=300):
    """Pi uzerinde yerel komut (Flask zaten Pi'de calisir)."""
    return subprocess.run(cmd, input=input_text, capture_output=True,
                          text=True, timeout=timeout)


def read_pi_port():
    """nextep.service icindeki Environment=PORT degerini dondurur (yoksa $PORT/8050)."""
    for path in ("/etc/systemd/system/nextep.service",
                 os.path.join(BASE_DIR, "service", "nextep.service")):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    m = re.match(r"^\s*Environment=PORT=(\d+)\s*$", line)
                    if m:
                        return m.group(1)
        except OSError:
            continue
    return str(os.environ.get("PORT") or "8050")


def _read_template():
    path = os.path.join(BASE_DIR, TEMPLATE_REL)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _render(template, values):
    out = template
    for k, v in values.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out


def _clean_owner(name):
    return (name or "").strip().strip("'\"").lower()


# --------------------------------------------------------------------------
# web sunucusu tespiti (VPS)
# --------------------------------------------------------------------------

_SS_LINE_RE = re.compile(r'users:\(\("([^"]+)"')
_PORT_RE = re.compile(r'[:.](\d+)\s')


def _port_owner(vps_run, port):
    """(owner, pid, raw) — portu dinleyen surec adi. Bulunamazsa ("", "", raw)."""
    cmd = (f"ss -ltnpH 'sport = :{port}' 2>/dev/null || "
           f"ss -ltnp 2>/dev/null | grep -E '[:.]{port} '")
    try:
        rc, out = vps_run(cmd, timeout=30)
    except Exception:
        return "", "", ""
    raw = (out or "").strip()
    for line in raw.splitlines():
        m = _SS_LINE_RE.search(line)
        if m:
            name = _clean_owner(m.group(1))
            pid = ""
            mp = re.search(r'pid=(\d+)', line)
            if mp:
                pid = mp.group(1)
            return name, pid, raw
    if raw:
        # users:(...) yoksa (yetki/format farki) son sutundan kabaca cikar
        parts = raw.split()
        if parts:
            cand = _clean_owner(parts[-1].split(":")[0])
            if cand:
                return cand, "", raw
    return "", "", raw


def detect_web(vps_run):
    """Web sunucusu durumu + secim secenekleri.

    Donen sozluk:
      {"http": owner, "https": owner, "owner": en baskin sahip,
       "options": ["caddy","nginx","apache2"],       # aktif secenekler
       "server": "caddy|nginx|apache2|",             # desteklenen mevcut sahip
       "blocked": bool, "blocked_owner": str, "raw": str}
    """
    o80, _p80, raw80 = _port_owner(vps_run, 80)
    o443, _p443, raw443 = _port_owner(vps_run, 443)
    owners = [o for o in (o80, o443) if o]
    # baskin sahip: 443 > 80
    owner = o443 or o80 or ""
    result = {
        "http": o80, "https": o443, "owner": owner,
        "options": [], "server": "", "blocked": False, "blocked_owner": "",
        "raw": (raw80 + "\n" + raw443).strip()[:2000],
    }
    if not owners:
        # port bos → uc secenek de acik
        result["options"] = list(WEB_SERVERS)
        return result
    supported = [o for o in owners if o in WEB_SERVERS]
    unsupported = [o for o in owners if o not in WEB_SERVERS]
    if unsupported:
        # desteklenmeyen (veya bilinmeyen) bir sahip var → secim YOK
        result["blocked"] = True
        result["blocked_owner"] = unsupported[0]
        return result
    if supported:
        srv = supported[0]
        result["server"] = srv
        # mevcut sunucu + (port cakismadigi icin) yalniz o sunucu secilebilir
        result["options"] = [srv]
        return result
    return result


# --------------------------------------------------------------------------
# landing + web sunucusu kurulumu (VPS)
# --------------------------------------------------------------------------

def _landing_html():
    path = os.path.join(BASE_DIR, "service", "nextep-landing.html")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ('<!doctype html><html><head><meta charset="utf-8">'
                '<title>NextEp</title></head><body><h1>NextEp Stremio</h1>'
                '</body></html>\n')


def _write_landing(vps_run, log, landing):
    html = _landing_html()
    rc, out = vps_run(f"mkdir -p {landing}", timeout=60)
    if rc != 0:
        return False, out
    rc, out = vps_run(f"cat > {landing}/index.html", html, timeout=120)
    if rc != 0:
        return False, out
    vps_run(f"chown -R caddy:caddy {landing} 2>/dev/null || "
            f"chown -R www-data:www-data {landing} 2>/dev/null || true", timeout=60)
    return True, ""


def _backup(vps_run, path, ts):
    vps_run(f"[ -f {path} ] && cp -a {path} {path}.bak_{ts} || true", timeout=60)


_TEST_PATH = {
    "stremio": "/stremio/install-info.json",
    "calendar": "/calendar/x/nextep.ics",
    "webhook": "/webhook/jellyfin/x",
}


def _https_test(vps_run, log, domain, step="verify", profile="stremio"):
    """https://<domain><profil yolu> -> istegi Pi (waitress) karsiladi mi?

    Yol yoksa Caddy/nginx dosyayi sunar (404, Server: Caddy) -> 'waitress' basligi
    YOK; yol varsa uc Pi'den gelir -> 'Server: Caddy, waitress' (kod 405/404/200
    olabilir, yol olmadigindan ayirt eden sey waitress basligidir).
    Stremio profilinde ayrica 200 beklenir (install-info public uctur).
    """
    path = _TEST_PATH.get((profile or "stremio").strip().lower(), _TEST_PATH["stremio"])
    want200 = (profile or "stremio").strip().lower() == "stremio"
    for i in range(6):
        rc, out = vps_run(
            f"curl -sk -D - -o /dev/null -w '%{{http_code}}' --max-time 10 "
            f"https://{domain}{path}", timeout=40)
        text = (out or "")
        code = text.strip().splitlines()[-1] if text.strip() else ""
        routed = "waitress" in text.lower()
        if routed and (code.endswith("200") or not want200):
            log(f"==> HTTPS testi OK: https://{domain}{path} -> {code} (profil: {profile})")
            return True
        time.sleep(10)
    log(f"UYARI: HTTPS testi basarisiz (profil: {profile}, son kod: {code or '-'}, "
        f"yol: {path}) — yonlendirme yok gibi")
    return False


# --------------------------------------------------------------------------
# 1.87: PROFIL bazli EKLEMELI yapilandirma yamalama
#   Her kart yalnizca KENDI ihtiyaci olan yolu kurar; mevcut yollar ASLA silinmez.
# --------------------------------------------------------------------------

PROFILES = {
    "stremio": ("/stremio/",),
    "calendar": ("/calendar/",),
    "webhook": ("/webhook/",),
}


def _profile_paths(profile):
    """Profil -> yol listesi (bilinmeyen profil -> stremio)."""
    p = (profile or "stremio").strip().lower()
    return PROFILES.get(p, PROFILES["stremio"])


def _span_by_braces(lines, start):
    """start satirindan baslayan susluparante dengeli blogun bitis indexi."""
    depth = 0
    for i in range(start, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth <= 0:
            return i
    return len(lines) - 1


def _caddy_find_site(lines, domain):
    """Yonetilen/mevcut site blogunu bul -> (start, end) | None."""
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s == f"{domain} {{":
            return i, _span_by_braces(lines, i)
        if MARK in ln and i + 1 < len(lines) and lines[i + 1].strip() == f"{domain} {{":
            return i + 1, _span_by_braces(lines, i + 1)
    return None


def _caddy_block(domain, backend, landing, logpath, email, paths):
    emailblock = f"    email {email}\n" if email else ""
    if logpath and logpath.lower() not in ("kapali", "kapalı"):
        logblock = f"    log {{\n        output file {logpath}\n    }}\n"
    else:
        logblock = ""
    handles = "".join(
        f"    handle {p}* {{\n        reverse_proxy {backend}\n    }}\n" for p in paths
    )
    return (f"# {MARK}: {domain}\n"
            f"{domain} {{\n"
            f"{emailblock}"
            f"    encode zstd gzip\n"
            f"    root * {landing}\n"
            f"    file_server\n"
            f"{handles}"
            f"{logblock}"
            f"}}\n")


def _caddy_ensure(text, domain, backend, landing, logpath, email, paths):
    """Site blogunu EKLEMELI guncelle. Degisiklik yoksa metin AYNEN doner."""
    lines = (text or "").splitlines()
    span = _caddy_find_site(lines, domain)
    if not span:
        head = "\n".join(lines).rstrip("\n")
        sep = "\n\n" if head else ""
        return head + sep + _caddy_block(domain, backend, landing, logpath, email, paths)
    start, end = span
    block = lines[start:end + 1]
    add = []
    for p in paths:
        if not any(f"handle {p}" in ln for ln in block):
            add.append(f"    handle {p}* {{\n        reverse_proxy {backend}\n    }}")
    if not add:
        return text
    new_lines = lines[:end] + add + lines[end:]
    return "\n".join(new_lines) + "\n"


def _nginx_find_site(lines, domain):
    for i, ln in enumerate(lines):
        if ln.strip().startswith("server") and "{" in ln:
            end = _span_by_braces(lines, i)
            if any(f"server_name {domain}" in b for b in lines[i:end + 1]):
                return i, end
    return None


def _nginx_block(domain, backend, landing, paths):
    locs = "".join(
        f"    location {p} {{\n"
        f"        proxy_pass http://{backend};\n"
        f"        proxy_set_header Host $host;\n"
        f"        proxy_set_header X-Real-IP $remote_addr;\n"
        f"    }}\n" for p in paths
    )
    return (f"# {MARK}: {domain}\n"
            f"server {{\n"
            f"    listen 80;\n"
            f"    listen [::]:80;\n"
            f"    server_name {domain};\n"
            f"    root {landing};\n"
            f"    index index.html;\n\n"
            f"{locs}"
            f"}}\n")


def _nginx_ensure(text, domain, backend, landing, paths):
    lines = (text or "").splitlines()
    span = _nginx_find_site(lines, domain)
    if not span:
        head = "\n".join(lines).rstrip("\n")
        sep = "\n\n" if head else ""
        return head + sep + _nginx_block(domain, backend, landing, paths)
    start, end = span
    block = lines[start:end + 1]
    add = []
    for p in paths:
        if not any(ln.strip().startswith(f"location {p}") for ln in block):
            add.append(f"    location {p} {{\n"
                       f"        proxy_pass http://{backend};\n"
                       f"        proxy_set_header Host $host;\n"
                       f"        proxy_set_header X-Real-IP $remote_addr;\n"
                       f"    }}")
    if not add:
        return text
    new_lines = lines[:end] + add + lines[end:]
    return "\n".join(new_lines) + "\n"


def _apache_vhost_block(domain, backend, landing, paths):
    rules = "".join(
        f"    ProxyPass {p} http://{backend}/\n"
        f"    ProxyPassReverse {p} http://{backend}/\n" for p in paths
    )
    return (f"# {MARK}: {domain}\n"
            f"<VirtualHost *:80>\n"
            f"    ServerName {domain}\n"
            f"    DocumentRoot {landing}\n\n"
            f"    ProxyPreserveHost On\n"
            f"{rules}\n"
            f"    <Directory {landing}>\n"
            f"        Require all granted\n"
            f"    </Directory>\n"
            f"</VirtualHost>\n")


def _apache_ensure(text, domain, backend, landing, paths):
    """Domain vhost'larina EKSIK ProxyPass satirlarini ekler (silme yok)."""
    lines = (text or "").splitlines()
    targets = []
    i = 0
    while i < len(lines):
        if lines[i].strip().lower().startswith("<virtualhost"):
            j = i
            while j < len(lines) and "</virtualhost>" not in lines[j].strip().lower():
                j += 1
            if any(f"ServerName {domain}" in b for b in lines[i:j + 1]):
                targets.append((i, j))
            i = j + 1
            continue
        i += 1
    if not targets:
        head = "\n".join(lines).rstrip("\n")
        sep = "\n\n" if head else ""
        return head + sep + _apache_vhost_block(domain, backend, landing, paths)
    add_map = {}
    for start, end in targets:
        block = lines[start:end + 1]
        add = []
        for p in paths:
            if not any(f"ProxyPass {p}" in ln for ln in block):
                add.append(f"    ProxyPass {p} http://{backend}/")
                add.append(f"    ProxyPassReverse {p} http://{backend}/")
        if add:
            add_map[end] = add
    if not add_map:
        return text
    out = []
    for idx, ln in enumerate(lines):
        if idx in add_map:
            out.extend(add_map[idx])
        out.append(ln)
    return "\n".join(out) + "\n"


def install_caddy(vps_run, log, domain, backend, landing, logpath, email, paths=None):
    paths = tuple(paths or PROFILES["stremio"])
    if not shutil.which("curl"):
        pass
    rc, out = vps_run("command -v caddy >/dev/null 2>&1 || (apt-get update && apt-get install -y caddy)",
                      timeout=900)
    log(out[-1500:])
    if rc != 0:
        return False, "caddy-install-failed"
    vps_run("systemctl enable --now caddy", timeout=120)
    ok, err = _write_landing(vps_run, log, landing)
    if not ok:
        return False, "landing-failed"
    ts = time.strftime("%Y%m%d_%H%M%S")
    _backup(vps_run, "/etc/caddy/Caddyfile", ts)
    rc, current = vps_run("cat /etc/caddy/Caddyfile 2>/dev/null || true", timeout=60)
    current = current or ""
    if logpath and logpath.lower() not in ("kapali", "kapalı"):
        vps_run(f"mkdir -p $(dirname {logpath}) 2>/dev/null || true", timeout=30)
    # 1.87: EKLEMELI yama — yalnizca EKSIK prof yol(lari) eklenir; mevcut
    # (baska profilin) handle'lari ASLA silinmez.
    new_text = _caddy_ensure(current, domain, backend, landing, logpath, email, paths)
    if new_text == current:
        log("==> Caddyfile zaten guncel: prof yolu mevcut, yazma/reload atlandi")
        return True, ""
    rc, out = vps_run("cat > /etc/caddy/Caddyfile", new_text, timeout=60)
    if rc != 0:
        return False, "caddyfile-write-failed"
    rc, out = vps_run("caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile", timeout=120)
    log(out[-1500:])
    if rc != 0:
        vps_run(f"cp -a /etc/caddy/Caddyfile.bak_{ts} /etc/caddy/Caddyfile", timeout=60)
        return False, "caddy-validate-failed"
    vps_run("ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true", timeout=60)
    rc, out = vps_run("systemctl reload caddy", timeout=120)
    if rc != 0:
        log(out[-1500:])
        return False, "caddy-reload-failed"
    return True, ""


def install_nginx(vps_run, log, domain, backend, landing, logpath, email, paths=None):
    paths = tuple(paths or PROFILES["stremio"])
    rc, out = vps_run("command -v nginx >/dev/null 2>&1 || (apt-get update && apt-get install -y nginx)",
                      timeout=900)
    log(out[-1500:])
    if rc != 0:
        return False, "nginx-install-failed"
    ok, err = _write_landing(vps_run, log, landing)
    if not ok:
        return False, "landing-failed"
    ts = time.strftime("%Y%m%d_%H%M%S")
    path = f"/etc/nginx/sites-available/{domain}"
    _backup(vps_run, path, ts)
    rc, current = vps_run(f"cat {path} 2>/dev/null || true", timeout=60)
    current = current or ""
    # 1.87: EKLEMELI yama (yalniz eksik location'lar eklenir).
    conf = _nginx_ensure(current, domain, backend, landing, paths)
    if conf == current:
        log("==> nginx sitesi zaten guncel: profil yolu mevcut, yazma/reload atlandi")
        return True, ""
    rc, out = vps_run(f"cat > {path}", conf, timeout=60)
    if rc != 0:
        return False, "nginx-write-failed"
    vps_run(f"ln -sf {path} /etc/nginx/sites-enabled/{domain}", timeout=30)
    rc, out = vps_run("nginx -t", timeout=120)
    log(out[-1500:])
    if rc != 0:
        vps_run(f"rm -f /etc/nginx/sites-enabled/{domain}", timeout=30)
        return False, "nginx-test-failed"
    vps_run("ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true", timeout=60)
    rc, out = vps_run("systemctl reload nginx || systemctl restart nginx", timeout=120)
    if rc != 0:
        log(out[-1500:])
        return False, "nginx-reload-failed"
    return True, ""


def install_apache2(vps_run, log, domain, backend, landing, logpath, email, paths=None):
    paths = tuple(paths or PROFILES["stremio"])
    rc, out = vps_run("command -v apache2 >/dev/null 2>&1 || (apt-get update && apt-get install -y apache2)",
                      timeout=900)
    log(out[-1500:])
    if rc != 0:
        return False, "apache-install-failed"
    ok, err = _write_landing(vps_run, log, landing)
    if not ok:
        return False, "landing-failed"
    vps_run("a2enmod proxy proxy_http headers ssl rewrite >/dev/null 2>&1 || true", timeout=60)
    ts = time.strftime("%Y%m%d_%H%M%S")
    path = f"/etc/apache2/sites-available/{domain}.conf"
    _backup(vps_run, path, ts)
    rc, current = vps_run(f"cat {path} 2>/dev/null || true", timeout=60)
    current = current or ""
    # 1.87: EKLEMELI yama (yalniz eksik ProxyPass/ProxyPassReverse eklenir).
    conf = _apache_ensure(current, domain, backend, landing, paths)
    if conf == current:
        log("==> apache sitesi zaten guncel: profil yolu mevcut, yazma/reload atlandi")
        return True, ""
    rc, out = vps_run(f"cat > {path}", conf, timeout=60)
    if rc != 0:
        return False, "apache-write-failed"
    vps_run(f"a2ensite {domain} >/dev/null 2>&1 || true", timeout=60)
    rc, out = vps_run("apache2ctl configtest", timeout=120)
    log(out[-1500:])
    if rc != 0:
        vps_run(f"a2dissite {domain} >/dev/null 2>&1 || true", timeout=60)
        return False, "apache-test-failed"
    vps_run("ufw allow 80/tcp >/dev/null 2>&1 || true; ufw allow 443/tcp >/dev/null 2>&1 || true", timeout=60)
    rc, out = vps_run("systemctl reload apache2 || systemctl restart apache2", timeout=120)
    if rc != 0:
        log(out[-1500:])
        return False, "apache-reload-failed"
    return True, ""


def _certbot(vps_run, log, server, domain, email):
    """Let's Encrypt sertifikasi (nginx/apache icin). Caddy kendi alir."""
    pkg = {"nginx": "python3-certbot-nginx", "apache2": "python3-certbot-apache"}.get(server)
    if not pkg:
        return True
    if not email:
        log("UYARI: e-posta verilmedi — certbot e-postasiz kayit kullanilacak "
            "(--register-unsafely-without-email)")
    rc, out = vps_run(
        f"command -v certbot >/dev/null 2>&1 || "
        f"(apt-get update && apt-get install -y certbot {pkg})", timeout=900)
    log(out[-1500:])
    if rc != 0:
        return False
    flag = "--nginx" if server == "nginx" else "--apache"
    reg = f"-m '{email}'" if email else "--register-unsafely-without-email"
    rc, out = vps_run(
        f"certbot {flag} -d {domain} --non-interactive --agree-tos "
        f"--redirect {reg}", timeout=600)
    log(out[-2000:])
    return rc == 0


def install_web_stack(vps_run, log, server, domain, backend, landing, logpath, email, profile="stremio"):
    """Secilen web sunucusunu kurar; YALNIZ profilin yollarini ekler (1.87).

    profile: stremio | calendar | webhook — mevcut yollar korunur, silinmez.
    (ok, error_code) dondurur.
    """
    if server not in WEB_SERVERS:
        return False, "bad-web-server"
    paths = _profile_paths(profile)
    _step(log, "webserver", "run")
    log(f"==> profil: {profile} (yollar: {', '.join(paths)})")
    fn = {"caddy": install_caddy, "nginx": install_nginx, "apache2": install_apache2}[server]
    ok, err = fn(vps_run, log, domain, backend, landing, logpath, email, paths=paths)
    if not ok:
        _step(log, "webserver", "fail")
        return False, err
    if server in ("nginx", "apache2"):
        if not _certbot(vps_run, log, server, domain, email):
            _step(log, "webserver", "fail")
            return False, "certbot-failed"
    _step(log, "webserver", "ok")
    return True, ""


# --------------------------------------------------------------------------
# ters tunel (autossh) — Pi tarafi
# --------------------------------------------------------------------------

def _apt_install(log, package):
    rc = _pi_run(["bash", "-lc", f"command -v {package} >/dev/null 2>&1 || "
                                 f"(apt-get update && apt-get install -y {package})"], timeout=900)
    log((rc.stdout or "")[-1200:])
    return rc.returncode == 0


def write_tunnel_key(secret, log):
    """VPS profil anahtarini /root/.ssh/vps_tunnel (600) olarak yazar."""
    _step(log, "tunnel-key", "run")
    try:
        os.makedirs("/root/.ssh", mode=0o700, exist_ok=True)
        try:
            os.chmod("/root/.ssh", 0o700)
        except Exception:
            pass
        text = secret if secret.endswith("\n") else secret + "\n"
        with open(TUNNEL_KEY, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(TUNNEL_KEY, 0o600)
    except Exception as e:
        log(f"HATA: tünel anahtarı yazılamadı: {str(e)[:200]}")
        _step(log, "tunnel-key", "fail")
        return False
    _step(log, "tunnel-key", "ok")
    return True


def write_known_hosts(host, port, log):
    """ssh-keyscan ile /root/.ssh/known_hosts_vps uretir."""
    _step(log, "tunnel-known-hosts", "run")
    try:
        pr = _pi_run(["bash", "-lc",
                      f"ssh-keyscan -p {int(port)} -T 8 {host} > {TUNNEL_KNOWN_HOSTS} 2>/dev/null"],
                     timeout=60)
        if pr.returncode != 0 or not os.path.exists(TUNNEL_KNOWN_HOSTS) \
                or os.path.getsize(TUNNEL_KNOWN_HOSTS) == 0:
            log("HATA: known_hosts üretilemedi (ssh-keyscan)")
            _step(log, "tunnel-known-hosts", "fail")
            return False
        os.chmod(TUNNEL_KNOWN_HOSTS, 0o600)
    except Exception as e:
        log(f"HATA: known_hosts: {str(e)[:200]}")
        _step(log, "tunnel-known-hosts", "fail")
        return False
    _step(log, "tunnel-known-hosts", "ok")
    return True


def write_tunnel_unit(profile, port, log):
    """Unit'i sablondan uretir + daemon-reload + enable --now."""
    _step(log, "tunnel-unit", "run")
    try:
        template = _read_template()
    except Exception as e:
        log(f"HATA: tünel şablonu okunamadı: {str(e)[:200]}")
        _step(log, "tunnel-unit", "fail")
        return False
    unit = _render(template, {
        "VPS_HOST": profile["host"],
        "VPS_PORT": profile["port"],
        "VPS_USER": profile["username"],
        "KEY": TUNNEL_KEY,
        "KNOWN_HOSTS": TUNNEL_KNOWN_HOSTS,
        "PORT": port,
        "AUTOSSH": AUTOSSH_BIN,
    })
    try:
        with open(TUNNEL_UNIT, "w", encoding="utf-8") as f:
            f.write(unit)
        _pi_run(["systemctl", "daemon-reload"], timeout=60)
        # enable + restart: birim dosyasi degistiyse calisan surec de yeni ayari alir.
        _pi_run(["systemctl", "enable", "nextep-tunnel"], timeout=60)
        rc = _pi_run(["systemctl", "restart", "nextep-tunnel"], timeout=120)
        log(((rc.stdout or "") + (rc.stderr or ""))[-1200:])
        if rc.returncode != 0:
            _step(log, "tunnel-unit", "fail")
            return False
    except Exception as e:
        log(f"HATA: tünel unit yazılamadı: {str(e)[:200]}")
        _step(log, "tunnel-unit", "fail")
        return False
    _step(log, "tunnel-unit", "ok")
    return True


def install_tunnel(profile, secret, port, log):
    """autossh kur + anahtar + known_hosts + unit. (ok, err) dondurur."""
    _step(log, "tunnel-deps", "run")
    if not _apt_install(log, "autossh"):
        log("HATA: autossh kurulamadı")
        _step(log, "tunnel-deps", "fail")
        return False, "autossh-install-failed"
    _step(log, "tunnel-deps", "ok")
    if not write_tunnel_key(secret, log):
        return False, "tunnel-key-failed"
    if not write_known_hosts(profile["host"], profile["port"], log):
        return False, "known-hosts-failed"
    if not write_tunnel_unit(profile, port, log):
        return False, "tunnel-unit-failed"
    return True, ""


def tunnel_active():
    try:
        pr = _pi_run(["systemctl", "is-active", "nextep-tunnel"], timeout=15)
        return (pr.stdout or "").strip().startswith("active")
    except Exception:
        return False


def tunnel_installed():
    return os.path.exists(TUNNEL_UNIT)


def remove_tunnel(log):
    """Kill-switch: tunel unit + kimlikleri sil."""
    _pi_run(["systemctl", "disable", "--now", "nextep-tunnel"], timeout=120)
    for path in (TUNNEL_UNIT, TUNNEL_KEY, TUNNEL_KNOWN_HOSTS):
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            log(f"UYARI: {path} silinemedi: {str(e)[:120]}")
    _pi_run(["systemctl", "daemon-reload"], timeout=60)
    log("==> Ters tünel ve kimlikleri kaldırıldı")
    return True


# --------------------------------------------------------------------------
# Pi WireGuard istemcisi (sh/nextep_remote.sh muadili)
# --------------------------------------------------------------------------

def install_pi_wg_client(log):
    """Pi'de /root/nextep.conf -> /etc/wireguard/nextep.conf + wg-quick@nextep."""
    if not os.path.exists(WG_SRC):
        log("HATA: /root/nextep.conf yok")
        return False
    try:
        with open(WG_SRC, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception as e:
        log(f"HATA: nextep.conf okunamadı: {str(e)[:160]}")
        return False
    if "0.0.0.0/0" in text:
        log("HATA: conf 0.0.0.0/0 içeriyor — tam tünel reddedildi")
        return False
    if not _apt_install(log, "wg"):
        log("HATA: wireguard kurulamadı")
        return False
    os.makedirs("/etc/wireguard", mode=0o700, exist_ok=True)
    changed = 1
    if os.path.exists(WG_CONF):
        try:
            with open(WG_CONF, "r", encoding="utf-8", errors="replace") as f:
                if f.read() == text:
                    changed = 0
        except Exception:
            pass
    if changed:
        if os.path.exists(WG_CONF):
            shutil.copy2(WG_CONF, WG_CONF + ".bak_" + time.strftime("%Y%m%d_%H%M%S"))
        with open(WG_CONF, "w", encoding="utf-8") as f:
            f.write(text)
        os.chmod(WG_CONF, 0o600)
    active = _pi_run(["systemctl", "is-active", "wg-quick@nextep"], timeout=15).stdout or ""
    if changed and active.strip() == "active":
        _pi_run(["systemctl", "restart", "wg-quick@nextep"], timeout=120)
        _pi_run(["systemctl", "enable", "wg-quick@nextep"], timeout=60)
    else:
        rc = _pi_run(["systemctl", "enable", "--now", "wg-quick@nextep"], timeout=120)
        if rc.returncode != 0:
            log(((rc.stdout or "") + (rc.stderr or ""))[-800:])
            return False
    log("==> wg-quick@nextep aktif")
    return True


# --------------------------------------------------------------------------
# WireGuard hub kurulumu (VPS) — sh/vps_setup.sh setup_wg muadili
# --------------------------------------------------------------------------

_WG_GATHER = r"""
set -e
IF=""
for i in 0 1 2 3 4 5 6 7 8 9; do
  [ -e /etc/wireguard/wg$i.conf ] && continue
  ip link show wg$i >/dev/null 2>&1 && continue
  IF="wg$i"; break
done
[ -n "$IF" ] || { echo "ABORT:no-iface"; exit 1; }
NET=""
for n in $(seq 10 30); do
  b="10.$n.$n"
  if ! ip route show 2>/dev/null | grep -q "$b\." && ! grep -rh "$b\." /etc/wireguard/*.conf 2>/dev/null | grep -q .; then NET="$b.0/24"; break; fi
done
[ -n "$NET" ] || { echo "ABORT:no-subnet"; exit 1; }
PORT=""
for p in $(seq 53119 53219); do ss -uln 2>/dev/null | grep -q ":$p " && continue; PORT=$p; break; done
[ -n "$PORT" ] || { echo "ABORT:no-port"; exit 1; }
VIP="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null | tr -d '[:space:]')"
echo "$VIP" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' || VIP=""
HUB=""
if ip link show wg0 >/dev/null 2>&1 || [ -e /etc/wireguard/wg0.conf ]; then
  ha="$(grep -m1 -E '^[[:space:]]*Address[[:space:]]*=' /etc/wireguard/wg0.conf 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
  hb="$(printf '%s' "$ha" | cut -d/ -f1 | cut -d. -f1-3)"
  case "$hb" in [0-9]*.[0-9]*.[0-9]*) HUB="$hb.0/24";; esac
fi
umask 077; mkdir -p /etc/wireguard
VP="$(wg genkey)"; VU="$(printf '%s' "$VP" | wg pubkey)"
PP="$(wg genkey)"; PU="$(printf '%s' "$PP" | wg pubkey)"
echo "IF=$IF"; echo "NET=$NET"; echo "PORT=$PORT"; echo "VIP=$VIP"; echo "HUB=$HUB"
echo "VP=$VP"; echo "VU=$VU"; echo "PP=$PP"; echo "PU=$PU"
"""


def setup_vps_wg(vps_run, log, vps_ip_hint=""):
    """VPS'te WG hub arayuzu + Pi conf uretir. (ok, err) dondurur."""
    rc, out = vps_run("command -v wg >/dev/null 2>&1 || (apt-get update && apt-get install -y wireguard)",
                      timeout=900)
    log(out[-1200:])
    if rc != 0:
        return False, "wg-install-failed"
    rc, out = vps_run(_WG_GATHER, timeout=180)
    if "ABORT:" in out:
        return False, out.strip().split("ABORT:")[-1].split()[0][:40]
    vals = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()
    need = ("IF", "NET", "PORT", "VP", "VU", "PP", "PU")
    if not all(vals.get(k) for k in need):
        log(out[-1500:])
        return False, "wg-detect-failed"
    iface = vals["IF"]
    net = vals["NET"]
    port = vals["PORT"]
    vip = vps_ip_hint or vals.get("VIP") or ""
    if not re.match(r"^\d+(\.\d+){3}$", vip or ""):
        return False, "no-vps-ip"
    base3 = net.split("/")[0].rsplit(".", 1)[0]
    vps_ip = base3 + ".1"
    pi_ip = base3 + ".2"
    pi_allowed = net
    if vals.get("HUB"):
        pi_allowed = net + ", " + vals["HUB"]
    ts = time.strftime("%Y%m%d_%H%M%S")
    vps_conf = (
        f"# {MARK} (nextep uzaktan baglanti)\n"
        f"[Interface]\nPrivateKey = {vals['VP']}\nAddress = {vps_ip}/24\nListenPort = {port}\n\n"
        f"[Peer]\n# Pi (nextep.conf)\nPublicKey = {vals['PU']}\nAllowedIPs = {pi_ip}/32\n")
    pi_conf = (
        f"# {MARK} (Pi istemci conf)\n"
        f"[Interface]\nPrivateKey = {vals['PP']}\nAddress = {pi_ip}/24\n\n"
        f"[Peer]\nPublicKey = {vals['VU']}\nEndpoint = {vip}:{port}\n"
        f"AllowedIPs = {pi_allowed}\nPersistentKeepalive = 25\n")
    vps_run(f"cp -a /etc/wireguard/{iface}.conf /etc/wireguard/{iface}.conf.bak_{ts} 2>/dev/null || true",
            timeout=60)
    rc, out = vps_run(f"cat > /etc/wireguard/{iface}.conf && chmod 600 /etc/wireguard/{iface}.conf",
                      vps_conf, timeout=60)
    if rc != 0:
        return False, "wg-conf-write-failed"
    rc, out = vps_run("cat > /root/nextep.conf && chmod 600 /root/nextep.conf", pi_conf, timeout=60)
    if rc != 0:
        return False, "wg-piconf-write-failed"
    apply_cmd = (f"ufw allow {port}/udp >/dev/null 2>&1 || true; "
                 f"systemctl enable --now wg-quick@{iface} 2>&1; wg show {iface} >/dev/null 2>&1 && echo WG-OK")
    rc, out = vps_run(apply_cmd, timeout=180)
    log(out[-1200:])
    if "WG-OK" not in out:
        return False, "wg-start-failed"
    log(f"==> VPS {iface} aktif (subnet {net}, port {port})")
    return True, ""


# --------------------------------------------------------------------------
# VPS durum kontrolu (yapisal) — string scraping yerine
# --------------------------------------------------------------------------

def check_vps(vps_run):
    """{"caddy":bool,"stremio":bool,"wg":str,"web":detected,"routes":{...}} dondurur."""
    out = {"caddy": False, "stremio": False, "wg": "", "web": None, "routes": {}}
    try:
        rc, o = vps_run("command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy && echo CADDY-OK || true",
                        timeout=30)
        out["caddy"] = "CADDY-OK" in o
    except Exception:
        pass
    try:
        rc, o = vps_run("grep -q 'handle /stremio/\\*' /etc/caddy/Caddyfile 2>/dev/null && echo ST-OK || true",
                        timeout=30)
        out["stremio"] = "ST-OK" in o
    except Exception:
        pass
    # 1.87: profil yollari (caddy/nginx/apache) — kartlarin "Kurulu mu?" durumu
    try:
        rc, o = vps_run(
            "cat /etc/caddy/Caddyfile /etc/nginx/sites-enabled/* "
            "/etc/apache2/sites-enabled/* 2>/dev/null "
            "| grep -E 'handle /|location /|ProxyPass /' | head -60 || true",
            timeout=30)
        txt = o or ""
        out["routes"] = {
            "stremio": "/stremio/" in txt,
            "calendar": "/calendar/" in txt,
            "webhook": "/webhook/" in txt,
        }
    except Exception:
        out["routes"] = {}
    try:
        rc, o = vps_run("grep -l 'nextep-vps-setup' /etc/wireguard/*.conf 2>/dev/null | head -1", timeout=30)
        base = os.path.basename((o or "").strip().splitlines()[0]) if (o or "").strip() else ""
        out["wg"] = base[:-5] if base.endswith(".conf") else ""
    except Exception:
        pass
    try:
        out["web"] = detect_web(vps_run)
    except Exception:
        pass
    return out


# --------------------------------------------------------------------------
# "Sunucu Degistir" — yerel teardown
# --------------------------------------------------------------------------

def teardown_vps(vps_run, log):
    """VPS tarafinda YALNIZ NextEp yonetimli izleri siler.

    - `# nextep-vps-setup` imzali WG arayuzu(leri)
    - /root/nextep.conf
    Web sunucusu yapilandirmasina DOKUNULMAZ (baska amacla kullaniliyor olabilir).
    """
    try:
        rc, out = vps_run(f"grep -l '{MARK}' /etc/wireguard/*.conf 2>/dev/null || true", timeout=60)
    except Exception as e:
        log(f"UYARI: VPS WG taramasi: {str(e)[:160]}")
        out = ""
    for line in (out or "").splitlines():
        path = line.strip()
        m = re.match(r"^/etc/wireguard/([A-Za-z0-9_.-]+)\.conf$", path)
        if not m:
            continue
        iface = m.group(1)
        log(f"==> VPS WG arayuzu kaldiriliyor: {iface}")
        vps_run(f"systemctl disable --now wg-quick@{iface} 2>/dev/null || true", timeout=120)
        vps_run(f"ip link delete {iface} 2>/dev/null || true", timeout=60)
        vps_run(f"rm -f /etc/wireguard/{iface}.conf", timeout=60)
    vps_run("rm -f /root/nextep.conf", timeout=60)
    log("==> VPS izleri temizlendi (web sunucusuna dokunulmadi)")
    return True


def teardown_local(log):
    """Sunucu degisiminde Pi'de kalan izleri siler (idempotent)."""
    _pi_run(["systemctl", "disable", "--now", "nextep-tunnel"], timeout=120)
    _pi_run(["systemctl", "disable", "--now", "wg-quick@nextep"], timeout=120)
    for path in (TUNNEL_UNIT, TUNNEL_KEY, TUNNEL_KNOWN_HOSTS, WG_CONF, WG_SRC):
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            log(f"UYARI: {path} silinemedi: {str(e)[:120]}")
    _pi_run(["systemctl", "daemon-reload"], timeout=60)
    log("==> Yerel izler temizlendi (tünel + WG)")
    return True
