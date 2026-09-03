#!/usr/bin/env bash
# nextep-healthcheck.sh - NextEp watchdog (2 dk timer ile oneshot calisir)
# Karar: curl yoklamasi + NRestarts (journal okunmaz).
#   3+ ust uste hata + son 30 dk'da guncelleme -> rollback + tum kanallara bildirim
#   3+ ust uste hata + guncelleme yok      -> restart + tum kanallara bildirim
set -e

APP_DIR="/etc/nextep"
RUN_DIR="/run/nextep-health"
CNT_FILE="$RUN_DIR/fails"
NR_FILE="$RUN_DIR/nrestarts"
MARK="/etc/snapshot/app-update/.just-updated"
WINDOW_SEC=1800

PORT="$(sed -n 's/^Environment=PORT=//p' /etc/systemd/system/nextep.service 2>/dev/null | head -n 1 | tr -d '[:space:]')"
PORT="${PORT:-8050}"

mkdir -p "$RUN_DIR"

healthy() {
  curl -sf -m 10 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null \
    && curl -sf -m 10 -o /dev/null "http://127.0.0.1:$PORT/api/followed" 2>/dev/null
}

notify_all_py() {
  "$APP_DIR/venv/bin/python" -c "import sys; sys.path.insert(0, '$APP_DIR/py'); from notifications import notify_all; notify_all('''$1''')" 2>/dev/null || true
}

just_updated() {
  [ -f "$MARK" ] || return 1
  TS="$(head -n 1 "$MARK" 2>/dev/null | tr -d '[:space:]')"
  case "$TS" in ''|*[!0-9]*) return 1;; esac
  NOW="$(date +%s)"
  [ $((NOW - TS)) -lt "$WINDOW_SEC" ]
}

if healthy; then
  echo 0 > "$CNT_FILE"
  systemctl show nextep -p NRestarts 2>/dev/null | cut -d= -f2 > "$NR_FILE" || true
  exit 0
fi

FAILS="$(cat "$CNT_FILE" 2>/dev/null || echo 0)"
case "$FAILS" in ''|*[!0-9]*) FAILS=0;; esac
FAILS=$((FAILS + 1))
echo "$FAILS" > "$CNT_FILE"
echo "nextep-healthcheck: ard arda hata $FAILS (port $PORT)" >&2

# Crash-loop imzasi: restart sayisi hizla artiyorsa esigi beklemeden mudahale
CRASHLOOP=""
PREV="$(cat "$NR_FILE" 2>/dev/null || echo 0)"
CUR="$(systemctl show nextep -p NRestarts 2>/dev/null | cut -d= -f2 || echo 0)"
case "$PREV$CUR" in *[!0-9]*) ;; *) [ $((CUR - PREV)) -ge 5 ] && CRASHLOOP="1";; esac
echo "$CUR" > "$NR_FILE" || true

if [ "$FAILS" -lt 3 ] && [ -z "$CRASHLOOP" ]; then
  exit 0
fi

if just_updated; then
  echo "nextep-healthcheck: guncelleme penceresi icinde, rollback yapiliyor" >&2
  "$APP_DIR/venv/bin/python" -c "import sys; sys.path.insert(0, '$APP_DIR/py'); from app_update import rollback; rollback('watchdog: saglik kontrolu basarisiz')" 2>/dev/null || true
  echo 0 > "$CNT_FILE"
else
  echo "nextep-healthcheck: guncelleme yok, servis yeniden baslatiliyor" >&2
  systemctl restart nextep 2>/dev/null || true
  notify_all_py "NextEp servisi yanıt vermiyordu, yeniden başlatıldı."
  echo 0 > "$CNT_FILE"
fi
exit 0
