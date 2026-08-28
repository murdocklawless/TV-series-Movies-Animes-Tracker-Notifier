# Senkron Planı — Güncelleme Modalı 7’li Header + Özel Tooltip + Senkron Ayrıştırması

**Tarih:** 2026-08-24  
**Durum:** Faz 20 canlı (bildirim tek-sefer + `notify_all` 14 dil). Bu plan modal 4→7 satıra çıkarılacak.

## 1. Hedef Tablo (onaylı son hali — 14 dil)

| # | Header | Tooltip (ilk harf büyük, gerisi küçük; parantez içi aynen) | Setting key | Cron (`py/scheduler.py`) |
|---|---|---|---|---|
| 1 | **Bildirim Saati** | Kartların altına bulunan durum bildirimlerini tazeler (Bitti/İptal/Planlandı/Yeni Sezon/Sayısı Artan İzlenmemiş Bölüm) | `notification_hour` (yeni, gizli `09:00` → modal’a eklenecek, default `09:05`) | `check_notifications` `py/scheduler.py:607` `notification_check` — 13 tip Dizi/Film durum |
| 2 | **Yayın Kontrol Senkronu** | Aynı gün içinde yayınlanan dizi bölümlerini ve vizyona giren filmleri kontrol eder | `notify_hour` DB `13:35` | `check_releases` `py/scheduler.py:594` `13:35` — `episode_today`/`movie_today` |
| 3 | **Dizi/Film Kontrol Senkronu** | Dizi bölüm bilgisini ve film detayını tazeler (anime hariç) | `sync_hour` | `sync_releases` `py/scheduler.py:118` — tv `sync_episodes`, movie `sync_movie_details` (genişletilecek) |
| 4 | **Tür Kontrol Senkronu** | Yeni tür var mı diye kontrol eder | `genre_hour` | `sync_genres` `py/scheduler.py:552` `05:00` |
| 5 | **Puan Kontrol Senkronu** | Dizi/Film/Anime kartlarındaki puan durumunu kontrol eder | `data_hour` (kapsam daraltılacak, sadece `backfill_votes`) | `backfill_votes` `py/scheduler.py:397` — `vote_average` (tv/movie) + `score` (anime) |
| 6 | **Anime Kontrol Senkronu** | Anime Bugün Bölümü Ve durum değişimlerini kontrol eder (Ara Verdi/Bitti/Yayına Başladı/Bölüm sayısı) | `anime_notification_hour` (yeni) | `check_anime_notifications` (yeni, `py/scheduler.py:337` anime bloğu ayrılacak) `09:05` |
| 7 | **Öneri Bölümü Güncelleme Rotasyonu** | Öneri bölümü kartlarını tazeler | `rec_hour` (yeni, `data_hour+15` → bağımsız) | `refresh_recommendations_job` `py/scheduler.py:578` `05:25` |

**Notlar:**
- 1. tooltip’ten “/Puan” çıkarıldı → 5’e taşındı (D/F/A ilk harfler büyük).
- 3. film dahil edildi (önerin) — header “Dizi/Film Kontrol Senkronu”, tooltip “(anime hariç)”.
- 6. “Anime Bugün Bölümü Ve” B/V büyük, “+” → “Ve”.
- 2. tooltip “dizi bölümlerini ve vizyona giren filmleri” netleştirildi.
- 4. “Yeni tür var mı diye kontrol eder” — `sync_genres` `INSERT OR IGNORE`.
- 5. anime dahil — `backfill_votes` hem `followed` hem `anime` günceller.

## 2. Dosya Değişiklikleri

- `static/index.html:447` `#settings-update-modal` — 4 `label` → 7 `label`; her `span` `data-i18n="label_*"` + `data-i18n-title="tip_*"` (özel tooltip delegasyonu `static/js/utils.js` hazır); sıra #1–7.
- `static/js/i18n.js:261` — 7 `label_*` TR verdiğin isimlere (EN çeviri), 2 yeni anahtar (`label_notification_hour`, `label_anime_hour`, `label_rec_hour`) ×14 dil (TR/EN doğru, diğer diller EN fallback Faz 19 deseni); 7 `tip_*` ×14 dil yukarıdaki metinlerle.
- `static/js/settings.js:449` — `s.notification_hour/s.rec_hour/s.anime_notification_hour` wiring: `value` doldurma + `saveSettingsPartial({notification_hour: ...})` 3 yeni handler (mevcut `984` deseni).
- `py/routes/settings.py:142` GET’e `notification_hour`/`rec_hour`/`anime_notification_hour` + `genre_hour` (şu an eksik) ekle; `182` whitelist’e 4’ü ekle; `219` tetik listesine ekle → `schedule_releases()` anında cron yeniler.
- `py/scheduler.py` — `schedule_releases`: `rec_h/rec_m` `data_hour+15` → `get_setting("rec_hour") or "05:25"` bağımsız `py/scheduler.py:578`; yeni `check_anime_notifications()` (`py/scheduler.py:337` anime bloğu taşınır, `notif_anime_status` snapshot’lı); `notification_check` artık sadece Dizi/Film; `sync_releases` `py/scheduler.py:118` `elif media_type=='movie': sync_movie_details()` dalı ekle.
- `py/db.py:225` legacy map’e `rec_hour`/`anime_notification_hour` ekle (gerekirse).

## 3. DB / Scheduler

- Yeni setting default’ları: `notification_hour=09:05`, `rec_hour=05:25`, `anime_notification_hour=09:05`.
- Snapshot’lar (`notif_tv_status` 14 satır, `notif_season_upcoming` 1 satır) korunur.

## 4. Doğrulama

- `py_compile` 3 py + `node --check` 7 JS
- `curl /api/settings` 7 saat dönüyor
- Modal 7 satır, her header hover’da özel tooltip (custom div)
- `journalctl` 7 job `next_run_time` doğru
- `sqlite3` snapshot’lar korunmuş

## 5. Dağıtım (workflow kuralı)

1. Yerelde düzenle → 2. `scp -i pi5_key` `py/*` + `static/*` → `pi:/etc/nextep/` → 3. `python3 -m py_compile` → 4. `systemctl restart takip` → 5. `md5sum` MATCH → 6. `md/AGENTS.md` Faz 21 notu.
