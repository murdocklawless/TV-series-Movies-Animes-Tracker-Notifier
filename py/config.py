import os
import sqlite3
import json
import time
import datetime
import threading
import requests
from flask import Flask, jsonify, request, send_from_directory
from apscheduler.schedulers.background import BackgroundScheduler
from zoneinfo import ZoneInfo
import zoneinfo

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Faz 2 klasör düzenlemesi için: .py dosyaları py/ altına taşınırsa BASE_DIR'i proje köküne sabitle
if os.path.basename(BASE_DIR) == "py":
    BASE_DIR = os.path.dirname(BASE_DIR)
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "db", "tracker.db"))
# Migration: eski konumda (root'ta data.db veya tracker.db) varsa ve hedefte yoksa onu kullan
if "DB_PATH" not in os.environ and not os.path.exists(DB_PATH):
    for legacy in (os.path.join(BASE_DIR, "data.db"), os.path.join(BASE_DIR, "tracker.db")):
        if os.path.exists(legacy):
            DB_PATH = legacy
            break
STATIC_DIR = os.path.join(BASE_DIR, "static")

TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

# Lokal poster klasörleri (w500 kalite, ID bazlı)
POSTER_ROOT = os.path.join(STATIC_DIR, "images", "posters")
POSTER_SHOWS_DIR = os.path.join(POSTER_ROOT, "shows")
POSTER_MOVIES_DIR = os.path.join(POSTER_ROOT, "movies")
POSTER_ANIME_DIR = os.path.join(POSTER_ROOT, "anime")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
# Statik dosyalar icin kisa cache (1 saat) - CSS/JS guncellemeleri gec olmadan dussun.
# Posterler ayri after_request ile immutable 30 gun cache'lenmeye devam eder.
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 60 * 60

@app.after_request
def _poster_cache_headers(resp):
    # /static/images/posters/... icin immutable cache
    try:
        if request.path.startswith("/static/images/posters/"):
            resp.headers["Cache-Control"] = "public, max-age=2592000, immutable"
            # ETag zaten Flask tarafindan eklenir
        elif request.path.startswith(("/static/js/", "/static/css/")) or request.path == "/":
            # JS/CSS/index.html: her kullanimda ETag dogrulamasi (304) - deploy aninda tum cihazlarda guncellenir
            # ("/" haric tutulursa index.html 1 saat bayat kalir, eski v= referanslariyla bayat JS/CSS yuklenir)
            resp.headers["Cache-Control"] = "no-cache"
    except Exception:
        pass
    return resp


@app.after_request
def _x_cache_bypass(resp):
    # Cache'lenmemis API yanitlarina BYPASS etiketi (HIT/MISS zaten yazilmissa dokunma)
    try:
        if request.path.startswith("/api/") and "X-Cache" not in resp.headers:
            resp.headers["X-Cache"] = "BYPASS"
    except Exception:
        pass
    return resp
