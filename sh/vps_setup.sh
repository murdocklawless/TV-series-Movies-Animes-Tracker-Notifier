#!/usr/bin/env bash
# vps_setup.sh — VPS etkileşimli kurulum (Caddy/Stremio + uzaktan bağlantı WireGuard)
#
# Kullanım (VPS'te root):
#   bash vps_setup.sh            # menü (eksik olanı sorar)
#   bash vps_setup.sh --check    # yalnız durum gösterir, değişiklik YAPMAZ
#   Web UI (etkileşimsiz, soru YOK):
#   bash vps_setup.sh --install-wg --auto [--port N] [--vps-ip IP]
#   bash vps_setup.sh --install-stremio --auto --domain D [--email E] [--landing L] [--backend B] [--logpath P]
#
# İlkeler (değişmez):
#   - HAZIR DEĞER YOK: tüm sorular elden yazılır (yalnız LE e-postası boş geçilebilir).
#     Tespit sonuçları yalnız HİNT olarak gösterilir, kutuya doldurulmaz.
#   - İdempotent: tekrar çalıştırınca kurulmuş olan atlanır, yalnız eksik önerilir.
#   - Her yazma öncesi yedek alınır. Sır (anahtar) repoya girmez, yalnız VPS'te durur.
#   - Tespit işleve bakar (program+servis+blok); imza `# nextep-vps-setup`
#     yalnız güvenli yeniden yazma içindir, başkasının ayarına dokunulmaz.
set -uo pipefail

MARK="nextep-vps-setup"
CADDYFILE="/etc/caddy/Caddyfile"
WGDIR="/etc/wireguard"
CHECK_ONLY=0
AUTO=0
INSTALL_WG=0
INSTALL_STREMIO=0
ARG_PORT=""
ARG_VPSIP=""
ARG_DOMAIN=""
ARG_EMAIL=""
ARG_LANDING=""
ARG_BACKEND=""
ARG_LOGPATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --auto|--yes) AUTO=1; shift ;;
    --install-wg) INSTALL_WG=1; shift ;;
    --install-stremio) INSTALL_STREMIO=1; shift ;;
    --port) ARG_PORT="${2:-}"; shift 2 ;;
    --vps-ip) ARG_VPSIP="${2:-}"; shift 2 ;;
    --domain) ARG_DOMAIN="${2:-}"; shift 2 ;;
    --email) ARG_EMAIL="${2:-}"; shift 2 ;;
    --landing) ARG_LANDING="${2:-}"; shift 2 ;;
    --backend) ARG_BACKEND="${2:-}"; shift 2 ;;
    --logpath) ARG_LOGPATH="${2:-}"; shift 2 ;;
    *) die "bilinmeyen bayrak: $1" ;;
  esac
done

die() { echo "HATA: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "UYARI: $*" >&2; }

need_root() {
  [[ "$(id -u)" -eq 0 ]] || die "root ile çalıştır (sudo bash sh/vps_setup.sh)"
}

# --- soru yardımcıları (hazır değer yok) ---
# ask_req "Soru" "hint" -> değeri stdout'a basar (sorular stderr'e: $() ile yakalanınca kaybolmasın)
ask_req() {
  local q="$1" hint="$2" ans=""
  while [[ -z "$ans" ]]; do
    echo "  ? $q" >&2
    [[ -n "$hint" ]] && echo "    hint: $hint" >&2
    read -r -p "    > " ans || die "girdi kapalı — etkileşimli çalıştır"
    ans="$(echo "$ans" | xargs)"
    [[ -z "$ans" ]] && echo "    (boş bırakılamaz, tekrar yaz)" >&2
  done
  echo "$ans"
}
# ask_opt "Soru" "hint" -> boş olabilir (sorular stderr'e)
ask_opt() {
  local q="$1" hint="$2" ans=""
  echo "  ? $q" >&2
  [[ -n "$hint" ]] && echo "    hint: $hint" >&2
  read -r -p "    > " ans || die "girdi kapalı — etkileşimli çalıştır"
  echo "$ans" | xargs
}
# ask_yesno "Soru" -> E/h (boş kabul edilmez)
ask_yesno() {
  local q="$1" ans=""
  while true; do
    read -r -p "  ? $q [E/h] > " ans || die "girdi kapalı — etkileşimli çalıştır"
    case "$ans" in
      E|e|EVET|evet|Y|y) return 0 ;;
      H|h|HAYIR|hayir|N|n) return 1 ;;
      *) echo "    (E ya da h yaz)" >&2 ;;
    esac
  done
}

# ================= TESPİT (salt okunur) =================
has_cmd() { command -v "$1" >/dev/null 2>&1; }

detect_caddy() {
  has_cmd caddy || return 1
  systemctl is-active --quiet caddy 2>/dev/null || return 1
  return 0
}

detect_stremio() {
  detect_caddy || return 1
  grep -q "handle /stremio/\*" "$CADDYFILE" 2>/dev/null || return 1
  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1 || return 1
  return 0
}

# yönetilen WG arayüzünü bulur (isim basar) ya da 1 döner
detect_wg_iface() {
  local f iface
  for f in "$WGDIR"/*.conf; do
    [[ -e "$f" ]] || continue
    grep -q "$MARK" "$f" 2>/dev/null || continue
    iface="$(basename "$f" .conf)"
    echo "$iface"
    return 0
  done
  return 1
}

detect_wg() {
  local iface
  iface="$(detect_wg_iface)" || return 1
  systemctl is-active --quiet "wg-quick@$iface" 2>/dev/null || return 1
  grep -q "^\[Peer\]" "$WGDIR/$iface.conf" 2>/dev/null || return 1
  return 0
}

status_table() {
  local green="" red="" reset=""
  if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
    green=$'\033[0;32m'; red=$'\033[0;31m'; reset=$'\033[0m'
  fi
  echo "--- durum ---"
  if detect_caddy; then echo "Caddy:      ${green}KURULU${reset}"; else echo "Caddy:      ${red}EKSİK${reset}"; fi
  if detect_stremio; then echo "Stremio:    ${green}KURULU${reset}"; else echo "Stremio:    ${red}EKSİK${reset}"; fi
  local wi
  if wi="$(detect_wg_iface)"; then
    if detect_wg; then echo "WireGuard:  ${green}KURULU${reset} ($wi)"; else echo "WireGuard:  ${red}EKSİK${reset} (conf var: $wi, servis/peer tam değil)"; fi
  else
    echo "WireGuard:  ${red}EKSİK${reset}"
  fi
}

# ================= CADDY + STREMIO =================
vps_public_ip() {
  local ip=""
  ip="$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null | xargs)" || ip=""
  if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -v '^127\.' | grep -v '^10\.' | grep -v '^172\.' | grep -v '^192\.168\.' | head -1)"
  fi
  echo "$ip" | xargs
}

resolve_domain() {
  getent hosts "$1" 2>/dev/null | awk '{print $1}' | head -1
}

install_caddy_pkg() {
  if has_cmd caddy; then info "caddy zaten kurulu"; return 0; fi
  info "caddy kuruluyor (apt)..."
  apt-get update && apt-get install -y caddy || die "caddy kurulamadı"
  systemctl enable --now caddy || die "caddy servisi başlatılamadı"
}

setup_stremio() {
  echo "--- 1. Stremio NextEp plugin kurulumu ---"
  local domain email landing backend logpath vpsip resolved
  if [[ "$AUTO" == "1" ]]; then
    # Etkileşimsiz: zorunlu domain bayraktan, gerisi varsayılanlı (soru YOK).
    domain="$ARG_DOMAIN"
    [[ -n "$domain" ]] || die "ABORT:no-domain (--domain verilmedi)"
    email="$ARG_EMAIL"
    landing="${ARG_LANDING:-/var/www/stremio}"
    backend="${ARG_BACKEND:-127.0.0.1:8050}"
    logpath="${ARG_LOGPATH:-/var/log/caddy/stremio-access.log}"
    info "otomatik: domain=$domain landing=$landing backend=$backend"
  else
    domain="$(ask_req "Domain?" "örn. stremio.ornek.com — DNS yalnızca VPS IP'sine bakmalı, Cloudflare proxy KAPALI (gri bulut)")"
  fi
  vpsip="$(vps_public_ip)"
  if [[ -n "$vpsip" ]]; then
    info "tespit edilen VPS IP: $vpsip"
    resolved="$(resolve_domain "$domain")"
    if [[ -z "$resolved" ]]; then
      warn "$domain çözümlenemedi. DNS kaydını açıp tekrar çalıştır."
      if [[ "$AUTO" == "1" ]]; then echo "ABORT:dns-mismatch (cozulemedi)"; return 1; fi
      ask_yesno "DNS yok, yine de devam edilsin mi? (sertifika alınamaz)" || return 1
    elif [[ "$resolved" != "$vpsip" ]]; then
      warn "$domain -> $resolved çözülüyor, VPS IP ($vpsip) değil."
      echo "     Cloudflare proxy (turuncu bulut) KAPALI olmalı (gri bulut)."
      echo "     DNS'i düzeltip tekrar çalıştır — kuruluma devam edilmiyor."
      echo "ABORT:dns-mismatch"
      return 1
    else
      info "DNS doğrulandı: $domain -> $vpsip"
    fi
  else
    warn "VPS IP tespit edilemedi; DNS'yi elle doğrula ($domain VPS IP'ye bakmalı, proxy kapalı)."
  fi
  if [[ "$AUTO" != "1" ]]; then
    email="$(ask_opt "Let's Encrypt e-posta? (boş geçilebilir)" "örn. ad@ornek.com — sertifika uyarıları için, şart değil")"
    landing="$(ask_req "Landing dizini?" "örn. /var/www/stremio — yoksa oluşturulur")"
    backend="$(ask_req "Backend adres:port?" "örn. 127.0.0.1:8050 — Pi tünel ucu")"
    logpath="$(ask_req "Access log yolu? (kapalı yazılabilir)" "örn. /var/log/caddy/stremio-access.log")"
  fi

  install_caddy_pkg

  if ! curl -s -o /dev/null --max-time 5 "http://$backend/" 2>/dev/null; then
    warn "backend'e ulaşılamadı (http://$backend/) — Pi tüneli çalışmıyor olabilir. Kurulum yine de tamamlanır."
  else
    info "backend ulaşılabilir: http://$backend/"
  fi

  [[ -d "$landing" ]] || { info "dizin oluşturuluyor: $landing"; mkdir -p "$landing"; chown caddy:caddy "$landing" 2>/dev/null || true; }

  local ts bak logblock emailblock
  ts="$(date +%Y%m%d_%H%M%S)"
  bak="$CADDYFILE.bak_$ts"
  info "Caddyfile yedekleniyor: $bak"
  cp "$CADDYFILE" "$bak" || die "yedek alınamadı"

  if [[ "$logpath" == "kapalı" || "$logpath" == "kapali" ]]; then logblock=""; else
    mkdir -p "$(dirname "$logpath")" 2>/dev/null || true
    logblock="    log {
        output file $logpath
    }"
  fi
  if [[ -n "$email" ]]; then emailblock="    email $email"; else emailblock=""; fi

  # yönetilen eski bloğu + aynı domainin imzasız bloğu temizle, siteyi ekle
  # (diğer sitelere dokunulmaz; aynı domain iki kez yazılırsa validate patlar)
  local tmp
  tmp="$(mktemp)"
  awk -v mark="$MARK" -v dom="$domain" '
    $0 ~ mark {skip=1}
    $0 == dom " {" {skip=1}
    skip && /^\}/ {skip=0; next}
    !skip {print}
  ' "$CADDYFILE" > "$tmp"
  cat >> "$tmp" <<EOF
# $MARK: $domain (stremio)
$domain {
${emailblock}
    encode zstd gzip
    root * $landing
    file_server
    handle /stremio/* {
        reverse_proxy $backend
    }
${logblock}
}
EOF
  mv "$tmp" "$CADDYFILE"
  info "site bloğu yazıldı: $domain"

  caddy validate --config "$CADDYFILE" --adapter caddyfile || { warn "validate hatalı — yedek geri alınıyor"; cp "$bak" "$CADDYFILE"; systemctl reload caddy 2>/dev/null || true; return 1; }
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  systemctl reload caddy || die "caddy reload başarısız"

  info "HTTPS testi bekleniyor (sertifika ilk alımda biraz sürebilir)..."
  local i code=""
  for i in 1 2 3 4 5 6; do
    code="$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 "https://$domain/stremio/install-info.json" 2>/dev/null)"
    [[ "$code" == "200" ]] && break
    sleep 10
  done
  if [[ "$code" == "200" ]]; then
    info "OK: https://$domain/stremio/install-info.json -> 200"
  else
    warn "test 200 vermedi (son: $code) — DNS/proxy/backend kontrol et"
  fi

  print_pi_sync "$domain"
}

print_pi_sync() {
  local domain="$1"
  echo ""
  echo "=== Pi tarafı (kopyala-yapıştır) ==="
  echo "Pi'ye SSH ile girip çalıştır (DB yedeği + tp_base_url + doğrulama, restart gerekmez):"
  echo ""
  echo "  TS=\$(date +%Y%m%d_%H%M%S); cd /etc/nextep && mkdir -p bak/tpurl_\$TS && cp db/nextep.db bak/tpurl_\$TS/ && \\"
  echo "  sqlite3 db/nextep.db \"INSERT INTO settings(key,value) VALUES('tp_base_url','https://$domain') ON CONFLICT(key) DO UPDATE SET value=excluded.value;\" && \\"
  echo "  sqlite3 db/nextep.db \"SELECT value FROM settings WHERE key='tp_base_url';\""
  echo ""
  echo "Alternatif (arayüz): Ayarlar -> Third Party Apps -> Public Adres = https://$domain"
  echo ""
}

# ================= WIREGUARD =================
first_free_iface() {
  local i
  for i in 0 1 2 3 4 5 6 7 8 9; do
    [[ -e "$WGDIR/wg$i.conf" ]] && continue
    ip link show "wg$i" >/dev/null 2>&1 && continue
    echo "wg$i"
    return 0
  done
  return 1
}

subnet_used() {
  # $1 = 10.10.10.0/24 gibi; kullanımdaysa 0 döner
  local net="$1" base
  base="$(echo "$net" | cut -d/ -f1 | cut -d. -f1-3)"
  ip route show 2>/dev/null | grep -q "$base\." && return 0
  grep -rh "$base\." "$WGDIR"/*.conf 2>/dev/null | grep -q . && return 0
  return 1
}

first_free_subnet() {
  local n
  for n in $(seq 10 30); do
    local net="10.$n.$n.0/24"
    subnet_used "$net" || { echo "$net"; return 0; }
  done
  return 1
}

first_free_port() {
  local p
  for p in $(seq 53119 53219); do
    ss -uln 2>/dev/null | grep -q ":$p " && continue
    echo "$p"
    return 0
  done
  return 1
}

setup_wg() {
  echo "--- 2. NextEp uzaktan bağlantı (WireGuard) kurulumu ---"
  has_cmd wg || { info "wireguard kuruluyor (apt)..."; apt-get update && apt-get install -y wireguard || die "wireguard kurulamadı"; }
  [[ "$(sysctl -n net.ipv4.ip_forward 2>/dev/null)" == "1" ]] || warn "net.ipv4.ip_forward=1 degil — wg0 ile yeni arayuz arasi yonlendirme calismaz (once: sysctl -w net.ipv4.ip_forward=1)"

  local iface net vps_ip pi_ip port hub_net hub_addr hub_base pi_allowed
  iface="$(first_free_iface)" || die "boş wg arayüzü yok (wg0-wg9 dolu)"
  net="$(first_free_subnet)" || die "boş subnet yok"
  port="$(first_free_port)" || die "boş port yok (53119-53219 dolu)"
  vps_ip="$(echo "$net" | cut -d/ -f1 | cut -d. -f1-3).1"
  pi_ip="$(echo "$net" | cut -d/ -f1 | cut -d. -f1-3).2"
  echo "  bulunanlar: arayüz=$iface subnet=$net VPS=$vps_ip Pi=$pi_ip port=$port"
  if [[ "$AUTO" == "1" ]]; then
    # Etkileşimsiz: bayrak > tespit (soru YOK).
    [[ -n "$ARG_PORT" ]] && port="$ARG_PORT"
    while ss -uln 2>/dev/null | grep -q ":$port "; do
      echo "    ($port dolu, yeni boş aranıyor)"
      port="$(first_free_port)" || die "ABORT:port-yok (53119-53219 dolu)"
    done
    info "port otomatik: $port"
  elif ask_yesno "Bulunan boş port $port kullanılsın mı?"; then
    while ss -uln 2>/dev/null | grep -q ":$port "; do
      echo "    ($port o arada dolmuş, yeni boş aranıyor)"
      port="$(first_free_port)" || die "boş port yok (53119-53219 dolu)"
    done
    info "port onaylandı: $port"
  else
    port="$(ask_req "Listen portu?" "örn. 53119 — ss ile boş olduğu görülen")"
    while ss -uln 2>/dev/null | grep -q ":$port "; do
      echo "    ($port kullanımda, başka yaz)"
      port="$(ask_req "Listen portu?" "örn. 53119 — ss ile boş olduğu görülen")"
    done
  fi
  [[ "$port" =~ ^[0-9]+$ ]] && [[ "$port" -ge 1024 && "$port" -le 65535 ]] || die "geçersiz port: $port"

  # Pi conf'taki Endpoint için VPS genel IP (AUTO: bayrak > tespit, soru YOK)
  local detected_ep vps_ep
  detected_ep="$(vps_public_ip)"
  if [[ "$AUTO" == "1" ]]; then
    vps_ep="${ARG_VPSIP:-$detected_ep}"
    [[ "$vps_ep" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "ABORT:no-vps-ip (tespit boş, --vps-ip verilmedi)"
    info "VPS IP otomatik: $vps_ep"
  elif [[ "$detected_ep" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && ask_yesno "Tespit edilen VPS IP $detected_ep kullanılsın mı? (Pi bu adrese bağlanacak)"; then
    vps_ep="$detected_ep"
    info "VPS IP onaylandı: $vps_ep"
  else
    [[ -n "$detected_ep" ]] && echo "  tespit edilen VPS IP: $detected_ep"
    vps_ep="$(ask_req "VPS genel IP? (Pi bu adrese bağlanacak)" "örn. $detected_ep — api.ipify.org açılmıyorsa VPS panelindeki IP")"
    while true; do
      [[ "$vps_ep" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
      echo "    (geçerli IPv4 yaz, örn. $detected_ep)"
      vps_ep="$(ask_req "VPS genel IP? (Pi bu adrese bağlanacak)" "örn. $detected_ep")"
    done
  fi

  # Hub subnet tespiti (telefon yolunun yeni arayüz üzerinden çalışması için).
  # wg0 hub varsa onun /24'ü Pi'nin AllowedIPs'ine eklenir, yoksa yalnız yeni ağ.
  hub_net=""
  if ip link show wg0 >/dev/null 2>&1 || [[ -e "$WGDIR/wg0.conf" ]]; then
    hub_addr="$(grep -m1 -E '^[[:space:]]*Address[[:space:]]*=' "$WGDIR/wg0.conf" 2>/dev/null | cut -d= -f2 | xargs)"
    hub_base="$(echo "$hub_addr" | cut -d/ -f1 | cut -d. -f1-3)"
    if [[ "$hub_base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      hub_net="$hub_base.0/24"
      info "hub subnet tespit edildi: $hub_net (Pi AllowedIPs'e eklenecek)"
    else
      warn "hub adresi okunamadı ($WGDIR/wg0.conf) — Pi yalnız yeni ağa erişir"
    fi
  fi
  pi_allowed="$net"
  [[ -n "$hub_net" ]] && pi_allowed="$net, $hub_net"

  umask 077
  mkdir -p "$WGDIR"
  local vps_priv vps_pub pi_priv pi_pub
  vps_priv="$(wg genkey)"
  vps_pub="$(echo "$vps_priv" | wg pubkey)"
  pi_priv="$(wg genkey)"
  pi_pub="$(echo "$pi_priv" | wg pubkey)"

  local conf="$WGDIR/$iface.conf"
  [[ -e "$conf" ]] && cp "$conf" "$conf.bak_$(date +%Y%m%d_%H%M%S)"
  cat > "$conf" <<EOF
# $MARK (nextep uzaktan baglanti)
[Interface]
PrivateKey = $vps_priv
Address = $vps_ip/24
ListenPort = $port

[Peer]
# Pi (nextep.conf)
PublicKey = $pi_pub
AllowedIPs = $pi_ip/32
EOF
  chmod 600 "$conf"
  info "VPS arayüz conf yazıldı: $conf"

  ufw allow "$port/udp" >/dev/null 2>&1 || true
  # telefonun mevcut wg0 hub'ından yeni ağa geçiş (hub varsa)
  if ip link show wg0 >/dev/null 2>&1 || [[ -e "$WGDIR/wg0.conf" ]]; then
    ufw route allow in on wg0 out on "$iface" >/dev/null 2>&1 || true
    ufw route allow in on "$iface" out on wg0 >/dev/null 2>&1 || true
    info "yönlendirme kuralı eklendi: wg0 <-> $iface"
  else
    warn "wg0 hub bulunamadı — telefon mevcut profille bağlanamaz, yalnız Pi-VPS arası çalışır"
  fi

  systemctl enable --now "wg-quick@$iface" || die "arayüz başlatılamadı: $iface"
  info "$iface aktif"

  local piconf="/root/nextep.conf"
  cat > "$piconf" <<EOF
# $MARK (Pi istemci conf — Pi'de /etc/wireguard/nextep.conf olur, arayüz adı: nextep)
[Interface]
PrivateKey = $pi_priv
Address = $pi_ip/24

[Peer]
PublicKey = $vps_pub
Endpoint = $vps_ep:$port
AllowedIPs = $pi_allowed
PersistentKeepalive = 25
EOF
  chmod 600 "$piconf"

  echo ""
  echo "=== Pi tarafı: /root/nextep.conf oluşturuldu ==="
  cat "$piconf"
  echo ""
  echo "Pi'ye kopyala ve kaldır (Pi'de, arayüz adı dosya adından gelir: nextep):"
  echo "  (yerel PC'den) scp <buradaki nextep.conf> root@<pi-ip>:/etc/wireguard/nextep.conf"
  echo "  (Pi'de) systemctl enable --now wg-quick@nextep && wg show nextep && ping -c2 $vps_ip"
  echo "  (VPS'te, conf Pi'ye kopyalaninca) shred -u $piconf  # ozel anahtar VPS'te kalmasin"
  echo ""
  echo " handshake Pi bağlanınca görünür: wg show $iface"
  ping -c2 -W2 "$pi_ip" >/dev/null 2>&1 && info "Pi'ye ulaşıldı: $pi_ip" || warn "Pi'ye henüz ulaşılamıyor (Pi tarafı kurulunca düzelir)"
  echo ""
  echo "Telefon hatırlatması: mevcut WireGuard profiline AllowedIPs'e $pi_ip/32 ekle -> http://$pi_ip:8050"
}

# ================= MENÜ =================
main() {
  need_root
  if [[ $CHECK_ONLY -eq 1 ]]; then status_table; exit 0; fi
  if [[ $INSTALL_WG -eq 1 || $INSTALL_STREMIO -eq 1 ]]; then
    [[ $AUTO -eq 1 ]] || die "etkileşimsiz kurulum --auto ister"
    [[ $INSTALL_STREMIO -eq 1 ]] && setup_stremio
    [[ $INSTALL_WG -eq 1 ]] && setup_wg
    echo ""
    echo "Bitti. Son durum:"
    status_table
    exit 0
  fi
  status_table
  echo ""
  local need_caddy=0 need_wg=0
  detect_stremio || need_caddy=1
  detect_wg || need_wg=1
  if [[ $need_caddy -eq 0 && $need_wg -eq 0 ]]; then
    echo "Hepsi kurulu — yapılacak iş yok."
    exit 0
  fi
  if [[ $need_caddy -eq 1 && $need_wg -eq 1 ]]; then
    echo "Seç: 1) Stremio plugin  2) Uzaktan bağlantı (WG)  3) Hepsi"
    local sel=""
    while [[ "$sel" != "1" && "$sel" != "2" && "$sel" != "3" ]]; do
      read -r -p "  > " sel || die "girdi kapalı — etkileşimli çalıştır"
      sel="$(echo "$sel" | xargs)"
    done
    [[ "$sel" == "1" || "$sel" == "3" ]] && setup_stremio
    [[ "$sel" == "2" || "$sel" == "3" ]] && setup_wg
  elif [[ $need_caddy -eq 1 ]]; then
    echo "Kurulmayan: Stremio plugin (Caddy+bağlantı). Kurulsun mu?"
    ask_yesno "Kur" && setup_stremio
  else
    echo "Kurulmayan: Uzaktan bağlantı (WireGuard). Kurulsun mu?"
    ask_yesno "Kur" && setup_wg
  fi
  echo ""
  echo "Bitti. Son durum:"
  status_table
}

main "$@"
