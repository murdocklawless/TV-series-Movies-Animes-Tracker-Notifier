#!/usr/bin/env bash
# uninstall.sh - Nextep kaldirma (soru sorar: database silinsin mi?)
# Kullanim: sudo bash uninstall.sh
#   E -> /etc/nextep komple kalkar (db dahil)
#   H -> uygulama kalkar, /etc/nextep/db/nextep.db korunur
set -e

APP_DIR="/etc/nextep"
DB_FILE="$APP_DIR/db/nextep.db"

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

# ---------- Database sorusu ----------
WIPE_DB=""
if [ -t 0 ] && [ -r /dev/tty ]; then
  TRIES="0"
  while [ "$TRIES" -lt 3 ]; do
    printf "Database'i de silmemi istiyor musunuz? (E/H): " > /dev/tty
    ANS="$(head -n 1 /dev/tty 2>/dev/null | tr -d '[:space:]' || true)"
    case "$ANS" in
      [Ee]) WIPE_DB="1"; break ;;
      [Hh]) WIPE_DB=""; break ;;
      *) echo "Lutfen E veya H girin." > /dev/tty ;;
    esac
    TRIES=$((TRIES + 1))
  done
  if [ "$TRIES" -ge 3 ] && [ -z "$WIPE_DB" ] && [ "$ANS" != "H" ] && [ "$ANS" != "h" ]; then
    echo "==> Bilgi: gecerli cevap alinamadi, database korunuyor (H varsayildi)."
  fi
else
  echo "==> Bilgi: terminal yok, database korunuyor (H varsayildi)."
fi

if [ -n "$WIPE_DB" ]; then
  echo "==> $APP_DIR komple siliniyor (db dahil - her sey)..."
  rm -rf "$APP_DIR"
else
  if [ -f "$DB_FILE" ]; then
    echo "==> Uygulama kaldiriliyor, database korunuyor ($DB_FILE)..."
  else
    echo "==> Uyari: database bulunamadi ($DB_FILE yok); uygulama kaldiriliyor..."
  fi
  if [ -d "$APP_DIR" ]; then
    # db/nextep.db disindaki her sey: once db icini temizle, sonra db haric ust dizinleri
    if [ -d "$APP_DIR/db" ]; then
      find "$APP_DIR/db" -mindepth 1 ! -name 'nextep.db' -exec rm -rf {} + 2>/dev/null || true
    fi
    find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name 'db' -exec rm -rf {} + 2>/dev/null || true
    # db bos kaldiysa (nextep.db yoktu) kaldir
    if [ -d "$APP_DIR/db" ] && [ -z "$(ls -A "$APP_DIR/db" 2>/dev/null)" ]; then
      rmdir "$APP_DIR/db" 2>/dev/null || true
    fi
    if [ -d "$APP_DIR" ] && [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
      rmdir "$APP_DIR" 2>/dev/null || true
    fi
  else
    echo "    ($APP_DIR zaten yok.)"
  fi
fi

echo "==> Dogrulama..."
if systemctl list-unit-files 2>/dev/null | grep -q "^nextep.service"; then
  echo "!! nextep.service hala kayitli." >&2
  exit 1
fi
if [ -n "$WIPE_DB" ]; then
  if [ -d "$APP_DIR" ]; then
    echo "!! $APP_DIR hala var, silinemedi." >&2
    ls -la "$APP_DIR" >&2 || true
    exit 1
  fi
  echo "==> Uninstall tamamlandi: $APP_DIR ve nextep.service silindi."
else
  if [ -f "$DB_FILE" ]; then
    if ! sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>/dev/null | grep -q "^ok"; then
      echo "!! Korunan database bozuk: $DB_FILE" >&2
      exit 1
    fi
    echo "==> Uninstall tamamlandi: uygulama kaldirildi, database korundu ($DB_FILE, saglam)."
  else
    echo "==> Uninstall tamamlandi: uygulama kaldirildi (database zaten yoktu)."
  fi
  if [ -d "$APP_DIR/py" ] || [ -d "$APP_DIR/venv" ] || [ -d "$APP_DIR/static" ]; then
    echo "!! Uygulama dizinleri hala duruyor (py/venv/static)." >&2
    ls -la "$APP_DIR" >&2 || true
    exit 1
  fi
fi

echo "==> Not: python3/python3-venv/curl gibi sistem paketleri korunur."
