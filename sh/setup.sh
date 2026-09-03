#!/usr/bin/env bash
# NextEp - tek betik kurulum / güncelleme (Raspberry Pi, Debian tabanlı)
# Kullanım:
#   sudo bash sh/setup.sh
#   sudo PORT=8051 BRANCH=main REPO_URL=https://...git bash sh/setup.sh
# Davranış:
#   - /etc/nextep yok/boş ise   -> SIFIR KURULUM (boş DB, init_db ilk açılışta oluşturur)
#   - marker dosyaların tümü var -> GÜNCELLEME (bilgi mesajı + yedek + restart)
#   - klasör dolu ama eksik dosya -> TAMAMLAMA (eksikler eklenir, DB korunur)
# Mevcut DB (db/*.db), .env ve .smtp_secret ASLA ezilmez/taşınmaz.
set -e

APP_DIR="/etc/nextep"
PORT="${PORT:-8050}"
REPO_URL="${REPO_URL:-https://github.com/murdocklawless/TV-series-Movies-Animes-Tracker-Notifier.git}"
BRANCH="${BRANCH:-main}"

echo "==> Kök yetkisi kontrol ediliyor..."
if [ "$(id -u)" -ne 0 ]; then
  echo "Lütfen sudo ile çalıştırın: sudo bash sh/setup.sh"
  exit 1
fi

# ---------- 3. Bileşen kontrolü (eksikse kur) ----------
echo "==> Sistem bileşenleri kontrol ediliyor (python3, sqlite3, curl, git, tzdata)..."
MISSING_PKGS=""
have_cmd() { command -v "$1" >/dev/null 2>&1; }

PY_OK=""
if have_cmd python3; then
  PY_VER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo 0)"
  PY_MAJOR="$(echo "$PY_VER" | cut -d. -f1)"
  PY_MINOR="$(echo "$PY_VER" | cut -d. -f2)"
  if [ "${PY_MAJOR:-0}" -gt 3 ] || { [ "${PY_MAJOR:-0}" -eq 3 ] && [ "${PY_MINOR:-0}" -ge 10 ]; }; then
    if python3 -m venv --help >/dev/null 2>&1; then
      PY_OK="1"
      echo "    python3 bulundu ($PY_VER) + venv modülü OK"
    else
      echo "    python3 var ama venv modülü yok -> python3-venv kurulacak"
    fi
  else
    echo "    python3 sürümü yetersiz ($PY_VER, en az 3.10 gerekli)"
  fi
else
  echo "    python3 bulunamadı"
fi
[ -n "$PY_OK" ] || MISSING_PKGS="$MISSING_PKGS python3 python3-pip python3-venv"

if ! have_cmd python3 || ! python3 -m pip --version >/dev/null 2>&1; then
  case "$MISSING_PKGS" in *python3-pip*) ;; *) MISSING_PKGS="$MISSING_PKGS python3-pip";; esac
fi

if have_cmd sqlite3; then
  echo "    sqlite3 bulundu ($(sqlite3 --version 2>/dev/null | awk '{print $1}'))"
else
  echo "    sqlite3 bulunamadı -> kurulacak"
  MISSING_PKGS="$MISSING_PKGS sqlite3"
fi

if have_cmd curl; then
  echo "    curl bulundu"
else
  echo "    curl bulunamadı -> kurulacak"
  MISSING_PKGS="$MISSING_PKGS curl"
fi

if have_cmd git; then
  echo "    git bulundu"
else
  echo "    git bulunamadı -> kurulacak (repo klonu için şart)"
  MISSING_PKGS="$MISSING_PKGS git"
fi

if [ -f /usr/share/zoneinfo/Europe/Istanbul ]; then
  echo "    tzdata bulundu (Europe/Istanbul)"
else
  echo "    tzdata bulunamadı -> kurulacak"
  MISSING_PKGS="$MISSING_PKGS tzdata"
fi

if [ -n "$MISSING_PKGS" ]; then
  # shellcheck disable=SC2086
  echo "==> Eksik paketler kuruluyor:$MISSING_PKGS"
  apt-get update
  apt-get install -y $MISSING_PKGS
else
  echo "==> Tüm sistem bileşenleri mevcut, apt-get atlandı."
fi

# ---------- 4. Staging klonu ----------
echo "==> Repo klonlanıyor: $REPO_URL (dal: $BRANCH)..."
STAGE="$(mktemp -d /tmp/nextep-setup-XXXXXX)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
if ! git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$STAGE" 2>/tmp/nextep-git-err.log; then
  echo "HATA: repo klonlanamadı." >&2
  echo "  URL: $REPO_URL | dal: $BRANCH" >&2
  echo "  Nedenler: ağ erişimi yok / URL yanlış / dal adı yanlış / (özel repo ise) yetki gerekli." >&2
  echo "  git çıktısı:" >&2
  cat /tmp/nextep-git-err.log >&2 || true
  exit 1
fi
NEW_COMMIT="$(git -C "$STAGE" rev-parse --short HEAD 2>/dev/null || echo bilinmiyor)"
echo "    klon tamamlandı (commit: $NEW_COMMIT)"

if [ ! -f "$STAGE/py/nextep.py" ] || [ ! -f "$STAGE/requirements/requirements.txt" ]; then
  echo "HATA: klonlanan repoda beklenen dosyalar yok (py/nextep.py, requirements/requirements.txt)." >&2
  echo "  Yanlış repo klonlanmış olabilir: $REPO_URL" >&2
  exit 1
fi

# ---------- 5. Mod tespiti ----------
MARKERS="py/nextep.py py/config.py py/routes service/nextep.service static/index.html requirements/requirements.txt"
MODE="FRESH"
if [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  ALL_PRESENT="1"
  for m in $MARKERS; do
    if [ ! -e "$APP_DIR/$m" ]; then
      ALL_PRESENT=""
      break
    fi
  done
  if [ -n "$ALL_PRESENT" ]; then
    MODE="UPDATE"
  else
    MODE="COMPLETE"
  fi
fi

case "$MODE" in
  FRESH)    echo "==> Mod: SIFIR KURULUM ($APP_DIR yok veya boş)." ;;
  UPDATE)   echo "==> Mod: GÜNCELLEME — mevcut kurulum tespit edildi ($APP_DIR dolu, tüm uygulama dosyaları mevcut)." ;;
  COMPLETE) echo "==> Mod: TAMAMLAMA — $APP_DIR dolu ama bazı uygulama dosyaları eksik; eksikler eklenecek, mevcut veriler korunacak." ;;
esac

# ---------- 6. Yedek (güncelleme/tamamlama öncesi) ----------
if [ "$MODE" != "FRESH" ]; then
  mkdir -p "$APP_DIR/bak"
  BACKUP="$APP_DIR/bak/pre-setup-$(date +%Y%m%d-%H%M%S).tar.gz"
  echo "==> Kurulum öncesi yedek alınıyor: $BACKUP"
  tar czf "$BACKUP" --exclude=venv -C "$APP_DIR" . 2>/dev/null || echo "    (uyarı: yedek alınamadı, devam ediliyor)"
fi

# ---------- 7. Senkron (tam ağaç; veri dosyaları hariç) ----------
echo "==> Uygulama dosyaları senkronize ediliyor -> $APP_DIR ..."
mkdir -p "$APP_DIR" "$APP_DIR/db"
if have_cmd rsync; then
  rsync -a --delete \
    --exclude 'venv/' \
    --exclude 'db/*.db' \
    --exclude 'bak/' \
    --exclude 'backup/' \
    --exclude '.git/' \
    --exclude '.env' \
    --exclude '.smtp_secret' \
    --exclude 'tmp_push/' \
    --exclude 'restore/' \
    --exclude '.opencode/' \
    "$STAGE/py/" "$APP_DIR/py/"
  rsync -a --delete --exclude '.git/' "$STAGE/static/" "$APP_DIR/static/"
  rsync -a "$STAGE/requirements/" "$APP_DIR/requirements/"
  rsync -a "$STAGE/service/" "$APP_DIR/service/"
  rsync -a "$STAGE/sh/" "$APP_DIR/sh/" 2>/dev/null || true
else
  rm -rf "$APP_DIR/py" "$APP_DIR/static" "$APP_DIR/requirements" "$APP_DIR/service"
  mkdir -p "$APP_DIR/py" "$APP_DIR/static" "$APP_DIR/requirements" "$APP_DIR/service" "$APP_DIR/sh"
  cp -a "$STAGE/py/." "$APP_DIR/py/"
  cp -a "$STAGE/static/." "$APP_DIR/static/"
  cp -a "$STAGE/requirements/." "$APP_DIR/requirements/"
  cp -a "$STAGE/service/." "$APP_DIR/service/"
  cp -a "$STAGE/sh/." "$APP_DIR/sh/" 2>/dev/null || true
fi
rm -f "$APP_DIR/.env" 2>/dev/null || true
echo "    senkron tamamlandı (db/*.db, .env, .smtp_secret korunur; venv'e dokunulmaz)."

cd "$APP_DIR"

# ---------- 8. venv + pip ----------
if [ ! -x "venv/bin/python" ] || ! ./venv/bin/python --version >/dev/null 2>&1; then
  echo "==> Sanal ortam (yeniden) oluşturuluyor..."
  rm -rf venv
  python3 -m venv venv
else
  echo "==> Mevcut sanal ortam sağlam, yeniden kullanılıyor."
fi

if [ ! -f "requirements/requirements.txt" ]; then
  echo "HATA: requirements/requirements.txt bulunamadı, bağımlılıklar kurulamaz." >&2
  exit 1
fi
echo "==> Bağımlılıklar yükleniyor..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements/requirements.txt

# DB bütünlük kontrolü (varsa; sıfır kurulumda DB henüz yoktur — normal)
if [ -f "db/nextep.db" ]; then
  echo "==> Mevcut DB bütünlüğü doğrulanıyor..."
  if ! sqlite3 "db/nextep.db" "PRAGMA integrity_check;" | grep -q "^ok"; then
    echo "HATA: DB bütünlük hatası (db/nextep.db). Yedekten geri yükleyin, kurulum durduruldu." >&2
    exit 1
  fi
  echo "    DB sağlam."
else
  echo "    (DB yok — ilk açılışta uygulama oluşturacak.)"
fi

# ---------- 9. Systemd servisi ----------
echo "==> Systemd servisi kuruluyor (port: $PORT)..."
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

systemctl daemon-reload
systemctl enable --now nextep
if [ "$MODE" = "UPDATE" ] || [ "$MODE" = "COMPLETE" ]; then
  systemctl restart nextep
fi

# ---------- 10. Doğrulama ----------
echo "==> Servis doğrulanıyor..."
OK=""
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/followed"; then
    OK="1"
    break
  fi
  sleep 1
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$OK" ]; then
  case "$MODE" in
    FRESH)
      echo "==> SIFIR KURULUM tamamlandı (commit: $NEW_COMMIT)."
      ;;
    UPDATE)
      echo "==> GÜNCELLEME tamamlandı (yeni commit: $NEW_COMMIT). Servis yeniden başlatıldı."
      ;;
    COMPLETE)
      echo "==> TAMAMLAMA bitti (eksik dosyalar eklendi, commit: $NEW_COMMIT). Servis yeniden başlatıldı."
      ;;
  esac
  echo "==> Uygulama http://${IP:-<cihaz-ip>}:$PORT adresinde çalışıyor."
  exit 0
fi

echo "!! Servis başladı ama yanıt vermedi. Durum:" >&2
systemctl status nextep --no-pager || true
journalctl -u nextep --no-pager -n 50 || true
exit 1
