# TV-series-Movies-Animes-nextep-Notifier

Dizi ve filmleri takip eden, yeni bölümlerin yayın tarihlerini takvimde gösteren ve çıkış gününde Telegram üzerinden bildirim gönderen web uygulaması. Tüm veriler TMDB (The Movie Database) API'sinden gelir.

## Özellikler

- **Arama**: TMDB üzerinden film ve dizi arama, tek tıkla takibe ekleme
- **Afiş ızgarası**: Takip edilen yapımlar afiş kartlarıyla listelenir; dizi/film rozeti, TMDB puanı ve ilk yayın tarihi gösterilir
- **Detay penceresi**: Afişe tıklayınca özet, türler, puan, süre, sezon/bölüm sayısı ve durum bilgisi görüntülenir
- **Yayın takvimi**: Her yapımın sezon bazında bölüm takvimi; bölüm adları, tarihler (gün ay yıl) ve haftanın günü gösterilir
- **Telegram bildirimi**: Her sezonun/bölümün yayın tarihi takip edilir; çıkan bölümler için Telegram'a bildirim gönderilir (6 saatte bir kontrol)
- **Duyarlı tasarım**: Masaüstü, tablet ve telefon ekranlarına uyumlu; mobilde dokunmatik kullanım
- **Ayarlar**: TMDB API anahtarı, Telegram bot token ve chat ID web arayüzünden girilebilir

## Teknolojiler

- Python 3 + Flask
- SQLite (veritabanı)
- APScheduler (zamanlanmış bildirim kontrolü)
- waitress (production sunucusu)
- HTML / CSS / JavaScript (arayüz)
- TMDB API v3, Telegram Bot API

## Kurulum (Raspberry Pi / Debian)

1. Klasöre kopyalayın: `/etc/nextep`
2. Sanal ortam oluşturup paketleri kurun:
   ```
   python3 -m venv venv
   ./venv/bin/pip install -r requirements/requirements.txt
   ```
3. systemd servisi kurun:
   ```
   cp service/nextep.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now takip
   ```
4. Web arayüzünü açın: `http://<sunucu-ip>:8050`
5. **Ayarlar** sekmesinden TMDB API anahtarınızı, Telegram bot token'ınızı ve chat ID'nizi girin

Servis 8050 portunda çalışır (`PORT` ortam değişkeniyle değiştirilebilir).

## API

| Metot | Uç Nokta | Açıklama |
|-------|----------|----------|
| GET | `/api/search?q=...` | TMDB'de film/dizi arama |
| POST | `/api/follow` | Yapımı takibe ekle |
| GET | `/api/followed` | Takip listesi |
| DELETE | `/api/unfollow/<id>` | Takibi bırak |
| GET | `/api/releases?media_type=...&tmdb_id=...` | Sezon/bölüm takvimi |
| GET | `/api/details?media_type=...&tmdb_id=...` | Detay bilgileri |
| GET/POST | `/api/settings` | Ayarları oku/kaydet |
| POST | `/api/settings/test` | Telegram/TMDB bağlantı testi |

## Not

- `db/nextep.db` (SQLite veritabanı) ve gizli anahtar dosyaları `.gitignore` ile reponun dışında tutulur.
- `backup_pre_calendar/` klasörü, takvim özelliği öncesi sürümün yedeğini içerir.