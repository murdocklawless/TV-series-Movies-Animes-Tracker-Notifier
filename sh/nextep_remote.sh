#!/usr/bin/env bash
# nextep_remote.sh — Pi uzaktan-bağlantı istemcisi kurulumu (WireGuard, Pi'de root)
#
# Kullanim:
#   (yerel PC'den) scp <VPS /root/nextep.conf> /root/nextep.conf   # once conf tasinir
#   (Pi'de root)   bash nextep_remote.sh
#
# Ilkeler:
#   - Soru sorulmaz; girdi yalniz /root/nextep.conf dosyasidir (yoksa hata + talimat).
#   - Idempotent: wireguard kuruluysa atlanir; conf ayniysa yeniden yazilmaz.
#   - Sir repoya girmez: conf scp ile tasinir, bu betik tasinabilir.
#   - Guvenlik: 0.0.0.0/0 AllowedIPs'li conf REDDEDILIR (tum trafigi tunellemek yok).
set -uo pipefail

MARK="nextep-vps-setup"
SRC="/root/nextep.conf"
DST="/etc/wireguard/nextep.conf"
IFACE="nextep"

die() { echo "HATA: $*" >&2; exit 1; }
info() { echo "==> $*"; }
warn() { echo "UYARI: $*" >&2; }

[[ "$(id -u)" -eq 0 ]] || die "root ile calistir (sudo bash nextep_remote.sh)"
[[ -f "$SRC" ]] || die "/root/nextep.conf yok — once VPS'teki conf buraya kopyalanmali: scp <vps:/root/nextep.conf> /root/nextep.conf"
grep -q "0.0.0.0/0" "$SRC" && die "conf 0.0.0.0/0 iceriyor — tam tunel reddedildi, dogru conf kopyala"
grep -q "$MARK" "$SRC" || warn "conf imzasiz ($MARK yok) — devam ediliyor, AllowedIPs satirini gozle dogrula"

if command -v wg >/dev/null 2>&1; then
  info "wireguard zaten kurulu"
else
  info "wireguard kuruluyor (apt)..."
  apt-get update && apt-get install -y wireguard || die "wireguard kurulamadi"
fi

mkdir -p /etc/wireguard
CONF_CHANGED=1
if [[ -f "$DST" ]]; then
  if cmp -s "$SRC" "$DST"; then
    info "conf ayni, yeniden yazilmadi: $DST"
    CONF_CHANGED=0
  else
    cp "$DST" "$DST.bak_$(date +%Y%m%d_%H%M%S)"
    info "mevcut conf yedeklendi, yenisi yaziliyor"
    install -m 600 "$SRC" "$DST"
  fi
else
  info "conf yaziliyor: $DST"
  install -m 600 "$SRC" "$DST"
fi

# Subnet çakışma kontrolü: yeni conf'un ağı başka arayüzde kuruluysa dur
# (kendi arayüzümüzden gelen route idempotent tekrara izin verir).
new_base="$(grep -m1 -E '^[[:space:]]*Address[[:space:]]*=' "$DST" 2>/dev/null | cut -d= -f2 | xargs | cut -d/ -f1 | cut -d. -f1-3)"
if [[ "$new_base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && ip route show 2>/dev/null | grep -q "$new_base\."; then
  ip route show 2>/dev/null | grep -q "$new_base\..* $IFACE" || die "subnet $new_base.0/24 zaten baska arayuzde kurulu — once onu kaldir ya da conf degistir"
fi

# Conf degisti ve arayuz eski conf ile aktifse enable --now yetmez (eski
# anahtarlar kalir) — yeniden baslat gerekir.
if [[ "$CONF_CHANGED" == "1" ]] && systemctl is-active --quiet "wg-quick@$IFACE" 2>/dev/null; then
  warn "arayuz eski conf ile aktifti — yeni conf ile yeniden baslatiliyor"
  systemctl restart "wg-quick@$IFACE" || die "arayuz yeniden baslatilamadi: $IFACE"
  systemctl enable "wg-quick@$IFACE" 2>/dev/null || true
else
  systemctl enable --now "wg-quick@$IFACE" || die "arayuz baslatilamadi: $IFACE"
fi
info "$IFACE aktif"
wg show "$IFACE" || die "wg show basarisiz"

pi_addr="$(grep -m1 -E '^[[:space:]]*Address[[:space:]]*=' "$DST" 2>/dev/null | cut -d= -f2 | xargs | cut -d/ -f1)"
vps_ip="$(echo "$pi_addr" | cut -d. -f1-3).1"
if [[ "$vps_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.1$ ]]; then
  if ping -c2 -W2 "$vps_ip" >/dev/null 2>&1; then
    info "VPS'e ulasildi: $vps_ip"
  else
    warn "VPS'e henuz ulasilamiyor ($vps_ip) — VPS tarafi ve handshake kontrol et: wg show $IFACE"
  fi
else
  warn "VPS IP turetilemedi (Address satiri: $pi_addr)"
fi

echo "Bitti: el sikisma Pi baglaninca VPS'te gorunur (VPS: wg show <arayuz>)."
