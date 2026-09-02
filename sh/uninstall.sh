#!/usr/bin/env bash
# uninstall.sh - Nextep tam kaldirma (her seyi siler, soru sormaz)
# Kullanim: sudo bash uninstall.sh
set -e

APP_DIR="/etc/nextep"

echo "==> Kok yetkisi kontrol ediliyor..."
if [ "$(id -u)" -ne 0 ]; then
  echo "Lutfen sudo ile calistirin: sudo bash $0"
  exit 1
fi

echo "==> Servis durduruluyor..."
systemctl stop nextep 2>/dev/null || true
systemctl disable nextep 2>/dev/null || true

echo "==> Systemd servisi siliniyor..."
rm -f /etc/systemd/system/nextep.service
systemctl daemon-reload 2>/dev/null || true

echo "==> $APP_DIR siliniyor (db, posterler, bak, backup, restore dahil - her sey)..."
rm -rf "$APP_DIR"

echo "==> Dogrulama..."
if [ -d "$APP_DIR" ]; then
  echo "!! $APP_DIR hala var, silinemedi." >&2
  ls -la "$APP_DIR" >&2 || true
  exit 1
fi
if systemctl list-unit-files 2>/dev/null | grep -q "^nextep.service"; then
  echo "!! nextep.service hala kayitli." >&2
  exit 1
fi

echo "==> Uninstall tamamlandi: $APP_DIR ve nextep.service silindi."
echo "==> Not: python3/python3-venv/curl gibi sistem paketleri korunur."
