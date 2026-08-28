#!/usr/bin/env bash
# Uygulamayı (waitress) başlatır
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
export PORT="${PORT:-5000}"
exec ./venv/bin/python py/nextep.py
