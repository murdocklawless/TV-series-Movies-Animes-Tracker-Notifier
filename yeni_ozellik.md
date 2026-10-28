# NextEp — Yeni Özellik Fikirleri

> Oluşturma: 27.10.2026 · Bağlam: 2.20.3+ (build 671) · Durum: fikir listesi (uygulanmadı)
> Kısıtlar: Flask + SQLite + Raspberry Pi 5 (port 8050) · 14 dil · mobil/tablet/TV-APK

## 1) Hızlı kazanımlar

| # | Özellik | Neden / mevcut altyapı | Emek | Öncelik |
|---|---------|------------------------|------|---------|
| 1 | **API/Kota sağlık paneli** | `query_log` + `rate_track` hazır: TMDB/TVmaze/Trakt istek sayısı, son 24 saat, hata oranı, "kota riski" göstergesi. İşler akordeonundaki uyarının somut hali. | S | P1 |
| 2 | **Bildirim sustur / ertele** | Yapım bazında "7 gün sustur" + genel sessiz saatler (00:00–08:00). Bildirim üretimi tek yerde (`notification.py`) → temiz kesişim. | S–M | P1 |
| 3 | **Toplu işlemler** | Grid'de seçim modu: seçilen kartlara arşivle / izlendi say / takipten çık / sonra izle. Tablet ve TV'de tek tek dokunmayı bitirir. | M | P1 |
| 4 | **İzleme günlüğü + zengin istatistik** | `watched_at` zaten tutuluyor: "bu ay 32 bölüm", takvim ısı haritası, tür dağılımı, en çok izlenen oyuncu/stüdyo. | M | P2 |
| 5 | **Haftalık özet (digest)** | Pazartesi: "bu hafta yayınlanacaklar + geçen hafta izlediklerin" tek bildirim veya e-posta. Mevcut scheduler + bildirim kanalları. | S–M | P2 |

## 2) Orta vadeli

| # | Özellik | Not | Emek | Öncelik |
|---|---------|-----|------|---------|
| 6 | Per-title bildirim tercihi | Her karta "yeni bölüm / sezon / puan değişimi" anahtarları (şu an global). | M | P2 |
| 7 | Keşif alarmı (kural motoru) | "Tür = gerilim + puan ≥ 7.5 + 2026+ → haber ver" kuralları; öneri feed'i zaten taranıyor. | M–L | P3 |
| 8 | Web Push (PWA) | APK kurmadan telefona bildirim; mevcut 4 kanala 5. kanal (VAPID + service worker). | M | P2 |
| 9 | İzlemeyi bırakma (dropped) | "Bıraktım" + sebep; istatistik ve önerilerde negatif sinyal. | S–M | P3 |
| 10 | Klavye kısayolları | `/` ara, `f` filtre, `Space` izlendi, ok tuşları bölüm. Masaüstünde ciddi hız. | S | P3 |
| 11 | Toplu içe/dışa aktarma | Letterboxd/IMDb CSV import; tüm takip listesini CSV/JSON export. | M | P2 |
| 12 | Yedek doğrulama | Son yedeği otomatik "restore-test" (geçici DB + `integrity_check`), panelde yeşil/kırmızı. | S–M | P2 |

## 3) Daha büyük / stratejik

| # | Özellik | Not | Emek | Öncelik |
|---|---------|-----|------|---------|
| 13 | Çift yönlü Trakt senkronu | Şu an tek yön ağırlıklı; puan/yorum/watchlist alanlarını da çek. | M–L | P3 |
| 14 | Kodi/Jellyfin/Emby → Nextep izleme | Webhook altyapısı var; oynatma yüzdesiyle "yarıda kaldı" durumu. | M | P3 |
| 15 | Takvim görünümü (haftalık ızgara) | Bölüm takvimi şu an liste; haftalık grid + kişisel filtre + ICS'e yansıma. | M | P2 |
| 16 | 2FA (TOTP) + oturum yönetimi | Public adres kullanılıyorsa değerli: aktif oturumlar, tek tıkla çıkış. | M | P2 |
| 17 | Discord bot komutları | `/ara`, `/takip`, `/bu-hafta`. | L | P3 |
| 18 | Kullanıcı bazlı puan/yorum | Karta kendi puanın + kısa not; TMDB puanından ayrı gösterim. | M | P3 |

## 4) Kısıtlar (planlarken hatırlatma)

- **TMDB/TVmaze kotası:** her yeni özellikte "kaç istek" sorusu sorulmalı
  (Ayarlar → Güncelleme Saatleri → İşler: "Kısa aralık = kota riski" kuralı).
- **Raspberry Pi 5:** CPU/RAM sınırlı → ağır işler (toplu tarama, görsel işleme)
  gece bakımına (`maint` job) alınmalı.
- **SQLite:** tek yazıcı; toplu işlemler transaction + kilit süresi gözetilmeli.
- **14 dil:** her yeni arayüz metni 14 dilde eklenmeli (`static/js/i18n.js` deseni).
- **Dağıtım:** `python py/eol.py check` → `python py/jsver.py bump` → scp → md5 + `eol.py check`
  (statikte servis restart gerekmez; `py/` değişirse `systemctl restart nextep`).

## 5) Öneri (ilk üç)

1. **Kota sağlık paneli** — mevcut `query_log`/`rate_track` ile, düşük risk.
2. **Bildirim sustur / sessiz saatler** — günlük kullanımda en çok hissedilir.
3. **Toplu işlemler** — tablet ve TV'de büyük kolaylık.

## 6) Seçilen özellik için plan şablonu (boş — doldurulacak)

### 6.1 Özellik adı / numarası

### 6.2 Amaç ve kullanıcı akışı (adım adım)

### 6.3 Backend — değişecek/yeni dosyalar (`py/…`)

### 6.4 Veritabanı — yeni tablo/kolon/migration + geri dönüş

### 6.5 API — yeni/değişen uçlar (metot, yol, istek/yanıt, yetki)

### 6.6 Arayüz — dosyalar (`static/index.html`, `js/…`, `css/…`) + yerleşim

### 6.7 i18n — yeni anahtarlar (14 dil) ve mevcut metin değişiklikleri

### 6.8 Zamanlama/kota etkisi (TMDB/TVmaze/Trakt istek sayısı)

### 6.9 Test — masaüstü / tablet / mobil / APK-TV senaryoları

### 6.10 Riskler ve geri alma (rollback)

### 6.11 Dağıtım adımları (`eol check` → `jsver bump` → scp → md5 → servis)

### 6.12 Sürüm notu taslağı (CHANGELOG TR/EN)
