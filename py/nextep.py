import os

from config import app
from db import init_db, get_setting
from ramcache import list_cache, end_startup
from rate_track import set_startup_grace
from scheduler import start_scheduler
import query_log
from jsver import startup_report  # 2.19: damga zinciri denetimi (tek kaynak, sh yok)

from routes.search import search_bp
from routes.followed import followed_bp
from routes.anime import anime_bp
from routes.settings import settings_bp
from routes.recommendations import recommendations_bp
from routes.fav_listings import fav_listings_bp
from routes.app_update import app_update_bp
from routes.stremio import stremio_bp
from routes.calendar import calendar_bp
from routes.remote import remote_bp
from routes.auth import auth_bp
from routes.webhook import webhook_bp
from routes.emby import emby_bp
from notification import notification_bp

app.register_blueprint(search_bp)
app.register_blueprint(followed_bp)
app.register_blueprint(anime_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(recommendations_bp)
app.register_blueprint(fav_listings_bp)
app.register_blueprint(app_update_bp)
app.register_blueprint(stremio_bp)
app.register_blueprint(calendar_bp)
app.register_blueprint(remote_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(notification_bp)
app.register_blueprint(webhook_bp)
app.register_blueprint(emby_bp)

from auth import init_auth

init_auth(app)  # Faz 30: gizli anahtar + global giris kapisi (Stremio muaf)

init_db()
startup_report()  # 2.19: acilista damga zinciri durumu (temiz / UYARI) — py/jsver.py
try:
    # İlk açılış tohumu: version tablosu boşsa dosyadaki formatı-düzgün değer yazılır.
    # Dolu tablo asla ezilmez; anlamsal doğrulama (yayınlanmış küme) her check_update'te
    # yapılır — bilinmeyen değer güncellenebilir sayıldığından sistem kendiliğinden yakınsar.
    from db import db_version_get, db_version_set
    from app_update import _ver_tuple, local_version
    if not db_version_get():
        _fv = local_version()
        if _ver_tuple(_fv):
            db_version_set(_fv)
            print(f"version seed: {_fv}", flush=True)
except Exception as e:
    print(f"version seed failed: {e}", flush=True)
try:
    ttl = int(get_setting("cache_ttl") or 3600)
except (TypeError, ValueError):
    ttl = 3600
list_cache.configure(ttl)
if ttl > 0:
    list_cache.restore_from_db()   # restart sonrasi kalici cache geri yükleme
# 2.19.25: sorgu gunlugu (log/query.log, 05:00 devirli). Seviye ayardan gelir.
try:
    query_log.configure(get_setting("query_log_level") or "info")
except Exception:
    query_log.configure("info")
# 2.19.25: acilista backfill_votes() CAGRILMAZ. Tum takipli ogeler icin puan
# tazelemesi acilisa ~100 TMDB istegi ekliyordu; gorev 05:10 cron'unda zaten var.
start_scheduler()
# 2.19.6: senkron havuzu (outbox + Trakt gelen yoklama + Emby WS oge kuyrugu).
# Scheduler'dan sonra baslar: giden isler olayla, gelen yoklama 10 sn aktif /
# kullanici araligi bossa.
try:
    import sync_pool
    sync_pool.start()
except Exception as e:
    print(f"sync_pool baslatma hata: {e}", flush=True)
end_startup()                       # artik bump'lar gecerli
set_startup_grace(False)            # acilis zarfi bitti: kayitlar bara isler


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    try:
        from waitress import serve

        print(f"* Production server running on http://0.0.0.0:{port}")
        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:
        app.run(host="0.0.0.0", port=port, debug=debug)