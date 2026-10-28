# Plan — Sorgu Trafiği Azaltma (uygulandı: 2.20.1)

> Durum: **UYGULANDI ve pi5'te canlı** (2026-10-23). Yedekler:
> `bak/sorgu_plan_20261023_203519/` (yerel + pi, `nextep.db.pre` dahil).
> Aşağıdaki tablolar hem planı hem **gerçek ölçümleri** içerir.

---

## 0) Panel sayacı 05:00'e hizalandı (ölçüm düzeltmesi) — ✅

- `rate_track`: `_today_key()` / `_day_start_mono()` artık **05:00 hesap günü**
  (`query_log.billing_day()` + `billing_day_start()`); `_restore_from_log()`
  `stats_today(..., since=billing_day_start())` ile yalnız **geçerli hesap
  gününü** geri sayar (`query_log.stats_today`'e opsiyonel `since` eklendi).
- `i18n.rate_peak_tip` 14 dil: "05:00'te sıfırlanır (hesap günü)".
- **Ölçüm (canlı):** panelde TMDB "Toplam" **1.046 → 330** = o günün gerçek
  net TMDB isteği (günlük dosyayla birebir). Eski davranış 2 hesap gününü
  topluyordu (restart'ta canlı dosyayı baştan sayıyordu).

## (a) Kademeli sezon TTL — ✅

| Sezon / dizi durumu | Kontrol |
|---|---|
| Taze sezon (son bölüm ≤ 30 gün) | her gün |
| Sezon boş / eksik / son bölüm tarihi NULL | her gün |
| **Eski sezon** (`season_check_at` = eklenme + 45 gün) | **45 günde bir** (kartın kendi gününde) |
| Dizi **statüsü** (`/tv/{id}`) | **her gün** (tüm diziler) |
| **Statü değişirse** | o kartın **tüm sezonları anında** taranır |
| Ayın 1'i tam tarama | **kaldırıldı** (45 günlük çapaya devredildi) |

- `_fetch_show_bundle(tmdb_id, extra_titles, conn, rows)` → sezon kararı,
  `_season_state(conn, tmdb_id, season)`, `_apply_bundle_meta()` → statü +
  hafif alanlar (puan/oy/sezon listesi) **ek istek olmadan** yazılır ve yalnız
  yavaş taramada `season_check_at += 45 gün`.
- TVmaze `/singlesearch/shows` yalnız **sezon çekilen** diziler için çağrılır.
- **Kuru çalıştırma (gerçek kartlar):** `season_list`te **142 sezon** → bugün
  **14'ü çekilir, 128'i atlanır (%90)**; 44 diziden **13'ünde** çekim var,
  **31'i tamamen atlanır**; TVmaze 43 → **13**.

## (1B) Backfill birleştirme — ✅

- `sync_releases()` sonunda `_backfill_votes_impl()` çağrılır (önbellek SICAK).
- Ayrı `follow_data_sync` cron'u **korundu** (Ayarlar → "Puan Kontrol
  Senkronu" saatini yönetir; çapa sayesinde **ek istek üretmez**).
- İç içe run sorunu giderildi: dekoratörlü `backfill_votes()` sarmalayıcı,
  gövde `_backfill_votes_impl()` → günlükte tek `sync.releases` run'ı.
- **Sonuç:** 05:10-05:20 arası restart cezası **ortadan kalkar**.

## (4) Kart başına 90/45 gün çapası — ✅

| Veri | Sıklık | Çapa |
|---|---|---|
| Dizi credits (kadro/yönetmen) + detay | 90 gün | `detail_check_at` |
| Film detay + credits (vizyonu geçmiş) | 90 gün — **tek istek** (`append_to_response=credits`) | `detail_check_at` |
| Film (vizyona girmemiş / ≤30 gün) | **her gün** | `release_date` |
| Eski sezonlar | 45 gün | `season_check_at` |
| Anime: bitmiş / yayında | 90 gün / **haftalık** | `detail_check_at` |

- Yeni kolonlar: `followed.added_at | season_check_at | detail_check_at`,
  `anime.added_at | detail_check_at` + `followed_anchor_ai` / `anime_anchor_ai`
  **trigger**'ları (yeni kart: +45 / +90; INSERT yollarına dokunulmadı).
- **Mevcut kartlar bir kez dağıtıldı** (deterministik, id bazlı): ilk kontroller
  önümüzdeki 90/45 güne yayıldı → hiçbir kart bugün "due" değil (ani yük yok).
- Kart görünümü değişmedi; bilgi modalı yine DB'den anında okur, "Yenile"
  düğmesi zorla tazeler.

## (5) Feed eleme (A + B + C + D) — ✅

| # | Ne yapıldı | Etki |
|---|---|---|
| **A** | Havuz detay **ön-ısıtması kaldırıldı** (`refresh_feed_source`); kart detayı yalnız **gösterilen kartlar** için, gösterim yolunda, `rec_detail` kalıcı önbelleğiyle | 239 istek → ~18 (ilk gösterim, sonra 0) |
| **B** | 7 sağlayıcı kaynağında (netflix, hbo_max, disney_plus, paramount, apple_tv, prime_video, amc) **film/belgesel** kart detayı hiç çekilmez; platform kaynaktan türetilir (`source_provider`) | −162 istek (film detayları) |
| **C** | `/discover` sayfa sayısı **3 → 2** (60 → 40 aday) | discover 24 → 16 |
| **D** | **Belgesel havuzu ayda bir** (`feed_docs_last`, 30 gün) | −~50/kaynak |

> TV kartlarında `status` satırı korunur (dizi detayı yalnız gösterilen kartlar
> için çekilir); film/belgesel kartlarında zaten vizyon tarihi gösterilir.

## Ölçüm: günlük senkron (kanıt)

| | Önce (bugün 05:10-05:20) | Sonra (2.20.1, canlı ölçüm) |
|---|---|---|
| `sync.releases` | **293** istek / 132 sn | **79** istek / 16,4 sn |
| `backfill` (ayrı cron) | 58 istek | 0 (aynı run içinde, 8 istek) |
| **Toplam** | **351 istek** | **79 istek** (−%77) |
| Restart cezası (05:18 restart) | +99 istek | **0** |

## Beklenen günlük tablo (bugünkü kartlarla)

| Kalem | Önce | Sonra |
|---|---|---|
| Dizi detay/statü (44, günlük) | 44 | 44 |
| Sezon listeleri | 137 | ~17 |
| Dizi credits + film detay/credits | 107 | ~3 |
| TVmaze | 43 | ~13 (haftalık yapılırsa ~2) |
| Feed havuzu (senin rotasyonun) | ~204/gün ort. | **~10-30/gün** |
| Anime + kullanıcı + update + bildirim | ~60 | ~25 |
| **Günlük ortalama** | **~596** | **~110-130** |

## Kalan doğrulama
- **Yarın 05:10** gerçek zamanlı run: `run_end sync.releases` ~80-100 istek,
  `errors=0`, günlükte atlanan/çekilen sezon satırı.
- Panel: 05:00 geçişinde sayacın sıfırlandığı (Toplam = yeni gün dosyası).
- Feed: ilk haftalık turda `feed.pool` isteklerinin ~16'ya düştüğü.

## Geri alma
- `bak/sorgu_plan_20261023_203519/` içindeki `py/*.py`, `routes/`, `js/i18n.js`
  dosyalarını geri kopyala + `systemctl restart nextep`; DB şeması geri alınmaz
  (eklenen kolonlar zararsız, NULL bırakılabilir).
