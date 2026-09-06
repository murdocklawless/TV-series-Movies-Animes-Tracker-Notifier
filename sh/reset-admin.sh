#!/bin/bash
# Faz 30: admin sifresini SSH/pi konsolundan sifirlar (web'den erisilemez).
# Kullanim: sh/reset-admin.sh <yeni-sifre>
# Sifre kurali: >=10 karakter + buyuk + kucuk + rakam + sembol.
set -u
APP_DIR="/etc/nextep"
DB="$APP_DIR/db/nextep.db"
VENV_PY="$APP_DIR/venv/bin/python"

if [ $# -ne 1 ]; then
  echo "Kullanim: sh/reset-admin.sh <yeni-sifre>"
  exit 1
fi
if [ ! -f "$DB" ]; then
  echo "DB bulunamadi: $DB"
  exit 1
fi
if [ ! -x "$VENV_PY" ]; then
  echo "venv python bulunamadi: $VENV_PY"
  exit 1
fi

"$VENV_PY" - "$DB" "$1" <<'EOF'
import re, sqlite3, sys
from werkzeug.security import generate_password_hash
db, p = sys.argv[1], sys.argv[2]
err = None
if len(p) < 10: err = "en az 10 karakter"
elif not re.search(r"[A-Z]", p): err = "buyuk harf"
elif not re.search(r"[a-z]", p): err = "kucuk harf"
elif not re.search(r"[0-9]", p): err = "rakam"
elif not re.search(r"[^A-Za-z0-9]", p): err = "sembol"
if err:
    print(f"Sifre kurali ihlali: {err}")
    sys.exit(1)
conn = sqlite3.connect(db)
cur = conn.execute(
    "UPDATE users SET password_hash=?, force_pw_change=0, status='active' WHERE id=1",
    (generate_password_hash(p),),
)
if not cur.rowcount:
    print("Admin (id=1) bulunamadi.")
    sys.exit(1)
conn.execute("DELETE FROM sessions WHERE user_id=1")
conn.commit()
conn.close()
print("Admin sifresi sifirlandi, tum admin oturumlari dusuruldu.")
EOF
