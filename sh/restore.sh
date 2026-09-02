#!/usr/bin/env bash
# restore.sh - full yedekten tek komutla geri yukleme (soru sormaz)
# Kullanim: full yedek ile ayni klasore koyun (nextep-full-*.tar.gz yanina)
#   sudo bash restore.sh
# Her yerden calisir: /tmp, /home/pi, baska klasor. /etc/nextep icine konursa otomatik /tmp'ye kopyalanir.
set -e

APP_DIR="/etc/nextep"
PORT="${PORT:-8050}"

# Kendi dizinini bul (sembolik link degil, gercek konum)
RESTORE_SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

# /etc/nextep icine konmussa guvenli calisma icin /tmp'ye kopyala (recursion onleme)
if [ "$RESTORE_SRC_DIR" = "$APP_DIR" ] || [[ "$RESTORE_SRC_DIR" == "$APP_DIR/"* ]]; then
  TMPDIR="/tmp/nextep-restore-$$"
  mkdir -p "$TMPDIR"
  echo "==> Uyari: $RESTORE_SRC_DIR /etc/nextep icinde, guvenli calisma icin $TMPDIR'ye kopyalaniyor..." >&2
  cp -a "$RESTORE_SRC_DIR"/nextep-full-*.tar.gz "$TMPDIR"/ 2>/dev/null || true
  cp -a "$0" "$TMPDIR"/restore.sh
  chmod +x "$TMPDIR"/restore.sh
  exec bash "$TMPDIR"/restore.sh
fi

echo "==> Kok yetkisi kontrol ediliyor..."
if [ "$(id -u)" -ne 0 ]; then
  echo "Lutfen sudo ile calistirin: sudo bash $0"
  exit 1
fi

echo "==> Full yedek araniyor: $RESTORE_SRC_DIR"
LATEST="$(ls -1t "$RESTORE_SRC_DIR"/nextep-full-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "HATA: full yedek bulunamadi: $RESTORE_SRC_DIR/nextep-full-*.tar.gz" >&2
  echo "Icerik:" >&2; ls -1 "$RESTORE_SRC_DIR" >&2 || true
  echo "Ornek: mkdir -p /tmp/restore && cp nextep-full-*.tar.gz restore.sh /tmp/restore/ && sudo bash /tmp/restore/restore.sh" >&2
  exit 1
fi
echo "==> Bulunan yedek: $LATEST"

if ! tar tzf "$LATEST" | grep -q "^db/nextep.db"; then
  echo "HATA: tar bozuk, db/nextep.db yok: $LATEST" >&2
  exit 1
fi

echo "==> Mevcut sistem durduruluyor (varsa)..."
systemctl stop nextep 2>/dev/null || true

if [ -d "$APP_DIR/db" ] && [ -f "$APP_DIR/db/nextep.db" ]; then
  echo "==> Mevcut DB yedekleniyor..."
  mkdir -p "$APP_DIR/bak"
  tar czf "$APP_DIR/bak/pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$APP_DIR" db 2>/dev/null || true
fi

echo "==> Yedek aciliyor -> $APP_DIR (posterler dahil)..."
mkdir -p "$APP_DIR"
# tar icinde venv yok, dogrudan acmak guvenli (venv haric). /tmp kopyasi sayesinde ayni dizin recursion yok.
tar xzf "$LATEST" -C "$APP_DIR"

# Eski venv varsa temizle (yedekte yok)
if [ -d "$APP_DIR/venv" ]; then
  # venv yedekte olmadigi icin gelen venv olmamali, ama varsa onceki kurulumdan kalmistir, sil ve yeniden kur
  rm -rf "$APP_DIR/venv"
fi

cd "$APP_DIR"

echo "==> Python3 ve bagimliliklar kuruluyor..."
apt-get update
apt-get install -y python3 python3-pip python3-venv curl sqlite3

echo "==> Sanal ortam olusturuluyor..."
python3 -m venv venv

echo "==> Bagimliliklar yukleniyor..."
./venv/bin/pip install --upgrade pip >/dev/null
./venv/bin/pip install -r requirements/requirements.txt

echo "==> DB dogrulama..."
if ! sqlite3 "$APP_DIR/db/nextep.db" "PRAGMA integrity_check;" | grep -q "^ok"; then
  echo "HATA: DB butunluk hatasi: $APP_DIR/db/nextep.db" >&2
  exit 1
fi

echo "==> Systemd servisi kuruluyor (port: $PORT)..."
if [ -f "$APP_DIR/service/nextep.service" ]; then
  cp -f "$APP_DIR/service/nextep.service" /etc/systemd/system/nextep.service
else
  cat > /etc/systemd/system/nextep.service <<EOF
[Unit]
Description=NextEp - Dizi/Film/Anime Takip Uygulamasi
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=PYTHONUNBUFFERED=1
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/py/nextep.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
fi
# PYTHONUNBUFFERED yoksa ekle
if ! grep -q PYTHONUNBUFFERED /etc/systemd/system/nextep.service; then
  sed -i '/Environment=PORT=/a Environment=PYTHONUNBUFFERED=1' /etc/systemd/system/nextep.service
fi

systemctl daemon-reload
systemctl enable --now nextep

echo "==> Servis baslatiliyor..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "==> Restore tamamlandi! Yedek: $LATEST"
    echo "==> Uygulama http://$(hostname -I | awk '{print $1}'):$PORT adresinde calisiyor."
    echo "==> DB: $(sqlite3 "$APP_DIR/db/nextep.db" "SELECT count(*) FROM followed;" 2>/dev/null) takip, $(sqlite3 "$APP_DIR/db/nextep.db" "SELECT count(*) FROM anime;" 2>/dev/null) anime"
    echo "==> Posterler: $(find "$APP_DIR/static/images/posters" -type f 2>/dev/null | wc -l) dosya"
    exit 0
  fi
  sleep 1
done

echo "!! Servis basladi ama yanit vermedi. Durum:" >&2
systemctl status nextep --no-pager || true
journalctl -u nextep --no-pager -n 50 || true
exit 1
