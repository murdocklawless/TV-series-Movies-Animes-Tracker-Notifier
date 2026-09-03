import os

from config import app
from db import init_db, get_setting
from ramcache import list_cache, end_startup
from scheduler import backfill_votes, start_scheduler

from routes.search import search_bp
from routes.followed import followed_bp
from routes.anime import anime_bp
from routes.settings import settings_bp
from routes.recommendations import recommendations_bp
from routes.fav_listings import fav_listings_bp
from routes.app_update import app_update_bp
from notification import notification_bp

app.register_blueprint(search_bp)
app.register_blueprint(followed_bp)
app.register_blueprint(anime_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(recommendations_bp)
app.register_blueprint(fav_listings_bp)
app.register_blueprint(app_update_bp)
app.register_blueprint(notification_bp)

init_db()
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
backfill_votes()                    # startup zarfi: bump'lar bastirilir
start_scheduler()
end_startup()                       # artik bump'lar gecerli


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    try:
        from waitress import serve

        print(f"* Production server running on http://0.0.0.0:{port}")
        serve(app, host="0.0.0.0", port=port, threads=8)
    except ImportError:
        app.run(host="0.0.0.0", port=port, debug=debug)