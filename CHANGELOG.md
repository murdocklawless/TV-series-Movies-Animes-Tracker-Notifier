# NextEp Değişiklik Geçmişi
<!-- Yeni sürümde en üste `## X.Y - GG/AA/YYYY-SS:DD` bölümü + `### TR` / `### EN` listesi ekle -->

## 2.22.0 - 28/10/2026-23:48
### TR
- **İçe aktarma öncesi otomatik DB snapshot:** `POST /api/cards/import/apply` artık yazmadan önce **tutarlı** bir kopya alır — `bak/import_<YYYYmmdd_HHMMSS>/nextep.db.pre` (SQLite `backup()` API, düz `cp` değil). Yalnız dosya geçerliyse oluşur; **en yeni 10** klasör kalacak şekilde budanır. Yanıtta `snapshot` yolu döner.
- **“Geri al” bilgisi:** başarılı aktarımdan sonra ikinci toast — `Geri almak için: bak/import_…`.
- **İsteğe bağlı TMDB doğrulaması (varsayılan KAPALI):** onay penceresinde `TMDB'de doğrula` anahtarı. Açıkken her kart için `GET /movie/{id}` / `/tv/{id}` çağrılır (kart başına **1 istek**), sonuç **1 saat** önbelleklenir → önizlemeden sonra apply aynı istekleri **tekrar atmaz**. Anime atlanır (AniList'e gidilmez). Doğrulanamayanlar `N doğrulanamadı` olarak raporlanır ve **eklenmez**. Kapalıyken **hiç ağ isteği yok**.
- **İçe aktarma geçmişi:** yeni `import_log` tablosu (`user_id, ts, format, filename, total, added, skipped, unverified, snapshot, extra`) + `GET /api/cards/import/history?limit=20`. Akordeona **Geçmiş** butonu ve **adanmış modal** (`#cards-import-history-modal`, son 20 kayıt: tarih · biçim · sonuç · snapshot yolu, boş durum metni). TV `hookModals`'a eklendi.
- **i18n:** 8 yeni anahtar × 14 dil (`cards_import_verify`, `tip_cards_import_verify`, `cards_import_unverified`, `cards_import_rollback`, `cards_import_history`, `tip_cards_import_history`, `cards_import_history_title`, `cards_import_history_empty`).
- **Cache-buster:** `style.css?v=657 → 658`; `py/jsver.py bump` → **build 685**. `py/` değiştiği için servis **restart** edildi.
- **Doğrulama (gerçek uçlarla):** snapshot `integrity_check=ok` (2.7 MB) · budama testi 11 → **10** · `verify=0` 83 kart **24 ms / 0 istek** · `verify=1` (2 gerçek + 1 sahte) `unverified=1` · ikinci geçiş **14 ms** (önbellek) · geçersiz dosya **400** ve **snapshot/log yok** · geçmiş kaydı doğru · test kalıntıları temizlendi (`import_log=0`, `bak/import_*=0`). `py_compile` + `node --check` + HTML/CSS denetimi + `jsver check` + `eol` OK; md5 yerel = pi.
- **Sürüm:** 2.22.0 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedek: `bak/release_2.22.0_20261028_234829/` (pre + post), `bak/imp_hardening_20261028_201042/` (8 dosya + DB).
### EN
- **Automatic DB snapshot before import:** `POST /api/cards/import/apply` now takes a **consistent** copy before writing — `bak/import_<YYYYmmdd_HHMMSS>/nextep.db.pre` (SQLite `backup()` API, not a plain `cp`). Created only when the file parses; the newest **10** folders are kept. The response returns the `snapshot` path.
- **Rollback hint:** after a successful import a second toast shows `To roll back: bak/import_…`.
- **Optional TMDB verification (OFF by default):** a `Verify on TMDB` switch in the confirm modal. When on, each card is checked with `GET /movie/{id}` / `/tv/{id}` (**1 request per card**), results cached for **1 hour** so `apply` does not repeat them. Anime is skipped (no AniList call). Unverified cards are reported as `N not verified` and **not added**. When off, **no network request** is made.
- **Import history:** new `import_log` table (`user_id, ts, format, filename, total, added, skipped, unverified, snapshot, extra`) plus `GET /api/cards/import/history?limit=20`. The accordion gained a **History** button and a **dedicated modal** (`#cards-import-history-modal`, last 20 entries: date · format · result · snapshot path). Added to TV `hookModals`.
- **i18n:** 8 new keys × 14 languages.
- **Cache-buster:** `style.css?v=657 → 658`; `py/jsver.py bump` → **build 685**; service **restarted** (py change).
- **Verified against live endpoints:** snapshot `integrity_check=ok` (2.7 MB) · prune test 11 → **10** · `verify=0` 83 cards **24 ms / 0 requests** · `verify=1` (2 real + 1 fake) `unverified=1` · second pass **14 ms** (cache) · invalid file **400** with **no snapshot/log** · history row correct · test artefacts cleaned (`import_log=0`, `bak/import_*=0`). `py_compile`, `node --check`, HTML/CSS checks, `jsver check`, `eol` all OK; md5 local = pi.
- **Version:** 2.22.0 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backups: `bak/release_2.22.0_20261028_234829/`, `bak/imp_hardening_20261028_201042/`.

## 2.21.1 - 28/10/2026-19:06
### TR
- **Güncelleme butonlarında turuncu yükleme görünümü:** “Güncellemeleri Kontrol Et” (`#appupdate-check`) ve “NextEp'i Güncelle” (`#appupdate-run`) tıklanınca buton **çerçevesi turuncu** (`#f97316`), **zemini %30 şeffaf turuncu** olur; etiket gizlenir, butonun ortasında beyaz spinner döner ve istek bitince (başarı/hata) eski hâline döner. Yedekle butonundaki (`#backup-now`) mevcut görünümle **tek kurala** birleştirildi (yinelenen blok kaldırıldı).
- **İçe aktarma önizlemesi yeniden tasarlandı:** onay modalındaki düz metin yerine **hizalı boru düzeni**:
  `83 Kart | 79 Yeni | 4 Mevcut | 1639 Bölüm | İzlenmiş 871 Bölüm | İzlenmemiş 768 Bölüm`
  `44 Dizi | 32 Film | 7 Anime`
  `83 Satır | 83 Kart | 0 ID'siz | 0 Bozuk` (yalnız CSV yüklemesinde)
  Borular **turuncu**; tek **11 kolonlu grid** (6 hücre + 5 boru) sayesinde kolon genişlikleri içeriğe göre **dinamik**, `|` işaretleri satırlar arasında **alt alta hizalı**. “Var olan kartlar atlanır (birleştirme)” notu ayrı satıra alındı. `İzlenmemiş` = `bölüm − izlenmiş`.
- **i18n:** 7 yeni anahtar × 14 dil (`cards_imp_new`, `cards_imp_existing`, `cards_imp_watched`, `cards_imp_unwatched`, `csv_rows`, `csv_no_id`, `csv_bad`); kullanılmayan `cards_import_summary` ve `csv_import_summary` kaldırıldı.
- **Cache-buster:** `style.css?v=652 → 653`, `py/jsver.py bump` → **build 683**. Statik değişiklik → servis restart **gerekmedi**, tarayıcıda **Ctrl+F5**.
- **Doğrulama:** `node --check` (settings.js, i18n.js) OK; HTML (41 tekil ID) + CSS (denge/mojibake) denetimi OK; 14 dil anahtar tamlığı OK; `jsver check` + `eol.py check` OK; md5 yerel = pi; canlı `style.css?v=653`, `__NX_BUILD=683`, servis `active`.
- **Sürüm:** 2.21.1 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedek: `bak/release_2.21.1_20261028_190620/` (`nextep.db.pre` + post).
### EN
- **Orange loading state on the update buttons:** clicking “Check for Updates” (`#appupdate-check`) or “Update NextEp” (`#appupdate-run`) turns the button **border orange** (`#f97316`) with a **30 % translucent orange background**; the label is hidden, a white spinner rotates in the centre and everything reverts when the request finishes (success or error). Merged with the existing `#backup-now` rule into a **single rule** (duplicate block removed).
- **Import preview redesigned:** the plain text in the confirm modal is replaced by an **aligned pipe layout**:
  `83 Cards | 79 New | 4 Existing | 1639 Episodes | Watched 871 Episodes | Unwatched 768 Episodes`
  `44 Shows | 32 Movies | 7 Anime`
  `83 Rows | 83 Cards | 0 Without ID | 0 Invalid` (CSV uploads only)
  Pipes are **orange**; a single **11-column grid** (6 cells + 5 pipes) makes column widths **dynamic** to content and keeps the `|` separators **aligned across rows**. The “existing cards are skipped (merge)” note moved to its own line. `Unwatched` = `episodes − watched`.
- **i18n:** 7 new keys × 14 languages (`cards_imp_new`, `cards_imp_existing`, `cards_imp_watched`, `cards_imp_unwatched`, `csv_rows`, `csv_no_id`, `csv_bad`); unused `cards_import_summary` and `csv_import_summary` removed.
- **Cache-buster:** `style.css?v=652 → 653`, `py/jsver.py bump` → **build 683**. Static-only change → no service restart, just **Ctrl+F5**.
- **Verified:** `node --check` OK; HTML (41 unique ids) + CSS (balance/mojibake) checks OK; all 14 languages complete; `jsver check` + `eol.py check` OK; md5 local = pi; live `style.css?v=653`, `__NX_BUILD=683`, service `active`.
- **Version:** 2.21.1 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backup: `bak/release_2.21.1_20261028_190620/` (pre + post).

## 2.21.0 - 28/10/2026-18:41
### TR
- **Kartları dışa / içe aktarma (yeni):** Yedekleme modalı iki akordeona bölündü — **YEDEKLE** (Database / Herşeyi + **Rsync** + **Samba** + Yedekle / Geri Yükle; Rsync/Samba artık iç içe akordeon) ve **KARTLARI DIŞA & İÇE AKTAR** (tek satır: biçim pulldown'u + **Dışa Aktar** + **İçe Aktar**). Alt akordeona tıklamak üstteki YEDEKLE'yi kapatmaz.
- **Uçlar:** `GET /api/cards/export?format=json|csv`, `POST /api/cards/import/preview`, `POST /api/cards/import/apply`. Kartlar **kullanıcı bazlı**; içe aktarma **birleştirir** (aynı `tmdb_id`/`anilist_id` varsa atlanır), önizleme + **adanmış onay modalı** (`#cards-import-confirm-modal`), limit **5 MB / 20.000 kart**, sonrasında `ramcache.bump()`.
- **CSV tam yedek:** 34 kolon (tür, kimlik, başlık, tarih, durum, puan, oy sayısı, süre, sezon/bölüm sayıları, türler, ağlar, stüdyo, özet, açıklama, slogan, poster/cover yolları, sezon listesi, durum bayrakları) + **tüm bölümler** (`S1E1~tarih~saat~izlendi~izlenme~süre~ad`). `;` ayırıcı + UTF-8 BOM + CRLF (Excel TR); **alan içi satır sonları tek satıra** indirilir → her kart tam 1 satır; eski 19 kolonlu CSV'ler hâlâ okunur.
- **JSON:** bölüm satırlarına **`air_time`** eklendi → JSON da tam kayıpsız (metinlerde satır sonları korunur).
- **Arayüz:** biçim pulldown'u **Dil ve Zaman** modalındaki desenle birebir (`provider-combobox` + `provider-list`, `initPulldownCombobox`), seçenekler yalnız **JSON** / **CSV**; üç öğe **120px eşit genişlikte ve ortalı** (36px, mobil 32px, ≤400px 96px). Sarmalayıcı `overflow:visible` — pencere kırpılmıyor.
- **Kaldırılanlar:** “TMDB'den bilgileri tamamla” anahtarı (UI + i18n + backend `_tmdb_lookup`) → kimliksiz satırlar **hiç istek atmadan** raporlanıp atlanır; kart aktarma akordeonundaki açıklama paragrafı.
- **Bu sürümde biriken diğer değişiklikler:** “Sıradaki İzlenmemiş Bölüm” → **“Sıradaki Yayınlanmış İzlenmemiş Bölümler”** (Dizi/Anime/Belgesel); bölüm özetinde tür sayısı ile bölüm sayısı arasındaki `|` kaldırıldı (boşluk); TV `hookModals`'a `settings-backup-modal` + `cards-import-confirm-modal` eklendi.
- **Cache-buster:** `style.css?v=651`, `mobil.css?v=564`, `py/jsver.py bump` → **build 682**; `py/` değiştiği için servis **restart** edildi.
- **Doğrulama:** `py_compile` + `node --check` + modül bağ testi OK; birim testleri (JSON/CSV, eski biçim, bozuk dosya, ID'siz satır); pi DB **kopyasında** tam tur — CSV 34 kolon / 83 kart / 84 fiziksel satır, kartlar silinip geri yüklendiğinde `followed=76, anime=7, bölüm=1639, izlenmiş=859, in_watched=34, arşiv=2, ertelenmiş=5` **birebir**; `jsver check` OK; `eol.py check` OK; md5 yerel = pi.
- **Sürüm:** 2.21.0 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedek: `bak/release_2.21.0_20261028_184051/` (`nextep.db.pre`).
### EN
- **Card export / import (new):** the backup modal is split into two accordions — **BACKUP** (Database / Everything + **Rsync** + **Samba** + Backup / Restore; Rsync/Samba are now nested) and **EXPORT & IMPORT CARDS** (single row: format pulldown + **Export** + **Import**). Clicking a nested accordion does not close the parent.
- **Endpoints:** `GET /api/cards/export?format=json|csv`, `POST /api/cards/import/preview`, `POST /api/cards/import/apply`. Cards are **per user**; import **merges** (existing `tmdb_id`/`anilist_id` are skipped), with a preview + a **dedicated confirmation modal** (`#cards-import-confirm-modal`), limits **5 MB / 20,000 cards**, then `ramcache.bump()`.
- **Full CSV backup:** 34 columns (type, ids, title, date, status, rating, vote count, runtime, season/episode counts, genres, networks, studios, overview, description, tagline, poster/cover paths, season list, state flags) plus **all episodes** (`S1E1~date~airtime~watched~watched_at~runtime~name`). `;` delimiter + UTF-8 BOM + CRLF; in-cell line breaks are flattened so **each card is exactly one line**; legacy 19-column CSVs still import.
- **JSON:** `air_time` added to episode rows → JSON is fully lossless (line breaks preserved).
- **UI:** the format pulldown mirrors the **Language & Time** modal pattern (`provider-combobox` + `provider-list`, `initPulldownCombobox`), options only **JSON** / **CSV**; the three items are **120px wide and centred** (36px, 32px on mobile, 96px ≤400px). The wrapper uses `overflow:visible` so the popup is never clipped.
- **Removed:** the “Fill details from TMDB” switch (UI + i18n + backend `_tmdb_lookup`) → rows without an ID are reported and skipped **without any request**; the explanatory paragraph in the cards accordion.
- **Accumulated in this release:** “Next Unwatched Episode” → **“Next Aired Unwatched Episodes”** (TV/Anime/Docs); the `|` between the type count and the episode count in the section summary became a space; TV `hookModals` now includes `settings-backup-modal` + `cards-import-confirm-modal`.
- **Cache-buster:** `style.css?v=651`, `mobil.css?v=564`, `py/jsver.py bump` → **build 682**; service **restarted** (py change).
- **Verified:** `py_compile`, `node --check`, module link test OK; unit tests (JSON/CSV, legacy format, broken file, ID-less rows); full round-trip on a **copy** of the pi DB — CSV 34 columns / 83 cards / 84 physical lines, restore returned `followed=76, anime=7, episodes=1639, watched=859, in_watched=34, archived=2, deferred=5` **exactly**; `jsver check` OK; `eol.py check` OK; md5 local = pi.
- **Version:** 2.21.0 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backup: `bak/release_2.21.0_20261028_184051/`.

## 2.20.3 - 23/10/2026-22:45
### TR
- **"NextEp'i Güncelle" butonuna dönen yuvarlak animasyon:** Ayarlar → NextEp Güncelleme modalındaki güncelleme butonu tıklandığında etiket gizlenir ve **butonun tam ortasında** beyaz dönen yuvarlak görünür; istek bittiğinde (başarı **veya** hata) animasyon kaldırılır. Pseudo-element (`::after`) + mevcut `@keyframes spin` kullanıldığı için DOM'a eklenen bir düğüm yok → dil değişimi/`textContent` güncellemeleriyle çakışmaz.
- **"Güncellemeleri Kontrol Et" butonu da aynı animasyonu aldı:** bu buton zaten `.loading` sınıfını ekleyip kaldırıyordu ama **görsel geri bildirim yoktu**; artık kontrol isteği boyunca aynı dönen yuvarlak görünür.
- **Kapsam:** yalnız bu iki buton (`#appupdate-run`, `#appupdate-check`); diğer `.loading` kullanan butonlar, güncelleme akışı, `/api/app-update/*` uçları ve diğer modallar **değişmedi**.
- **Cache-buster:** `style.css?v=636 → 637`; `py/jsver.py bump` → **build 663** (settings.js zinciri). Statik değişiklik → servis restart **gerekmedi**, tarayıcıda **Ctrl+F5**.
- **Doğrulama:** `node --check` (settings.js) OK; `jsver check` OK; modül bağ testi **LINK_TEMIZ**; CSS parantez dengesi 1135/1136 (mevcut fark aynı, yeni bloklar dengeli); pi'de 4 dosya md5 **eşit**, canlı `style.css?v=637` + `nextep.js?v=663`, servis `active`.
- **Sürüm:** 2.20.3 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedekler: `bak/appupdate_spinner_20261023_212456/` (yerel + pi, 3 dosya), `bak/surum_2.20.3_20261023_213000/` (`nextep.db.pre` + `nextep.db`).
### EN
- **Spinner on the "Update NextEp" button:** clicking the update button in Settings → NextEp Update hides the label and shows a **white spinning circle centred in the button**; the animation is removed when the request finishes (success **or** error). Implemented with a pseudo-element (`::after`) + the existing `@keyframes spin`, so no DOM node is inserted → no conflict with language switching / `textContent` updates.
- **The "Check for Updates" button got the same spinner:** that button already toggled a `.loading` class but had **no visual feedback**; now the same spinner shows while the check request runs.
- **Scope:** only these two buttons (`#appupdate-run`, `#appupdate-check`); other buttons using `.loading`, the update flow, the `/api/app-update/*` endpoints and other modals are **unchanged**.
- **Cache-buster:** `style.css?v=636 → 637`; `py/jsver.py bump` → **build 663**. Static-only change → no service restart, just **Ctrl+F5**.
- **Verified:** `node --check` OK; `jsver check` OK; module link test **LINK_TEMIZ**; CSS brace balance unchanged (new blocks balanced); on pi 4 files md5-equal, live `style.css?v=637` + `nextep.js?v=663`, service `active`.
- **Version:** 2.20.3 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backups: `bak/appupdate_spinner_20261023_212456/`, `bak/surum_2.20.3_20261023_213000/`.

## 2.20.2 - 23/10/2026-22:35
### TR
- **Mobil kısaltmalar (yalnız mobil; masaüstü + TV aynen kalır):** takvim (yayın takvimi) satırlarındaki etiket artık **"Sez 1 · Böl 1"** — yeni i18n anahtarı `season_ep_mini` (14 dil); dokunmatik cihazlarda ilk sütun %52 olduğu için "Sezon 1 · Bölüm 1" bölüm numarasını kesiyordu. Kartlardaki sezon/bölüm hapları da mobilde **"2 Sez 34 Böl"** (`seasons_short` / `episodes_short`). Anime kartları, LOKAL ARA kompakt hap yolu ve bilgi modalı rozetleri **değişmedi**.
- **İzlenmemiş Bölümler modalı punto düzeltmesi (mobil):** modalın tablosu **tek kolonlu** olduğu için o hücre hem `:first-child` hem `:last-child` olup tarih sütununun **0.7rem**'ini kapıyordu → etiket takvimdekiyle **aynı puntoya** çekildi (`#unwatched-modal .releases-table td { font-size: inherit }`, mobil tablo font'u 0.88rem). **Metin değişmedi** ("Sezon 1 · Bölüm 4" kalır).
- **Dokunulmayanlar:** masaüstü görünüm, TV/APK, anime kart hapı, LOKAL ARA kompakt hapları, bilgi modalı rozetleri, izlenmemiş modalı metni — hiçbiri değişmedi (koşullar `isMobile() && !isTvUIActive()` ile sınırlı).
- **Cache-buster:** `mobil.css?v=556 → 557`; `py/jsver.py bump` → **build 662** (i18n + views + components zinciri). Statik değişiklik → servis restart **gerekmedi**, tarayıcıda **Ctrl+F5**.
- **Doğrulama:** `node --check` (i18n/views/components) OK; `jsver check` OK; modül bağ testi **LINK_TEMIZ**; pi'de 6 dosya md5 **eşit**, canlı `mobil.css?v=557` + `nextep.js?v=662`, servis `active`.
- **Sürüm:** 2.20.2 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedekler: `bak/kisaltma_20261023_211913/` (yerel + pi, 5 dosya), `bak/surum_2.20.2_20261023_212500/` (`nextep.db.pre` + `nextep.db`).
### EN
- **Mobile-only abbreviations (desktop + TV unchanged):** the calendar (release schedule) rows now read **"Sez 1 · Böl 1"** via the new `season_ep_mini` i18n key (14 languages) — on touch devices the first column is 52 % wide and "Sezon 1 · Bölüm 1" was clipping the episode number. Card season/episode pills also use the short form on mobile (**"2 Sez 34 Böl"**, `seasons_short` / `episodes_short`). Anime cards, the compact LOKAL ARA pill path and the info-modal badges are **unchanged**.
- **Unwatched Episodes modal font-size fix (mobile):** because that modal's table has a **single column**, the cell is both `:first-child` and `:last-child` and inherited the date column's **0.7rem** — it now matches the calendar label (`#unwatched-modal .releases-table td { font-size: inherit }`, 0.88rem mobile table font). The **text is unchanged** ("Sezon 1 · Bölüm 4" stays).
- **Untouched:** desktop view, TV/APK, anime card pill, compact LOKAL ARA pills, info-modal badges, the unwatched modal's text — gated by `isMobile() && !isTvUIActive()`.
- **Cache-buster:** `mobil.css?v=556 → 557`; `py/jsver.py bump` → **build 662**. Static-only change → no service restart, just **Ctrl+F5**.
- **Verified:** `node --check` OK; `jsver check` OK; module link test **LINK_TEMIZ**; on pi 6 files md5-equal, live `mobil.css?v=557` + `nextep.js?v=662`, service `active`.
- **Version:** 2.20.2 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backups: `bak/kisaltma_20261023_211913/`, `bak/surum_2.20.2_20261023_212500/`.

## 2.20.1 - 23/10/2026-22:15
### TR
- **Panel sayacı 05:00'e hizalandı (ölçüm düzeltmesi):** `rate_track` artık **05:00 hesap günü** sınırında sıfırlanır (`query_log.billing_day()` / `billing_day_start()`); restart'taki geri sayım `stats_today(..., since=...)` ile **yalnız geçerli hesap gününü** sayar (yeni opsiyonel `since` parametresi). Önceden gece yarısı + her restart'ta canlı günlük dosyasının tamamı geri sayıldığı için panel **2 hesap gününü** topluyordu. **Ölçüm: TMDB "Toplam" 1.046 → 330** (o günün gerçek net isteği). `rate_peak_tip` 14 dilde "05:00'te sıfırlanır" olarak güncellendi.
- **Kademeli sezon TTL (a):** taze sezon (son bölüm ≤30 gün) ve eksik/boş sezonlar **her gün**; **eski sezonlar 45 günde bir** (kartın eklenme tarihine çapalı `season_check_at`); dizi **statüsü her gün** okunur ve **statü değişirse o kartın tüm sezonları anında** taranır; ayın 1'indeki tam tarama **kaldırıldı**. TVmaze `/singlesearch/shows` yalnız sezon çekilen diziler için çağrılır. **Kuru çalıştırma: 142 sezon → 14 çekim / 128 atlama (%90)**, 44 diziden 13'ünde çekim var, TVmaze 43 → 13.
- **Backfill birleştirme (1B):** `sync_releases` run'inin sonunda `_backfill_votes_impl()` çalışır (önbellek sıcak) → **05:10-05:20 arası restart cezası ortadan kalkar**. İç içe run sorunu giderildi (dekoratörlü `backfill_votes()` sarmalayıcı); ayrı `follow_data_sync` cron'u **korundu** çünkü Ayarlar → "Puan Kontrol Senkronu" saatini yönetir ve çapa sayesinde **ek istek üretmez**.
- **Kart başına 90/45 gün çapası (4):** yeni `followed.added_at | season_check_at | detail_check_at` ve `anime.added_at | detail_check_at` kolonları + `followed_anchor_ai` / `anime_anchor_ai` trigger'ları (yeni kart: +45/+90 gün). **Mevcut kartlar bir kez dağıtıldı** (deterministik, id bazlı) → ilk kontroller önümüzdeki 90/45 güne yayıldı, hiçbir kart bugün "due" değil. Dizi detay+credits ve **film detay+credits 90 günde bir**; film artık **tek istekte** (`append_to_response=credits`) çekilir; vizyona girmemiş/yeni film (≤30 gün) **her gün**; anime bitmiş 90 gün / yayında **haftalık**. Kart görünümü ve bilgi modalı değişmedi ("Yenile" zorla tazeler).
- **Feed eleme (5) — A+B+C+D:** (A) havuz detay **ön-ısıtması kaldırıldı** → kart detayı yalnız **gösterilen kartlar** için, `rec_detail` kalıcı önbelleğiyle; (B) 7 sağlayıcı kaynağında **film/belgesel** detayı hiç çekilmez (platform kaynaktan türetilir, `source_provider`) — TV kartlarında `status` satırı korunur; (C) `/discover` sayfa **3 → 2**; (D) **belgesel havuzu ayda bir** (`feed_docs_last`). Rotasyon gün/saatleri (Ayarlar) değişmedi.
- **Ölçüm (canlı):** `sync.releases` **293 → 79 istek**, süre **132 → 16,4 sn**; ayrı backfill dahil toplam **351 → 79 istek (−%77)**; `run_end` tek run olarak loglanıyor (`requests=79 cache=0 errors=0`).
- **Doğrulama:** kademe senaryo testleri A-G (kapsız/çapalı/statü değişimi/taze/eksik/yeni/TVmaze) ✓; migration testi (kolonlar + trigger + dağıtım, **idempotent**) ✓; `py_compile` tüm dosyalar ✓; `jsver bump` → **build 661** + `check` OK; modül bağ testi **LINK_TEMIZ**; pi'de `active`, `http=200`, panel = günlük dosya (330).
- **Poster koruması (aynı sürüm):** `py/app_update.py` → `_sync_tree()` artık `static/images/posters` ve `static/bak` dizinlerini **silmiyor** (rmtree ÖNCESİ geçici yere taşınır, kopyalama SONRASI geri getirilir; repo'da da varsa birleştirilir). Öncesinde her güncelleme yerel poster önbelleğini yok ediyordu: pi4'te 23 Eki 19:11 güncellemesi (2.19.27 → 2.20.0) 4 dizi posterini sildi → kartlar 404 verdi. **Emniyet kemeri:** güncelleme sonrası poster dosya sayısı düşerse snapshot'taki (`code.tar.gz`) eksikler otomatik geri yüklenir. pi4'te kayıp posterler snapshot çıkarma + `py/migrate_posters.py` ile kurtarıldı → **7 dizi × w500/w185 hepsi HTTP 200**.
- **Sürüm:** 2.20.1 (pi DB `version` + `VERSION` eşit, `integrity_check=ok`). Yedekler: `bak/sorgu_plan_20261023_203519/` (kod+DB), `bak/surum_2.20.1_20261023_211500/` (`nextep.db.pre` + `nextep.db`), `bak/poster_koruma_20261023_210123/` (yerel + pi5 + pi4 `app_update.py`).
### EN
- **Panel counter aligned to 05:00 (measurement fix):** `rate_track` now resets on the **05:00 billing day** (`query_log.billing_day()` / `billing_day_start()`); the restart restore counts **only the current billing day** via `stats_today(..., since=...)` (new optional `since`). Previously the panel accumulated **two billing days** (midnight reset + full live-file restore on every restart). **Measured: TMDB "Total" 1.046 → 330** (the real net count for the day). The `rate_peak_tip` string was updated in 14 languages.
- **Tiered season TTL (a):** fresh seasons (last episode ≤30 days) and missing/empty seasons are checked **daily**; **old seasons every 45 days** (anchored to the card's added date via `season_check_at`); show **status is read daily** and **a status change triggers an immediate full season scan** for that card; the 1st-of-month full scan was **removed**. TVmaze `/singlesearch/shows` is only called for shows that actually fetch seasons. **Dry run: 142 seasons → 14 fetched / 128 skipped (90%)**, 13 of 44 shows fetch anything, TVmaze 43 → 13.
- **Backfill merge (1B):** `_backfill_votes_impl()` runs at the end of the `sync_releases` run (cache warm) → the **05:10-05:20 restart penalty is gone**. Nested-run issue fixed (decorated `backfill_votes()` wrapper); the separate `follow_data_sync` cron is **kept** because it drives the "Score Check Sync" setting and costs **zero extra requests** thanks to the anchors.
- **Per-card 90/45-day anchors (4):** new `followed.added_at | season_check_at | detail_check_at` and `anime.added_at | detail_check_at` columns + `followed_anchor_ai` / `anime_anchor_ai` triggers (new card: +45/+90 days). **Existing cards were staggered once** (deterministic, id-based) so nothing is due today. Show detail+credits and **movie detail+credits every 90 days**; movies now use **a single request** (`append_to_response=credits`); unreleased/new movies (≤30 days) **daily**; anime finished 90 days / airing **weekly**. Card UI and the info modal are unchanged ("Refresh" forces an update).- **Feed trimming (5) — A+B+C+D:** (A) pool detail **pre-heating removed** → details only for **displayed cards**, backed by the persistent `rec_detail` cache; (B) in the 7 provider sources **movie/doc** details are never fetched (platform derived from the source, `source_provider`) — TV cards keep their `status` line; (C) `/discover` pages **3 → 2**; (D) **documentary pool monthly** (`feed_docs_last`). Rotation day/time settings are unchanged.
- **Measured (live):** `sync.releases` **293 → 79 requests**, duration **132 → 16.4 s**; including the separate backfill **351 → 79 requests (−77%)**; a single `run_end` is logged (`requests=79 cache=0 errors=0`).
- **Verified:** tier scenarios A-G ✓; migration test (columns + triggers + stagger, **idempotent**) ✓; `py_compile` all files ✓; `jsver bump` → **build 661** + `check` OK; module link test **LINK_TEMIZ**; pi `active`, `http=200`, panel matches the daily log (330).
- **Poster protection (same release):** `py/app_update.py` → `_sync_tree()` no longer deletes `static/images/posters` and `static/bak` (moved aside BEFORE rmtree, restored AFTER the copy; merged if the repo also has the path). Previously every update wiped the local poster cache: on pi4 the 23 Oct 19:11 update (2.19.27 → 2.20.0) deleted 4 show posters → cards returned 404. **Safety net:** if the poster file count drops after an update, the missing files are restored automatically from the snapshot (`code.tar.gz`). The lost pi4 posters were recovered via snapshot extraction + `py/migrate_posters.py` → **7 shows × w500/w185 all HTTP 200**.
- **Version:** 2.20.1 (pi DB `version` + `VERSION` in lockstep, `integrity_check=ok`). Backups: `bak/sorgu_plan_20261023_203519/` (code+DB), `bak/surum_2.20.1_20261023_211500/` (`nextep.db.pre` + `nextep.db`), `bak/poster_koruma_20261023_210123/` (local + pi5 + pi4 `app_update.py`).

## 2.20.0 - 23/10/2026-19:10
### TR
- **Minor sürüm damgası (kod değişikliği yok):** 2.19.28 → 2.19.30 arasındaki üç düzeltme bu sürümde toplu olarak işaretlendi. Sürüm numarası hem pi DB `version` tablosuna hem `VERSION` dosyasına yazıldı (dosya = DB, `integrity_check=ok`).
- **Kapsam özeti:**
  - **2.19.28** — bölüm başlığı büyüteci satır içi arama kutusunu açıyor; ilk karakterde `#section-results-modal` açılıp yazıya göre süzülüyor (kartlar azalıyor); kart tıklaması bilgi modalını açıyor, butonlar çalışıyor; `#section-results-modal` `z-index:190` ile bilgi ve takvim modalları artık panelin **üstünde**; filtre menüsünün sağ dikey kenarı turuncu dotted çizginin bitiş noktasına hizalı (mobil + masaüstü).
  - **2.19.29** — mobil dizi/film/belgesel/anime arama kutusu dotted çizginin **3px üstünde** (`top:auto; bottom:3px`) ve genişlik 100px.
  - **2.19.30** — aynı kutunun genişliği **125px**.
- **Kapsam dışı:** izlenmiş / izlenmemiş / arşiv / öneriler, masaüstü (`style.css`) ve APK/TV (`tv.css`) ölçüleri değişmedi.
- **Doğrulama:** `VERSION` = DB = **2.20.0**, `integrity_check=ok`; canlı `mobil.css?v=556`, `style.css?v=636`, JS build 660; servis `active`; restart gerekmedi.
- **Yedek:** pi `bak/surum_2.20.0_20261023_190657/` (`nextep.db.pre` + `nextep.db`).
### EN
- **Minor version stamp (no code change):** the three fixes from 2.19.28 → 2.19.30 are labelled under this release. The version was written to both the pi DB `version` table and the `VERSION` file (file = DB, `integrity_check=ok`).
- **Scope summary:**
  - **2.19.28** — the section-header magnifier opens the inline search box again; the first character opens `#section-results-modal` filtered by the typed text (cards decrease); a card click opens the info modal and its buttons work; with `#section-results-modal` at `z-index:190` the info and calendar modals now open **above** the panel; the filter menu's right vertical edge lines up with the end of the orange dotted line (mobile + desktop).
  - **2.19.29** — the mobile dizi/film/belgesel/anime search box sits **3px above** the dotted line (`top:auto; bottom:3px`) at 100px width.
  - **2.19.30** — the same box is **125px** wide.
- **Out of scope:** watched / unwatched / archive / recommendations, desktop (`style.css`) and APK/TV (`tv.css`) sizes unchanged.
- **Verified:** `VERSION` = DB = **2.20.0**, `integrity_check=ok`; live `mobil.css?v=556`, `style.css?v=636`, JS build 660; service `active`; no restart needed.
- **Backup:** pi `bak/surum_2.20.0_20261023_190657/` (`nextep.db.pre` + `nextep.db`).

## 2.19.30 - 23/10/2026-18:55
### TR
- **Mobil bölüm arama kutusu genişliği 125px:** dizi / film / belgesel / anime bölüm başlıklarındaki satır içi arama kutusu `100px` → **`125px`** (`width:125px; max-width:125px`). Konum değişmedi: butonun solunda (`right:92px`, arşiv anahtarı varken `122px`) ve **alt kenarı dotted turuncu çizginin 3px üstünde** (`top:auto; bottom:3px`).
- **Sadece mobil:** kural `html:not(.is-tv):not(.tv-mode)` + `@media (max-width:600px)` içinde → **masaüstü** (`style.css`, taban `width:230px`) ve **APK/TV** (`tv.css`, `html.is-tv`) **değişmedi**. İzlenmiş / izlenmemiş (`160px`, çizginin 3px altı), arşiv ve öneriler de aynı kaldı.
- **Cache-buster:** `mobil.css?v=555` → **556** (style 636, tablet 514, tv 561, JS build 660 aynı).
- **Doğrulama:** `git diff` yalnız `mobil.css` (2 satır + yorum) ve `index.html` (`?v=`) — başka dosya yok; CSS parantez 235/235, `BOM=0`, `U+FFFD=0`; pi'de md5 **eşit**, canlı `mobil.css?v=556`, servis `active`; statik → restart yok.
- **Sürüm:** 2.19.30 (DB `version` + `VERSION` eşit, integrity ok). Yedek: `bak/arama_kutusu_125px_20261023_185406/` — yerelde HEAD kopyaları; pi'de `mobil.css`, `index.html`, `nextep.db.pre` + `nextep.db`.
### EN
- **Mobile section search box width 125px:** the inline search box in the dizi / film / belgesel / anime headers goes `100px` → **`125px`** (`width:125px; max-width:125px`). Position unchanged: left of the button (`right:92px`, `122px` with the archive toggle) and its **bottom edge 3px above the orange dotted line** (`top:auto; bottom:3px`).
- **Mobile only:** the rule lives under `html:not(.is-tv):not(.tv-mode)` + `@media (max-width:600px)`, so **desktop** (`style.css`, base `width:230px`) and **APK/TV** (`tv.css`, `html.is-tv`) are **unchanged**. Watched / unwatched (`160px`, 3px below the line), archive and recommendations stay as they were.
- **Cache-buster:** `mobil.css?v=555` → **556** (style 636, tablet 514, tv 561, JS build 660 unchanged).
- **Verified:** `git diff` touches only `mobil.css` (2 declarations + comment) and `index.html` (`?v=`); CSS braces 235/235, `BOM=0`, `U+FFFD=0`; on pi md5-equal, `mobil.css?v=556` live, service `active`; static-only → no restart.
- **Version:** 2.19.30 (DB `version` + `VERSION` in lockstep, integrity ok). Backup: `bak/arama_kutusu_125px_20261023_185406/` — HEAD copies locally; on pi `mobil.css`, `index.html`, `nextep.db.pre` + `nextep.db`.

## 2.19.29 - 23/10/2026-18:40
### TR
- **Mobil bölüm arama kutusu konumu:** dizi / film / belgesel / anime bölüm başlıklarındaki satır içi arama kutusu artık **dotted turuncu yatay çizginin 3px üzerinde** duruyor — `top: 40%` + `translateY(-50%)` yerine `top: auto; bottom: 3px; transform: none` (kutunun **alt kenarı** çizgiye 3px mesafede; kutu kısa olduğu için üst kenarı başlığın ~2-3px üstüne taşabilir).
- **Genişlik 100px:** aynı dört bölümde kutu `170px` → **`100px`** (`width:100px; max-width:100px`). Önceki `max-width: calc(100vw - 130px)` (375px ekranda 245px hesaplanıyordu) kaldırıldı; artık sabit tavan.
- **Kapsam bilinçli olarak dar:** yalnız dizi/film/belgesel/anime. **İzlenmiş / izlenmemiş** (çizginin 3px altı, `160px`), **arşiv**, **öneriler**, **masaüstü** (`style.css` taban `width:230px`) ve **APK/TV** (`tv.css`, `html.is-tv`) ölçüleri **değişmedi** — yeni kural `html:not(.is-tv):not(.tv-mode)` + `@media (max-width:600px)` ile sınırlı.
- **Cache-buster:** `mobil.css?v=554` → **555** (JS build 660, `style.css?v=636`, tablet/tv aynı).
- **Doğrulama:** pi'de 2 dosya md5 eşit, `mobil.css?v=555` canlı, `repl=0` / `BOM=0`; statik değişiklik → restart yok, tarayıcıda **Ctrl+F5**.
- **Sürüm:** 2.19.29 (DB `version` + `VERSION` eşit, integrity ok). Yedek: `bak/arama_kutusu_100px_20261023_183756/` (yerel: HEAD kopyaları; pi: `mobil.css`, `index.html`, `nextep.db.pre` + `nextep.db`).
### EN
- **Mobile section search box position:** in the dizi / film / belgesel / anime headers the inline search box now sits **3px above the orange dotted horizontal line** — `top: 40%` + `translateY(-50%)` replaced by `top: auto; bottom: 3px; transform: none` (the box's **bottom edge** is 3px away from the line; since the box is short its top edge may stick ~2-3px above the header).
- **Width 100px:** in those four sections the box goes from `170px` to **`100px`** (`width:100px; max-width:100px`). The old `max-width: calc(100vw - 130px)` (245px on a 375px screen) is gone; the cap is now fixed.
- **Deliberately narrow scope:** only dizi/film/belgesel/anime. **Watched / unwatched** (3px below the line, `160px`), **archive**, **recommendations**, **desktop** (`style.css` base `width:230px`) and **APK/TV** (`tv.css`, `html.is-tv`) sizes are **unchanged** — the new rule is limited by `html:not(.is-tv):not(.tv-mode)` + `@media (max-width:600px)`.
- **Cache-buster:** `mobil.css?v=554` → **555** (JS build 660, `style.css?v=636`, tablet/tv unchanged).
- **Verified:** on pi both files md5-equal, `mobil.css?v=555` live, `repl=0` / `BOM=0`; static-only change → no restart, just **Ctrl+F5**.
- **Version:** 2.19.29 (DB `version` + `VERSION` in lockstep, integrity ok). Backup: `bak/arama_kutusu_100px_20261023_183756/` (local: HEAD copies; pi: `mobil.css`, `index.html`, `nextep.db.pre` + `nextep.db`).

## 2.19.28 - 23/10/2026-18:10
### TR
- **Düzeltme — bölüm başlığı büyüteci yine satır içi arama kutusunu açıyor:** 2.19.27'de kaldırılan eski akış geri geldi. Büyüteç (`#view-dizi`, `#view-film`, `#view-belgesel`, `#view-anime`, `#view-unwatched`, `#view-watched`, `#view-archive`) `.rec-search-input` kutusunu açar; masaüstünde butonun **soluna**, mobilde dizi/film/belgesel/anime için yine **butonun soluna** (buton 60px → kutu 92px, arşiv anahtarı varken 90px → 122px), izlenmiş/izlenmemiş ve arşivde **dotted turuncu çizginin 3px altına**, sağ kenarı çizginin bittiği noktaya hizalı.
- **Yazınca sonuç modalı açılır (kullanıcı seçimi):** kutuya **ilk karakter** yazıldığında kutu kapanır ve `#section-results-modal` açılır; yazılan metin modala devredilir (`value` + imleç sonda), yazıya **modalın kendi kutusunda** devam edilir. Kartlar yazıya göre süzülür, yazdıkça **azalır** (ek eşik yok); eşleşme yoksa "sonuç yok" satırı görünür.
- **Katman sırası düzeltildi:** `#section-results-modal` → `z-index: 190`, böylece **bilgi modalı** (detay / bölüm bilgisi) ve **takvim (releases) modalı** (`.modal-overlay`, `z-index: 200`) arama sonuç panelinin **üstünde** açılır; panel açık kalır, ESC **önce üstteki** modalı kapatır (yakalama fazı).
- **Filtre menüsü hizası (mobil + masaüstü):** menünün **sağ dikey kenarı** turuncu dotted çizginin sağ bitiş noktasıyla hizalı. Menü, konumlandırılmış `.section-sort-wrap`'in çocuğu olduğu için wrap'in sağ ofseti kadar **negatife** çekilir: dizi/film/belgesel/anime `-30px` (arşiv anahtarı varken `-60px`), izlenmiş/izlenmemiş + arşiv `-82px`, öneriler `-142px` (masaüstü) / `-122px` (mobil), öneri feed başlığı `-90px` (masaüstü) / `-75px` (mobil). Mobilde dizi/film/belgesel/anime menü ve kutuları aynı hizaya geldi.
- **Doğrulama:** `node --check static/js/views.js` OK; `py/jsver.py check` → **OK (build 660)**; modül grafı bağ testi **LINK_TEMIZ**; pi'de 15 dosya md5 eşit, `style.css?v=636` / `mobil.css?v=554` / `nextep.js?v=660`, `repl=0`, `moji=0`, `BOM=0`.
- **Sürüm:** 2.19.28 (DB `version` + `VERSION` eşit; `/api/app-update/check` güncelleme görmez). Yedek: pi `bak/bolum_arama_20261023_180637/` (15 dosya) + `bak/2.19.28_bolum_arama_20261023_180637/` (DB `nextep.db.pre` + `nextep.db`, integrity ok).
### EN
- **Fix — the section-header magnifier again opens the inline search box:** the pre-2.19.27 flow is back. The magnifier (`#view-dizi`, `#view-film`, `#view-belgesel`, `#view-anime`, `#view-unwatched`, `#view-watched`, `#view-archive`) opens the `.rec-search-input` box: on desktop to the **left of the button**; on mobile dizi/film/belgesel/anime also to the **left of the button** (button 60px → box 92px, with the archive toggle 90px → 122px), while watched/unwatched and archive open **3px below the orange dotted line**, right edge aligned with the line's end.
- **Typing opens the results modal (user's choice):** the **first character** closes the box and opens `#section-results-modal`, seeding it with the typed text (`value` + caret at the end); typing continues in the **modal's own input**. Cards are filtered as you type and **decrease**; an empty state is shown when nothing matches.
- **Stacking fixed:** `#section-results-modal` → `z-index: 190`, so the **info modal** (details / episode info) and the **calendar (releases) modal** (`.modal-overlay`, `z-index: 200`) open **above** the section results panel; the panel stays open and ESC closes the **top-most** modal first (capture phase).
- **Filter menu alignment (mobile + desktop):** the menu's **right vertical edge** lines up with the right end of the orange dotted line. Because the menu is a child of the positioned `.section-sort-wrap`, it is shifted **negatively** by the wrap's own offset: dizi/film/belgesel/anime `-30px` (`-60px` with the archive toggle), watched/unwatched + archive `-82px`, recommendations `-142px` (desktop) / `-122px` (mobile), recommendation feed header `-90px` (desktop) / `-75px` (mobile).
- **Verified:** `node --check` OK; `py/jsver.py check` → **OK (build 660)**; module graph link test **LINK_TEMIZ**; on pi 15 files md5-equal, `style.css?v=636` / `mobil.css?v=554` / `nextep.js?v=660`, `repl=0`, `moji=0`, `BOM=0`.
- **Version:** 2.19.28 (DB `version` + `VERSION` in lockstep; `/api/app-update/check` reports no update). Backup: pi `bak/bolum_arama_20261023_180637/` (15 files) + `bak/2.19.28_bolum_arama_20261023_180637/` (DB `nextep.db.pre` + `nextep.db`, integrity ok).

## 2.19.27 - 23/10/2026-02:25
### TR
- **Düzeltme — bölüm içi arama artık kendi sonuç modalını açıyor (Tasarım B):** bölüm başlıklarındaki büyüteç (`#view-dizi`, `#view-film`, `#view-belgesel`, `#view-anime`, `#view-unwatched`, `#view-watched`, `#view-archive`) daha önce yalnızca sayfadaki kartları satır içi süzüyordu; açılan bir panel yoktu. Artık `#section-results-modal` açılıyor: karta tıklama **bilgi modalını** açar (bölüme atlamaz), kartın kendi butonları (izle / izlemeyi geri al / arşivle / takibi bırak) **çalışır** ve arama paneli **açık kalır**. Kartlar kopyalanmaz, bölümün kendi grid'inden **taşınır** → her bölümün kendi handler'ları birebir korunur.
- **LOKAL ARA değişmedi:** `#local-search-modal` içinde kart tıklaması yine bölüme atlar ve "uçan kart" animasyonu çalışır (2.19.12 / 2.19.21 davranışı aynen korunur).
- **Satır içi filtre kaldırıldı:** `applyFollowSectionState` artık yalnızca sıralama yapar; bölümlerdeki gizli `rec-search-input` açılır kutusu kullanılmıyor (öneri bölümlerinin kendi satır içi araması olduğu gibi duruyor).
- **Tazeleme:** arşivle / arşivden çıkar / takibi bırak gibi işlemlerden sonra `app:lists-refreshed` olayı paneli bölümün **taze** kartlarıyla yeniden doldurur (bayat kart kalmaz). Kapatınca kartlar bölüme geri döner ve bölüm özeti (dotted çizgi altı) yeniden hesaplanır.
- **Klavye/modal davranışı:** ESC **yakalama** fazında çalışır — üstte bilgi/takvim/onay modalı varsa önce **o** kapanır, arama paneli açık kalır; üstte modal yoksa panel kapanır. Mobilde (≤600px) panel person-modal ölçüsünde ortada açılır ve kartlar `--card-w` ölçüsünü kullanır; TV'de arama sonuç modalıyla aynı 2 seviyeli gezinme + buton modu (aşağı = ilk kart).
- **Öneriler — "İzlenmişlere taşı" TÜM kartlarda:** eski `_can_move_watched` koşulu (anime FINISHED/CANCELLED, dizi Ended/Canceled, film yayınlanmış) kaldırıldı, fonksiyon artık `True` döner. Uç, yapımı takip eder (yoksa oluşturur) ve tüm bilinen bölümlerini izlenmiş işaretler.
- **Öneriler — yeni "Arşive taşı" butonu (TÜM kartlar):** yeni `POST /api/recommendations/archive` ucu yapımı **sadece arşive taşır** (takipte yoksa oluşturur, `archived=1`); izlenmiş işaretlemez. Yapım Arşiv bölümünde görünür, oradan "arşivden çıkar" ile geri alınabilir; öneri listesinden kart kalkar. Feed ve bölüm önerilerinde çalışır, TV satır görünümüne `archive` yuvası eklendi.
- **Doğrulama:** `node --check` (views/tv/rowview) + `py_compile` (recommendations, routes/recommendations) OK; `jsver.py check` → OK.
- **Sürüm:** 2.19.27 (DB `version` + `VERSION` eşit). Yedek: `bak/2.19.27_bolum_arama_modal_<ts>/`.
### EN
- **Fix — section search now opens its own results modal (Design B):** the magnifier in each section header (`#view-dizi`, `#view-film`, `#view-belgesel`, `#view-anime`, `#view-unwatched`, `#view-watched`, `#view-archive`) used to filter the on-page cards inline; there was no panel at all. It now opens `#section-results-modal`: clicking a card opens the **info modal** (no jump to the section), the card's own buttons (watch / unwatch / archive / unfollow) **work**, and the search panel **stays open**. Cards are not cloned, they are **moved** from the section grid, so every section keeps its own handlers untouched.
- **LOKAL ARA unchanged:** inside `#local-search-modal` a click still jumps to the section and plays the "flying card" animation (2.19.12 / 2.19.21 behaviour preserved).
- **Inline filter removed:** `applyFollowSectionState` now only sorts; the hidden `rec-search-input` dropdown is no longer used for follow sections (the recommendation sections keep their own inline search).
- **Refresh:** after archive / unarchive / unfollow, the `app:lists-refreshed` event refills the panel with the section's **fresh** cards (no stale cards). Closing returns the cards to the section and recomputes the section summary (below the dotted line).
- **Keyboard/modal behaviour:** ESC runs in the **capture** phase — if an info/calendar/confirm modal is on top, **it** closes first and the search panel stays open; with no modal on top the panel closes. On mobile (≤600 px) the panel opens centred at person-modal size using `--card-w` cards; on TV it gets the same two-level navigation + button mode as the search results modal (down = first card).
- **Recommendations — "Move to watched" on ALL cards:** the old `_can_move_watched` gate (anime FINISHED/CANCELLED, show Ended/Canceled, released movie) is gone; the function returns `True`. The endpoint follows the title (creating it if needed) and marks every known episode as watched.
- **Recommendations — new "Move to archive" button (ALL cards):** the new `POST /api/recommendations/archive` endpoint **only archives** the title (follows it if needed, sets `archived=1`); it is not marked watched. The title shows up in Archive and can be unarchived there; the card leaves the recommendation list. Works in the feed and in section recommendations, with a new `archive` slot in TV row view.
- **Verified:** `node --check` (views/tv/rowview) + `py_compile` (recommendations, routes/recommendations) OK; `jsver.py check` → OK.
- **Version:** 2.19.27 (DB `version` + `VERSION` in lockstep). Backup: `bak/2.19.27_bolum_arama_modal_<ts>/`.

## 2.19.26 - 22/10/2026-05:20
### TR
- **Düzeltme — sorgu günlüğünde tarih iki kez yazılıyordu:** her satırda hem `t` (tam ISO zaman) hem `d` (hesap günü) vardı; `d` hiçbir yerde okunmuyordu (`stats_today`, `summarize_file`, `day_totals` yalnız `t` ve dosya adını kullanıyor). `d` alanı kaldırıldı — tarihin tek kaynağı `t`, gün bilgisi ayrıca dosya adından da belli (canlı dosya tek hesap günü tutar, 05:00'te `query-YYYY-MM-DD.jsonl` olarak devreder).
- **Geriye dönük uyum:** eski satırlardaki `d` alanı **olduğu gibi bırakıldı** (okuyan yok, yeniden yazma riski alınmadı). Yani bugünkü dosyada iki biçim yan yana bulunabilir; ayrıştırıcılar ikisini de sorunsuz okur. Satır başına ~23 bayt azaldı.
- **Doğrulama:** `py_compile` OK; 18 maddelik test paketi **ALL_OK 18**; yeni satırda `d` yok / `t` var, `stats_today` ve günlük özet çalışıyor; pi'de servis `active`.
- **Sürüm:** 2.19.26 (DB `version` + `VERSION` eşit). Yedek: `bak/2.19.26_qlog_tarih_<ts>/`.
### EN
- **Fix — the query log carried the date twice:** each line had both `t` (full ISO time) and `d` (billing day), yet `d` was never read (`stats_today`, `summarize_file` and `day_totals` only use `t` and the file name). The `d` field was removed — `t` is the single source of the date, and the day is also implied by the file name (the live file holds one billing day and rotates to `query-YYYY-MM-DD.jsonl` at 05:00).
- **Backwards compatible:** `d` in existing lines was **left untouched** (nothing reads it; no rewrite risk). So today's file may contain both shapes; parsers handle either. Saves ~23 bytes per line.
- **Verified:** `py_compile` OK; 18-case test suite **ALL_OK 18**; new lines have no `d` but keep `t`, `stats_today` and the daily summary still work; service `active` on the Pi.
- **Version:** 2.19.26 (DB `version` + `VERSION` in lockstep). Backup: `bak/2.19.26_qlog_tarih_<ts>/`.

## 2.19.25 - 22/10/2026-05:00
### TR
- **Yeni — sorgu günlüğü (`log/query.log`):** her dış HTTP isteği tek satır JSON olarak yazılır: `svc` (tmdb/anilist/tvmaze/trakt/notify/update/geo/img/emby), `tag` (hangi kural), `sec` (hangi bölüm), `card`/`ids` (hangi kart), `ms`, `st`, `src` (`net`/`cache`), `u` (uid) ve varsa `err`. Aynı istek grubu `run` kimliğiyle işaretlenir; iş sonunda `run_end` özeti (istek/önbellek/hata sayısı) düşer. Gizli alanlar (`api_key`, `token`, `secret`, `password`, `authorization`) **hiç yazılmaz**.
- **Gün devri 05:00:** hesap günü 05:00'te kapanır; `query.log` → `query-YYYY-MM-DD.jsonl` olarak arşivlenir (30 gün) ve aynı gün için otomatik **Markdown özet** üretilir (`query-YYYY-MM-DD.md`, 365 gün): kurala/saatlik dağılım, en çok sorgulanan kartlar, tekrar eden URL'ler, en yavaş istekler, hatalar.
- **A0 — feed haftalık tazeleme fırtınası kesildi:** `refresh_feed_source()` artık `force=True` kullanmıyor. Eski davranış her hafta havuzun **tamamının** (2 kaynak × 60 dizi + 60 film) detayını yeniden çekiyordu (~360 TMDB isteği / 20 dk); yeni davranış yalnızca `rec_detail`'te **kaydı olmayan** öğeleri çeker.
- **A1 — Trakt eşit cursor döngüsü:** `watched_at` dakikaya yuvarlandığı için cursor'a eşit kayıt her yoklamada (10 sn) yeniden işleniyordu (Yeraltı S02E03 → 10 sn'de 1 TMDB isteği). `tp_trakt_in_seen` (son 100 öğe anahtarı) eklendi; aynı öğe bir kez işlenir.
- **A2 — anime sezgisi memo:** `_is_anime_like` sonucu yeni `tmdb_anime_probe` tablosunda 90 gün saklanır; aynı TMDB id'si için tekrar sorgu atılmaz. `_tmdb_find` artık ortak TMDB önbelleğini kullanır.
- **B1 — TMDB yanıt önbelleği (6 saat, 500 kayıt):** aynı `(path, params, dil)` tekrar sorulmaz; kullanıcı kaynaklı yenilemeler `no_cache=True` ile baypas eder. Önbellek isabetleri de günlüğe `src=cache` olarak yazılır.
- **B2 — tek istekte detay:** `/api/follow`, `/api/details` ve Stremio takip oluşturma `append_to_response=credits,aggregate_credits` ile **tek** TMDB isteği yapar; başlık/kadro/yönetmen aynı yanıttan üretilir.
- **Açılış yükü:** `nextep.py` açılışında `backfill_votes()` **çağrılmıyor** (05:10 cron'u duruyor). `rate_track` gün-ici toplam/pik değerlerini açılışta canlı günlükten geri hesaplar — restart sonrası gösterge sıfırlanmış görünmez.
- **Ayar:** `query_log_level` (`info` varsayılan / `debug`). `debug` seviyesinde görsel indirme (img) ve Emby (LAN) satırları da yazılır.
### EN
- **New — query log (`log/query.log`):** every outbound HTTP request is one JSON line: `svc` (tmdb/anilist/tvmaze/trakt/notify/update/geo/img/emby), `tag` (which rule), `sec` (which section), `card`/`ids` (which card), `ms`, `st`, `src` (`net`/`cache`), `u` (uid) and optional `err`. Requests are grouped under a `run` id, closed by a `run_end` summary (requests/cache hits/errors). Secrets (`api_key`, `token`, `secret`, `password`, `authorization`) are **never written**.
- **05:00 rotation:** the billing day ends at 05:00; `query.log` is moved to `query-YYYY-MM-DD.jsonl` (kept 30 days) and an automatic **Markdown summary** is generated (`query-YYYY-MM-DD.md`, kept 365 days): per-rule/hourly split, most-queried cards, repeated URLs, slowest requests, errors.
- **A0 — feed weekly refresh storm removed:** `refresh_feed_source()` no longer uses `force=True`. The old behaviour re-fetched details for the **entire** pool every week (2 sources × 60 shows + 60 movies, ~360 TMDB requests in 20 min); now only entries **missing** from `rec_detail` are fetched.
- **A1 — Trakt equal-cursor loop:** because `watched_at` is rounded to the minute, an entry equal to the cursor was re-processed on every poll (10 s), e.g. Yeraltı S02E03 → 1 TMDB request every 10 s. Added `tp_trakt_in_seen` (last 100 item keys) so each entry is processed once.
- **A2 — anime probe memo:** `_is_anime_like` results are cached for 90 days in the new `tmdb_anime_probe` table; `_tmdb_find` now shares the TMDB response cache.
- **B1 — TMDB response cache (6 h, 500 entries):** identical `(path, params, language)` is not re-queried; user-triggered refreshes bypass it with `no_cache=True`. Cache hits are logged as `src=cache`.
- **B2 — single-request details:** `/api/follow`, `/api/details` and Stremio follow creation use `append_to_response=credits,aggregate_credits` (**one** TMDB request); title/cast/directors come from the same payload.
- **Startup load:** `backfill_votes()` is **no longer called** at startup (the 05:10 cron stays). `rate_track` restores the day's totals/peak from the live log after a restart, so the gauge no longer appears reset.
- **Setting:** `query_log_level` (`info` default / `debug`); `debug` also logs poster downloads (img) and Emby (LAN) lines.

## 2.19.24 - 22/10/2026-01:40
### TR
- **Sürüm damgası senkronizasyonu — kod değişikliği yok.** 2.19.23'ün (satır görünümünde "uçan kart" küçülerek yok olma + yeşil satır bandı vurgusu) dağıtımı sonrası sürüm hem `VERSION` dosyasında hem pi5 DB'sindeki `version` tablosunda (`id=1`) eşitlenerek ilerletildi: **2.19.23 → 2.19.24**.
- **Doğrulanan durum:** yerel `VERSION` = pi5 `/etc/nextep/VERSION` = pi5 DB `version.number` = **2.19.24**; `/api/app-update/check` → `available:false` (dosya ≠ DB sapması yok, `check_update()` dosyayı geri yazmıyor). Statik dosyalar (16 JS `?v=658`, `style.css?v=635`, `mobil 553`, `tv 561`) ve `index.html` yerel ↔ pi5 **md5 0 fark**; `jsver check` → `OK (build 658)`; servis `active`, **restart gerekmedi**.
- **Not:** Bu sürüm yalnız sürüm taşıma/parite kaydıdır; işlevsel fark yoktur. Yedek: `bak/2.19.24_surum_senkron_20261022_013745/` (yerel + pi, `nextep.db` dahil).
### EN
- **Version stamp synchronisation — no code change.** After shipping 2.19.23 (the "flying card" shrinking into the row's visible centre + green row band highlight in row view), the version was advanced from **2.19.23 to 2.19.24** with both the `VERSION` file and the `version` table (`id=1`) in the pi5 database kept in lockstep.
- **Verified state:** local `VERSION` = pi5 `/etc/nextep/VERSION` = pi5 DB `version.number` = **2.19.24**; `/api/app-update/check` → `available:false` (no file/DB drift, `check_update()` does not rewrite the file). Static assets (16 JS `?v=658`, `style.css?v=635`, `mobil 553`, `tv 561`) and `index.html` show **0 md5 difference** local ↔ pi5; `jsver check` → `OK (build 658)`; service `active`, **no restart needed**.
- **Note:** This release is a version/deployment-parity record only; no functional change. Backup: `bak/2.19.24_surum_senkron_20261022_013745/` (local + pi, `nextep.db` included).

## 2.19.23 - 22/10/2026-01:45
### TR
- **Düzeltme + yeni — satır görünümünde "uçan kart" davranışı:** hedef bölüm **satır görünümündeyse** (`.poster-grid.row-mode` → `.card` = `display: table-row`) klon artık kart **gibi büyümüyor**; tıklanan kartın klonu **satırın ekranda görünen kısmının tam ortasına doğru tamamen küçülerek yok oluyor** (`scale(2) → scale(0)` + opaklık 0, 0.5 sn). Sebep: eski `flyTo()` ölçeği `hedefGenişlik / klonGenişlik` ile hesaplıyordu; satırın genişliği ~1200px, kart ~96px → **≈12× büyüme**, yani kart "büyüyüp kayboluyordu".
- **Satır vurgusu (çerçeve yerine):** hedefe `.jump-target` (outline) **verilmiyor**; onun yerine satıra `.row-jump-target` ekleniyor → satırın **üst ve alt çizgisi yeşil** (`#22c55e`), **satır zemini aynı yeşilin %30'u** (`rgba(34,197,94,0.30)`), **3 sn** sonra yumuşak sönüş (`@keyframes row-jump-glow`, `forwards`).
- **"Görünen kısmın ortası" hesabı (`localRowVisibleCenter`):** satır rect'i hem **viewport** hem de yatay kaydırma sargısı (`.row-hscroll`) ile **kırpılır** → merkez gerçekten kullanıcının gördüğü bant olur. `scrollIntoView` sırasında sargının `scrollLeft`'i saklanıp geri yazılır → satır **yatayda kaymaz**.
- **Layout kayması yok:** çizgiler gerçek `border` yerine `box-shadow: inset` + `border-bottom-color` ile çizilir → satır yüksekliği ve komşu satırlar oynamaz.
- **Kart görünümü DEĞİŞMEDİ:** kart modunda akış birebir aynı (klon hedef kartın üstüne 1:1 küçülür, kartta 3 sn yeşil çerçeve, klon uçuşu sırasında gerçek kart `visibility:hidden`). Değişiklik yalnız satır modunda geçerli — mobil / masaüstü / TV-APK aynı.
- **Damga:** `jsver bump` → tüm JS `?v=658`, `__NX_BUILD 658`; `style.css?v=634 → 635` (`mobil 553`, `tv 561` sabit). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5 / APK'da uygulamayı yenile).
### EN
- **Fix + new — "flying card" behaviour in row view:** when the target section is in **row view** (`.poster-grid.row-mode` → `.card` = `display: table-row`) the clone no longer grows like a card; it **shrinks completely and disappears into the exact centre of the row's visible part on screen** (`scale(2) → scale(0)` + opacity 0, 0.5 s). Cause: the old `flyTo()` computed the scale as `targetWidth / cloneWidth`; a row is ~1200 px wide and the card ~96 px → **≈12× growth**, i.e. the card "grew and vanished".
- **Row highlight (instead of a frame):** the target does **not** get `.jump-target` (outline); instead the row gets `.row-jump-target` → the row's **top and bottom lines turn green** (`#22c55e`) and the **row background becomes the same green at 30%** (`rgba(34,197,94,0.30)`), fading out after **3 s** (`@keyframes row-jump-glow`, `forwards`).
- **"Centre of the visible part" (`localRowVisibleCenter`):** the row rect is clipped by both the **viewport** and the horizontal scroll wrapper (`.row-hscroll`) so the centre is really the band the user sees. The wrapper's `scrollLeft` is saved and restored around `scrollIntoView` → the row does **not** jump horizontally.
- **No layout shift:** the lines are drawn with `box-shadow: inset` + `border-bottom-color` instead of real borders → row height and neighbouring rows stay put.
- **Card view UNCHANGED:** in card mode the flow is identical (clone shrinks 1:1 onto the target card, green frame for 3 s, real card `visibility:hidden` during the flight). The change applies to row mode only — mobile / desktop / TV-APK alike.
- **Stamps:** `jsver bump` → all JS `?v=658`, `__NX_BUILD 658`; `style.css?v=634 → 635` (`mobil 553`, `tv 561` unchanged). Static-only change → **no service restart needed** (Ctrl+F5 / reopen the APK).

## 2.19.22 - 22/10/2026-01:30
### TR
- **Düzeltme — LOKAL ARA "uçan kart" ekranın ortasında değil sol üst köşede çıkıyordu (mobil + masaüstü):** 2.19.21'de klon `position: fixed` olarak ekleniyordu ama **`left/top` atanmıyordu** (CSS'teki `left:0; top:0` geçerliydi); buna karşın ilk `transform` **kaynak kartın ekran merkezine göre** hesaplanıyordu. Sonuç: klon `(0,0)` noktasından yola çıkıp `(viewportMerkezi − kaynakKartMerkezi)` kadar kayıyordu → kart modalın sağındaysa büyük klon **sol üst köşede, %75'i ekranın dışında** görünüyordu. Aynı referans hatası uçuş hedefini de kaydırıyordu.
- **Düzeltme (`search.js` → `makeLocalFly`):** ① klon artık **kaynak kartın ekran konumuna** yerleştiriliyor (`el.style.left = r.left; el.style.top = r.top`), ② `body`'ye eklendikten **sonra klonun KENDİ `getBoundingClientRect()`'i** ölçülüp transform o rect'in merkezinden kuruluyor (**kendini düzelten hesap** — CSS/sınıf farkı olsa bile kaymaz), ③ `flyTo()` aynı ölçülen merkezi referans alıyor → varış da hedef kartın **tam merkezi**. Ayrıca ilk çizimde `transition:none` → büyük kart **anında** ortada belirir (kaynak konumdan ortaya "kayma" animasyonu yok); uçuşta `transition` `flyTo()` içinde açıkça verilir.
- **Sonuç:** tıklanan kartın klonu 1 sn **ekranın tam ortasında %100 büyük** yeşil çerçeveyle durur → 0.5 sn'de hedef kartın satır/sırasına uçar → hedefte 3 sn yeşil çerçeve (2.19.21 davranışı aynen korunur). Mobil / masaüstü / TV-APK **tek akış**.
- **Damga:** `jsver bump` → tüm JS `?v=657`, `__NX_BUILD 657`; CSS değişmedi (`style 634`, `mobil 553`, `tv 561`). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5 / APK'da uygulamayı yenile).
### EN
- **Fix — the LOCAL SEARCH "flying card" appeared in the top-left corner instead of the middle of the screen (mobile + desktop):** in 2.19.21 the clone was appended with `position: fixed` but **`left/top` were never set** (the CSS `left:0; top:0` applied), while the initial `transform` was computed **relative to the source card's screen centre**. Result: the clone started from `(0,0)` and was shifted by `(viewport centre − source card centre)`, so when the card sat on the right side of the modal the big clone **landed in the top-left corner with ~75% of it off-screen**. The same reference error also offset the flight target.
- **Fix (`search.js` → `makeLocalFly`):** (1) the clone is now placed **at the source card's screen position** (`el.style.left = r.left; el.style.top = r.top`), (2) after appending, the clone's **own `getBoundingClientRect()`** is measured and the transform is built from that centre (**self-correcting math** — it cannot drift even if CSS/classes differ), (3) `flyTo()` uses the same measured centre → it lands on the target card's **exact centre**. Also `transition:none` on the first paint, so the enlarged card appears **instantly** centred (no slide from the source position to the middle); the flight transition is set explicitly in `flyTo()`.
- **Result:** the tapped card's clone stays 1 s **exactly in the middle of the screen at 100% larger size** with a green frame → flies to the target card's row/position in 0.5 s → keeps the green frame for 3 s on the target (2.19.21 behaviour preserved). Mobile / desktop / TV-APK share the **same flow**.
- **Stamps:** `jsver bump` → all JS `?v=657`, `__NX_BUILD 657`; CSS unchanged (`style 634`, `mobil 553`, `tv 561`). Static-only change → **no service restart needed** (Ctrl+F5 / reopen the APK).

## 2.19.21 - 22/10/2026-01:20
### TR
- **Yeni — LOKAL ARA sonucundan bölüme atlarken "uçan kart" animasyonu (mobil / masaüstü / TV-APK aynı akış):** sonuç kartına tıklanınca (dokununca / TV'de OK) ilgili bölüm açılır ve tıklanan kartın **klonu ekranın TAM ORTASINDA %100 BÜYÜK** (`scale(2)`) **yeşil çerçeveyle 1 sn** görünür; ardından **0.5 sn**'lik bir animasyonla (`translate + tek tip scale`, `cubic-bezier(.2,.8,.2,1)`) kartın **bulunduğu satır ve sıraya uçup küçülerek yerine oturur** ve gerçek kartta **3 sn daha yeşil çerçeve** kalır (2.19.12'den beri var olan `jump-glow` vurgusu). Toplam: 1 sn bekleme + 0.5 sn uçuş + 3 sn vurgu.
- **Nasıl (JS, `search.js`):** yeni `makeLocalFly(srcCard)` — tıklanan kartın `cloneNode(true)` kopyası `body`'ye eklenir; `position:fixed`, boyutu kaynak kartın rect'i, başlangıç dönüşümü `translate(viewportMerkezi − kartMerkezi) scale(2)`; `.card.local-fly-card` sınıfı yeşil `outline` + halka gölge verir, `pointer-events:none` olduğu için hiçbir dokunuşu engellemez. `flyTo(rect,ms)` hedef rect'in merkezine `translate` + `s = hedefGenişlik / klonGenişlik` **tek tip** ölçekle uçurur (satır görünümünde/kart boyu farklı olduğunda bozulma olmaz). `jumpToLocalCard(item, kind, srcCard)` artık kaynak kartı alır ve faz makinesiyle çalışır: `hold` (1 sn) → `fly` (0.5 sn) → `glow` (3 sn) → `finish`.
- **Davranış detayları:** uçuş başlarken hedef `scrollIntoView({block:"center"})` ile görünür alana getirilir ve ölçülür; ölçüm sırasında gerçek kart `visibility:hidden` (uçuş bitince geri açılır) → çift görüntü olmaz. Uçuş bitince klon kaldırılır, hedefe `.jump-target` + `tabIndex` + `focus` verilir (TV'de D-pad kaldığı yerden devam eder). Kart 6 sn içinde gelmezse klon **fade-out** ile söner; hedef rect `0×0` (gizli grid) ise uçuş atlanır, doğrudan fokus + 3 sn çerçeve uygulanır; kullanıcı 1 sn'lik bekleme sırasında sayfaya dokunur/kaydırırsa animasyon iptal edilir (klon söner); 15 sn mutlak güvenlik sınırı vardır. Grid yeniden çizilirse sınıf/fokus 120 ms'lik döngüyle tazelenir (2.19.15/2.19.16 yarış koruması korunur).
- **CSS (`style.css`):** `.card.local-fly-card` (`position:fixed`, `z-index:900` → modal overlay 200 ve toast/özel katmanlar 300-400'ün üstünde, `transform-origin:center`, `transition: transform .5s`), yeşil `outline` + `box-shadow` halkası; klonda `.poster-top button { display:none }` (görüntü sadece gösterim). Seçici `.card.local-fly-card` (0,2,0) → `.card`'ın kendi `transition/transform` kuralını ezer.
- **Platform:** mobilde `position:fixed` + `window.innerWidth/innerHeight` → URL çubuğu/klavye oynasa da tam ortada; TV/APK'da kartın OK keydown'ı `div.click()` ürettiği için aynı akış çalışır, klon `--tv-scale` ölçeklerini miras alır (ek TV kodu yok).
- **Damga:** `jsver bump` → tüm JS `?v=656`, `__NX_BUILD 656`; `style.css?v=633 → 634` (`mobil 553`, `tv 561` sabit). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5 / APK'da uygulamayı yenileme).
### EN
- **New — "flying card" animation when jumping from LOCAL SEARCH results to a section (mobile / desktop / TV-APK share one flow):** tapping (or pressing OK on TV) a result card opens the target section and shows a **clone of the tapped card at 100% larger size (`scale(2)`) exactly in the middle of the screen, framed in green, for 1 second**; then a **0.5 s** animation (`translate + uniform scale`, `cubic-bezier(.2,.8,.2,1)`) **flies it to the card's actual row/position and shrinks it into place**, after which the real card keeps a **green frame for another 3 s** (the `jump-glow` highlight that has existed since 2.19.12). Total: 1 s hold + 0.5 s flight + 3 s highlight.
- **How (JS, `search.js`):** new `makeLocalFly(srcCard)` — a `cloneNode(true)` copy of the tapped card is appended to `body`; `position:fixed`, sized to the source rect, initial transform `translate(viewport centre − card centre) scale(2)`; the `.card.local-fly-card` class adds the green `outline` + ring shadow, and `pointer-events:none` keeps it from blocking any input. `flyTo(rect,ms)` moves it to the target rect's centre with `translate` + **uniform** `s = targetWidth / cloneWidth` (no distortion when the card size differs, e.g. row view). `jumpToLocalCard(item, kind, srcCard)` now receives the source card and runs a phase machine: `hold` (1 s) → `fly` (0.5 s) → `glow` (3 s) → `finish`.
- **Behaviour details:** before the flight the target is brought into view with `scrollIntoView({block:"center"})` and measured; the real card is `visibility:hidden` during the flight (restored afterwards) so there is no double image. When the flight ends the clone is removed and the target gets `.jump-target` + `tabIndex` + `focus` (on TV the D-pad continues from there). If the card never appears within 6 s the clone **fades out**; if the target rect is `0×0` (hidden grid) the flight is skipped and the plain focus + 3 s frame path is used; interaction during the 1 s hold cancels the animation (clone fades); a 15 s absolute safety timer exists. If the grid re-renders, the class/focus are refreshed by the 120 ms loop (the 2.19.15/2.19.16 race protection is preserved).
- **CSS (`style.css`):** `.card.local-fly-card` (`position:fixed`, `z-index:900` → above the modal overlay 200 and toast/custom layers 300-400, `transform-origin:center`, `transition: transform .5s`), green `outline` + `box-shadow` ring; `.poster-top button { display:none }` inside the clone (display only). The `.card.local-fly-card` selector (0,2,0) overrides `.card`'s own `transition/transform`.
- **Platforms:** on mobile `position:fixed` + `window.innerWidth/innerHeight` keeps it dead-centre regardless of the URL bar/keyboard; on TV/APK the card's OK keydown produces `div.click()`, so the same flow runs and the clone inherits the `--tv-scale` sizes (no extra TV code).
- **Stamps:** `jsver bump` → all JS `?v=656`, `__NX_BUILD 656`; `style.css?v=633 → 634` (`mobil 553`, `tv 561` unchanged). Static-only change → **no service restart needed** (Ctrl+F5 / reopen the APK).

## 2.19.20 - 22/10/2026-01:05
### TR
- **Düzeltme — 2.19.19'da büyüme animasyonu yanlışlıkla KALDIRILMIŞTI, geri getirildi:** "kart dokunup tutunca büyüyor ve modal dışına taşıyor" şikâyeti animasyonu sıfırlayarak çözülmüştü (`#local-search-modal .card:hover { transform:none … }`). İstenen bu değildi → o kural **silindi**, `.card:hover` (`scale(1.06)` + turuncu halka + `z-index:5`) lokal sonuç modalında da aynen çalışır.
- **Doğru çözüm — kart büyüdüğünde TAM SIĞACAK kadar küçültüldü:** lokal modal grid'inde (≤480px) `width: calc((100% - 16px) / 3.06)` (16px = 2 × 8px gap). 3 yerine **3.06** bölen: `scale(1.06)` büyümesinin yarısı (%3) her yana **büyüme payı** bırakır; satır `justify-content:center` ile ortalandığı için kalan boşluk iki yana **eşit** dağılır → büyümüş kartın sol/sağ kenarı modal kenarına **tam oturur, taşma 0**. Ölçüler kullanıcının verdiği değerlerle birebir: taban kart **95.9562 × 222.9371px** (taban genişlik = eski 101.71 / 1.06; yükseklik poster 2:3 = 143.93px + sabit bilgi bloğu 79.0px), büyümüş hâli 101.71px. 481-600px aralığında `--card-w` sabit **120px** (tablet.css) ve 3×120 + 24 = 384px modala bol bol sığdığı için **dokunulmadı**.
- **Değişiklik — "{n} Sonuç" bilgisi sola yanaştırıldı (mobil):** `#local-search-modal .local-search-count { text-align: left }`. Turuncu dotted çizgi tam genişlikte kalır, sayaç çizginin **sol üstünde**; tür özeti çizginin altında (solda) aynen durur. Masaüstü/TV'de sağ hizalı düzen korunur.
- **Düzeltme — en üstteki kartlar tür özetine neredeyse bitişikti:** grid `padding:16px / margin:-16px` olduğu için kartlar özetin dibinden (0px) başlıyor, büyüyünce (%3 × 222.94 ≈ **6.7px** yukarı) özet metnine değiyordu. Lokal modal grid'ine `padding-top: 26px` verildi → **net taban boşluk 10px**; büyümüş kartın **üst border'ı tür özetinin ~3px altına** gelir (10 − 6.7 ≈ 3.3px). Gerekirse `24px` ile 1–2px daha sıkı ayarlanabilir.
- **Damga:** JS **değişmedi** (`?v=655`, `__NX_BUILD 655` sabit — `jsver check` OK); yalnız `mobil.css?v=552 → 553` (`style.css 633` ve `tv.css 561` sabit, style.css'e dokunulmadı). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5).
### EN
- **Fix — the card grow animation had been removed by mistake in 2.19.19; it is back:** the "card grows on touch-and-hold and overflows the modal" complaint had been solved by neutralising the animation (`#local-search-modal .card:hover { transform:none … }`). That is not what was asked for → the rule is **deleted**; `.card:hover` (`scale(1.06)` + orange ring + `z-index:5`) works inside the local results modal again.
- **Correct fix — the base card is shrunk just enough to fit when it grows:** in the local modal grid (≤480px), `width: calc((100% - 16px) / 3.06)` (16px = 2 × 8px gap). Dividing by **3.06** instead of 3 leaves half of the `scale(1.06)` growth (3%) as **headroom** on each side; because the row is centred with `justify-content:center`, the leftover space is distributed **evenly** → the grown card's left/right edge sits **exactly on the modal edge, zero overflow**. The sizes match the numbers the user measured exactly: base card **95.9562 × 222.9371px** (base width = previous 101.71 / 1.06; height = 2:3 poster 143.93px + fixed 79.0px info block), grown width 101.71px. The 481-600px range is **untouched** (fixed `--card-w: 120px` from tablet.css; 3×120 + 24 = 384px already fits the modal with room to spare).
- **Change — "{n} Results" is now left-aligned (mobile):** `#local-search-modal .local-search-count { text-align: left }`. The orange dotted line keeps its full width, the count sits **above its left end**, and the kind summary stays below the line on the left. Desktop/TV keep the right-aligned layout.
- **Fix — the top row of cards was almost touching the kind summary:** the grid uses `padding:16px / margin:-16px`, so cards started right at the summary (0px) and touched it when growing upward (3% × 222.94 ≈ **6.7px**). The local modal grid now has `padding-top: 26px` → **10px base gap**, so the grown card's **top border lands ~3px below the kind summary** (10 − 6.7 ≈ 3.3px). `24px` can be used if 1-2px tighter is preferred.
- **Stamps:** JS **unchanged** (`?v=655`, `__NX_BUILD 655`; `jsver check` OK); only `mobil.css?v=552 → 553` (`style.css 633` and `tv.css 561` unchanged — style.css was not touched). Static-only change → **no service restart needed** (Ctrl+F5).

## 2.19.19 - 22/10/2026-00:52
### TR
- **Düzeltme — filtre butonu arama kutusunun içine geliyordu:** `.modal-header` `justify-content: space-between` ve mobilde `h3 { max-width: 30% }` olduğu için boşluk dağılıyor, **ortadaki** öğe olan `.sort-wrap` tam ortada duran arama kutusunun üstüne denk geliyordu. `.modal.local-modal .sort-wrap { margin-left: auto }` eklendi → butonlar sağa toplanır: `ARA   [ kutu ]   [filtre][×]` (filtre **× işaretinin hemen solunda**, arada bölüm butonlarıyla aynı 10px boşluk). Masaüstünde `h3 { flex:1 }` zaten aynı sonucu veriyordu → davranış değişmedi.
- **Değişiklik — modal başlığı "LOKAL ARA" → "ARA":** yeni i18n anahtarı `search_local_title_short` (tr "ARA", en "Search", de "Suche", fr "Recherche", es "Buscar", it "Cerca", ru "Поиск", ar "بحث", pt "Busca", nl "Zoeken", pl "Szukaj", ja "検索", ko "검색", zh "搜索"). Yalnız **sonuç modalının** header'ı kısalır; arama görünümündeki blok başlığı (`index.html:369`) **"LOKAL ARA" olarak kalır**. Başlık kısaldığı için mobilde h3 ile ortadaki kutu arasında çakışma riski de kalmadı.
- **Düzeltme — mobilde karta dokunup tutunca kart büyüyor ve kenar kartlar modal dışına taşıyordu:** `.card:hover` kuralındaki `transform: scale(1.06)` + `z-index: 5` dokunmatikte **uzun basmada `:hover` tetiklendiği** için kartı büyütüyordu. `mobil.css` (≤600px) içine `html:not(.is-tv):not(.tv-mode) #local-search-modal .card:hover { transform:none; box-shadow:none; z-index:1 }` eklendi → **yalnız LOKAL ARA sonuç modalı**; masaüstü hover'ı ve TV odak ölçeği (`tv.css`) korunur, turuncu kenarlık geri bildirimi kalır.
- **Düzeltme — izlenen kayıt "soluk" görünüyordu ("Kaçakçı" filmi):** kök neden DB'de doğrulandı (`followed.id=113`: `in_watched=1` **ve** `deferred=1`). `/api/local-search` **tüm** kayıtları döndürür (`build_followed_items(..., None)`), `makeFollowedCard`/`makeAnimeCard` ise `deferred=1` görünce `is-deferred` (opacity .35) ekler; izlenenler/arşiv bölümleri kendi builder'larını kullandığı için soluk görünmüyordu. Yeni `localIsLate(it)` yardımcısı (`deferred=1 && in_watched!=1 && archived!=1`) kart üretiminde kullanılıyor: `late` değilse `is-deferred` sınıfı kaldırılır → izlenen/arşiv kartları **izlenenler bölümüyle birebir parite**. (Kopya item üretilmez; defer butonunun davranışı bozulmaz.)
- **Değişiklik — soluk (sonra izlenecek) kartlar en sona:** `renderLocalResults()` sıralamasının ilk anahtarı `localIsLate` (0 önce, 1 sonra); ardından tür sırası (Dizi, Film, Belgesel, Anime) ve başlık A-Z. "Tümü"nde de tür filtresinde de soluklar listenin **sonunda**.
- **Değişiklik — filtre artık gerçek filtreleme:** önce yalnız sıralama yapıyordu (seçilen tür öne alınıyor, diğerleri arkada kalıyordu). Şimdi `kind !== "all"` ise yalnız o türün kartları dizilir (dizi → sadece dizi, film → sadece film, belgesel → sadece belgesel, anime → sadece anime). **"{n} Sonuç" sayacı ve tür özeti filtrelenmiş listeden** üretilir → sayaç/özet ekrandaki kartlarla her zaman tutarlı; seçilen türde kayıt yoksa "Sonuç bulunamadı".
- **Damga:** `jsver bump` → tüm JS `?v=655`, `__NX_BUILD 655`; `style.css?v=632 → 633`, `mobil.css?v=551 → 552` (`tv.css 561` sabit). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5).
### EN
- **Fix — the filter button landed inside the search box:** `.modal-header` uses `justify-content: space-between` and on mobile `h3 { max-width: 30% }` limits the title, so the free space is distributed and the **middle** item (`.sort-wrap`) ended up right on top of the centred search box. Added `.modal.local-modal .sort-wrap { margin-left: auto }` so the buttons group on the right: `SEARCH [ box ] [filter][×]` (the filter sits **immediately left of the ×**, with the same 10px gap as the section buttons). On desktop `h3 { flex:1 }` already produced this result, so nothing changes there.
- **Change — modal title "LOCAL SEARCH" → "SEARCH":** new i18n key `search_local_title_short` (tr "ARA", en "Search", de "Suche", …). Only the **results modal** header is shortened; the search view block title (`index.html:369`) **stays "LOCAL SEARCH"**. The shorter title also removes any chance of it colliding with the centred box on mobile.
- **Fix — long-pressing a card on mobile made it grow and pushed edge cards outside the modal:** the `.card:hover` rule (`transform: scale(1.06)` + `z-index: 5`) fired on touch because **long press triggers `:hover`**. Added to `mobil.css` (≤600px): `html:not(.is-tv):not(.tv-mode) #local-search-modal .card:hover { transform:none; box-shadow:none; z-index:1 }` → **local search modal only**; desktop hover and the TV focus scale (`tv.css`) are untouched, and the orange border feedback remains.
- **Fix — a watched item looked dimmed in the results ("Kaçakçı"):** root cause confirmed in the DB (`followed.id=113`: `in_watched=1` **and** `deferred=1`). `/api/local-search` returns **all** rows (`build_followed_items(..., None)`) while `makeFollowedCard`/`makeAnimeCard` add `is-deferred` (opacity .35) whenever `deferred=1`; the watched/archive sections use their own builders and therefore never dim. New `localIsLate(it)` helper (`deferred=1 && in_watched!=1 && archived!=1`) is used while building the cards: when not `late`, the `is-deferred` class is removed → watched/archived cards are **identical to the watched section**. (No copies of the item are made, so the defer button keeps working as before.)
- **Change — dimmed ("watch later") cards go last:** the first sort key in `renderLocalResults()` is now `localIsLate` (0 first, 1 last), then kind order (Shows, Movies, Documentaries, Anime), then title A-Z. Dimmed cards end up at the **end** in "All" and in every kind filter.
- **Change — the kind filter now really filters:** it used to only reorder (selected kind first, the rest behind). Now, when `kind !== "all"`, only cards of that kind are rendered (shows → shows only, movies → movies only, documentaries → documentaries only, anime → anime only). The **"{n} Results" counter and the kind summary are computed from the filtered list**, so they always match the cards on screen; a kind with no rows shows "No results found".
- **Stamps:** `jsver bump` → all JS `?v=655`, `__NX_BUILD 655`; `style.css?v=632 → 633`, `mobil.css?v=551 → 552` (`tv.css 561` unchanged). Static-only change → **no service restart needed** (Ctrl+F5).

## 2.19.18 - 22/10/2026-00:37
### TR
- **Düzeltme — mobilde LOKAL ARA kutusuna yazı yazılamıyordu (her harf siliniyordu):** `closeLocalSearchModal()` (2.19.17) mobilde **header kutusunun değerini sayfadaki kutuya geri yazıyordu**. Sayfadaki kutuya **1. harf** girildiğinde (`q < 2`) bu fonksiyon çağrılıyor, o an **henüz boş** olan header kutusunun değeri sayfa kutusuna yazılıp **yazılan harf siliniyordu** → 2 karaktere hiç ulaşılamıyor, sonuç paneli açılmıyordu ("kutuya yazı yazılamıyor"). Geri yazma satırı kaldırıldı: değer senkronu zaten header kutusunun her `input` olayında `inp.value = hdr.value` ile yapılıyor (tek doğru kaynak: sayfadaki kutu). Yalnız **odak döndürme** kaldı (kart atlamasında `refocus=false`).
- **Etki:** yalnız mobil (≤600px) — masaüstünde `localMobilePanel()` false olduğu için o dal hiç çalışmıyordu, masaüstü davranışı değişmedi.
- **Damga:** `jsver bump` → tüm JS `?v=654`, `__NX_BUILD 654`; CSS değişmedi (`style 632`, `mobil 551`, `tv 561` sabit). Statik değişiklik → **servis restart gerekmez** (Ctrl+F5).
### EN
- **Fix — the LOCAL SEARCH box could not be typed into on mobile (every character was erased):** `closeLocalSearchModal()` (2.19.17) wrote the **header box value back into the page box** on mobile. When the **first character** was typed into the page box (`q < 2`) that function ran and overwrote the page box with the value of the header box — which was still **empty** — so **the typed character disappeared**; the two-character threshold was never reached and the results panel never opened ("the box does not accept typing"). The write-back line has been removed: the values are already synced on every `input` event of the header box via `inp.value = hdr.value` (single source of truth: the page box). Only the **focus return** remains (with `refocus=false` for card jumps).
- **Scope:** mobile only (≤600px) — on desktop `localMobilePanel()` is false, so that branch never ran and desktop behaviour is unchanged.
- **Stamps:** `jsver bump` → all JS `?v=654`, `__NX_BUILD 654`; CSS unchanged (`style 632`, `mobil 551`, `tv 561`). Static-only change → **no service restart needed** (Ctrl+F5).

## 2.19.17 - 22/10/2026-00:33
### TR
- **Yeni — LOKAL ARA sonuç modalı mobilde oyuncu/yönetmen modalı gibi ortada:** telefonlarda (≤600px, TV hariç) panel artık arama kutusunun 10px altında değil, **ekranın ortasında** açılır (`align-items: center`, `max-height: 90vh`); genişlik ve kart ölçüsü person-modal ile **birebir** (mobil.css'teki 2.19.12/2.19.13 kuralları aynen geçerli: ≤480px 3'lü düzen, 481-600px 120px/12px). Mobilde JS konumlandırma **yapılmaz** (`positionLocalModal()` erken döner) → sayfa kaydırma/yeniden boyutlanma paneli oynatmaz.
- **Yeni — mobilde header'ın TAM ORTASINDA arama kutusu:** `LOKAL ARA   [ kutu ]   [filtre][×]`. Panel açılırken kutu **girilen ilk harflerle dolu** gelir, **odaklanır** ve **imleç harflerin sağında** bekler; yazdıkça aynı akış (250 ms debounce) çalışır, kartlar ve sayaç/özet canlı güncellenir. İki kutu tek doğru kaynakla senkron: header kutusuna yazılan değer sayfadaki `#local-search-input`'a kopyalanır; `×`/Escape/2 karakter altına inme durumunda değer geri yazılır ve odak sayfa kutusuna döner. Sekme değişiminde ve kart atlamasında odak geri alınmaz (`closeLocalSearchModal(false)`).
- **Yeni — turuncu yatay dotted çizgi + sayaç + tür özeti (mobil/masaüstü/APK):** dizi bölümündeki `.unwatched-section-title` görünümünün aynısı — çizgi **kenarlardan 20px içeride**. **"{n} Sonuç"** artık başlık ortasında değil, **çizginin sağ üstünde**; **çizginin altında** o an dizilen kartlardan üretilen **tür özeti** yazılır: `4 Dizi | 2 Film | 1 Belgesel` (sıra sabit: Dizi, Film, Belgesel, Anime; boş türler yazılmaz). 2.19.14'ün "sayaç başlık ortasında" kuralı **iptal** edildi. Özet tek kaynaktan (`grid` kartlarının `dataset.sumKind`) hesaplanır → harf girip kart sayısı düştükçe **realtime** güncellenir. Kullanıcı kararıyla bölüm toplamı ve izlenmiş/izlenmemiş (süre) bilgisi **gösterilmez**.
- **TV/APK:** yeni blok `--tv-scale` ile ölçeklenir (sayaç `0.85rem`, özet `0.7rem`, çizgi girintisi `20px`). Header kutusu TV'de `display:none` → D-pad zincirlerine girmez (`isVisible` kontrolü), Geri/OK akışı değişmez.
- **Yeni i18n anahtarı yok:** `search_local_ph`, `search_local_count`, `summary_shows/films/docs/anime` mevcut anahtarlar kullanıldı.
- **Damga:** `jsver bump` → tüm JS `?v=653`, `__NX_BUILD 653`; `style.css?v=631 → 632`, `mobil.css?v=550 → 551`, `tv.css?v=560 → 561`. Statik değişiklik → **servis restart gerekmez** (Ctrl+F5).
### EN
- **New — LOCAL SEARCH results modal opens centred on mobile like the person modal:** on phones (≤600px, TV excluded) the panel no longer sits 10px below the search box but **in the middle of the screen** (`align-items: center`, `max-height: 90vh`); width and card size are **identical** to the person modal (the 2.19.12/2.19.13 rules still apply: 3-per-row ≤480px, 120px/12px at 481-600px). JS positioning is **skipped** on mobile (`positionLocalModal()` returns early), so page scrolling/resizing never moves the panel.
- **New — search box exactly centred in the header on mobile:** `LOCAL SEARCH   [ box ]   [filter][×]`. When the panel opens the box is **pre-filled with the letters already typed**, **focused**, with the **caret at the end**; typing drives the same flow (250 ms debounce) and the cards, count and summary update live. Both boxes stay in sync from a single source of truth: what is typed in the header box is copied to the page `#local-search-input`; on `×`/Escape/falling below 2 characters the value is written back and focus returns to the page box. Focus is not taken back on tab changes or card jumps (`closeLocalSearchModal(false)`).
- **New — orange horizontal dotted line + count + kind summary (mobile/desktop/APK):** the same look as `.unwatched-section-title` in the series section, with the line **inset 20px from the edges**. **"{n} Results"** is now **above the line, right-aligned**, and **below the line** the **kind summary** built from the cards currently laid out: `4 Shows | 2 Movies | 1 Documentary` (fixed order: shows, movies, documentaries, anime; empty kinds omitted). The 2.19.14 "count in the middle of the header" rule is **reverted**. The summary is computed from a single source (the grid cards' `dataset.sumKind`), so it updates **in real time** as the card count drops. By user decision the episode total and watched/unwatched (runtime) parts are **not shown**.
- **TV/APK:** the new block is scaled with `--tv-scale` (count `0.85rem`, summary `0.7rem`, line inset `20px`). The header box is `display:none` on TV, so it never enters the D-pad chains (`isVisible` check) and the Back/OK flow is unchanged.
- **No new i18n keys:** existing `search_local_ph`, `search_local_count`, `summary_shows/films/docs/anime` are reused.
- **Stamps:** `jsver bump` → all JS `?v=653`, `__NX_BUILD 653`; `style.css?v=631 → 632`, `mobil.css?v=550 → 551`, `tv.css?v=560 → 561`. Static-only change → **no service restart needed** (Ctrl+F5).

## 2.19.16 - 21/10/2026-04:59
### TR
- **Düzeltme — yeşil vurgu 3 sn sonra kalkmıyordu (yarış hatası):** `jumpToLocalCard()` döngüsü bittiği anda bekleyen son tick, 3,1 sn'deki temizlikten **sonra** çalışıyor; `dataset.jumpSeen` temizlikte silindiği için kartı "yeni" sayıp `.jump-target` sınıfını **geri ekliyordu** → çerçeve kalıcı oluyordu. Artık **tek çıkış noktası** var (`finish()`): `finished` bayrağı + bekleyen tick'in `clearTimeout` ile iptali + olay dinleyicilerinin kaldırılması + sınıfın silinmesi. Temizlikten sonra hiçbir tick işaret ekleyemez. Kullanıcı etkileşimi yalnız **odak tazelemeyi** durdurur; **vurgu yine 3 sn sonra kalkar**.
- **CSS emniyet kemeri:** vurgu artık `@keyframes jump-glow` animasyonuyla da süreli — sınıf bir şekilde takılı kalsa bile çerçeve **3 sn sonra görsel olarak kaybolur** (`animation: jump-glow 3s ease-out forwards`).
- **Damga:** `jsver bump` → tüm JS `?v=652`, `__NX_BUILD 652`; `style.css?v=630 → 631`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **Fix — the green highlight did not clear after 3 s (race condition):** the last pending tick of the `jumpToLocalCard()` loop ran **after** the 3.1 s cleanup; because `dataset.jumpSeen` was deleted by the cleanup, the card was treated as "new" and `.jump-target` was **added again**, leaving the frame permanently. There is now a **single exit point** (`finish()`): a `finished` flag + `clearTimeout` of the pending tick + removal of the event listeners + removal of the class. No tick can re-add the mark after the cleanup. User interaction only stops the **focus refresh**; the highlight still clears after 3 s.
- **CSS safety net:** the highlight is now also time-limited via a `@keyframes jump-glow` animation — even if the class somehow lingers, the frame **visually disappears after 3 s** (`animation: jump-glow 3s ease-out forwards`).
- **Stamps:** `jsver bump` → all JS `?v=652`, `__NX_BUILD 652`; `style.css?v=630 → 631`. Static-only change → **no service restart needed**.

## 2.19.15 - 21/10/2026-04:54
### TR
- **Düzeltme — LOKAL ARA'dan bölüme atlanan kart artık gerçekten vurgulanıyor:** `switchView` sonrası bölüm listesi **asenkron yeniden çizildiği** için (grid `innerHTML` sıfırlanır) işaretlenen/odaklanan DOM öğesi çöpe gidiyor, vurgu ve odak kayboluyordu — mobilde "0,1 sn seçili kalıp kayboluyor", masaüstünde aranan kart hiç belli olmuyordu. Artık `jumpToLocalCard()` işareti/odağı **~3 sn boyunca 120 ms aralıkla tazeler**: yeni bir DOM öğesi görülürse `tabIndex` + `.jump-target` + `focus()` + `scrollIntoView` yeniden uygulanır; aynı öğede yalnız odak kaybolmuşsa yeniden odaklanır. Kullanıcı etkileşime geçerse (tıklama/tuş/kaydırma) tazeleme durur; **ilk 400 ms'teki olaylar yok sayılır** (TV'de atlamayı başlatan OK döngüyü iptal etmez).
- **Vurgu artık yeşil ve 3 sn:** `.card.jump-target` → `outline: 2px solid #22c55e` + `box-shadow: 0 0 0 3px rgba(34,197,94,0.25)`; **3 sn** sonra kalkar, odak kartta kalır. Masaüstünde fare hover'ından ayırt edilir; mobil ve APK'da da görünür.
- **Damga:** `jsver bump` → tüm JS `?v=651`, `__NX_BUILD 651`; `style.css?v=629 → 630`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **Fix — the card jumped to from LOCAL SEARCH is now actually highlighted:** after `switchView` the section list is **re-rendered asynchronously** (the grid's `innerHTML` is cleared), so the marked/focused DOM node was discarded and both the highlight and the focus were lost — on mobile it "stayed selected for 0.1 s then vanished", on desktop the searched card was never indicated. `jumpToLocalCard()` now **refreshes the mark/focus every 120 ms for ~3 s**: if a new DOM node appears, `tabIndex` + `.jump-target` + `focus()` + `scrollIntoView` are re-applied; on the same node only a lost focus is restored. The refresh stops as soon as the user interacts (click/key/scroll), and **events in the first 400 ms are ignored** (so the OK press that starts the jump on TV does not cancel the loop).
- **The highlight is green and lasts 3 s:** `.card.jump-target` → `outline: 2px solid #22c55e` + `box-shadow: 0 0 0 3px rgba(34,197,94,0.25)`; it clears after **3 s** while the focus stays on the card. It is distinguishable from the mouse hover on desktop and visible on mobile and the APK.
- **Stamps:** `jsver bump` → all JS `?v=651`, `__NX_BUILD 651`; `style.css?v=629 → 630`. Static-only change → **no service restart needed**.

## 2.19.14 - 21/10/2026-04:43
### TR
- **Yeni — LOKAL ARA sayacı başlık satırının tam ortasında:** "N Sonuç" metni artık sonuç modalının başlık satırında, **LOKAL ARA başlığı ile filtre/× butonlarının tam ortasında** durur (mutlak konumlandırma; taşma koruması `max-width: 50%` + ellipsis, tıklamayı engellemez). **Turuncu** (`#f97316`) ve **buton yazı boyutunda** (`0.85rem`). Masaüstü, mobil ve APK'da aynı görünüm.
- **Metin:** `search_local_count` → tr **"{n} Sonuç"** (S büyük); diğer dillerde de Latin alfabesinde baş harf büyütüldü (en `Results`, fr `Résultats`, es `Resultados`, it `Risultati`, ru `Результатов`, pt `Resultados`, nl `Resultaten`, pl `Wyników`).
- **Düzeltme — bölüm kartlarındaki sezon/bölüm hapları yine tam:** 2.19.11'de kısaltılan `seasonEpMid` artık **varsayılan olarak tam** yazıyor: **"2 Sezon 34 Bölüm"** — dizi/film/belgesel, izlenmemiş, izlenmiş, arşiv ve öneri kartlarının tamamında (**TV/APK dahil**). Kısaltma **yalnız LOKAL ARA sonuç modalında** kalır (`badgeMode: "compact"`): mobil "2 S 12 B", diğerleri "2 Sez 14 Böl". Anime kartlarının tek bölüm rozeti zaten tam yazıyordu.
- **Damga:** `jsver bump` → tüm JS `?v=650`, `__NX_BUILD 650`; `style.css?v=628 → 629`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **New — the LOCAL SEARCH counter sits dead centre in the header row:** the "N Results" text now lives in the results modal's header, **exactly between the LOCAL SEARCH title and the filter/× buttons** (absolute centring; overflow guard `max-width: 50%` + ellipsis, does not block clicks). **Orange** (`#f97316`) and **button font size** (`0.85rem`). Identical on desktop, mobile and the APK.
- **Text:** `search_local_count` → tr **"{n} Sonuç"** (capital S); the Latin-script languages were capitalised as well (en `Results`, fr `Résultats`, es `Resultados`, it `Risultati`, ru `Результатов`, pt `Resultados`, nl `Resultaten`, pl `Wyników`).
- **Fix — season/episode pills on section cards are full again:** `seasonEpMid`, shortened in 2.19.11, now **defaults to the full form**: **"2 Sezon 34 Bölüm"** — on shows/movies/docs, unwatched, watched, archive and recommendation cards (**including TV/APK**). The shortened form is kept **only in the LOCAL SEARCH results modal** (`badgeMode: "compact"`): mobile "2 S 12 B", others "2 Sez 14 Böl". Anime cards already showed the full single episode pill.
- **Stamps:** `jsver bump` → all JS `?v=650`, `__NX_BUILD 650`; `style.css?v=628 → 629`. Static-only change → **no service restart needed**.

## 2.19.13 - 21/10/2026-04:29
### TR
- **Düzeltme — TV/APK'da LOKAL ARA modalı "çizgi" olarak açılıyordu:** panel yüksekliği CSS'te `calc(100vh - …)` ile hesaplanıyordu; TV/APK'da CSS `100vh` ile JS ölçümü farklı ölçeğe düşünce `max-height` ~0'a kırpılıyor ve panel yalnızca 1px kenarlık olarak kalıyordu. Artık **ölçüm tek kaynaktan**: overlay'in kendi `getBoundingClientRect()`'i (kutunun rect'iyle aynı koordinat sistemi) → üst konum `--local-modal-top` ve yükseklik `--local-modal-h` **JS'ten px olarak** verilir; panele her koşulda **en az ~200px** yer garantilenir (üst konum `avail-200` ile kırpılır, yükseklik en az 160px). CSS `100vh` hesabı kaldırıldı (`max-height: var(--local-modal-h, 70vh)`). Kutu ekranın dibine çok yakınsa önce `scrollIntoView({block:"start"})` denemesi korunur.
- **Düzeltme — mobilde arama sonuç modallarında satır başına kart sayısı:** 2.19.12'de kartlar sabit `120px` + `gap: 18px` yapılmıştı; oyuncu/yönetmen modalı ise ≤480px'te `--card-w` (=1/3) ve `--card-gap` (8px) kullandığı için **3 kart/satır** gösteriyordu. Arama modalları da aynı efektif değerlere çevrildi (`gap: var(--card-gap)`, `width: var(--card-w)`) → **lokal ara / ara / çoklu ara** modalları oyuncu/yönetmen modalıyla **aynı satır düzeninde** (≤480px'te 3 kart/satır, 481-600px'te 120px/12px). person-grid boşlukları (`padding: 16px 20px; margin: -16px -20px`) ve modal genişliği (`max-width: 1000px`) korunur.
- **Damga:** `jsver bump` → tüm JS `?v=649`, `__NX_BUILD 649`; `style.css?v=627 → 628`, `mobil.css?v=549 → 550`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **Fix — the LOCAL SEARCH modal opened as a "line" on TV/APK:** the panel height was computed in CSS via `calc(100vh - …)`; on TV/APK the CSS `100vh` and the JS measurement fall into different scales, so `max-height` collapsed to ~0 and the panel was left as a 1px border. Measurement is now **single-sourced**: the overlay's own `getBoundingClientRect()` (same coordinate system as the box's rect) → the top offset (`--local-modal-top`) and the height (`--local-modal-h`) are **written in px from JS**; the panel is always guaranteed **at least ~200px** of room (top clamped to `avail-200`, height at least 160px). The CSS `100vh` calculation was removed (`max-height: var(--local-modal-h, 70vh)`). If the box sits too close to the bottom, the `scrollIntoView({block:"start"})` attempt is kept.
- **Fix — cards per row in the mobile search result modals:** 2.19.12 set fixed `120px` cards with `gap: 18px`, while the actor/director modal uses `--card-w` (1/3) and `--card-gap` (8px) at ≤480px, showing **3 cards per row**. The search modals now use the same effective values (`gap: var(--card-gap)`, `width: var(--card-w)`) → **local search / search / multi-search** modals match the actor/director modal's **row layout** (3-up at ≤480px, 120px/12px at 481-600px). The person-grid spacing (`padding: 16px 20px; margin: -16px -20px`) and the modal width (`max-width: 1000px`) are kept.
- **Stamps:** `jsver bump` → all JS `?v=649`, `__NX_BUILD 649`; `style.css?v=627 → 628`, `mobil.css?v=549 → 550`. Static-only change → **no service restart needed**.

## 2.19.12 - 21/10/2026-04:11
### TR
- **Yeni — LOKAL ARA kartına tıklama artık bölüme atlıyor:** sonuç kartına tıklayınca **bilgi modalı açılmaz**; sonuç modalı kapanır, kartın bulunduğu bölüme gidilir ve kart **odaklanır** (2.5 sn turuncu çerçeve vurgusu). Hedef seçimi: arşivli → **Arşiv**, izlenmiş → **İzlenmiş**, sonra-izlenecek → ilgili **"-later"** grid'i, aksi halde ana grid (dizi/film/belgesel/anime). Kart üstündeki butonlar (takvim/arşivle/kaldır/bilgi/ertele) eskisi gibi çalışır.
- **TV/APK:** LOKAL ARA kartında **OK** artık aynı atlamayı yapar (buton moduna girmez); atlanan bölümde kartta OK yine normal şekilde buton moduna girer (info/takvim/…). Sentetik tıklama koruması bu modal için kapatıldı.
- **Mobil genişlik eşitlemesi:** çoklu ara (`#search-results-modal`) ve lokal ara (`#local-search-modal`) modalları artık **oyuncu/yönetmen modalı (`#person-modal`) ölçüsünde** — tam genişlik (mobil listesindeki `92%` sınırı kalktı), grid boşlukları person-grid ile aynı (`gap: 18px; padding: 16px 20px; margin: -16px -20px`) ve kartlar **120px**. Aynı düzeltme **Ayarlar → Favoriler → filmografi** modalına (`#fav-listing-modal`) da uygulandı. `#picker-modal` **kapsam dışı** (dokunulmadı).
- **Damga:** `jsver bump` → tüm JS `?v=648`, `__NX_BUILD 648`; `style.css?v=626 → 627`, `mobil.css?v=548 → 549`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **New — clicking a LOCAL SEARCH card now jumps to its section:** clicking a result card **no longer opens the info modal**; the results modal closes, the app navigates to the section the card belongs to and **focuses** the card (2.5 s orange outline highlight). Target selection: archived → **Archive**, watched → **Watched**, deferred → the matching **"-later"** grid, otherwise the main grid (shows/movies/docs/anime). Card buttons (calendar/archive/remove/info/defer) keep working as before.
- **TV/APK:** pressing **OK** on a LOCAL SEARCH card now performs the same jump (no button mode); once in the section, OK on the card enters button mode as usual (info/calendar/…). The synthetic-click guard is disabled for this modal.
- **Mobile width alignment:** the multi-search (`#search-results-modal`) and local search (`#local-search-modal`) modals now match the **actor/director modal (`#person-modal`)**: full width (the mobile list's `92%` cap is lifted), person-grid spacing (`gap: 18px; padding: 16px 20px; margin: -16px -20px`) and **120px cards**. The same fix was applied to the **Settings → Favorites → filmography** modal (`#fav-listing-modal`). `#picker-modal` is **out of scope** (untouched).
- **Stamps:** `jsver bump` → all JS `?v=648`, `__NX_BUILD 648`; `style.css?v=626 → 627`, `mobil.css?v=548 → 549`. Static-only change → **no service restart needed**.

## 2.19.11 - 21/10/2026-03:47
### TR
- **Düzeltme — LOKAL ARA sonuç modalı artık arama kutusunun 10px altında:** her platformda (mobil/APK/masaüstü) modal, JS'in yazdığı `--local-modal-top` değişkeniyle kutunun alt kenarına hizalanır (`align-items: flex-start` + `padding-top`), yüksekliği kalan alana göre sınırlanır. Böylece **kutu görünür ve odaklı** kalır (yazı görünür), sonuçlar hemen altında akar; panel içi kaydırma korunur. Sayfa kayarsa/yeniden boyutlanırsa hizalama yeniden hesaplanır; kutu ekranın altına çok yakınsa önce yukarı alınıp ölçülür.
- **Mobil: sonuçlar yeniden modal içinde (çoklu ara ölçüsünde):** 2.19.9'un akış-içi paneli kaldırıldı; `.local-modal` mobil modal listesine eklendi → `max-width: 92%`, `border-radius: 12px`, `border: 1px solid #2a2f3d`, `padding: 0` — **çoklu ara modalıyla birebir**. Başlıktaki `h3` artık gizlenmiyor → **filtre butonu ×'in hemen yanında**. Kart genişliği `--card-w` formülünde kaldı (modal içinde de 3'lü düzen).
- **Hap etiketleri (taşma düzeltmesi):** mobilde **"2 S 12 B"** (yeni `seasons_mini`/`episodes_mini`, ×14 dil), masaüstü/tablet/TV'de **"2 Sez 14 Böl"** (`seasons_short`/`episodes_short`). Tek rozet varsa tam yazı korunur; TV biçimi değişmedi.
- **Damga:** `jsver bump` → tüm JS `?v=647`, `__NX_BUILD 647`; `style.css?v=625 → 626`, `mobil.css?v=547 → 548`. Statik değişiklik → **servis restart gerekmez**.
### EN
- **Fix — the LOCAL SEARCH results modal now opens 10px below the search box:** on every platform (mobile/APK/desktop) the modal is aligned to the box's bottom edge via the JS-written `--local-modal-top` variable (`align-items: flex-start` + `padding-top`) and its height is capped to the remaining space. The **box stays visible and focused** (typing is visible) and results flow right below it; inner scrolling is preserved. The alignment is recalculated on scroll/resize, and if the box sits too close to the bottom it is scrolled up first.
- **Mobile: results are back inside a modal (multi-search dimensions):** the 2.19.9 in-flow panel was removed; `.local-modal` was added to the mobile modal list → `max-width: 92%`, `border-radius: 12px`, `border: 1px solid #2a2f3d`, `padding: 0` — **identical to the multi-search modal**. The header `h3` is no longer hidden → **the filter button sits right next to the ×**. Card width stays on the `--card-w` formula (3-up layout inside the modal too).
- **Badge labels (overflow fix):** mobile shows **"2 S 12 B"** (new `seasons_mini`/`episodes_mini`, ×14 languages), desktop/tablet/TV shows **"2 Sez 14 Böl"** (`seasons_short`/`episodes_short`). A single badge keeps the full text; the TV format is unchanged.
- **Stamps:** `jsver bump` → all JS `?v=647`, `__NX_BUILD 647`; `style.css?v=625 → 626`, `mobil.css?v=547 → 548`. Static-only change → **no service restart needed**.

## 2.19.10 - 21/10/2026-03:27
### TR
- **Düzeltme — LOKAL ARA mobil kart boyutu:** panel `#view-search` içine taşındığı için arama görünümünün `#view-search .poster-grid .card { width: 132px }` kuralı panele de uyguluyordu; telefonda kartlar satıra 1-2 sığıyordu. Mobilde (≤600px) panel kartları artık bölüm/çoklu ara kartlarıyla **aynı formülden** (`--card-w`) gelir → **3'lü düzen** (≤480px: 1/3, 481-600px: 120px). Masaüstü/tablet/TV kart boyutu **değişmedi** (132px / 132×scale).
- **Yeni — TV (APK) LOKAL ARA fokus akışı:** Ara butonuna basınca odak **doğrudan LOKAL ARA kutusuna** gider ve klavye açılır. Kutudan **Yukarı = × (kapat)**, **Aşağı = Dizi** (panel kapalıyken) / **Aşağı = sonuç kartları** (panel açıkken). Yazarken panel açılır ama **odak kutuda kalır** (yazma/klavye bozulmaz). Navbar'da Ara butonundan aşağı inilirse de doğrudan kutuya girilir.
- **Yeni — TV'de sonuç paneli D-pad + Geri:** panel artık TV modal yığınında (`hookModals`) → D-pad kartlar arasında 2D gezer (satır üstünde başlık: filtre ↔ ×), OK ile kart **buton moduna** girer (info/takvim/…), filtre menüsü D-pad ile gezilir, Back menüyü kapatıp filtre butonuna döner. **Geri zinciri:** kartlardayken → arama kutusuna döner + klavye açılır (panel kapanmaz); kutudayken → paneli kapatır; panel kapalıyken → mevcut davranış (aramadan çık → `#tab-search`). Klavye açıkken Geri'yi Android IME tüketir (yalnız klavye kapanır).
- **Kapsam:** `views.js` (Ara butonu odağı), `tv.js` (dikey zincir, navbar-aşağı, modal yığını + D-pad/OK/Geri/filtre menüsü), `mobil.css` (mobil kart kuralı). **Damga:** `jsver.py bump` → tüm JS `?v=646`, `__NX_BUILD 646`; `mobil.css?v=546 → 547`. Statik değişiklik → **servis restart gerekmez** (telefonda Ctrl+F5, APK'da uygulamayı yeniden aç).
### EN
- **Fix — LOCAL SEARCH mobile card size:** because the panel now lives inside `#view-search`, the search view's `#view-search .poster-grid .card { width: 132px }` rule also hit the panel; on phones only 1-2 cards fitted per row. On mobile (≤600px) the panel's cards now use the **same formula** as section/multi-search cards (`--card-w`) → **3-up layout** (≤480px: 1/3, 481-600px: 120px). Desktop/tablet/TV card size is **unchanged** (132px / 132×scale).
- **New — TV (APK) LOCAL SEARCH focus flow:** pressing the Search button focuses the **LOCAL SEARCH box directly** and opens the keyboard. From the box, **Up = × (close)** and **Down = Shows** (panel closed) / **Down = result cards** (panel open). The panel opens while typing but **focus stays in the box** (typing/keyboard are not disturbed). Pressing Down from the navbar Search button also enters the box directly.
- **New — TV results panel D-pad + Back:** the panel is now part of the TV modal stack (`hookModals`) → the D-pad moves 2D across the cards (above the first row: filter ↔ ×), OK enters card **button mode** (info/calendar/…), the filter menu is D-pad navigable, and Back closes the menu returning to the filter button. **Back chain:** while in the cards → returns to the search box + opens the keyboard (panel stays); while in the box → closes the panel; panel closed → existing behaviour (leave the search view → `#tab-search`). With the keyboard open, Android's IME consumes Back (only the keyboard closes).
- **Scope:** `views.js` (Search button focus), `tv.js` (vertical chain, navbar-down entry, modal stack + D-pad/OK/Back/filter menu), `mobil.css` (mobile card rule). **Stamps:** `jsver.py bump` → all JS `?v=646`, `__NX_BUILD 646`; `mobil.css?v=546 → 547`. Static-only change → **no service restart needed** (Ctrl+F5 on phones, relaunch the app on the APK).

## 2.19.9 - 21/10/2026-03:02
### TR
- **Düzeltme — LOKAL ARA mobilde arama kutusunu kapatıyordu:** sonuç modalı (`position: fixed` + dikeyde ortalı overlay) telefonda — özellikle ekran klavyesi açıkken kısalan viewport'ta — arama kutusunun **üzerine** geliyordu; 2. karakterde açılan modal kutuyu görünmez yaptığı için yazmaya devam edilemiyordu. Artık **mobilde (≤600px) sonuç paneli akış içinde**, kutunun hemen altında açılır: kutu görünür ve odaklı kalır, ekran klavyesi açık kalır. **Masaüstü/tablet/TV davranışı birebir aynı** (sabit overlay) — tek düğüm, tek kaynak.
- **Panel içi kaydırma:** çok sonuçta panel `max-height: 50vh` ile sınırlanır ve **kendi içinde kayar** (masaüstündeki 80vh davranışının mobil karşılığı); sayfa uzamaz, "Ara"/"Çoklu Ara" blokları yerinde kalır. Mobilde panel başlığındaki tekrar eden "LOKAL ARA" yazısı gizlenir (blok başlığı zaten var).
- **Kodlama temizliği:** `mobil.css`'te 2.19.6 PowerShell kazasından kalan **BOM** ve 13 satırdaki mojibake (`â€”` → `—`, `Ä±` → `ı` …) onarıldı; dosya artık BOM'suz UTF-8, moji=0 (yorum dışı kod bölümü yedekle birebir aynı doğrulandı).
- **JS değişmedi:** `openLocalSearchModal` zaten `display:flex` yazıyor ve akış içinde de çalışıyor → `?v=` JS zinciri ve `__NX_BUILD 645` sabit. `mobil.css?v=545 → 546`; statik değişiklik → **servis restart gerekmez** (Ctrl+F5).
### EN
- **Fix — LOCAL SEARCH covered the input on mobile:** the results modal (`position: fixed`, vertically centred overlay) landed **on top of** the search box on phones — especially with the on-screen keyboard open and the viewport shrunk — so after the 2nd character (the point where the modal opens) the box was hidden and typing could not continue. On **mobile (≤600px) the results panel now opens in normal flow**, right below the box: the box stays visible and focused and the keyboard stays open. **Desktop/tablet/TV behaviour is unchanged** (fixed overlay) — one node, one source.
- **Panel scrolling:** with many results the panel is capped at `max-height: 50vh` and **scrolls inside itself** (the mobile counterpart of the desktop 80vh behaviour); the page does not grow and the "Search"/"Multi Search" blocks stay in place. On mobile the duplicate "LOCAL SEARCH" title inside the panel header is hidden (the block title already shows it).
- **Encoding cleanup:** the **BOM** left over from the 2.19.6 PowerShell incident and the mojibake on 13 lines (`â€”` → `—`, `Ä±` → `ı`, …) were repaired in `mobil.css`; the file is now BOM-less UTF-8 with moji=0 (the non-comment code was verified byte-identical to the backup).
- **No JS changes:** `openLocalSearchModal` already writes `display:flex` and works in normal flow too → the `?v=` JS chain and `__NX_BUILD 645` are unchanged. `mobil.css?v=545 → 546`; static-only change → **no service restart needed** (Ctrl+F5).

## 2.19.8 - 21/10/2026-02:29
### TR
- **Yeni — LOKAL ARA (NextEp içi kart arama):** Ara sekmesinin en üstüne **LOKAL ARA** bloğu. Yazarken (2. karakterden itibaren, 250 ms debounce) **adanmış sonuç modalı** açılır/güncellenir; 2 karakterin altına inince modal sessizce kapanır. Enter'a basılıp sorgu 2 karakterden kısaysa **kırmızı toast** ("En az 2 karakter girin").
- **Kapsam:** takip edilenler + izlenenler + arşivli + belgesel + anime (**Öneriler hariç**); toplam **200 kart** sınırı, aşılırsa "İlk 200 gösteriliyor" notu. Kart tıklaması mevcut detay modallarını açar (dizi/film/belgesel → `openDetails`, anime → `openAnimeDetails`).
- **Kart paritesi:** sonuç modalı 800px; kartlar bölümlerdekiyle **birebir aynı** (poster rozeti, tür/puan/platform/sezon-bölüm/durum hapları, `nowrap + ellipsis`, takvim/taşı/arşivle/kaldır/bilgi butonları). Modal `#view-search` dışında ve **`results-modal` sınıfı olmadan** — 132px küçültme ve hap kaydırma kurallarından etkilenmez.
- **Tür filtresi (huni):** Tümü (varsayılan) · Dizi · Film · Belgesel · Anime — seçilen tür **önde**, kalanlar varsayılan sırayla (Dizi → Film → Belgesel → Anime), tür içi **A-Z**. Filtre kalıcı değil; modal her açılışta Tümü'ye döner.
- **Backend:** yeni uç `GET /api/local-search?q=<terim>&limit=200` → `{ok, q, count, items, truncated}` (`py/routes/search.py`). Eşleşme Türkçe dostu katlama ile: casefold + NFKD aksan soyma + `ı→i` → **"iç" → "İçerde"**, "seker" → "Şeker Portakalı", "İÇ" → "İçerde" (düz casefold `İ`'nin birleşik noktası yüzünden "iç" sorgusunu kaçırıyordu).
- **Refactor (davranış korunarak):** `/api/followed` ve `/api/anime/followed` üretim mantığı `build_followed_items` / `build_anime_followed_items` olarak çıkarıldı; uçlar + lokal arama aynı üretimi paylaşır. `views.js`'te kopya kart blokları `makeFollowedCard` / `makeAnimeCard` üreticilerinde birleştirildi (bölümler + lokal arama aynı kart). `renderSectionSummary` artık modal içindeki gridlere özet basmaz.
- **Yan düzeltme:** `db.py` anime tablosu yeniden inşası (`anime_new`, `UNIQUE(user_id, anilist_id)` geçişi) `deferred` kolonunu taşımıyordu — sıfırdan kurulan DB'lerde anime erteleme kolonu kayboluyordu; artık korunuyor (mevcut bozuk DB'ler sonraki açılışta kendini onarır).
- **i18n:** 8 yeni anahtar ×14 dil (`search_local_title/ph/empty/count/filter/all/min/truncated`). **Cache-buster:** `py/jsver.py bump` → tüm JS `?v=645`, `__NX_BUILD 645`; `style.css?v=623 → 624`.
- **Revizyon (2.19.8, aynı sürüm) — LOKAL ARA filtre butonu:** sonuç modalındaki filtre butonu artık bölüm filtresiyle **birebir aynı görünümde** (aynı ikon `fa-arrow-down-wide-short`; stil CSS'te tek kaynaktan paylaşılır — `views.js`/`tv.js`'teki global `.section-filter` bağları butonu ezmesin diye sınıf `local-filter-btn`). Filtre ↔ × arasındaki mesafe, bölüm başlıklarındaki buton aralığının görünür boşluğuyla aynı (**10px** = 30px adım − ~20px buton). `style.css?v=624 → 625`; JS modülleri ve `__NX_BUILD 645` sabit.
### EN
- **New — LOCAL SEARCH (in-app card search):** a **LOCAL SEARCH** block at the top of the Search tab. While typing (from the 2nd character, 250 ms debounce) a **dedicated results modal** opens/updates; dropping below 2 characters silently closes it. Pressing Enter with a query shorter than 2 characters shows a **red toast** ("Enter at least 2 characters").
- **Scope:** followed + watched + archived + documentaries + anime (**Recommendations excluded**); hard cap of **200 cards** with a "Showing first 200" note when exceeded. Clicking a card opens the existing detail modals (shows/movies/docs → `openDetails`, anime → `openAnimeDetails`).
- **Card parity:** the results modal is 800px wide; cards are **identical** to the section cards (poster badge, type/score/platform/season-episode/status pills, `nowrap + ellipsis`, calendar/move/archive/remove/info buttons). The modal lives outside `#view-search` and does **not** use the `results-modal` class — so it is unaffected by the 132px shrink and pill-overflow rules.
- **Type filter (funnel):** All (default) · Shows · Movies · Documentaries · Anime — the selected type comes **first**, the rest keep the default order (Shows → Movies → Docs → Anime), A-Z within a type. The filter is not persisted; every modal open resets to All.
- **Backend:** new endpoint `GET /api/local-search?q=<term>&limit=200` → `{ok, q, count, items, truncated}` (`py/routes/search.py`). Matching uses Turkish-friendly folding: casefold + NFKD diacritic stripping + `ı→i` → **"iç" → "İçerde"**, "seker" → "Şeker Portakalı", "İÇ" → "İçerde" (plain casefold missed the "iç" query because of `İ`'s combining dot).
- **Refactor (behaviour preserved):** the `/api/followed` and `/api/anime/followed` item builders were extracted into `build_followed_items` / `build_anime_followed_items`; the endpoints and local search share one implementation. In `views.js` the duplicated card blocks were unified into `makeFollowedCard` / `makeAnimeCard` (sections + local search render the same card). `renderSectionSummary` no longer prints a summary into grids inside modals.
- **Side fix:** the `db.py` anime table rebuild (`anime_new`, the `UNIQUE(user_id, anilist_id)` migration) dropped the `deferred` column — fresh databases lost anime defer; it is now preserved (existing broken DBs self-heal on the next start).
- **i18n:** 8 new keys ×14 languages (`search_local_title/ph/empty/count/filter/all/min/truncated`). **Cache-buster:** `py/jsver.py bump` → all JS `?v=645`, `__NX_BUILD 645`; `style.css?v=623 → 624`.
- **Revision (2.19.8, same version) — LOCAL SEARCH filter button:** the results modal's filter button now matches the section filter button **exactly** (same `fa-arrow-down-wide-short` icon; the style is shared from a single CSS source — the class is `local-filter-btn` so the global `.section-filter` wirings in `views.js`/`tv.js` cannot hijack the button). The filter ↔ × spacing equals the visible gap between section header buttons (**10px** = 30px step − ~20px button). `style.css?v=624 → 625`; JS modules and `__NX_BUILD 645` unchanged.

## 2.19.7 - 21/10/2026-00:30
### TR
- **Düzeltme — statik dosya kodlaması:** 2.19.6'daki `?v=` damgası PowerShell ile atıldığı için UTF-8 bozulmuştu (`•` → `â€¢`, `İ` → `Ä°`, `—` → `â€"`; 448 satır + 12 dosyaya BOM). Dosyalar pi yedeğinden geri alındı, damga artık **`py/jsver.py`** ile atılıyor (`2.19.6 rev2` commit'i). `nextep.js`/`components.js` içindeki eski bozuk karakterler (U+FFFD) de onarıldı — bölüm başlığı ayırıcısı `·` ve takvim tarih yer tutucusu `—` düzeldi. Yeni kural `md/AGENTS.md`'de.
- **Yeni — şifre kutuları normal kutu oldu:** Emby (API Key, kullanıcı parolası, access token) ve Trakt (Client Secret) alanları artık `type="password"` **değil**; `autocomplete="off"` + `spellcheck="false"` + `autocapitalize="off"` + `data-lpignore` + `data-1p-ignore` + `data-form-type="other"` ile tarayıcı/şifre yöneticisi otomatik doldurma ve "güçlü şifre öner" pencereleri engellendi. "Kayıtlı" göstergesi artık ASCII `*******`.
- **Yeni — üç yönlü aktarım seçimi:** Trakt kartındaki tek "çift yönlü aktarım" switch'i yerine **üç switch**: `⇄ Çift yönlü`, `NextEp → Trakt`, `Trakt → NextEp`. Aynı anda yalnız biri açık olabilir; açık olanı kapatmak da mümkündür (hepsi kapalı = **Trakt senkronu durur**, kartta "kapalı" notu görünür). Yeni uç: `POST /api/thirdparty/trakt/direction` (`both|out|in|none`); eski `two-way` ucu geriye uyum için korunur.
- **Yön kapıları:** `NextEp → Trakt` modunda gelen yoklama ve mutabakat çalışmaz; `Trakt → NextEp` modunda giden aktarım (yeni izlemeler + kaldırma kuyruğu) çalışmaz; içeri alma kapalıysa havuz yoklama aralığı `0` olur (kartta "Kapalı").
- **Kursor koruması:** içeri almayan bir moddan içeri alan moda geçildiğinde `tp_trakt_in_cursor` "şimdi"ye çekilir; aksi halde o dönemde Trakt'a düşen izlemeler toplu gelirdi.
- **Göç:** mevcut ayar korunur — `tp_trakt_two_way=1 → ⇄ Çift yönlü`, `=0 → Trakt → NextEp`. Yön her değişimde eski anahtarla da eşitlenir.
- **i18n:** 11 yeni anahtar ×14 dil (`tp_trakt_dir_*` etiket + mod notları).
- **Cache-buster:** `py/jsver.py bump` → tüm JS `?v=641`, `__NX_BUILD 641`; `style.css?v=622` sabit.
- **Revizyon (aynı sürüm):** `⇄ Çift yönlü` etiketinde oklar metnin **sağına** alındı (`Çift yönlü ⇄`; Arapça'da RTL gereği ok başta kalır). Damga `?v=642`, `__NX_BUILD 642`.
- **Revizyon 3 (aynı sürüm) — Trakt kartı yerleşimi:** Havuz satırları (**Kuyruk**, **Etkin aralık**, **Son aktarım**) ayrı gruptan çıkarılıp **Durum kutusuna** alındı ("Son kontrol"ün altına); değerleri "Son kontrol" ile aynı stilde (yeşil, kalın değil). Havuz satırının etiketi `Etkin aralık` oldu (yeni anahtar `tp_trakt_poll_effective` ×14 dil) — "Kontrol aralığı (boşta)" etiketi yalnız ayar select'inde kaldı. **3 yön switch'i + Kontrol aralığı select'i** "Son sinyal" çerçevesinin altına taşındı. Damga `?v=644`, `__NX_BUILD 644`; `style.css?v=622` sabit (CSS değişmedi).
- **Revizyon 2 (aynı sürüm) — şifre yöneticisi pencereleri tamamen kapatıldı:** Belgede kalan **tüm** `type="password"` alanları (yedekleme rsync/samba, Discord webhook, Brevo anahtarı, SMTP şifresi, VPS parolası) `type="text"` + `autocomplete="off"` + `spellcheck="false"` + `autocapitalize="off"` + `data-lpignore` + `data-1p-ignore` + `data-bwignore` + `data-form-type="other"` + `data-protonpass-ignore` yapıldı; belgede yalnız **giriş ekranının** iki alanı `password` kaldı. Kredi alanlarının id'leri nötrleştirildi (`tp-emby-api-key`→`tp-emby-api-cred`, `tp-emby-auth-pass`→`tp-emby-auth-cred`, `tp-emby-auth-user`→`tp-emby-auth-name`, `tp-emby-access-token`→`tp-emby-access-cred`, `tp-trakt-client-secret`→`tp-trakt-client-cred`, `s-backup-rsync-pass`→`s-backup-rsync-cred`, `s-backup-samba-pass`→`s-backup-samba-cred`, `s-discord-webhook`→`s-discord-hook`, `s-brevo-key`→`s-brevo-cred`, `s-smtp-pass`→`s-smtp-cred`, `vps-pass`→`vps-cred`), Emby kullanıcı alanındaki `autocomplete="username"` kaldırıldı ve üçüncü taraf/ayar modallarına `autocomplete="off"` eklendi. SMTP "kayıtlı" maskesi `••••••••` → `*******`. Damga `?v=643`, `__NX_BUILD 643`.
- **Revizyon 4 (aynı sürüm) — Trakt "Kontrol aralığı" oku:** `#tp-trakt-poll` select'i özel ok kuralına eklendi; önceden `appearance` sıfırlanmadığı için tarayıcının yerleşik oku kutunun en sağ kenarına yapışıyordu. Artık Dil ve Zaman modalındaki pulldown'larla birebir aynı: `padding: 12px 30px 12px 14px`, `appearance:none`, `#888` chevron SVG, `background-position: right 10px center`, `background-size: 14px`. Damga `style.css?v=622 → 623`; JS modülleri ve `__NX_BUILD 644` sabit.
### EN
- **Fix — static file encoding:** the `?v=` stamp in 2.19.6 was applied with PowerShell, which corrupted UTF-8 (`•` → `â€¢`, `İ` → `Ä°`, `—` → `â€"`; 448 lines plus a BOM in 12 files). Files were restored from the Pi backup and stamping now runs through **`py/jsver.py`** (`2.19.6 rev2` commit). Legacy broken characters (U+FFFD) in `nextep.js`/`components.js` were repaired too — the section-title separator `·` and the calendar date placeholder `—` render correctly again. New rule recorded in `md/AGENTS.md`.
- **New — credential inputs are no longer password boxes:** Emby (API Key, user password, access token) and Trakt (Client Secret) fields are no longer `type="password"`; `autocomplete="off"` + `spellcheck="false"` + `autocapitalize="off"` + `data-lpignore` + `data-1p-ignore` + `data-form-type="other"` stop browser/password-manager autofill and "suggest strong password" pop-ups. The "stored" hint is now plain ASCII `*******`.
- **New — three-way transfer direction:** the single "two-way sync" switch is replaced by **three switches**: `⇄ Two-way`, `NextEp → Trakt`, `Trakt → NextEp`. Only one can be on; the active one can also be switched off (all off = **Trakt sync paused**, the card shows an "off" note). New endpoint: `POST /api/thirdparty/trakt/direction` (`both|out|in|none`); the legacy `two-way` endpoint is kept for compatibility.
- **Direction gates:** in `NextEp → Trakt` mode inbound polling and reconciliation do not run; in `Trakt → NextEp` mode outbound (new watches + removal queue) does not run; when inbound is off the pool interval is `0` (card shows "Off").
- **Cursor protection:** switching from an inbound-less mode to an inbound mode resets `tp_trakt_in_cursor` to "now", otherwise every watch collected on Trakt meanwhile would arrive in one burst.
- **Migration:** existing setting is preserved — `tp_trakt_two_way=1 → ⇄ Two-way`, `=0 → Trakt → NextEp`. The legacy key is kept in sync on every change.
- **i18n:** 11 new keys ×14 languages (`tp_trakt_dir_*` labels and mode notes).
- **Cache-buster:** `py/jsver.py bump` → all JS `?v=641`, `__NX_BUILD 641`; `style.css?v=622` unchanged.
- **Revision (same version):** the `⇄ Two-way` label now has the arrows to the **right** of the text (`Two-way ⇄`; Arabic keeps the arrow first due to RTL). Stamp `?v=642`, `__NX_BUILD 642`.
- **Revision 2 (same version) — password-manager pop-ups fully disabled:** every remaining `type="password"` field in the document (backup rsync/samba, Discord webhook, Brevo key, SMTP password, VPS password) became `type="text"` + `autocomplete="off"` + `spellcheck="false"` + `autocapitalize="off"` + `data-lpignore` + `data-1p-ignore` + `data-bwignore` + `data-form-type="other"` + `data-protonpass-ignore`; only the **login screen's** two fields remain `password`. Credential ids were neutralised (`…-pass/-key/-token/-secret` → `…-cred/-name/-hook`), `autocomplete="username"` was removed from the Emby user field and `autocomplete="off"` was added to the third-party/settings modal containers. SMTP "stored" mask is now `*******`. Stamp `?v=643`, `__NX_BUILD 643`.
- **Revision 3 (same version) — Trakt card layout:** the pool rows (**Queue**, **Effective interval**, **Last transfer**) moved out of their own group into the **status box** (under "Last check"); their values now use the same style as "Last check" (green, not bold). The pool row label became `Effective interval` (new key `tp_trakt_poll_effective` ×14 languages) — `Check interval (idle)` now only labels the settings select. The **three direction switches + the interval select** moved below the **"Last signal"** frame. Stamp `?v=644`, `__NX_BUILD 644`; `style.css?v=622` unchanged (no CSS change).
- **Revision 4 (same version) — Trakt "Check interval" arrow:** `#tp-trakt-poll` was added to the custom-arrow rule; previously `appearance` was not reset, so the browser's native arrow stuck to the far right edge. It now matches the Language & Time modal pulldowns exactly (`padding: 12px 30px 12px 14px`, `appearance:none`, `#888` chevron SVG, `background-position: right 10px center`, `background-size: 14px`). Stamp `style.css?v=622 → 623`; JS modules and `__NX_BUILD 644` unchanged.

## 2.19.6 - 20/10/2026-23:48
### TR
- **Yeni — anlık senkron havuzu (`py/sync_pool.py`):** yerel izleme/kaldırma işlemleri artık **olayla** tetiklenir. `sync_events` tablosu kalıcı outbox'tır (restart'ta bekleyen iş kaybolmaz); havuz 2 sn toplayıp **tek POST** atar, hata olursa 5s → 30s → 2dk → 10dk backoff ile yeniden dener, 8 denemede `failed` işaretler. Trakt'ın 429/420 yanıtlarında `Retry-After` kadar beklenir (`rate-limit:<sn>` hata sınıfı `_get`/`_post` içine eklendi).
- **Yeni — yoklama artık aktifken 10 sn:** Trakt gelen yoklaması havuzda çalışır; uygulama **aktifken** (görünür sekme, son 60 sn'de ping) **10 saniye**, boşta kullanıcının seçtiği aralık (varsayılan 10 dk). Yeni `POST /api/presence` + `auth.js` 30 sn'lik görünür-sekme ping'i; `/api/auth/ping` çevrimiçi durumunu beslemeye devam eder (değişmedi).
- **Yeni — Emby WS öğe bazlı hızlı yol:** `UserDataChanged` mesajındaki `ItemId`'ler 2 sn toplanıp **doğrudan** işlenir (öğe başına tek API çağrısı; 200'lük tam tarama beklenmez). Mesaj ayrıştırılamazsa eski **5 sn debounce'lu tam tarama yedeği** aynen çalışır; öğe işleri de havuz kuyruğundan geçtiği için retry + restart dayanıklılığı kazanır.
- **Düzeltme — Trakt gelen sayfalama:** `_inbound` artık 20'lik sayfalar hâlinde en fazla 5 sayfa (100 kayıt) okur ve cursor'dan eski kayda rastlayınca durur. Eski tek sayfalık okuma, tek yoklamada 100'den fazla yeni izleme varsa **eskileri sessizce atlıyordu**.
- **Düzeltme — aynı dakikadaki izlemeler:** Trakt `watched_at` saniyeleri sıfırladığı için `<=` karşılaştırması aynı dakikadaki ikinci kaydı atlıyordu; artık eşit damgalı kayıtlar yeniden işlenir (tekrarlar `process_signal` tarafında idempotent).
- **Mutabakat sıklığı:** `/sync/watched` karşılaştırması artık her yoklamada değil, en fazla **15 dakikada bir** çalışır (`reconcile_if_due`); "Senkron Et" butonu aynı yolu kullanır ve zaman damgasını tazeler. Trakt'ta silinen izlemeler yine geri alınır, yanlış silme koruması (`source='trakt'` / `trakt_out_pushed` eşleşme kaydı) aynen geçerli.
- **Liste taşıma kancası:** "İzlenenler"e taşıma/geri taşıma da Trakt'a yansır (izlendi → gönderim, izlenmedi → kaldırma kuyruğu + anında tetik).
- **Scheduler:** per-user `trakt_poll_*` işleri kaldırıldı (yoklamayı havuz devraldı); eski işler açılışta temizlenir. `_run_trakt_poll` elle tetikleme için korunur.
- **UI:** Trakt kartında **Kuyruk** satırı (bekleyen/hata), **Kontrol aralığı (boşta)** etiketi, son aktarım saati ve havuz hatası; 7 yeni i18n anahtarı ×14 dil.
- **Cache-buster:** tüm JS modülleri +1 (`?v=640`), `__NX_BUILD 640`; `style.css?v=622` sabit.
### EN
- **New — instant sync pool (`py/sync_pool.py`):** local watch/unwatch actions are now **event-driven**. The `sync_events` table is a durable outbox (pending work survives restarts); the pool coalesces 2 s and sends a **single POST**, retries with 5s → 30s → 2m → 10m backoff and marks `failed` after 8 attempts. Trakt 429/420 responses honour `Retry-After` (new `rate-limit:<sec>` error class in `_get`/`_post`).
- **New — 10 s polling while active:** Trakt inbound polling runs in the pool; while the app is **active** (visible tab, pinged within 60 s) it polls every **10 seconds**, otherwise the user's chosen interval (default 10 min). New `POST /api/presence` + a 30 s visible-tab ping in `auth.js`; `/api/auth/ping` still feeds online status (unchanged).
- **New — Emby WS item-level fast path:** `ItemId`s from `UserDataChanged` are collected for 2 s and processed **directly** (one API call per item; no 200-item full scan wait). If the message cannot be parsed, the previous **5 s debounced full scan** fallback still runs; item jobs also go through the pool queue for retry + restart durability.
- **Fix — Trakt inbound pagination:** `_inbound` now reads 20-item pages, up to 5 pages (100 records), and stops when it reaches an item older than the cursor. The old single-page read **silently skipped older new watches** when more than 100 arrived in one poll window.
- **Fix — same-minute watches:** because Trakt zeroes the seconds of `watched_at`, the `<=` comparison skipped the second record of the same minute; equal timestamps are processed again now (duplicates are idempotent in `process_signal`).
- **Reconcile frequency:** the `/sync/watched` comparison now runs at most **every 15 minutes** (`reconcile_if_due`) instead of on every poll; the "Sync now" button uses the same path and refreshes the timestamp. Watches deleted on Trakt are still reverted, and the wrong-deletion guard (`source='trakt'` / `trakt_out_pushed` ledger) is unchanged.
- **List-move hooks:** moving to/from the "Watched" list now propagates to Trakt as well (watched → push, unwatched → removal queue + instant kick).
- **Scheduler:** per-user `trakt_poll_*` jobs removed (the pool took over polling); stale jobs are cleaned at startup. `_run_trakt_poll` is kept for manual triggers.
- **UI:** Trakt card now shows a **Queue** row (pending/failed), a **Check interval (idle)** label, last transfer time and pool error; 7 new i18n keys ×14 languages.
- **Cache-buster:** all JS modules +1 (`?v=640`), `__NX_BUILD 640`; `style.css?v=622` unchanged.

## 2.19.5 - 20/10/2026-05:55
### TR
- **Yeni — ters yön tamamlandı (Trakt'ta "izlenmedi" → NextEp):** Trakt'ta bir film/bölüm izlenmedi yapıldığında bu artık NextEp'e de yansıyor. Trakt, silinen geçmişi hiçbir listede göstermediği için çözüm **mutabakat**: her yoklamada `GET /sync/watched/shows?extended=progress` + `GET /sync/watched/movies` ile Trakt'ın **güncel izlenen kümesi** alınır, yerelde izlendi görünen satırlarla karşılaştırılır; Trakt'ta olmayanlar yerelde de kaldırılır (`watched=0`, `watched_at=NULL`, kaynak temiz, sinyal tamponu silinir) ve log düşer: `[trakt] geri alindi (Trakt'ta izlenmedi): …`.
- **Yeni — eşleşme kaydı (`trakt_out_pushed`):** dışa aktarımda **Trakt'ın kabul ettiği** her öğe işaretlenir. Mutabakat yalnız `source='trakt'` olan veya bu kayıtta bulunan satırları kaldırma adayı sayar. Böylece: tek yönlü modda / hiç gönderilmemiş yerel işaretler, Emby-Jellyfin kaynaklı izlemeler ve **eski sürümde sessizce kabul edilmeyen gönderimler** asla silinmez. Trakt'ta görünen yerel izlemeler her turda "eşleşik" diye tohumlanır (eski doğru gönderimler de kapsanır).
- **Yeni — "kısmen kabul" koruması:** `/sync/history` yanıtında `not_found` varsa öğeler eşleşik işaretlenmez (mutabakat yerel işareti yanlışlıkla silmez) ve durum loglanır.
- **Sağlamlaştırma:** dışa aktarım sorguları `watched_at` artan sıralı; 100 öğe sınırına takılırsa `tp_trakt_out_ts` "şimdi"ye değil **son gönderilen damgaya** çekilir, kalanlar sonraki turda gider.
- **Sıra:** yoklama artık **inbound → mutabakat → outbound** çalışır; buton ve otomatik yoklama aynı yolu kullanır. API hatasında hiçbir şey silinmez (`tp_trakt_error`).
- **Sürüm kaynağı düzeltmesi:** uygulama her güncelleme kontrolünde `VERSION` dosyasını DB'deki sürüme geri yazıyordu (DB'de `1.93` kalmıştı). Bu sürümde hem dosya hem DB sürümü **2.19.5** yapıldı; dosya artık geri dönmüyor.
- **Damga:** JS değişmedi → tüm modüller `?v=639`, `__NX_BUILD 639`.
### EN
- **New — reverse direction completed (Trakt "unwatched" → NextEp):** marking a movie/episode unwatched on Trakt now propagates to NextEp. Trakt never lists deleted history, so the fix is **reconciliation**: every poll fetches the current watched set via `GET /sync/watched/shows?extended=progress` + `GET /sync/watched/movies`, compares it with local watched rows and clears those missing on Trakt (`watched=0`, `watched_at=NULL`, source cleared, signal-buffer row removed) with a log line: `[trakt] geri alindi (Trakt'ta izlenmedi): …`.
- **New — mirror ledger (`trakt_out_pushed`):** every item **accepted by Trakt** during outbound is recorded. Reconciliation only considers rows with `source='trakt'` or a ledger entry. So one-way mode marks, never-pushed local marks, Emby/Jellyfin-sourced watches and **items silently rejected by the old code** are never removed. Local watches visible on Trakt are seeded as mirrored each run (legacy correct pushes are covered too).
- **New — partial-accept guard:** if `/sync/history` returns `not_found`, those items are not marked as mirrored (reconciliation cannot wrongly clear the local mark) and the condition is logged.
- **Hardening:** outbound queries are `watched_at` ascending; when the 100-item cap is hit, `tp_trakt_out_ts` moves to the **last sent timestamp** instead of "now", so the remainder goes out on the next run.
- **Order:** polling now runs **inbound → reconcile → outbound**; the button and the automatic poll share the path. On API errors nothing is removed (`tp_trakt_error`).
- **Version source fix:** on every update check the app rewrote `VERSION` from the DB version (which was stuck at `1.93`). Both the file and the DB version are now **2.19.5**, so it no longer reverts.
- **Stamp:** no JS changes → every module `?v=639`, `__NX_BUILD 639`.

## 2.19.4 - 20/10/2026-05:35
### TR
- **Çift yönlü senkron tamamlandı (Trakt → dışa "izlenmedi"):** yerelde bir film/bölüm **izlendi → izlenmedi** yapıldığında bu değişiklik artık Trakt'a da yansıyor. Yeni `trakt_out_remove` kuyruğu (`user_id, kind, tmdb_id, season, episode, ts`) kaldırmaları tutar; dışa aktarım önce kuyruğu `POST /sync/history/remove` ile boşaltır, **sonra** yeni izlemeleri yazar — "kaldır → tekrar izle" senaryosunda son durum izlendi kalır.
- **Kanca noktaları:** `POST /api/episode/watch` (watched=0), `POST /api/season/watch` (toplu izlenmedi) ve `POST /api/movie/watch` (watched=0). Kaldırma yalnız gerçek bir **izlendi → izlenmedi** geçişinde kuyruğa girer; ayrıca ilgili **sinyal tamponu** satırı silinir (clear-apply eski sinyali geri yazmaz).
- **Güvenlik:** kuyruk yalnız çift yön açıkken (poll/buton) boşaltılır. Gönderim sırasında yerelde yeniden izlenmiş öğe atlanır ve kuyruktan düşülür. HTTP hatasında satırlar kalır (`tp_trakt_error`), bir sonraki yoklamada yeniden denenir; Trakt'ın `not_found` yanıtı da başarı sayılır (hedef zaten "yok").
- **Düzeltme — bölüm ekleme gövdesi:** dışa aktarım bölümleri artık Trakt'ın kanonik **`shows > seasons > episodes`** biçimiyle gönderiyor (`{"shows":[{"ids":{"tmdb":X},"seasons":[…]}],"movies":[…]}`). Eski `episodes` dizisi biçimi terk edildi; ekleme ve kaldırma aynı şekli kullanıyor.
- **Kapsam dışı (bilerek):** Emby/Jellyfin `unwatch_from_source` ve toplu `clear-apply` Trakt'tan silme **göndermez** (dış sunucu durumu Trakt geçmişini silmesin). Yalnız kullanıcının arayüzden yaptığı kaldırmalar aktarılır.
- **Damga:** JS değişmedi → tüm modüller `?v=639`, `__NX_BUILD 639`.
### EN
- **Two-way sync completed (Trakt ← outgoing "unwatched"):** when a movie/episode is toggled **watched → unwatched** locally, the change now propagates to Trakt. A new `trakt_out_remove` queue (`user_id, kind, tmdb_id, season, episode, ts`) stores removals; the outbound step flushes it via `POST /sync/history/remove` **before** writing new watches — in the "unwatch → re-watch" case the final state stays watched.
- **Hook points:** `POST /api/episode/watch` (watched=0), `POST /api/season/watch` (bulk unwatch) and `POST /api/movie/watch` (watched=0). A removal is queued only on a real **watched → unwatched** transition; the matching **signal buffer** row is deleted too (so clear-apply cannot resurrect it).
- **Safety:** the queue is flushed only when two-way sync is enabled (poll/button). Items that are locally watched again at send time are skipped and dropped from the queue. On HTTP failure rows are kept (`tp_trakt_error`) and retried on the next poll; Trakt's `not_found` response counts as success (the goal is "absent").
- **Fix — episode add payload:** outbound episodes now use Trakt's canonical **`shows > seasons > episodes`** shape (`{"shows":[{"ids":{"tmdb":X},"seasons":[…]}],"movies":[…]}`). The old `episodes` array shape is gone; add and remove share the same shape.
- **Out of scope (by design):** Emby/Jellyfin `unwatch_from_source` and bulk `clear-apply` do **not** send removals to Trakt (an external server must not wipe Trakt history). Only user-initiated UI unwatches propagate.
- **Stamp:** no JS changes → every module `?v=639`, `__NX_BUILD 639`.

## 2.19.3 - 20/10/2026-05:08
### TR
- **Kritik düzeltme (Trakt dizi senkronu):** Trakt `/sync/history` yanıtında dizi öğelerinde `show` nesnesi öğenin **üst düzeyinde** gelir; kod `episode` içinde arıyordu (`ep.get("show")`) → `tmdb` boş kalıyor ve **her bölüm sessizce atlanıyordu** (yalnız filmler aktarılıyordu). Artık `it["show"]` okunur (eski biçim için `ep["show"]` yedeği var).
- **Cursor koruması:** Trakt'ta ileri saatli bir damga cursor'ı geleceğe taşıyıp tüm aktarımı kilitleyebiliyordu (canlıda `02:30Z` = yerel 05:30 olayı). Yazılan cursor artık "şimdi"den ileri olamaz; kırpıldığında log düşer ve öğe sonraki yoklamada yeniden denenir.
- **Görünürlük:** kimlik/sezon-bölüm bilgisi eksik olduğu için atlanan öğeler artık loglanır: `[trakt] atlandi (id/se eksik): …` — bir daha sessiz kayıp olmaz.
- **Veri onarımı (tek seferlik):** takılı kalan cursor `2026-10-19T00:00:00.000Z` değerine çekildi; Trakt'ta işaretlenen **Tracker S01E01** (tmdb 211288) senkronla NextEp'e düştü.
- Buton davranışı: "Senkron Et" doğrudan yazar (ask sormaz); otomatik yoklama bölümleri ilk kez yakalarsa "İzlendi mi?" sorusu üretebilir (ask ayarı açık).
### EN
- **Critical fix (Trakt episode sync):** in `/sync/history`, episode items carry the `show` object at the **top level**, not inside `episode`; the code read `ep.get("show")` → `tmdb` was empty and **every episode was silently skipped** (only movies came through). It now reads `it["show"]` (with an `ep["show"]` fallback for older shapes).
- **Cursor guard:** a future-dated item could push the cursor into the future and lock all syncing (live case: `02:30Z` = 05:30 local). The stored cursor is now capped at "now"; when capped, a log line is emitted and the item is retried on the next poll.
- **Visibility:** items skipped for missing ids/season/episode are now logged: `[trakt] atlandi (id/se eksik): …` — no more silent drops.
- **One-time data repair:** the stuck cursor was reset to `2026-10-19T00:00:00.000Z`; **Tracker S01E01** (tmdb 211288) marked on Trakt was synced into NextEp.
- Button behaviour: "Sync now" writes directly (no ask); the automatic poll may still raise a "Did you watch it?" ask the first time it sees an episode (ask setting enabled).

## 2.19.2 - 20/10/2026-04:50
### TR
- **Anahtarlar ayrıldı:** Trakt butonu artık kendi anahtarını kullanıyor — **`tp_trakt_sync_now`** = "Senkron Et" (14 dil). Emby **Access Token** kartındaki buton **`tp_emby_token_check`** anahtarına döndü ve metni **"Token Kontrol"** oldu (14 dil). 2.17'den beri Trakt'ın Emby anahtarını ödünç alması sona erdi; anahtar adı ile işlevi artık uyumlu.
- **Davranış değişmedi:** Trakt butonu `POST /api/thirdparty/trakt/check`, Emby butonu `POST /api/thirdparty/emby/token/check` (sonrasında "Token geçerli" bildirimi). Emby API anahtarı kartındaki "Bağlantıyı test et" / "Şimdi senkronla" butonlarına dokunulmadı.
- **Damga:** tüm modüller `?v=639`, `__NX_BUILD 639`.
### EN
- **Keys split:** the Trakt button now has its own key — **`tp_trakt_sync_now`** = "Sync now" (14 languages). The Emby **Access Token** card's button is back on **`tp_emby_token_check`** with the text **"Check token"** (14 languages). Trakt no longer borrows the Emby key (a leftover from 2.17); key name and purpose now match.
- **No behaviour change:** the Trakt button calls `POST /api/thirdparty/trakt/check`, the Emby button calls `POST /api/thirdparty/emby/token/check` (followed by the "Token is valid" toast). The Emby API-key card's "Test connection" / "Sync now" buttons are untouched.
- **Stamp:** every module `?v=639`, `__NX_BUILD 639`.

## 2.19.1 - 20/10/2026-04:42
### TR
- **Metin:** Trakt kartındaki ve Emby **Access Token** kartındaki "Şimdi kontrol et" butonu artık **"Senkron Et"**. İki buton aynı anahtarı (`tp_emby_token_check`) paylaştığı için tek değişiklikle ikisi birden güncellendi; 14 dilin tamamı yenilendi (Toplu çeviriler `tp_emby_sync_now` ile aynı: "Sync now", "Jetzt synchronisieren", "Synchroniser maintenant", …).
- **Davranış değişmedi:** Trakt butonu `POST /api/thirdparty/trakt/check` (history'yi çekip izlendi yazar), Emby butonu `POST /api/thirdparty/emby/token/check` (token'ı doğrular/yeniler). Emby API anahtarı kartındaki "Bağlantıyı test et" ve "Şimdi senkronla" butonları aynen duruyor.
- **Arayüz:** Trakt kartındaki **"Redirect URI" başlığı kaldırıldı** — altındaki `Redirect URI (LAN)` / `Redirect URI (URL)` satırları ve kopyalama butonları korunuyor (başlık, satırlarla tekrar ediyordu).
- **Damga:** tüm modüller `?v=638`, `__NX_BUILD 638`.
### EN
- **Copy:** the "Check now" button on the Trakt card and on the Emby **Access Token** card is now **"Sync now"**. Both buttons share the same key (`tp_emby_token_check`), so one change updated both; all 14 languages were refreshed (translations match `tp_emby_sync_now`: "Sync now", "Jetzt synchronisieren", "Synchroniser maintenant", …).
- **No behaviour change:** the Trakt button calls `POST /api/thirdparty/trakt/check` (pulls history and writes watched), the Emby button calls `POST /api/thirdparty/emby/token/check` (validates/renews the token). The Emby API-key card's "Test connection" and "Sync now" buttons are untouched.
- **UI:** the **"Redirect URI" heading on the Trakt card was removed** — the `Redirect URI (LAN)` / `Redirect URI (URL)` rows and their copy buttons stay (the heading duplicated those rows).
- **Stamp:** every module `?v=638`, `__NX_BUILD 638`.

## 2.19 - 20/10/2026-04:30
### TR
- **Taşıma — `sh/jsver.sh` kaldırıldı, yerine `py/jsver.py`:** damga işlemlerinin tamamı artık Python: `check [klasör]`, `bump`, `set N`, `hooks`, `release "mesaj"`. `sh/` klasöründe bundan sonra yalnız kurulum/kaldırma scriptleri olacak (mevcut diğer scriptler şimdilik yerinde).
- **Yeni — güncelleme kapısı (durdurucu):** `py/app_update.py` GitHub'dan sürümü klonladıktan **hemen sonra**, kopyalama ve snapshot'tan **önce** damga zincirini denetler. Bozuksa güncelleme **hiç uygulanmaz**: canlı ağaç değişmez, snapshot alınmaz, sebep log'a ve bildirim kanallarına yazılır, manuel "Güncelle" butonunda hata olarak görünür. Eski şema (build satırı olmayan v1.x) engellenmez; yalnız "bir modül 2+ sürüm" ve "damga ≠ build" kapıyı kapatır.
- **Yeni — zamanlı denetim:** `py/scheduler.py` → `jsver_check_boot` (açılıştan 90 sn sonra) + `jsver_check_daily` (06:10). Bozuk zincirde günde 1 kez kanallara bildirim (aynı imza 24 saat içinde tekrarlanmaz).
- **Yeni — push kilidi:** `python3 py/jsver.py hooks` → `.git/hooks/pre-push`. Damga zinciri bozuksa `git push` reddedilir; kanca yalnızca mekanik zarftır, mantık `py/jsver.py` içinde. `/etc/nextep` klonuna kuruldu.
- **Açılış denetimi** aynı kaynağı kullanıyor: `py/nextep.py` → `jsver.startup_report()` (tek kural, tek çıktı).
- **Doğrulama:** sahte bozuk klonla `apply_update` → `RuntimeError`, canlı `static/js` md5 değişmedi, yeni snapshot yok; sahte bozuk repoda `git push` → reddedildi; düzeltilmiş repoda push geçti.
- **Damga:** tüm modüller `?v=637`, `__NX_BUILD 637`.
- **Kural:** yeni işlevler `py/` altında Python; `sh/` yalnız kurulum + kaldırma.
### EN
- **Moved — `sh/jsver.sh` is gone, replaced by `py/jsver.py`:** all stamping now lives in Python: `check [folder]`, `bump`, `set N`, `hooks`, `release "message"`. From now on `sh/` holds only install/uninstall scripts (the other existing scripts stay for now).
- **New — update gate (blocking):** right after cloning a release from GitHub and **before** any copy/snapshot, `py/app_update.py` validates the stamp chain. If it is broken the update is **not applied at all**: the live tree is untouched, no snapshot is taken, the reason goes to the log and to the notification channels, and the manual "Update" button shows the error. Pre-scheme releases (no build line, v1.x) are not blocked; only "a module with 2+ versions" and "stamp ≠ build" close the gate.
- **New — scheduled check:** `py/scheduler.py` → `jsver_check_boot` (90 s after boot) + `jsver_check_daily` (06:10). A broken chain triggers one channel notification per day (same signature is not repeated within 24 hours).
- **New — push lock:** `python3 py/jsver.py hooks` → `.git/hooks/pre-push`. A broken stamp chain makes `git push` fail; the hook is only a mechanical wrapper, the logic lives in `py/jsver.py`. Installed in the `/etc/nextep` clone.
- **Startup check** now uses the same source: `py/nextep.py` → `jsver.startup_report()` (one rule, one output).
- **Verified:** `apply_update` on a fake broken clone → `RuntimeError`, live `static/js` md5 unchanged, no new snapshot; `git push` in a fake broken repo → rejected; fixed repo pushed fine.
- **Stamp:** every module `?v=637`, `__NX_BUILD 637`.
- **Rule:** new features go under `py/` in Python; `sh/` is only install + uninstall.

## 2.18 - 20/10/2026-04:15
### TR
- **Yapısal (A) — tek build damgası:** `sh/jsver.sh` eklendi. `bump` build numarasını büyütüp **tüm** `?v=` damgalarını (`static/js/*.js` importları + `index.html` → `nextep.js` + `__NX_BUILD`) tek numaraya çeker; `check` ise bir modülün birden fazla sürümü varsa veya build ile uyuşmayan damga varsa hata verir. Modül başına ayrı numara tutma dönemi kapandı: "bir importçuyu atlamak" artık yayın öncesi yakalanıyor.
- **Yapısal (B) — idempotent bağlama:** `settings.js`'e `nxOnce()` koruması eklendi; dişli/menü, ayar modalları, Favoriler akordeonu, bildirim akordeonları, kanal akordeonu, yedekleme anahtarları/akordeonu, uygulama güncelleme ve favori liste modalı **tek sefer** bağlanıyor. `notification.js` init'i de tek seferlik. Aynı modül yine iki kez yüklenirse toggle birbirini iptal etmiyor; konsola `[nx] çift modül yüklemesi: <ad>` uyarısı düşüyor.
- **Yapısal (C) — açılış kontrolü:** Sunucu açılışta `static/js` damgalarını tarar; çok sürümlü modül veya build ile uyuşmayan sürüm varsa log'a `[ui] UYARI ...` yazar, temizse `[ui] js surum zinciri temiz (build=..., N modul)` satırı görünür.
- **Yayın akışı:** JS değişikliğinden sonra `sh/jsver.sh bump && systemctl restart nextep`; yayın öncesi `sh/jsver.sh check`. (`style.css` kendi damgasını korur.)
- **Damga:** tüm modüller `?v=636`, `__NX_BUILD 636`.
### EN
- **Structural (A) — single build stamp:** added `sh/jsver.sh`. `bump` increments the build number and pulls **every** `?v=` stamp (all `static/js/*.js` imports + `index.html` → `nextep.js` + `__NX_BUILD`) to that single number; `check` fails if any module carries more than one version or if a stamp disagrees with the build. Per-module version numbers are gone, so "missed one importer" is caught before release.
- **Structural (B) — idempotent binding:** `settings.js` now has an `nxOnce()` guard; the gear/menu, settings modals, Favorites accordion, notification accordions, channel accordion, backup switches/accordion, app-update block and favorite-listing modal bind **once**. `notification.js` init is one-shot too. If a module still loads twice, toggles no longer cancel each other and the console logs `[nx] çift modül yüklemesi: <name>`.
- **Structural (C) — startup check:** on boot the server scans `static/js` stamps; multi-version modules or stamps that disagree with the build are logged as `[ui] UYARI ...`, and a clean tree prints `[ui] js surum zinciri temiz (build=..., N modul)`.
- **Release flow:** after any JS change run `sh/jsver.sh bump && systemctl restart nextep`; run `sh/jsver.sh check` before publishing. (`style.css` keeps its own stamp.)
- **Stamp:** every module `?v=636`, `__NX_BUILD 636`.

## 2.17.1 - 20/10/2026-04:02
### TR
- **Düzeltme — Ayarlar (dişli) butonu çalışmıyordu:** 2.17'de `settings.js` iki farklı sürümle yükleniyordu (`nextep.js` → `?v=596`, `notification.js` → `?v=595`). Tarayıcı aynı modülü **iki kez** değerlendirdiği için `#tab-settings` tıklaması iki kez bağlandı: birinci dinleyici menüyü açıyor, ikincisi "açık" görüp hemen kapatıyordu. Aynı sebeple `initFavoritesAccordion` iki kez koştuğu için **Favoriler akordeonu** da açılıp kapanıyordu.
- **Düzeltme:** zincir hizalandı — `settings.js?v=597` (`nextep.js` + `notification.js`), `notification.js?v=585` (`nextep.js` + `settings.js` + `asks.js`), `asks.js?v=589` (`nextep.js`), `__NX_BUILD 563`, `index.html` → `nextep.js?v=635`. Böylece her modülün **tek örneği** var (2.16'dan kalan `notification.js` 582/584 ikiliği de giderildi).
- **Cache-buster:** `settings.js?v=597`, `notification.js?v=585`, `asks.js?v=589`, `nextep.js?v=635`, `__NX_BUILD 563`; `i18n.js?v=558` ve `style.css?v=622` sabit.
### EN
- **Fix — the Settings (gear) button did nothing:** in 2.17 `settings.js` was loaded under two different versions (`nextep.js` → `?v=596`, `notification.js` → `?v=595`). The browser evaluated the module **twice**, so the `#tab-settings` click was bound twice: the first listener opened the menu, the second saw it open and closed it immediately. For the same reason `initFavoritesAccordion` ran twice and the **Favorites accordion** toggled itself shut.
- **Fix:** the chain is aligned — `settings.js?v=597` (`nextep.js` + `notification.js`), `notification.js?v=585` (`nextep.js` + `settings.js` + `asks.js`), `asks.js?v=589` (`nextep.js`), `__NX_BUILD 563`, `index.html` → `nextep.js?v=635`. Every module now has exactly **one** instance (this also clears the leftover `notification.js` 582/584 split from 2.16).
- **Cache-buster:** `settings.js?v=597`, `notification.js?v=585`, `asks.js?v=589`, `nextep.js?v=635`, `__NX_BUILD 563`; `i18n.js?v=558` and `style.css?v=622` unchanged.

## 2.17 - 20/10/2026-03:52
### TR
- **Trakt kartına "Şimdi kontrol et" butonu (manuel yoklama):** Bağlı durumdaki kartta "Bağlantıyı Kes"in yanında yeni buton. Basınca `POST /api/thirdparty/trakt/check` anında `trakt.poll(uid, direct=True)` çalıştırır — 15 dakikalık zamanlayıcıyı beklemeden Trakt geçmişi çekilir. Sonuç toast ile bildirilir ("Trakt kontrol edildi · N yeni izleme"), kart tazelenir ve "Son kontrol" satırı güncellenir. Buton etiketi mevcut `tp_emby_token_check` anahtarından gelir ("Şimdi kontrol et").
- **Manuel = onaylı (soru sorulmaz):** Buton, Plex/Jellyfin/Emby'de posterden "izlendi" işaretlemesi gibi davranır: `direct=True` sayesinde gelen izlemeler "İzlendi mi?" sorusuna düşmeden doğrudan İzlenenler'e yazılır (`watched_source='trakt'`, `direct_mark=1`); o öğe için bekleyen soru varsa `_confirm_watched` kapatır. **Otomatik 15 dk'lık yoklama değişmedi** — hâlâ ask akışına düşer. TV'de E-1 kilidi (önceki bölüm izlenmemişse soru) korunur.
- **`direct` zinciri (varsayılan davranış aynı):** `trakt.poll(uid, direct=False)` → `_inbound(uid, direct=)` → `_mark_inbound(..., direct=)` → `process_signal(..., direct=True)`. Zamanlayıcı ve iki yönlü aktarım varsayılanla çağırır.
- **"Son kontrol" satırı:** Durum çerçevesinde `traktCheckedTs` artık gösteriliyor (payload'da vardı, kartta yoktu). Yeni i18n anahtarları: `tp_trakt_last_check`, `tp_trakt_check_done` (14 dil).
- **Cache-buster:** `i18n.js?v=558` (tüm importçular), `settings.js?v=596`, `nextep.js?v=634`, `__NX_BUILD 562`; `style.css?v=622` sabit.
### EN
- **"Check now" button on the Trakt card (manual poll):** when connected, a new button sits next to "Disconnect". Pressing it calls `POST /api/thirdparty/trakt/check`, which runs `trakt.poll(uid, direct=True)` immediately — no need to wait for the 15-minute timer. The result is toasted ("Trakt checked · N new watches"), the card refreshes and the "Last check" row updates. The label reuses the existing `tp_emby_token_check` key ("Check now").
- **Manual means confirmed (no question):** the button behaves like a poster "mark watched" in Plex/Jellyfin/Emby — with `direct=True` the incoming watches are written straight to Watched (`watched_source='trakt'`, `direct_mark=1`) instead of creating a "Did you watch this?" ask; any pending ask for that item is closed by `_confirm_watched`. **The automatic 15-minute poll is unchanged** — it still follows the ask flow. The TV E-1 lock (question when the previous episode is unwatched) is preserved.
- **`direct` chain (defaults unchanged):** `trakt.poll(uid, direct=False)` → `_inbound(uid, direct=)` → `_mark_inbound(..., direct=)` → `process_signal(..., direct=True)`. The scheduler and two-way sync keep calling with the default.
- **"Last check" row:** the status frame now shows `traktCheckedTs` (it was in the payload but never rendered). New i18n keys: `tp_trakt_last_check`, `tp_trakt_check_done` (14 languages).
- **Cache-buster:** `i18n.js?v=558` (all importers), `settings.js?v=596`, `nextep.js?v=634`, `__NX_BUILD 562`; `style.css?v=622` unchanged.

## 2.16 - 20/10/2026-03:23
### TR
- **Trakt kartına "Sunucuya Kur" (yeni VPS profili `trakt`):** Trakt Authorization Code + PKCE dönüş yolu (`/callback` + `/trakt/callback`) artık yönetilen bir profil. `_PROFILE_OF_APP["trakt"] = "trakt"` sayesinde `/api/thirdparty/status` kartı `vpsProfile/vpsRouteOk/vpsTunnelOk` ile besliyor; rota kuruluysa buton **"Kurulu"** (disabled, tooltip'li) görünür, tıklanamaz.
- **Kurulum eklemeli ve geri alınabilir:** `_caddy_ensure` yolu yalnızca eksik `handle` satırlarını **ekler** (mevcut yollar asla silinmez); `install_caddy` önce `/etc/caddy/Caddyfile.bak_<ts>` yedeği alır, `caddy validate` başarısızsa yedeği geri yükler, ancak sonra `systemctl reload caddy` yapar. **Metin değişmiyorsa dosya hiç yazılmaz** (`"Caddyfile zaten guncel ... yazma/reload atlandi"`) — mevcut sunucuda olduğu gibi no-op. Ayrıca `/api/remote/jobs` rota + tünel sağlamsa işe başlamadan `ABORT:already-installed` döner.
- **Tespit/doğrulama:** `check_vps()` routes sözlüğüne `trakt` eklendi; `"/callback"` tek başına `/trakt/callback` satırında da geçtiği için **iki yol birlikte** aranır. Caddy/nginx/apache grep limiti 60 → 100 satır. `_TEST_PATH["trakt"] = "/trakt/callback"` (kodsuz istekte de 200 + `waitress` döner).
- **Cache-buster:** `settings.js?v=595`, `notification.js?v=584`, `nextep.js?v=633`, `__NX_BUILD 561`; `style.css?v=622` sabit.
### EN
- **"Install on server" for the Trakt card (new `trakt` VPS profile):** the Trakt Authorization Code + PKCE return path (`/callback` + `/trakt/callback`) is now a managed profile. With `_PROFILE_OF_APP["trakt"] = "trakt"`, `/api/thirdparty/status` feeds the card `vpsProfile/vpsRouteOk/vpsTunnelOk`; when the route exists the button shows **"Installed"** (disabled, with tooltip) and cannot be clicked.
- **Additive, revertible install:** the Caddy path only **adds** missing `handle` lines (existing paths are never removed); `install_caddy` first takes a `/etc/caddy/Caddyfile.bak_<ts>` backup, restores it if `caddy validate` fails, and only then runs `systemctl reload caddy`. **If the text does not change, the file is not written at all** (`"Caddyfile zaten guncel ... yazma/reload atlandi"`) — a no-op on the current server. In addition, `/api/remote/jobs` returns `ABORT:already-installed` before doing anything when the route and tunnel are healthy.
- **Detection/verification:** `check_vps()` now reports `trakt`; because `"/callback"` also matches the `/trakt/callback` line, **both paths** must be present. The Caddy/nginx/apache grep limit goes 60 → 100 lines. `_TEST_PATH["trakt"] = "/trakt/callback"` (returns 200 + `waitress` even without a code).
- **Cache-buster:** `settings.js?v=595`, `notification.js?v=584`, `nextep.js?v=633`, `__NX_BUILD 561`; `style.css?v=622` unchanged.

## 2.15 - 20/10/2026-03:15
### TR
- **Trakt kartı — Client ID/Secret alanları çerçeveye alındı:** "Trakt Client ID" ve "Trakt Client Secret (opsiyonel)" kutuları artık **tek bir `.tp-sub-box` çerçevesi** içinde (hemen üstteki Redirect URI çerçevesiyle aynı hiza ve genişlik). İki alan arası 10px boşluk mevcut `.tp-sub-box > label + label` kuralından gelir; yeni CSS/i18n anahtarı eklenmedi. Otomatik kayıt (blur'da `trakt_client_id`/`trakt_client_secret`) mantığı değişmedi.
- **Cache-buster:** `settings.js?v=594`, `notification.js?v=583`, `nextep.js?v=632`, `__NX_BUILD 560`; `style.css?v=622` sabit.
### EN
- **Trakt card — Client ID/Secret fields framed:** the "Trakt Client ID" and "Trakt Client Secret (optional)" boxes are now inside a **single `.tp-sub-box` frame** (same alignment and width as the Redirect URI frame right above). The 10px gap between the two fields comes from the existing `.tp-sub-box > label + label` rule; no new CSS or i18n key was added. The blur auto-save (`trakt_client_id`/`trakt_client_secret`) logic is unchanged.
- **Cache-buster:** `settings.js?v=594`, `notification.js?v=583`, `nextep.js?v=632`, `__NX_BUILD 560`; `style.css?v=622` unchanged.

## 2.14 - 20/10/2026-03:03
### TR
- **Trakt kartı — iki bilgi notu kaldırıldı:** (1) Redirect URI çerçevesinin altındaki *"Bu değeri Trakt uygulama formundaki Redirect URI alanına girin."* (`tp_trakt_redirect_note`) ve (2) Client ID/Secret alanlarının altındaki *"Trakt uygulamanızın Client ID'sini girin (…). PKCE uygulamalarında Client Secret üretilmez; bu alanı boş bırakın."* (`tp_trakt_client_note`) notları artık gösterilmiyor. (i18n anahtarları sözlükte duruyor.)
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=593`, `i18n.js?v=557`, `nextep.js?v=631`, `__NX_BUILD 559`); `style.css?v=622` sabit.
### EN
- **Trakt card — two info notes removed:** (1) the note under the Redirect URI frame *"Enter this value in the Redirect URI field of your Trakt app."* (`tp_trakt_redirect_note`) and (2) the note under the Client ID/Secret fields *"Enter your Trakt app's Client ID (…). PKCE apps do not issue a Client Secret; leave this field empty."* (`tp_trakt_client_note`) are no longer shown. (The i18n keys remain in the dictionary.)
- **Cache-buster:** all JS modules +1 (`settings.js?v=593`, `i18n.js?v=557`, `nextep.js?v=631`, `__NX_BUILD 559`); `style.css?v=622` unchanged.

## 2.13 - 20/10/2026-02:47
### TR
- **Düzeltme — Trakt "Çift yönlü aktarım" satırı taşıyordu:** Trakt kartındaki çift yönlü satır, bildirim kanalları için tasarlanmış global `.notify-row` stilini (`gap: 100px; max-width: 400px; margin: auto`) ve `.settings-form label` (`display:flex`) kuralını miras alıyordu → **switch 384px'e geriliyor**, etiket **3 satıra** bölünüyor ve switch **modal dışına** taşıyordu. Trakt kartına özel yüksek özgüllüklü kural eklendi (`gap: 12px`, `max-width: none`, switch `41×22` sabit, `margin-left:auto`). `style.css?v=622`.
- **Cache-buster:** yalnız `style.css?v=622`; JS modülleri sabit.
### EN
- **Fix — Trakt "Two-way sync" row overflowed:** The two-way row inherited the global `.notify-row` style (notification channels: `gap: 100px; max-width: 400px; margin: auto`) plus `.settings-form label` (`display:flex`) → the **switch stretched to 384px**, the label wrapped to **3 lines** and the switch **overflowed outside the modal**. Added a high-specificity rule for the Trakt card (`gap: 12px`, `max-width: none`, switch fixed `41×22`, `margin-left:auto`). `style.css?v=622`.
- **Cache-buster:** only `style.css?v=622`; JS modules unchanged.

## 2.12 - 20/10/2026-02:45
### TR
- **Trakt OAuth → Authorization Code + PKCE:** Trakt (1 Eki 2026 migrasyonu) yeni uygulamalarda **Client Secret üretmiyor** ve **device code flow secret olmadan çalışmıyor**. Bu yüzden **Authorization Code + PKCE** akışı eklendi: "Bağlan" → `https://auth.trakt.tv/oauth/authorize?...&code_challenge=…&code_challenge_method=S256&state=…` **yeni sekmede** açılır → onay sonrası Trakt `redirect_uri`'ye (`/callback`) döner → NextEp kodu **`code_verifier` ile** (secret'sız) token'a çevirir. Kart, callback adresini (Trakt formuna girilecek) gösterir + kopyalar; onay sonrası kart otomatik "Bağlı" olur.
- **Uçlar:** `GET /api/thirdparty/trakt/authorize` (onay URL'i) + `GET /callback` ve `GET /trakt/callback` (kod → token). Yeni ayar: `trakt_redirect_uri` (varsayılan `https://nextep.cembol.com/callback`).
- **VPS:** Caddy'ye `nextep.cembol.com/callback` (+ `/trakt/callback`) → **pi5 (10.10.10.2:8050)** proxy kuralı eklendi (WireGuard üzerinden; mevcut kurallar korunur).
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=592`, `i18n.js?v=556`, `nextep.js?v=630`, `__NX_BUILD 558`); `style.css?v=621` sabit.
### EN
- **Trakt OAuth → Authorization Code + PKCE:** Trakt (Oct 1 2026 migration) no longer issues a **Client Secret** for new apps, and the **device code flow does not work without a secret**. So the **Authorization Code + PKCE** flow was added: "Connect" opens `https://auth.trakt.tv/oauth/authorize?...&code_challenge=…&code_challenge_method=S256&state=…` **in a new tab** → after approval Trakt redirects to the `redirect_uri` (`/callback`) → NextEp exchanges the code **with `code_verifier`** (no secret). The card shows + copies the callback address (to register in Trakt) and auto-switches to "Connected" after approval.
- **Endpoints:** `GET /api/thirdparty/trakt/authorize` (approval URL) + `GET /callback` and `GET /trakt/callback` (code → token). New setting: `trakt_redirect_uri` (default `https://nextep.cembol.com/callback`).
- **VPS:** Added a Caddy rule `nextep.cembol.com/callback` (+ `/trakt/callback`) → **pi5 (10.10.10.2:8050)** via WireGuard (existing rules preserved).
- **Cache-buster:** all JS modules +1 (`settings.js?v=592`, `i18n.js?v=556`, `nextep.js?v=630`, `__NX_BUILD 558`); `style.css?v=621` unchanged.

## 2.11 - 20/10/2026-01:55
### TR
- **Trakt PKCE (secret'sız uygulama) desteği:** Trakt artık **PKCE** uygulamaları için **Client Secret üretmiyor**; bu yüzden `configured()` (id **ve** secret) hiç true olamıyor ve **"Bağlan" butonu görünmüyordu**. Artık `configured()` = **yalnız Client ID**; Client ID kaydedilince **"Bağlan"** görünür. Secret yoksa device-code akışında **PKCE** kullanılır (`code_challenge` + `code_challenge_method=S256` → token adımında `code_verifier`); secret varsa eski (confidential) akış aynen korunur. Token yenilemede `client_secret` yalnızca **doluysa** gönderilir.
- **UI:** Client ID/Secret alanları artık **her zaman** görünür (kart yapılandırılmış/bağlı olsa bile); secret etiketi **"Client Secret (opsiyonel)"** ve not "PKCE uygulamalarında secret üretilmez, boş bırakın" olarak güncellendi.
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=591`, `i18n.js?v=555`, `nextep.js?v=629`, `__NX_BUILD 557`); `style.css?v=621` sabit.
### EN
- **Trakt PKCE (secret-less app) support:** Trakt no longer issues a **Client Secret** for **PKCE** apps, so `configured()` (id **and** secret) could never be true and the **"Connect" button never appeared**. `configured()` is now **Client ID only**; saving the Client ID reveals **"Connect"**. When there is no secret the device-code flow uses **PKCE** (`code_challenge` + `code_challenge_method=S256` → `code_verifier` at the token step); when a secret exists the legacy (confidential) flow is unchanged. On token refresh `client_secret` is sent only when **non-empty**.
- **UI:** The Client ID/Secret fields are now **always visible** (even when the card is configured/connected); the secret label is **"Client Secret (optional)"** and the note says "PKCE apps do not issue a secret; leave it empty".
- **Cache-buster:** all JS modules +1 (`settings.js?v=591`, `i18n.js?v=555`, `nextep.js?v=629`, `__NX_BUILD 557`); `style.css?v=621` unchanged.

## 2.10 - 20/10/2026-01:40
### TR
- **Düzeltme — Trakt Client ID tek başına kaydedilmiyordu:** 2.09'da eklenen otomatik kayıt **iki alan da dolu değilse** hiç kaydetmiyordu; yalnız **Client ID** girildiğinde ne istek gidiyor ne de "Kaydedildi" görünüyordu. Artık alanlar **bağımsız** kaydedilir (backend `if cid` / `if csec` ile kısmi kaydı zaten destekliyor): tetikleyen alan dolu ve (id için) değişmişse kaydedilir, "Kaydedildi" o alanın etiketinde gösterilir. Tetikleyiciye **`change`** eklendi (`blur` kaçarsa yakalar; kilit çift kaydı engeller).
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=590`, `i18n.js?v=554`, `nextep.js?v=628`, `__NX_BUILD 556`); `style.css?v=621` sabit.
### EN
- **Fix — Trakt Client ID alone was not saved:** The auto-save added in 2.09 only saved when **both fields were filled**; entering **Client ID** alone sent no request and showed no "Saved". Fields are now saved **independently** (the backend already supports partial saves via `if cid` / `if csec`): if the triggering field is filled (and, for the id, changed) it is saved and the "Saved" hint appears on that field's label. **`change`** was added as a trigger (catches cases where `blur` is missed; the lock prevents double saves).
- **Cache-buster:** all JS modules +1 (`settings.js?v=590`, `i18n.js?v=554`, `nextep.js?v=628`, `__NX_BUILD 556`); `style.css?v=621` unchanged.

## 2.09 - 20/10/2026-01:28
### TR
- **Trakt Client ID/Secret — odaktan çıkınca otomatik kayıt:** Emby API alanlarıyla **aynı desen**: iki alan dolu iken alandan çıkınca (veya **Enter**) `POST /api/thirdparty/trakt/client` ile **otomatik kaydedilir**; etiketin sağında yeşil **"Kaydedildi"** belirir (2 sn). Biri boşken **sessizce atlar** (yazarken hata toast'ı yok). Kaydedilince alanlar yerini **"Bağlan"** (device code) arayüzüne bırakır. **"Kaydedildi" butonu kaldırıldı** (etiket yanıltıcıydı; artık aksiyon butonu yok).
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=589`, `i18n.js?v=553`, `nextep.js?v=627`, `__NX_BUILD 555`); `style.css?v=621` sabit (yeni CSS yok).
### EN
- **Trakt Client ID/Secret — auto-save on blur:** Same pattern as the Emby API fields: with both fields filled, leaving the field (or pressing **Enter**) **auto-saves** via `POST /api/thirdparty/trakt/client`, and a green **"Saved"** hint appears at the right of the label (2 s). If one is empty it **skips silently** (no error toast while typing). After saving, the fields are replaced by the **"Connect"** (device code) UI. The **"Saved" button was removed** (its label was misleading; there is no action button now).
- **Cache-buster:** all JS modules +1 (`settings.js?v=589`, `i18n.js?v=553`, `nextep.js?v=627`, `__NX_BUILD 555`); `style.css?v=621` unchanged (no new CSS).

## 2.08 - 20/10/2026-01:16
### TR
- **Trakt Redirect URI (LAN) → localhost:** Trakt **development** uygulamaları yalnız **localhost** redirect kabul ettiği için **LAN** değeri artık gerçek LAN IP'si (`http://192.168.2.11:8050/trakt/callback`) değil, **`http://127.0.0.1:8050/trakt/callback`** (port = servis portu `PORT`, varsayılan 8050). Böylece Trakt formuna girilebilir. **URL** kutusu değişmedi (`https://nextep.cembol.com/trakt/callback`, production). Yalnız backend; JS/CSS/cache değişmedi (değer API'den gelir).
- **Cache-buster:** değişmedi (`settings.js?v=588`, `i18n.js?v=552`, `nextep.js?v=626`, `__NX_BUILD 554`, `style.css?v=621`).
### EN
- **Trakt Redirect URI (LAN) → localhost:** Since Trakt **development** apps only accept a **localhost** redirect, the **LAN** value is no longer the real LAN IP (`http://192.168.2.11:8050/trakt/callback`) but **`http://127.0.0.1:8050/trakt/callback`** (port = service port `PORT`, default 8050). So it can be entered in the Trakt form. The **URL** box is unchanged (`https://nextep.cembol.com/trakt/callback`, production). Backend only; JS/CSS/cache unchanged (the value comes from the API).
- **Cache-buster:** unchanged (`settings.js?v=588`, `i18n.js?v=552`, `nextep.js?v=626`, `__NX_BUILD 554`, `style.css?v=621`).

## 2.07 - 20/10/2026-01:10
### TR
- **Kurulum Bağlantısı — elle seçim (yeşil tick / kırmızı x):** Plex/Jellyfin/Emby webhook kartlarındaki **Kurulum Bağlantısı (LAN)** ve **(URL)** satırlarına, Trakt redirect'iyle **birebir aynı** seçici eklendi (kutu ile Kopyala arasında). Aktif satır: **yeşil yuvarlak + beyaz tick** (tooltip "Kurulum Bağlantısı LAN/URL etkin"), input + Kopyala **açık**. Pasif satır: **kırmızı yuvarlak + beyaz x** (tooltip "Kurulum Bağlantısı LAN/URL aktif et"), input + Kopyala **soluk + disabled**. Kırmızı x'e tıklanınca seçim **anında** geçer ve **kullanıcı+uygulama** bazında kaydedilir. Varsayılan **LAN**; URL adresi yoksa LAN zorunlu aktif.
- **Yeni uç:** `POST /api/thirdparty/webhook-link-mode` (`{app:"plex"|"jellyfin"|"emby", mode:"lan"|"url"}`) → `user_settings.tp_<app>_link_mode`.
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=588`, `i18n.js?v=552`, `nextep.js?v=626`, `__NX_BUILD 554`); `style.css?v=621` sabit (yeni CSS yok).
### EN
- **Install Link — manual pick (green tick / red x):** The **Install Link (LAN)** and **(URL)** rows in the Plex/Jellyfin/Emby webhook cards got the **exact same** selector as the Trakt redirect (between the box and Copy). Active row: **green circle + white tick** (tooltip "Install Link LAN/URL is active"), input + Copy **enabled**. Passive row: **red circle + white x** (tooltip "Activate Install Link LAN/URL"), input + Copy **faded + disabled**. Clicking the red x switches **instantly** and is saved **per user + app**. Default **LAN**; if no URL address exists, LAN is forced active.
- **New endpoint:** `POST /api/thirdparty/webhook-link-mode` (`{app:"plex"|"jellyfin"|"emby", mode:"lan"|"url"}`) → `user_settings.tp_<app>_link_mode`.
- **Cache-buster:** all JS modules +1 (`settings.js?v=588`, `i18n.js?v=552`, `nextep.js?v=626`, `__NX_BUILD 554`); `style.css?v=621` unchanged (no new CSS).

## 2.06 - 20/10/2026-00:45
### TR
- **Trakt Redirect URI — elle seçim (yeşil tick / kırmızı x):** Aktif redirect artık **takvim modalındaki "izlendi" göstergesiyle** seçilir: aktif satırda **yeşil yuvarlak + beyaz tick**, pasif satırda **kırmızı yuvarlak + beyaz x** (kutunun yanında, Kopyala'dan önce). Pasif satırın kutusu ve Kopyala'sı **soluk + disabled**. Kırmızı x'e tıklanınca seçim **anında** diğerine geçer (yeşil tick ↔ kırmızı x). Tooltip'ler: yeşil tick "Redirect URI LAN/URL etkin", kırmızı x "Redirect URI LAN/URL aktif et". Aktif değer yalnız **token yenilemede** (`/oauth/token`) gönderilir. **Varsayılan LAN**; bağlanınca kullanıcı seçimi **ezilmez**. URL kutusu yalnızca `tp_base_url` tanımlıysa görünür.
- **Yeni uç:** `POST /api/thirdparty/trakt/redirect-mode` (`{mode:"lan"|"url"}`).
- **Düzeltme (2.06b):** İkonlar (yeşil tick / kırmızı x) **nokta** gibi görünüyordu — `.tp-url-box button` (0,1,1) kuralı `.tp-redir-btn` padding'ini eziyor, `box-sizing: border-box` ile içerik 6×10px'e sıkışıyordu; yüksek özgüllüklü kural ile `padding: 0` sıfırlandı. Yuvarlaklar `.tp-url-box`'ın `align-items: stretch`'i yüzünden **üst kenara** yapışıyordu → `align-self: center` ile kutuya göre dikey ortalandı. `style.css?v=621`.
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=587`, `i18n.js?v=551`, `nextep.js?v=625`, `__NX_BUILD 553`), `style.css?v=621`.
### EN
- **Trakt Redirect URI — manual pick (green tick / red x):** The active redirect is now picked with the **calendar modal's "watched" indicator**: the active row shows a **green circle + white tick**, the passive row a **red circle + white x** (next to the box, before Copy). The passive row's box and Copy are **faded + disabled**. Clicking the red x switches the selection **instantly** (green tick ↔ red x). Tooltips: green tick "Redirect URI LAN/URL is active", red x "Activate Redirect URI LAN/URL". The active value is sent only on **token refresh** (`/oauth/token`). **Default LAN**; the user's choice is **not overwritten** on connect. The URL box appears only when `tp_base_url` is set.
- **New endpoint:** `POST /api/thirdparty/trakt/redirect-mode` (`{mode:"lan"|"url"}`).
- **Fix (2.06b):** The icons (green tick / red x) looked like a **dot** — the `.tp-url-box button` (0,1,1) rule overrode `.tp-redir-btn`'s padding, and with `box-sizing: border-box` the content box collapsed to 6×10px; reset with a higher-specificity rule (`padding: 0`). The circles stuck to the **top edge** because `.tp-url-box` uses `align-items: stretch` → vertically centered with `align-self: center`. `style.css?v=621`.
- **Cache-buster:** all JS modules +1 (`settings.js?v=587`, `i18n.js?v=551`, `nextep.js?v=625`, `__NX_BUILD 553`), `style.css?v=621`.

## 2.05 - 19/10/2026-23:59
### TR
- **Trakt Redirect URI — aktif donar:** Kurulumda aktif redirect = sabit kural (`tp_base_url` varsa **URL**, yoksa **LAN**) ve **bağlanınca donar**. Kartta **tek çerçevede** iki kutu: **Redirect URI (LAN)** ve **Redirect URI (URL)**. Aktif olan **enabled** (+ tooltip "Redirect URI LAN/URL kullanılıyor"); diğeri **disabled + soluk** (input + Kopyala). Sonradan `tp_base_url` girilse bile URL kutusu görünür ama **Trakt'a gitmez** (aktif değişmez). **Kes**'te donma temizlenir.
- **Yenileme dayanıklılığı:** `/oauth/token` yenilemesinde önce aktif redirect URI denenir; başarısızsa diğeri de denenir (başarısız deneme tek kullanımlık refresh token'ı tüketmez).
- **Kurulum Bağlantıları tek çerçeve:** Plex/Jellyfin/Emby "Kurulum Bağlantısı (LAN)" ve "(URL)" artık **tek çerçevede** (ikisi de enabled).
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=586`, `i18n.js?v=550`, `nextep.js?v=624`, `__NX_BUILD 552`), `style.css?v=619`.
### EN
- **Trakt Redirect URI — active is frozen:** On setup the active redirect is the fixed rule (`tp_base_url` set → **URL**, else **LAN**) and it is **frozen on connect**. The card shows two boxes **in a single frame**: **Redirect URI (LAN)** and **Redirect URI (URL)**. The active one is **enabled** (+ tooltip "Redirect URI LAN/URL is in use"); the other is **disabled + faded** (input + Copy). Even if `tp_base_url` is added later, the URL box appears but is **not sent to Trakt** (the active value does not change). **Disconnect** clears the freeze.
- **Refresh resilience:** On `/oauth/token` refresh the active redirect URI is tried first; if it fails the other is tried too (a failed attempt does not consume the single-use refresh token).
- **Install links in one frame:** Plex/Jellyfin/Emby "Install Link (LAN)" and "(URL)" are now in a **single frame** (both enabled).
- **Cache-buster:** all JS modules +1 (`settings.js?v=586`, `i18n.js?v=550`, `nextep.js?v=624`, `__NX_BUILD 552`), `style.css?v=619`.

## 2.04 - 19/10/2026-23:38
### TR
- **Trakt Redirect URI (LAN/URL):** Trakt kartına **Redirect URI** bölümü eklendi: **LAN / URL** iki seçenek (biri aktif, öteki disabled) + seçili değeri gösteren **read-only kutu + Kopyala**. LAN = `_lan_base()` (ör. `http://192.168.2.11:8050/trakt/callback`), URL = `tp_base_url` (ör. `https://nextep.cembol.com/trakt/callback`). Bu değer Trakt uygulama formundaki Redirect URI alanına girilir ve token yenilemede (`/oauth/token`) birebir eşleşir. Device flow'da bu adrese istek gitmez; mod değişirse Trakt formu da güncellenmelidir.
- **Global client_id/secret, per-user token:** Tek NextEp Trakt uygulaması (client_id/secret **global**) + her kullanıcının **kendi** Trakt token'ı → izlemeler kişisel, Ahmet'in izlediği Mehmet'e düşmez.
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=585`, `i18n.js?v=549`, `nextep.js?v=623`, `__NX_BUILD 551`); `style.css?618` değişmedi.
### EN
- **Trakt Redirect URI (LAN/URL):** Added a **Redirect URI** section to the Trakt card: **LAN / URL** options (one active, the other disabled) + a **read-only box + Copy** showing the selected value. LAN = `_lan_base()` (e.g. `http://192.168.2.11:8050/trakt/callback`), URL = `tp_base_url` (e.g. `https://nextep.cembol.com/trakt/callback`). Enter this in the Trakt app's Redirect URI field; it must match exactly on token refresh (`/oauth/token`). No request hits this address in the device flow; if the mode changes, update the Trakt form too.
- **Global client_id/secret, per-user token:** One NextEp Trakt app (client_id/secret **global**) + each user's **own** Trakt token → watches stay personal; Ahmet's watches never appear for Mehmet.
- **Cache-buster:** all JS modules +1 (`settings.js?v=585`, `i18n.js?v=549`, `nextep.js?v=623`, `__NX_BUILD 551`); `style.css?618` unchanged.

## 2.03 - 19/10/2026-23:15
### TR
- **Trakt entegrasyonu (opsiyonel):** Bağlantılar bölümüne **Emby ile Takvim arasına** "Trakt" akordeonu eklendi. Trakt hesabı + oynatıcıda Trakt eklentisi (VLC/Kodi/Infuse vb.) olan kullanıcılar bağlar; NextEp Trakt'ı **yoklar** (Trakt scrobble için gerçek zamanlı webhook sunmaz) ve izlemeleri "izlendi" + **kaynak=Trakt** olarak yazar.
- **Tek/çift yön:** Kartta **Çift yönlü aktarım** on/off (varsayılan **kapalı**). Kapalı = yalnız Trakt→NextEp (Trakt'a veri gönderilmez). Açık = NextEp'in algıladığı izlemeler (Stremio/Plex/Jellyfin/Emby/elle) Trakt'a da yazılır; **döngü koruması** ile kaynağı Trakt olan izleme geri yazılmaz.
- **Kontrol aralığı:** Kartta **Kapalı / 1 / 5 / 10 / 15 / 30 / 60 dk** (varsayılan **10**); per-user yoklama job'ı bu aralıkla çalışır. Token yoksa veya "Kapalı" ise job kurulmaz.
- **Kurulum:** Kartta **Trakt Client ID + Secret** alanları (trakt.tv/oauth/applications); **Bağla** → OAuth device code (kod + trakt.tv/activate), **Kes**.
- **Durum + Son sinyal:** Kartta Durum (Bağlı/Hazır/Bağlı değil), Trakt hesabı ve **Son sinyal** (Trakt'tan okunan son izleme) gösterilir.
- **Kaynak etiketi:** `trakt` kaynağı eklendi (özet modalı + ask damga satırı; renk `#ed1c24`).
- **Cache-buster:** tüm JS modülleri +1 (`settings.js?v=584`, `i18n.js?v=548`, `utils.js?v=539`, `nextep.js?v=622`, `__NX_BUILD 550`), `style.css?v=618`.
### EN
- **Trakt integration (optional):** A "Trakt" accordion was added in Connections **between Emby and Calendar**. Users with a Trakt account + a Trakt plugin in their player (VLC/Kodi/Infuse etc.) connect it; NextEp **polls** Trakt (no real-time scrobble webhook) and marks watches as watched with **source=Trakt**.
- **One/two-way:** A **Two-way sync** on/off in the card (default **off**). Off = Trakt→NextEp only (no data sent to Trakt). On = watches detected by NextEp (Stremio/Plex/Jellyfin/Emby/manual) are also written to Trakt; **loop protection** skips items whose source is Trakt.
- **Check interval:** In the card **Off / 1 / 5 / 10 / 15 / 30 / 60 min** (default **10**); a per-user poll job runs at that interval. No job if there is no token or it is "Off".
- **Setup:** **Trakt Client ID + Secret** fields in the card (trakt.tv/oauth/applications); **Connect** → OAuth device code (code + trakt.tv/activate), **Disconnect**.
- **Status + Last signal:** The card shows Status (Connected/Ready/Not connected), the Trakt account, and **Last signal** (the last watch read from Trakt).
- **Source label:** Added the `trakt` source (summary modal + ask stamp line; color `#ed1c24`).
- **Cache-buster:** all JS modules +1 (`settings.js?v=584`, `i18n.js?v=548`, `utils.js?v=539`, `nextep.js?v=622`, `__NX_BUILD 550`), `style.css?v=618`.

## 2.02 - 19/10/2026-22:42
### TR
- **"Seçiniz" metni font boyutu (mobil/tablet):** "Öneri Bölümü Güncelleme Rotasyonu" akordeon düğmesindeki metin (`feed_schedule_hint` = "Seçiniz") artık ≤1366px'te üstteki **saat input'larıyla aynı** font boyutunda (`1rem`). Önceden `0.9rem` idi ve saatlerden küçük görünüyordu. Toggle yüksekliği (33px blok) değişmedi.
- **Cache-buster:** `tablet.css?v=513`→`514`; JS değişmedi.
### EN
- **"Select" text font size (mobile/tablet):** The text inside the "Recommendation Section Update Rotation" accordion button (`feed_schedule_hint` = "Select") is now the **same font size as the time inputs above** (`1rem`) at ≤1366px. It was `0.9rem` and looked smaller than the times. The toggle height (33px block) is unchanged.
- **Cache-buster:** `tablet.css?v=513`→`514`; no JS changes.

## 2.01 - 19/10/2026-22:37
### TR
- **"Öneri Bölümü Güncelleme Rotasyonu" akordeon yüksekliği eşitlendi:** Blok artık **"Bildirim Saati"** kutusuyla aynı yükseklikte. Geniş masaüstünde (>1366px) input ~43px olduğu için blok **43px**; ≤1366px (tablet/mobil) input 33px olduğu için blok **33px**. Önceden blok sabit ~38px olduğundan masaüstünde küçük, mobilde büyük görünüyordu.
- **Cache-buster:** `style.css?v=616`→`617`, `tablet.css?v=512`→`513`; JS değişmedi.
### EN
- **"Recommendation Section Update Rotation" accordion height matched:** The block is now the same height as the **"Notification Time"** box. On wide desktop (>1366px) the input is ~43px, so the block is **43px**; at ≤1366px (tablet/mobile) the input is 33px, so the block is **33px**. Previously the block was a fixed ~38px, appearing small on desktop and tall on mobile.
- **Cache-buster:** `style.css?v=616`→`617`, `tablet.css?v=512`→`513`; no JS changes.

## 2.00 - 19/10/2026-22:25
### TR
- **Boş öneri sonucu cache'lendi:** Anime'de gerçekten boş dönen kaynaklar (AMC+, Apple TV+, Paramount) artık her bakışta sorgulanmıyor. Boş sonuç `feed_cache`'e yazılır ve **24 saat** (`FEED_EMPTY_TTL`) boyunca sorgusuz `[]` döner; 24 saat sonra ilk bakışta bir kez daha denenir, veri dönerse dolu olarak cache'lenir.
- **Değişmeyenler:** Haftalık `feed_refresh_*` job'ları ve **Ayarlar → Güncelleme Saatleri → "Öneri Bölümü Güncelleme Rotasyonu"** bloğu aynen korunur. Dolu kaynakların cache-first davranışı (1.99) aynı.
- **Cache-buster:** JS/CSS değişmedi; Python değiştiği için servis yeniden başlatılır.
### EN
- **Empty feed results are cached:** Sources that genuinely return nothing for anime (AMC+, Apple TV+, Paramount) are no longer queried on every view. The empty result is written to `feed_cache` and returns `[]` without querying for **24 hours** (`FEED_EMPTY_TTL`); after 24 hours the first view retries once, and if data comes back it is cached as non-empty.
- **Unchanged:** The weekly `feed_refresh_*` jobs and the **Settings → Update Times → "Recommendation Section Update Rotation"** block are kept as is. The cache-first behavior for non-empty sources (1.99) is unchanged.
- **Cache-buster:** no JS/CSS changes; Python changed, so the service is restarted.

## 1.99 - 19/10/2026-19:25
### TR
- **Öneri (feed) gösterimi cache-first:** `generate_feed(force=False)` artık havuzu **yaş sınırı olmadan** `feed_cache`'ten okur; cache varsa TMDB/AniList'e **hiç gitmez**. Cache yoksa çeker, kartları oluşturur ve cache'ler (bölüm asla boş kalmaz).
- **Kart detayları cache-first:** `_attach_tv_details` / `_attach_movie_details` artık `force=False` iken `rec_detail` kaydı **varsa** (7 gün TTL'den bağımsız) sorgusuz kullanır; yalnızca kayıt **yoksa** TMDB'den çeker. Böylece bayat detay yüzünden her seçimde sorgu yapılması biter.
- **Haftalık job detay ön-ısıtma:** `refresh_feed_source` havuzu çektikten sonra tv/film öğelerinin detaylarını da `rec_detail`'e yazar; gösterimde platform/durum rozetleri cache'ten gelir.
- **Refresh butonu:** `refresh=1` → `force=True` → havuz + detaylar yeniden çekilir ve cache tazelenir.
- **Not:** Yalnızca gerçekten veri dönmeyen kaynaklar (anime + `amc`/`apple_tv`/`paramount` — AniList'te sağlayıcı yok) boş kalır.
- **Cache-buster:** JS/CSS değişmedi; Python değiştiği için servis yeniden başlatılır.
### EN
- **Recommendations (feed) cache-first:** `generate_feed(force=False)` now reads the pool from `feed_cache` **with no age limit**; if cached it never hits TMDB/AniList. If missing it fetches, builds the cards and caches them (the section is never left empty).
- **Card details cache-first:** `_attach_tv_details` / `_attach_movie_details` now use an existing `rec_detail` row (ignoring the 7-day TTL) without querying when `force=False`; they only hit TMDB when the row is **missing**. This stops the per-selection queries caused by stale details.
- **Weekly job detail pre-warm:** `refresh_feed_source` now also writes tv/movie card details into `rec_detail`, so the platform/status badges come from cache on display.
- **Refresh button:** `refresh=1` → `force=True` → pool + details are re-fetched and the cache is refreshed.
- **Note:** Only sources that genuinely return no data (anime + `amc`/`apple_tv`/`paramount` — AniList has no providers) stay empty.
- **Cache-buster:** no JS/CSS changes; Python changed, so the service is restarted.

## 1.98 - 19/10/2026-18:51
### TR
- **SQLite WAL modu:** `db.py::get_db()` artık `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000` uygular. WAL ile okuyucu/yazıcı birbirini bloke etmez; 8 waitress thread'i + scheduler + WS altında kilit çekişmesi ve "database is locked" riski azalır. `journal_mode` kalıcıdır (DB başlığında).
- **DB yedeği WAL-güvenli:** `backup_core.build_artifact("db")` ham `shutil.copy2` yerine **`VACUUM INTO`** kullanır → son commit'ler `-wal`'da olsa bile tutarlı, tek dosya yedek üretir; `-wal`/`-shm` kopyalamaya gerek kalmaz.
- **Full yedek:** tar öncesi `PRAGMA wal_checkpoint(TRUNCATE)` ile WAL ana dosyaya boşaltılır; `nextep.db-wal` ve `nextep.db-shm` tar'a **alınmaz**.
- **Restore:** geri yüklenen DB'nin yanındaki eski `-wal`/`-shm` dosyaları silinir; full tar açılışında `-wal`/`-shm` üyeleri atlanır.
- **Cache-buster:** JS/CSS değişmedi (Python + servis yeniden başlatma).
### EN
- **SQLite WAL mode:** `db.py::get_db()` now applies `PRAGMA journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`. WAL lets readers and writers run concurrently, reducing lock contention and "database is locked" risk with 8 waitress threads + scheduler + WS. `journal_mode` is persistent (stored in the DB header).
- **WAL-safe DB backup:** `backup_core.build_artifact("db")` now uses **`VACUUM INTO`** instead of a raw `shutil.copy2`, producing a consistent single-file snapshot even when recent commits are still in `-wal`; no need to copy `-wal`/`-shm`.
- **Full backup:** `PRAGMA wal_checkpoint(TRUNCATE)` flushes WAL into the main DB before tarring; `nextep.db-wal` and `nextep.db-shm` are **excluded** from the tar.
- **Restore:** stale `-wal`/`-shm` files next to the restored DB are removed; `-wal`/`-shm` members are skipped when extracting a full tar.
- **Cache-buster:** no JS/CSS changes (Python + service restart).

## 1.97 - 19/10/2026-18:34
### TR
- **Emby Access Token "Göster" düzeltmesi:** Token `GET /api`'de dönmediği için sayfa yenilendikten sonra "Göster" boş kutuyu açıyordu. Yeni `GET /api/thirdparty/emby/token/reveal` (admin + `no-store`) ucu eklendi; "Göster"e basınca token yalnızca açık istek üzerine çekilip kutuya dolduruluyor ve görünür oluyor. Aynı oturumda token bellekte varsa ek istek yapılmaz.
- **Güvenlik notu:** Token artık yalnızca admin oturumu + `no-store` + kullanıcı "Göster"e bastığında, tek seferlik reveal ucuyla alınır; normal durum yanıtında dönmez.
- **Cache-buster:** `settings.js?v=583`, `notification.js?v=572`, `asks.js?v=578`, `nextep.js?v=621` (`__NX_BUILD 549`).
### EN
- **Emby Access Token "Show" fix:** Since the token is not returned by `GET /api`, the "Show" button revealed an empty box after a page reload. Added `GET /api/thirdparty/emby/token/reveal` (admin + `no-store`); clicking "Show" fetches the token only on explicit request, fills the field and reveals it. No extra request if the token is already in memory.
- **Security note:** The token is now fetched only through the one-shot reveal endpoint with an admin session + `no-store` + an explicit "Show" click; it is not part of the normal status response.
- **Cache-buster:** `settings.js?v=583`, `notification.js?v=572`, `asks.js?v=578`, `nextep.js?v=621` (`__NX_BUILD 549`).

## 1.96 - 19/10/2026-18:26
### TR
- **Etiket hizası düzeltmesi:** Ayar kutularının başlığı yeniden **solda**, "Kaydedildi" ipucu **sağda** (1.95'teki sağa yaslama geri alındı). Etiket–kutu mesafesi **3px** ve Public Adres kutusu genişletmesi korunuyor.
- **Emby API kutuları genişletildi:** Emby → API Key bölümündeki "Sunucu adresi", "API anahtarı" ve "Kullanıcı (ops.)" kutularının "Kaydedildi" ipucu başlık satırına taşındı; girişler artık çerçevenin sağ kenarına kadar uzanıyor.
- **Cache-buster:** `style.css?v=616`, `settings.js?v=582`, `notification.js?v=571`, `asks.js?v=577`, `nextep.js?v=620` (`__NX_BUILD 548`).
### EN
- **Label alignment fix:** Settings input labels are back on the **left** and the "Saved" hint on the **right** (the 1.95 right-alignment was reverted). The 3px label-to-box spacing and the Public Address box widening are kept.
- **Emby API boxes widened:** In Emby → API Key, the "Saved" hint of the "Server address", "API key" and "User (optional)" boxes moved to the label row, so the inputs now stretch to the right edge of the frame.
- **Cache-buster:** `style.css?v=616`, `settings.js?v=582`, `notification.js?v=571`, `asks.js?v=577`, `nextep.js?v=620` (`__NX_BUILD 548`).

## 1.95 - 19/10/2026-18:17
### TR
- **Etiket hizası:** Tüm ayar modallerindeki giriş kutularının başlığı artık kutunun **sağ üstünde** ve kutunun **3px üzerinde**; "Kaydedildi" ipucu da aynı hizada sağa yanaşık görünür. 1.87'de LAN/URL kutularının başlığını zorla sola çeken kural kaldırıldı (ör. Emby → Webhook → Kurulum Bağlantısı (LAN)).
- **Kutu genişliği:** Bağlantılar (Third Party Apps) modalindeki 440px sınırı kaldırıldı; Public Adres ve benzeri kutular çerçeve genişliğine yayılıyor. Public Adres kutusuna **Sunucu URL** başlığı eklendi ve "Kaydedildi" ipucu başlık satırına taşındı.
- **i18n düzeltmesi:** Yedekleme → Rsync ve Samba "Port" etiketlerinde eksik olan `label_port` anahtarı eklendi (dil uygulanınca "label_port" görünüyordu).
- **Satır düzeni korundu:** Switch/checkbox satırları, Bildirim Türleri, Bildirim Merkezi ve feed saat kutuları aynı kaldı.
- **Cache-buster:** `style.css?v=615`, `i18n.js?v=547`, `settings.js?v=581`, `notification.js?v=570`, `asks.js?v=576`, `nextep.js?v=619` (`__NX_BUILD 547`).
### EN
- **Label alignment:** Every settings input label is now at the **top-right** of its box and **3px above** it; the "Saved" hint appears flush right on the same line. The 1.87 rule that forced LAN/URL labels to the left was removed (e.g. Emby → Webhook → Install Link (LAN)).
- **Box width:** The 440px cap was removed in the Connections (Third Party Apps) modal, so the Public Address and similar boxes stretch to the frame width. The Public Address box got a **Server URL** label and its "Saved" hint moved to the label row.
- **i18n fix:** Added the missing `label_port` key for the Backup → Rsync/Samba "Port" labels (previously showed `label_port` after a language change).
- **Row layout unchanged:** Switch/checkbox rows, Notification Types, Notification Center and feed schedule time boxes stay as they are.
- **Cache-buster:** `style.css?v=615`, `i18n.js?v=547`, `settings.js?v=581`, `notification.js?v=570`, `asks.js?v=576`, `nextep.js?v=619` (`__NX_BUILD 547`).

## 1.94 - 19/10/2026-17:11
### TR
- **Emby Access Token bölümü:** Emby kartına `Webhook` / `API Key` / `Access Token` sırasıyla üçüncü akordeon eklendi. Kullanıcı adı + parola girilince parola alanından çıkışta (`blur`) veya `Enter` ile Emby'den kullanıcı token'ı alınır; token ve parola şifreli saklanır.
- **Anında WebSocket:** Access Token varsa WebSocket bu token ile açılır; oturum `UserId` alanı dolu olur ve posterden izlendi işaretleme / oynatma bitişi 15 dakikalık yoklamayı beklemeden NextEp'e düşer. API Key 15 dakikalık yedek tarama olarak korunur.
- **Otomatik yenileme:** Token 5 dakikada bir `/Users/{id}` ile kontrol edilir. `401/403` alınırsa kayıtlı kullanıcı adı + parola ile `AuthenticateByName` çağrılıp token otomatik yenilenir; WS handshake `401` dönerse beklemeden yeniden denenir. Sunucu kapalıysa token silinmez; yanlış parolada 30 sn → 1 saat backoff uygulanır.
- **Anında WS geçişi:** Token kaydedilince/silinince ya da sunucu adresi değişince mevcut WebSocket soketi `shutdown` + `close` ile kapatılır ve yeni ayarla beklemeden (15 sn yeniden bağlanma gecikmesi olmadan) yeniden bağlanır; durum satırı kısa sürede `Bağlı (anında)` / `Bağlı değil` olur.
- **Durum ve sinyal:** Access Token bölümünde `Durum`, WS kaynaklı `Son sinyal`, `Son token kontrolü` ve `Token yenilendi` satırları gösterilir. `Son sinyal` yalnızca WebSocket olaylarını kapsar; yoksa `—` görünür.
- **Güvenlik:** Token/parola GET yanıtında dönmez; yalnızca `hasToken` / `hasPassword` ve durum bilgisi gelir. Token endpoint'leri admin-only ve `Cache-Control: no-store`. Parola/token alanları maskelidir; `Göster` ile token geçici açılır. URL değişirse eski token/parola temizlenir.
- **Ayarlar menüsü düzeltmesi:** `settings.js` iki farklı sürümle (`?v=579` ve `?v=577`) import edildiği için tarayıcı modülü iki kez yüklüyor, dişli butonuna bağlanan iki toggle listener birbirini iptal ediyor ve menü açılmıyordu. `notification.js` importu `settings.js?v=580` ile hizalandı.
- **Cache-buster:** `settings.js?v=580`, `notification.js?v=569`, `asks.js?v=575`, `nextep.js?v=618` (`__NX_BUILD 546`); `style.css?614` değişmedi.
### EN
- **Emby Access Token section:** Added a third Emby accordion in the order `Webhook` / `API Key` / `Access Token`. When the username and password are filled, the user token is fetched on password `blur` or `Enter`; the token and password are stored encrypted.
- **Instant WebSocket:** When an Access Token exists, the WebSocket uses it; the session has a non-null `UserId`, so poster watch marks and playback stops reach NextEp without waiting for the 15-minute poll. API Key remains as 15-minute fallback polling.
- **Auto-renewal:** The token is checked against `/Users/{id}` every 5 minutes. On `401/403`, `AuthenticateByName` is called with the stored username/password and the token is renewed automatically; a WS handshake `401` triggers an immediate retry. If the server is down the token is kept; wrong passwords use 30 s → 1 h backoff.
- **Instant WS switch:** Saving/clearing the token or changing the server address shuts the current WebSocket down (`shutdown` + `close`) and reconnects with the new settings without the 15 s reconnect delay, so the status row flips to `Connected (instant)` / `Not connected` quickly.
- **Status and signal:** The Access Token section shows `Status`, WS-only `Last signal`, `Last token check` and `Token renewed`. `Last signal` only covers WebSocket events and shows `—` when none exist.
- **Security:** The token/password are never returned by GET; only `hasToken` / `hasPassword` and status metadata are sent. Token endpoints are admin-only with `Cache-Control: no-store`. Password/token fields are masked; `Show` reveals the token temporarily. Changing the URL clears the old token/password.
- **Settings menu fix:** `settings.js` was imported with two different versions (`?v=579` and `?v=577`), so the browser loaded the module twice and the two toggle listeners on the gear button cancelled each other, leaving the menu closed. The `notification.js` import is now aligned to `settings.js?v=580`.
- **Cache-buster:** `settings.js?v=580`, `notification.js?v=569`, `asks.js?v=575`, `nextep.js?v=618` (`__NX_BUILD 546`); `style.css?614` unchanged.

## 1.93 - 19/10/2026-16:14
### TR
- **Geçmiş tooltip'inde tick kolonu liste bazlı:** Bir günde en az bir satır tick alıyorsa artık tick almayan satırlarda da boş tick hücresi üretiliyor. Böylece 18.10'daki Kaçakçı satırı da `... | Jellyfin |` ile bitiyor; tick'ler ve ayraçlar aynı hizada kalıyor.
- **Dotted çizgi sağa uzuyor:** Boş tick hücresi de gerçek bir tablo hücresi olduğu için satırlar arası yatay noktalı çizgi tick kolonunun sağ kenarına kadar devam ediyor.
- **Tick yoksa kolon yok:** O gün hiç tick yoksa tick hücresi hiç üretilmiyor; satır `... | Jellyfin` olarak bitiyor, sonda gereksiz `|` görünmüyor.
- **Cache-buster:** `history.js?571`, `nextep.js?615` (`__NX_BUILD 543`); `style.css?614` değişmedi.
### EN
- **Per-list tick column in the history tooltip:** If at least one row in a day has a tick, rows without a tick now also get an empty tick cell. Kaçakçı on 18.10 therefore ends with `... | Jellyfin |`, and ticks/separators stay aligned.
- **Dotted line extends right:** The empty tick cell is still a real table cell, so the horizontal dotted separator between rows continues to the right edge of the tick column.
- **No tick, no column:** If the day has no ticks at all, no tick cell is rendered; the row ends at `... | Jellyfin` without a dangling `|`.
- **Cache-buster:** `history.js?571`, `nextep.js?615` (`__NX_BUILD 543`); `style.css?614` unchanged.

## 1.92 - 19/10/2026-15:58
### TR
- **Geçmiş tooltip tick hizası:** doğrudan işaretlenen satırlarda yeşil tick artık kaynaktan sonra `| ✓` biçiminde ayrılıyor. Tick hücresinin ayırıcıyı kapatan özel kuralı kaldırıldı; sol boşluk sıfırlandı. Böylece satır `Fallout | S01E02 | 18.10.2026 | 22:51 | Jellyfin | ✓` görünüyor.
- **Tick yoksa gereksiz `|` yok:** tick hücresi yalnızca `marked` veya `direct` satırlarda üretildiği için, o gün hiç tick yoksa satır `... | Jellyfin` olarak bitiyor; sona boş `|` eklenmiyor.
- **Cache-buster:** `style.css?614` (JS/API değişmedi).
### EN
- **History tooltip tick alignment:** on directly marked rows the green tick now follows the source as `| ✓`. The rule that suppressed the tick cell separator was removed and its left padding set to zero, so the row reads `Fallout | S01E02 | 18.10.2026 | 22:51 | Jellyfin | ✓`.
- **No dangling `|` when there is no tick:** the tick cell is only rendered for `marked` or `direct` rows, so a day without ticks ends at `... | Jellyfin` with no trailing separator.
- **Cache-buster:** `style.css?614` (no JS/API changes).

## 1.91 - 19/10/2026-15:39
### TR
- **Geçmiş takviminde doğrudan işaretleme tick'i:** Plex/Jellyfin/Emby'den poster üzerinden "izlendi" işaretlenen kayıtlar artık geçmiş takviminde **yeşil tick** ile gösteriliyor. `episodes`, `followed` ve `anime_episodes` tablolarına `direct_mark` eklendi; yalnızca medya sunucusunun `direct=True` yazımı `1`, ask "Evet" onayı ve NextEp içi manuel yazımlar `0` yazıyor. Böylece "Evet"e basılmadan gelen kayıtlar ayırt edilebiliyor.
- **Geçmiş satırına kaynak kolonu:** tooltip satırı artık `Yapım | S01E02 | 18.10.2026 | 22:51 | Jellyfin | ✓` biçiminde; kaynak, mevcut renkli Stremio/Plex/Jellyfin/Emby/Diğer etiketleriyle gösteriliyor. Tick, Ezel'deki "İşaretlendi" rozetiyle aynı yeşil görsel.
- **Tek seferlik backfill:** kaynak `plex/jellyfin/emby`, izlenmiş ve aynı anahtar için `resolved=1` + `created_at=watched_at` ask kaydı olmayan satırlar `direct_mark=1` alıyor. Mevcut DB'de 5 kayıt tick aldı: Fallout S1E1/E2, Mission: Impossible – Son Hesaplaşma, Profesyonel, F1 Filmi. (Bir Yıldız Doğuyor deploy öncesi DB'den çıkarılmıştı; kurala uyan bir satır olarak yeniden eklenirse otomatik tick alır.) Kaçakçı ask "Evet" ile girdiği için tick almıyor; Ezel ve "tümünü izlenmiş say" kayıtları mevcut `watch_marks` tick'ini koruyor.
- **Cache-buster:** `history.js?570`, `nextep.js?614` (`__NX_BUILD 542`), `style.css?613`.
### EN
- **Direct-mark tick in the history calendar:** entries marked watched directly from a Plex/Jellyfin/Emby poster now show a **green tick**. Added `direct_mark` to `episodes`, `followed` and `anime_episodes`; only media-server `direct=True` writes `1`, while ask "Yes" approvals and in-app manual writes store `0`. This distinguishes entries that arrived without pressing "Yes".
- **Source column in history rows:** the tooltip row is now `Title | S01E02 | 18.10.2026 | 22:51 | Jellyfin | ✓`; the source uses the existing coloured Stremio/Plex/Jellyfin/Emby/Other labels. The tick uses the same green visual as the existing "Marked" badge.
- **One-time backfill:** rows with source `plex/jellyfin/emby`, watched=1, and no matching `resolved=1` ask with `created_at=watched_at` get `direct_mark=1`. Five current rows got the tick: Fallout S1E1/E2, Mission: Impossible – Son Hesaplaşma, Profesyonel, F1 Filmi. (Bir Yıldız Doğuyor had already been removed from the DB before deploy; a matching row re-added later will get the tick automatically.) Kaçakçı was approved via ask, so no tick; Ezel and "mark all watched" entries keep their existing `watch_marks` tick.
- **Cache-buster:** `history.js?570`, `nextep.js?614` (`__NX_BUILD 542`), `style.css?613`.

## 1.90 - 19/10/2026-15:13
### TR
- **İzlendi-sor penceresinde mükerrer ask düzeltildi:** Stremio aynı oynatma için altyazı ucunu birden fazla kez çağırıyor ve her istek ayrı thread'de işleniyordu; `_create_watched_ask` içindeki "bekleyen ask var mı?" SELECT'i ile INSERT arasında kilit olmadığı için iki thread aynı anda geçip **iki özdeş `watched_ask`** yazabiliyordu (pi'de Organize İşler S1E1: id 171/172, aynı saniye). Artık: ① `routes.stremio._ASK_LOCK` ile dedupe + INSERT seri; ② `notifications` üzerinde `resolved<>2` koşullu, NULL-güvenli (`COALESCE`) **kısmi UNIQUE index** (`ux_notif_watched_ask`) + açılışta idempotent mükerrer temizliği; ③ `create_notification` `INSERT OR IGNORE` + `rowcount` kontrolü ve `finally` ile bağlantı kapatma; index reddederse `_create_watched_ask` mevcut satırın id'sini döndürür. "Hayır" sonrası yeniden sorma ve "Evet" sonrası sormama davranışı korunur.
### EN
- **Duplicate asks in the watched-ask window fixed:** Stremio calls the subtitle endpoint multiple times per playback and each request runs in its own thread; `_create_watched_ask` had no lock between its pending-ask SELECT and INSERT, so two threads could both pass and write **two identical `watched_ask` rows** (pi: Organize İşler S1E1, ids 171/172, same second). Now: ① `routes.stremio._ASK_LOCK` serialises dedupe + INSERT; ② a NULL-safe (`COALESCE`) **partial UNIQUE index** (`ux_notif_watched_ask`) on `notifications` with `resolved<>2`, plus idempotent duplicate cleanup at startup; ③ `create_notification` uses `INSERT OR IGNORE` + `rowcount` check and closes its connection in `finally`; if the index rejects the row, `_create_watched_ask` returns the existing row id. "No" → ask again and "Yes" → never ask again behaviour is unchanged.

## 1.89 - 19/10/2026-02:11
### TR
- **"Public adres tanımlı değil" notu artık kırmızı:** bu not, izlendi detaylarıyla aynı sınıfı kullanıyordu (`tp-frame-note`, yeşil `#2e7d32`) ve bu yüzden yanlışlıkla yeşil görünüyordu. Yeni **`.tp-frame-note.tp-warn`** varyantı eklendi (`color: #ef4444`); not artık **Stremio + Takvim + Plex/Jellyfin/Emby** kartlarının (URL) çerçevelerinde kırmızı gösteriliyor. İzlendi detayları (ör. "… izlendi") **yeşil** kalır.
- **Cache-buster:** `settings.js?577`, `nextep.js?613` (`__NX_BUILD 541`), `style.css?612`.
### EN
- **The "Public address not set" note is now red:** because the note shared the class used by watched detail lines (`tp-frame-note`, green `#2e7d32`) it was rendered green by mistake. A new **`.tp-frame-note.tp-warn`** variant was added (`color: #ef4444`) and the note now shows red in the (URL) frames of the **Stremio + Calendar + Plex/Jellyfin/Emby** cards. Watched detail lines (e.g. "… watched") stay **green**.
- **Cache-buster:** `settings.js?577`, `nextep.js?613` (`__NX_BUILD 541`), `style.css?612`.

## 1.88 - 19/10/2026-02:09
### TR
- **Güncelleme ekranı artık anında açılıyor:** "NextEp Güncelleme" bölümüne girildiğinde **30 saniyeye varan bekleme** vardı; çünkü ilk yanıt GitHub raw `VERSION` + yayınlanmış sürüm geçmişini (her VERSION commit'i için ayrı API çağrısı) bekliyordu. Artık:
  - Yeni **ağsız uç** `GET /api/app-update/version` → yerel sürüm (DB/dosya) + önbellekteki uzak sürüm; **anında** döner.
  - Bölüm açılır açılmaz **"Mevcut sürüm"** yazılır, **Güncelle** düğmesi önbellekteki duruma göre doğru hâle gelir; **hiçbir düğme boşuna devre dışı kalmaz**. Ağa **yalnız "Kontrol Et"** ile çıkılır (basılınca yalnız o düğme kısa süre kilitlenir).
  - `check_update()` sonucu **5 dk** önbelleklenir, "Kontrol Et" için **60 sn yenileme aralığı** vardır; fetch zaman aşımları **20 → 8 sn**; yayınlanmış sürüm listesi (`known`) yanıtı **bloklamaz** (arka planda tazelenir); ağ hatasında son bilinen uzak sürüme düşer.
  - **Yerel sürüm değişince önbellek bayat sayılır** (yoksa `/version` ile `/check` farklı sürüm gösterebiliyordu).
  - Sürümün gerçek kaynağı **DB `version` tablosudur**; `VERSION` dosyası ondan senkronlanır.
- **Public Adres kendi akordeonunda:** `tp_base_url` yalnız Stremio kartı içinden düzenlenebiliyordu; artık **"Sunucu Bağlantı Ayarları" ile "Stremio" arasında** ayrı bir kart. Tek-açık akordeon, **admin'e** görünür; Stremio kartında yalnız "Kurulum Bağlantısı (URL)" satırı kaldı (kaydetme mantığı ve "değişiklik yoksa kaydetme" kuralı aynen korundu).
- **"Kurulum Bağlantısı (URL)" artık LAN adresi göstermez:** (URL) çerçeveleri yalnız **public** adresten üretilir (`_public_base()`; eskiden public adres yoksa LAN adresine düşüyordu). Public adres tanımlı değilse çerçeve boş kalmaz, **"Public adres tanımlı değil"** yazar. "Bağlantıyı Kes" düğmesi artık adresin varlığına değil **kartın kurulu olmasına** bağlıdır (public adres yokken de bağlantı kesilebilir).
- **Çeviri:** yeni anahtar `tp_public_missing` ("Public adres tanımlı değil") **14 dilde**; kullanılmayan `tp_install_url` silindi. Cache-buster: `settings.js?576`, `i18n.js?546`, `nextep.js?612` (`__NX_BUILD 540`), `style.css?611`.
### EN
- **The update screen now opens instantly:** entering "NextEp Update" used to take up to **30 seconds**, because the first response waited for the GitHub raw `VERSION` plus the published-version history (one API call per VERSION commit). Now:
  - New **network-free endpoint** `GET /api/app-update/version` → local version (DB/file) + cached remote version; returns instantly.
  - As soon as the section opens, **"Current version"** is rendered and the **Update** button gets its correct state from the cache; **no button is needlessly disabled**. The network is only touched through **"Check"** (and then only that button is briefly locked).
  - The `check_update()` result is cached for **5 minutes** with a **60-second refresh window** for "Check"; fetch timeouts went **20 → 8 s**; the published-version list (`known`) no longer **blocks** the response (it is refreshed in the background); on a network error it falls back to the last known remote version.
  - **A local version change marks the cache stale** (otherwise `/version` and `/check` could report different versions).
  - The real source of truth for the version is the **DB `version` table**; the `VERSION` file is synchronised from it.
- **Public Address has its own accordion:** `tp_base_url` could only be edited inside the Stremio card; it is now a separate card **between "Server Connection Settings" and "Stremio"** — single-open accordion, visible to **admins**; the Stremio card keeps only its "Install Link (URL)" row (the save logic and the "no change → no save" rule are unchanged).
- **"Install Link (URL)" no longer shows a LAN address:** (URL) frames are built only from the **public** address (`_public_base()`; previously it fell back to the LAN address when the public one was missing). When no public address is set the frame does not stay empty — it shows **"Public address not set"**. The "Disconnect" button now depends on the card being **installed** rather than on the address being present (so you can disconnect even without a public address).
- **Translations:** new key `tp_public_missing` ("Public address not set") in **14 languages**; unused `tp_install_url` removed. Cache-buster: `settings.js?576`, `i18n.js?546`, `nextep.js?612` (`__NX_BUILD 540`), `style.css?611`.

## 1.87 - 19/10/2026-01:52
### TR
- **Emby API senkronu (yeni):** Emby webhook'u **Premiere** gerektirdiği için Emby kartı iki iç bölüme ayrıldı (**Webhook** / **API Key**) ve **API anahtarı ile senkron** eklendi. Anahtar **şifreli** saklanır (`crypto_util.encrypt_secret`); bağlantı **WebSocket** ile anlık, **15 dakikalık yoklama** ile yedeklidir. Kural: `PlayCount == 0` / `LastPlayedDate` yok = **elle işaretleme** → doğrudan yazılır; `PlayCount >= 1` = gerçek oynatma → **sor** akışına girer. API çerçevesinde "Durum", "Son sinyal" (+ "xyz izlendi"), taşıyıcı satırı (Anında/Kontrol · `{n} İzlenmiş`) ve API adresi/kullanıcı alanları bulunur.
- **Ask (izlendi bilgisi sor) kalıcı hafıza:** yeni `ask_decisions` tablosu ile Evet/Hayır kararları kalıcı tutulur; **bekleyen soru** varken aynı bölüm için yeni soru üretilmez, **reddedilen** kayıt yeniden sorulabilir. Aynı gün aynı başlık için tekrar soru üretilebilmesi amacıyla `create_notification(skip_dedupe=True)` eklendi. "Tüm bildirimleri temizle" artık **yalnız bekleyen** soruları siler, kararları unutturmaz.
- **Elle işaretleme / kaldırma (Jellyfin + Emby):** Jellyfin `UserDataSaved` + `SaveReason=TogglePlayed`, Emby `item.markplayed` / `item.markunplayed`. Elle "izlendi" **doğrudan yazılır** (sorulmaz); önceki bölüm izlenmemişse **kilit sorusu** çıkar. İşaret kaldırma **korunmalıdır**: yalnız aynı kaynağın yazdığı kayıt geri alınır (Stremio'nun yazdığı kayıt Emby/Jellyfin/Plex ile silinmez).
- **Poster/thumbnail:** eksik veya kırık görsel yolu düzeltildi (`ensure_thumbnail` varlık kontrolü, sor penceresi poster alanları, `asks.js` geri dönüşü: thumb → w500 → harf).
- **Profil bazlı VPS kurulumu:** Stremio'nun "Sunucuya Kur"u yalnız `/stremio/*` yazar; **Takvim** ve **Plex/Jellyfin/Emby** (webhook) kartları kendi profilleriyle kurulur ve **bir profilin kurulumu diğerlerinin rotalarını silmez** (ekleyici/idempotent yamalar). Kart durumu `vpsRouteOk` / `vpsTunnelOk` ile gösterilir.
- **Kurulum bağlantıları (LAN + URL):** her webhook/Takvim kartında **Kurulum Bağlantısı (LAN)** ve **(URL)** çerçeveleri; LAN adresi otomatik tespit edilir (taban adres kutusu yok, yalnız tam LAN linki). Durum artık **nereden bağlı** olduğunu söyler: **`Bağlı (LAN)`** / **`Bağlı (URL)`** (webhook kartları, Takvim ve Emby API). "Sunucuya Kur" düğmesi bağlıyken **devre dışı** olur ve tooltip'te `{app} Webhook LAN/URL üzerinden bağlı` yazar; henüz olay gelmemişse `Sunucuya kurulu`.
- **"Son sinyal" çerçeveleri:** Stremio kartındaki çerçeve Plex / Jellyfin / Emby (Webhook + API) kartlarına eklendi — zaman + altında **"xyz izlendi"**. Sinyal yoksa **"—"** ve **"Henüz sinyal yok"**. **Kaynak filtresi:** Stremio kartı artık yalnız `source='stremio'` sinyallerini gösterir (Emby/Jellyfin/Plex sinyalleri oraya düşmez); her kart yalnız kendi kaynağını gösterir.
- **Kaynak bazlı "İzlendi bilgisi sor":** Stremio/Plex/Jellyfin/Emby kartlarının **en üstünde** anahtar. Plex/Jellyfin/Emby için **kaynak bazlı** ayar (`ask_before_watched_plex|_jellyfin|_emby`); boş ise **genel** `ask_before_watched` geçerlidir (davranış değişmez). Bir kaynak kapatılırsa yalnız o kaynak sormadan doğrudan yazar; **E-1 kilidi** ve "kilit ihlali + sor kapalı → yazma yok" kuralı aynen korunur.
- **Arayüz düzeni:** "Bağlantılar" penceresindeki kart sırası **Stremio → Plex → Jellyfin → Emby → Takvim (ICS) → Uzak Bağlantı**; her kart **tek açık** akordeondur. Plex başlığı **(Plex Pass)**, Emby webhook çerçevesi **(Premiere)** ile gerekliliği gösterir; Plex webhook tarifi notu kaldırıldı.
- **Çeviri + cache-buster:** yeni anahtarlar 14 dilde (`tp_install_url_lan|_pub`, `tp_via_lan|_url`, `tp_lan_connected`, `tp_url_connected`, `tp_no_signal_yet`, `tp_plex_pass` …); kullanılmayan anahtarlar silindi (`vps_installed` metni "Sunucuya kurulu" oldu, `tp_lan_running`, `tp_plex_note`, `tp_emby_last_sync`). Tek `?v=` kuralı korunarak dalga uygulandı: `settings.js?573`, `i18n.js?544`, `nextep.js?609` (`__NX_BUILD 537`), `style.css?611`.
### EN
- **Emby API sync (new):** since Emby webhooks require **Premiere**, the Emby card now has two inner sections (**Webhook** / **API Key**) with an **API-key sync**. The key is stored **encrypted** (`crypto_util.encrypt_secret`); delivery is instant over **WebSocket** with a **15-minute poll** as a fallback. Rule: `PlayCount == 0` / no `LastPlayedDate` = **manual mark** → written directly; `PlayCount >= 1` = real playback → goes through the **ask** flow. The API frame shows status, **"Last signal"** (+ "xyz watched"), a transport line (instant/15-min · `{n} watched`) and the API address/user fields.
- **Persistent ask memory:** the new `ask_decisions` table keeps Yes/No decisions; while an ask is **pending** no duplicate is created, while **rejected** entries can be asked again. `create_notification(skip_dedupe=True)` allows re-asking the same title on the same day. "Clear all notifications" now removes **only pending** asks and does not forget decisions.
- **Manual mark / unmark (Jellyfin + Emby):** Jellyfin `UserDataSaved` + `SaveReason=TogglePlayed`, Emby `item.markplayed` / `item.markunplayed`. A manual "watched" is written **directly** (no ask); if the previous episode is unwatched the **lock question** appears. Unmarking is **guarded**: only records written by the same source are reverted (an Emby/Jellyfin/Plex unmark never deletes a Stremio record).
- **Poster/thumbnail:** fixed missing or broken image paths (`ensure_thumbnail` existence check, ask-window poster fields, `asks.js` fallback chain: thumb → w500 → letter).
- **Per-profile VPS install:** Stremio's "Install on Server" only writes `/stremio/*`; the **Calendar** and **Plex/Jellyfin/Emby** (webhook) cards install their own profiles, and installing one profile **never removes another profile's routes** (additive, idempotent patchers). Card state is reported through `vpsRouteOk` / `vpsTunnelOk`.
- **Install links (LAN + URL):** every webhook/Calendar card has **Install Link (LAN)** and **(URL)** frames; the LAN address is auto-detected (no base-address input, only the full LAN link). The status now says **where it is connected from**: **`Connected (LAN)`** / **`Connected (URL)`** (webhook cards, Calendar and Emby API). While connected the "Install on Server" button is **disabled** and its tooltip reads `{app} webhook connected over LAN/URL`; before the first event it reads `Installed on server`.
- **"Last signal" frames:** the Stremio card's frame was added to Plex / Jellyfin / Emby (Webhook + API) — a timestamp plus **"xyz watched"** underneath. With no signal it shows **"—"** and **"No signal yet"**. **Source filter:** the Stremio card now shows only `source='stremio'` signals (Emby/Jellyfin/Plex signals never land there); every card shows only its own source.
- **Per-source "Ask before watched":** a switch at the **top** of the Stremio/Plex/Jellyfin/Emby cards. Plex/Jellyfin/Emby use a **per-source** setting (`ask_before_watched_plex|_jellyfin|_emby`); when empty the **global** `ask_before_watched` applies (behaviour unchanged). Turning a source off makes only that source write directly; the **E-1 lock** and the "lock violated + asking off → nothing is written" rules are preserved.
- **UI layout:** card order in the Connections window is **Stremio → Plex → Jellyfin → Emby → Calendar (ICS) → Remote Connection**; each card is a **single-open** accordion. The Plex title shows **(Plex Pass)** and the Emby webhook frame **(Premiere)**; the Plex webhook recipe note was removed.
- **Translations + cache-buster:** new keys in 14 languages (`tp_install_url_lan|_pub`, `tp_via_lan|_url`, `tp_lan_connected`, `tp_url_connected`, `tp_no_signal_yet`, `tp_plex_pass` …); unused keys removed (`vps_installed` text became "Installed on server", `tp_lan_running`, `tp_plex_note`, `tp_emby_last_sync`). The single-`?v=` rule was kept while bumping the wave: `settings.js?573`, `i18n.js?544`, `nextep.js?609` (`__NX_BUILD 537`), `style.css?611`.

## 1.86 - 18/10/2026-19:36
### TR
- **Yeni özellik — Plex / Jellyfin / Emby webhook'ları:** Ayarlar → Üçüncü Parti Apps'e Stremio'nun altına **üç ayrı kart** eklendi. Her kart kişiye özel bir adres üretir: `nextep.cembol.com/webhook/<app>/<token>`. Plex'te **Webhooks** (Plex Pass gerekir; `media.scrobble`), Jellyfin'de **Webhook eklentisi** (`PlaybackStop`), Emby'de **Webhooks** (`Playback Stop`) bu adrese bağlanır; izleme **uygulamadan çıkınca anında** (gecelik tarama beklenmeden) işlenir.
- **Kaynak etiketi (nereden izlendi):** her bölüm/film artık **kaynağını** taşır — `stremio | plex | jellyfin | emby | other`. Etiket yalnız **iki yüzeyde** görünür: **İzlendi-Bilgisi (sor) penceresinde** damga satırının sonunda (`18.10.2026 - Pazar - 16:34 - Plex`) ve **bölüm/film özet modalında** "Süre"nin üzerinde `Kaynak: Plex`. Renkler marka renkleridir (Stremio mor, Plex sarı, Jellyfin mavi, Emby yeşil, Diğer gri). Kart üstü ve kart takvim modalı **kapsam dışı**.
- **"Son kaynak kazanır":** aynı bölüm önce Stremio'da sonra Plex'te izlenirse etiket son kaynağa döner; **bekleyen sor kaydı** varsa etiket orada da tazelenir (yeni sor üretilmez).
- **Elle işaretleme / belirsiz oynatıcı → "Diğer":** kart, takvim ve öneri listesinden yapılan elle "izlendi" işaretlemeleri (tek bölüm, sezon, tüm dizi/anime, film) `other` yazar. VLC gibi kaynağı belirsiz oynatıcılar için ileride **Trakt entegrasyonu** düşünülüyor (1.87 adayı).
- **`ask_before_watched` uyumu:** webhook da aynı ayara uyar — açıkken **Evet/Hayır** sorulur, kapalıyken doğrudan izlendi yazılır; E-1 kilidi, sinyal tamponu ve poster/thumbnail üretimi Stremio yoluyla **aynı çekirdekten** geçer.
- **Eşleştirme:** bölüm önce sağlayıcı kimliğiyle (TMDB/TVDB/IMDb) çözülür ve sezon/bölüm TMDB'de **doğrulanır**; kimlik yoksa (Plex/Jellyfin bölüm payload'ları çoğu zaman bölüm seviyesi kimlik gönderir) TMDB'de **isim araması** yapılır ve yine sezon/bölüm doğrulanır. Eski Plex ajanının `tvdb://<seri>/<sezon>/<bölüm>` biçimi de desteklenir. Çözülemeyen olay yazılmaz, log'a düşer (yanlış yapıma yazmamak için doğrulama şartı).
- **Sunucu:** yeni `py/routes/webhook.py` (`POST /webhook/<app>/<token>`; yanlış/boş token → **404**, olay tipleri filtrelenir, yarıda bırakılan izleme "Played=false" ise atlanır). `THIRDPARTY_APPS`'e `plex|jellyfin|emby` (protokol `webhook`), jenerik `/api/thirdparty/<app>/refresh-uuid|disconnect` uçları, kart durumu **"Hazır" → ilk gerçek olayda "Bağlı"**. Veritabanı: `episodes.source`, `anime_episodes.source`, `followed.watched_source`, `notifications.source`, `stremio_signals.source` (`ALTER TABLE`; veri göçü gerekmez, eski kayıtlar etiketsiz kalır ve satır gizlenir).
- **Çeviri:** 7 yeni anahtar × 14 dil (`ep_source`, `tp_plex_note`, `tp_jellyfin_note`, `tp_emby_note`, `tp_webhook_recipe`, `tp_webhook_refreshed`, `tp_webhook_disconnect_text`). Plex Pass notu kartta duruyor. **Cache-buster dalgası:** tüm js `?v=` +1 (i18n 530, components 534, views 533, settings 552, notification 543, asks 548, tv 531, auth 528 …), `nextep.js?v=587` (`__NX_BUILD` 515), `style.css?v=608`.
- **İzlendi-Bilgisi paneli düzeltmesi (1.85 içi):** Evet/Hayır düğmeleri artık her kartta **kendi satırında, pencere ortasında** ve **yeşil tik / kırmızı x ile aynı hizada**; mesaja gelince düğme zeminleri renklenir (yeşil/kırmızı) ve metin beyazlar.
### EN
- **New feature — Plex / Jellyfin / Emby webhooks:** three separate cards were added under Stremio in Settings → Third Party Apps. Each card issues a personal address, `nextep.cembol.com/webhook/<app>/<token>`. Plex **Webhooks** (Plex Pass required; `media.scrobble`), the Jellyfin **Webhook plugin** (`PlaybackStop`) and Emby **Webhooks** (`Playback Stop`) point at it, so a watch is processed **the moment you leave the app** (no overnight scan needed).
- **Source label (where it was watched):** every episode/movie now carries its **source** — `stremio | plex | jellyfin | emby | other`. The label appears on exactly **two surfaces**: in the **watched-ask window** at the end of the stamp line (`18 Oct 2026 - Sunday - 16:34 - Plex`) and in the **episode/movie summary modal** as `Source: Plex` above "Runtime". Colours follow the brands (Stremio violet, Plex amber, Jellyfin blue, Emby green, Other grey). Card faces and the card calendar modal are **out of scope**.
- **"Last source wins":** if the same episode is watched first in Stremio and then in Plex, the label flips to the latest source; if an ask record is still pending, its label is refreshed too (no duplicate ask).
- **Manual marking / unknown players → "Other":** manual "watched" marks from cards, the calendar and the recommendations list (single episode, season, whole show/anime, movie) write `other`. A **Trakt integration** is the planned answer for unknown players such as VLC (1.87 candidate).
- **`ask_before_watched` respected:** webhooks obey the same setting — when on you get the **Yes/No** question, when off the watch is recorded directly; the E-1 lock, signal buffer and poster/thumbnail handling all go through the **same core** as Stremio.
- **Matching:** an episode is first resolved by provider id (TMDB/TVDB/IMDb) and the season/episode is **verified** in TMDB; without an id (Plex/Jellyfin episode payloads usually send episode-level ids) a **title search** on TMDB is used and verified the same way. The legacy Plex agent form `tvdb://<series>/<season>/<episode>` is supported too. Unresolvable events are not written and are logged — verification is mandatory so we never write to the wrong title.
- **Server:** new `py/routes/webhook.py` (`POST /webhook/<app>/<token>`; wrong/empty token → **404**, event types are filtered, an aborted watch with `Played=false` is skipped). `THIRDPARTY_APPS` gained `plex|jellyfin|emby` (protocol `webhook`), generic `/api/thirdparty/<app>/refresh-uuid|disconnect` endpoints, and the card status goes **"Ready" → "Connected" on the first real event**. Database: `episodes.source`, `anime_episodes.source`, `followed.watched_source`, `notifications.source`, `stremio_signals.source` (`ALTER TABLE`; no data migration, old rows stay unlabelled and the row is hidden).
- **i18n:** 7 new keys × 14 languages (`ep_source`, `tp_plex_note`, `tp_jellyfin_note`, `tp_emby_note`, `tp_webhook_recipe`, `tp_webhook_refreshed`, `tp_webhook_disconnect_text`). The Plex Pass note stays on the card. **Cache-buster wave:** every js `?v=` +1 (i18n 530, components 534, views 533, settings 552, notification 543, asks 548, tv 531, auth 528 …), `nextep.js?v=587` (`__NX_BUILD` 515), `style.css?v=608`.
- **Watched-ask panel fix (within 1.85):** the Yes/No buttons now sit on **their own row, centred in the window**, **aligned with the green tick / red x**; hovering the message tints the button backgrounds (green/red) and turns the labels white.

## 1.85 - 18/10/2026-01:31
### TR
- **Yeni özellik — Takvim aboneliği (.ics):** kişiye özel bir adres (`/calendar/<token>/nextep.ics`) Google/Apple Takvim'e abone edilir; **yaklaşan** dizi/belgesel dizisi bölümleri, anime bölümleri ve film vizyonları takvime otomatik düşer. Arşivli yapımlar dışarıda; geçmiş olaylar gönderilmez.
- **Hatırlatıcı:** her olay için yayından **1 gün önce** `VALARM` eklenir (Apple Takvim doğrudan uygular; Google abone takvimlerde takvimin kendi bildirimini açmak gerekir — kartta bu not gösterilir).
- **Ayarlar → Üçüncü Parti Apps → "Takvim (ICS)" kartı:** adres + **Kopyala** + **Yenile** (yeni token) + **Kes** (token iptali, adanmış onay penceresi). Adres, Public Adres (`tp_base_url`) üzerinden üretilir.
- **Domain:** tüm dış erişim artık **`nextep.cembol.com`** üzerinden (`/stremio/*` + `/calendar/*`). Eski `stremio.cembol.com` kaldırıldı; VPS'te landing dizini `/var/www/nextep` oldu.
- **Sunucu:** yeni `py/ics.py` (elle yazılmış minimal iCalendar üreteci — dış paket yok) + yeni `/calendar/<token>/nextep.ics` ucu (public; yanlış/boş token → **404**). `THIRDPARTY_APPS`'e `calendar` eklendi; `/api/thirdparty/calendar/refresh-uuid|disconnect` uçları Stremio deseninin kardeşi.
- **Çeviri:** 4 yeni anahtar × 14 dil. **Cache-buster zinciri:** i18n 528, settings 550, components 532, tv 530, `nextep.js?v=580` (`__NX_BUILD` 511).
- **Takvim olay süresi düzeltmesi:** saatli olaylarda artık **bölümün kendi süresi** (`episodes.runtime`) kullanılır; bilinmiyorsa **1 saat**. Dizi genel süresi (`followed.runtime`) **artık kullanılmaz** — bazı dizilerde 130 dk gibi sezon/özel bölüm değerleri taşıyıp takvimde 2+ saat yer tutuyordu. Anime için `duration` (yoksa 1 saat). Ayrıca ICS'e **`REFRESH-INTERVAL`/`X-PUBLISHED-TTL` (saatlik yenile ipucu)** eklendi → mobil istemcilerde senkronizasyon gecikmesi azalır.
- **Landing sayfası (nextep.cembol.com) yenilendi:** artık **sekmeli** — **Stremio | Takvim**. Takvim sekmesi, Stremio ile aynı şemada (*Ne işe yarar? / Kurulum / Önemli notlar*) Google ve Apple Takvim kurulum adımlarını, hatırlatıcı notunu, mobil görünürlük ve güncelleme davranışını anlatır (14 dil). Sayfa başlığı (`h1`) sekmeye göre değişir: **"Stremio Plugin"** / **"Takvim Aboneliği"** (nav markası "NextEp Watch Sync" sabit). Dosya `service/nextep-landing.html` olarak yeniden adlandırıldı; VPS kurulumunun varsayılan landing yolu `/var/www/nextep` oldu.
- **Logo metni ve boyutu:** uygulama logosundaki yazı **"Dizi · Film · Belgesel · Anime Takip"** oldu (14 dil) ve font küçültüldü (masaüstü `1.7rem → 1.15rem`, taban `1.3rem → 1.05rem`; TV orantılı). Landing'in nav logosu da uygulama logosuyla (base64 gömülü PNG) değiştirildi, metni aynı 14 dilde gösterilir; **favicon** olarak da aynı logo gömüldü (`<link rel="icon">` + `apple-touch-icon`).
- **Mobil "Sıradaki Bölüm" şeridi:** telefonda artık **satırda 2 kart** görünür ve liste **yatay kaydırılır** (alt satıra düşmez; masaüstündeki satır-kaydırmalı ortalanmış düzen aynı kalır). Kart posteri **%25 küçültüldü** (27×40), yapım adı **tek satır** (uzunsa `…` ile kesilir; masaüstünde 2 satır) ve bölüm süresi mobilde de görünür (`S02E05 · 45 dk`).
### EN
- **New feature — Calendar subscription (.ics):** a personal address (`/calendar/<token>/nextep.ics`) can be subscribed to in Google/Apple Calendar; **upcoming** show/documentary-series episodes, anime episodes and movie releases drop into the calendar automatically. Archived titles are excluded; past events are not emitted.
- **Reminder:** each event carries a `VALARM` **1 day before** airing (Apple Calendar applies it directly; in Google's subscribed calendars you need to enable the calendar's own notifications — the card shows this note).
- **Settings → Third Party Apps → "Calendar (ICS)" card:** address + **Copy** + **Refresh** (new token) + **Disconnect** (token revoked, dedicated confirm dialog). The address is built from the Public Address (`tp_base_url`).
- **Domain:** all external access now goes through **`nextep.cembol.com`** (`/stremio/*` + `/calendar/*`). The old `stremio.cembol.com` was removed; the VPS landing directory became `/var/www/nextep`.
- **Server:** new `py/ics.py` (hand-written minimal iCalendar generator — no external package) plus the new `/calendar/<token>/nextep.ics` endpoint (public; wrong/empty token → **404**). `calendar` added to `THIRDPARTY_APPS`; `/api/thirdparty/calendar/refresh-uuid|disconnect` mirror the Stremio pattern.
- **i18n:** 4 new keys × 14 languages. **Cache-buster chain:** i18n 528, settings 550, components 532, tv 530, `nextep.js?v=580` (`__NX_BUILD` 511).
- **Calendar event duration fix:** timed events now use the **episode's own runtime** (`episodes.runtime`); when unknown, **1 hour**. The show-level runtime (`followed.runtime`) is **no longer used** — some shows carried season/special values such as 130 min and blocked 2+ hours in the calendar. For anime, `duration` (else 1 hour). Also added **`REFRESH-INTERVAL`/`X-PUBLISHED-TTL` (hourly refresh hint)** to the ICS, reducing sync lag on mobile clients.
- **Landing page (nextep.cembol.com) redesigned:** now **tabbed** — **Stremio | Calendar**. The Calendar tab follows the same scheme as Stremio (*What does it do? / Setup / Important notes*) and walks through Google and Apple Calendar setup, the reminder note, mobile visibility and refresh behaviour (14 languages). The page title (`h1`) changes per tab: **"Stremio Plugin"** / **"Calendar Subscription"** (nav brand stays "NextEp Watch Sync"). The file was renamed to `service/nextep-landing.html` and the VPS installer's default landing path became `/var/www/nextep`.
- **Logo text and size:** the app logo caption is now **"TV · Movie · Documentary · Anime Tracker"** (14 languages) and its font was reduced (desktop `1.7rem → 1.15rem`, base `1.3rem → 1.05rem`; TV scales proportionally). The landing nav logo now uses the app logo (base64-embedded PNG) with the same 14-language caption, and the same logo is embedded as the **favicon** (`<link rel="icon">` + `apple-touch-icon`).
- **Mobile "Up Next" strip:** on phones the strip now shows **2 cards per row** and scrolls **horizontally** (no second row; the desktop row-wrapped centred layout is unchanged). The card poster was **reduced by 25%** (27×40), the title is a **single line** (truncated with `…` when too long; two lines on desktop) and the episode duration is visible on mobile too (`S02E05 · 45 min`).
- **Row-view status colour:** in card view text statuses (`.next-ep.muted`) were already `#ef4444`, but in row view every status looked green. `rowview.js` `extract()` now sets a `statusMuted` flag (whether `.mrow-status .next-ep.muted` exists) and `cellSpecs()` adds the `wc-status-muted` class to the status cell; `style.css` → `.poster-grid.row-mode .wc-status.wc-status-muted { color: #ef4444; }`. So in row view `S02E03 · Oct 21 · 3` stays **green** while `Ended` / `Canceled` / `Waiting for a new season` (and anime equivalents) appear **red**.
- **Archived dimming in row view:** the card-view rule `.card.is-archived .info { opacity:.45; filter:saturate(.5) }` had **no effect** in row mode (there `.info { display: contents }` generates no box, so `opacity` does not apply). Added `.poster-grid.row-mode .card.is-archived .wcell:not(.wc-actions) { opacity: .45; filter: saturate(.5) }` → in row view archived cards' text cells are dimmed while **buttons (`wc-actions`) are unaffected** (consistent with card view). Also applies in the Archive tab.
- **"Archived" badge removed:** the `.badge-archived` pill on archived cards (Archive tab + archived cards in media tabs) was removed — the `archivedBadgeHTML()` function and its 7 call sites were deleted (`views.js`). Card **dimming** (`.is-archived`) and the buttons remain; `i18n.archived_badge` and the `.badge-archived`/`.archived-line` CSS are now unused (harmless, left in place).
- **Mobile/tablet navbar "Archive" label removed:** the ≤1366 tab-label hiding list in `tablet.css` **did not include `#tab-archive`** (added in 1.83 without updating the list) → on tablet/mobile the Archive button showed both icon and label, overflowing the 30px button. Added `html:not(.is-tv):not(.tv-mode) #tab-archive span` to the list → icon only (consistent with the other tabs). `#tab-notif` / `#tab-watched-ask` / `#tab-history` spans are **badges** (counts) so they were deliberately left out.
- **Mobile strip scrollbar hidden:** on mobile `.nextup-strip` is horizontally scrollable, which drew a scrollbar underneath; added `scrollbar-width: none` + `-ms-overflow-style: none` + `::-webkit-scrollbar { display: none }` (same pattern as `.filter-add-row`). Scrolling still works.

## 1.84 - 18/10/2026-00:01
### TR
- **Yeni özellik — "Sıradaki Bölüm" şeridi:** **Dizi · Belgesel · Anime** sekmelerinin en üstünde, her yapımın **tek sonraki izlenmemiş bölümünü** gösteren şerit. Kartta poster + `S02E05 · 45 dk` (anime `EP12 · 24 dk`); karta tıklamak detay penceresini açar.
- **Kapsam:** yalnız çoklu bölümlü yapımlar — dizi, belgesel **dizisi** ve anime. Filmler ve belgesel filmleri **hiç görünmez** (tek öğede "sonraki bölüm" kavramı yok); arşivli yapımlar da dışarıda.
- **İzlemeye başlanmış olma şartı:** bir yapım şeride girmek için **ilk bölümü (en düşük sezon/bölüm) izlenmiş** olmalı; hiç izlenmeye başlanmamış yapımlar şeritte görünmez.
- **Sıralama:** yayın tarihi **en yeni önce**. Başlıkta sağda `N yapım · toplam M dk` özeti görünür.
- **Taşınabilir bölüm:** şerit, yukarı/aşağı oklarıyla taşınabilir; sıra tarayıcıda hatırlanır (varsayılan: en üstte).
- **Diziliş:** kart **genişliği altındaki standart kartla aynı**, yükseklik **84px sabit**, aralarındaki boşluk da grid boşluğuyla aynı → şerit sütunları alttaki kartlarla **birebir hizalı**. **Yatay kaydırma çubuğu yok**; satıra sığmayan kartlar **alt satıra ortalanarak** geçer (6 sütunlu geniş ekranda 7. kart ikinci satıra iner).
- **Yazı boyutları:** karttaki yapım adı standart kart başlığıyla, `S02E05 · 45 dk` satırı standart kart statü satırıyla **aynı** boyutta; yapım adı en fazla **iki satır** olur, ikinci satırın sonunda `…` ile kesilir (üçüncü satıra taşmaz).
- **Boş durum:** sırada izlenecek bölüm yoksa "Sıradaki Bölüm" bölümü **tümüyle gizlenir** (başlık ve oklar dahil).
- **Otomatik kalkma:** bölüm uygulama içinden izlendi işaretlenince şerit anında güncellenir; **Stremio eklentisi veya başka bir istemci** yazdığında 30 saniyelik bildirim sayacı kontrolü değişikliği görüp listeleri ve şeridi kendiliğinden tazeler.
- **Sunucu:** `GET /api/next-up` (dizi/anime için tek sonraki bölüm + `totals:{count,min}` + `genres`); `list_cache` ile önbelleklenir. **`in_watched` filtresi kaldırıldı** (İzlenmişler'e taşınmış ama yeni bölümü olan dizi de şeride girer).
- **Düzeltme:** medya sekmesi başlıklarındaki "Arşivlenenleri göster" anahtarı ile satır görünümü düğmesinin **üst üste binmesi** giderildi (bozuk `#view-#view-*` seçicileri düzeltildi — 3 CSS dosyası).
- **Bölüm özeti satırı:** "Sıradaki Bölüm" şeridinin başlığı altında (dotted çizginin sol altında) diğer bölümlerle aynı biçimde özet satırı: `16 Dizi | 285 Bölüm | İzlenmiş 119 Bölüm (180:18) | İzlenmemiş 166 Bölüm (147:01)`. (Eski sağdaki "N yapım · toplam M dk" kaldırıldı.) Satır **yatay çizginin tam altında, kartların üstünde** durur (ilk sürümde kartların altına düşüyordu — `ensureSectionSummary` artık şerit konteynerini de tanıyor).
- **Sıralama:** şerit artık **yaklaşan (gelecek) bölüm tarihine göre** dizilir — en yakın önce; gelecek bölümü olmayan yapımlar sonda (eşitlikte yayınlanmış bölüm tarihi en yeni önce).
- **Görsel rötuş:** şerit kartındaki metinler ortalandı; `S04E01 · 45 dk` satırı yeşil (`#22c55e`) — mobilde (≤600px) süre gizlenir, yalnız `S04E01` görünür.
- **Arşiv görünürlüğü:** "Arşivlenenleri göster" anahtarı o sekmede **arşivli yapım yoksa gizlenir**; **hiç arşivli yapım yoksa "Arşiv" sekmesi de gizlenir** (sekmedeyken son öğe arşivden çıkarılırsa otomatik Dizi sekmesine düşer). Anahtar/sekme arşivleme veya arşivden çıkarma sonrası anında belirir/kaybolur.
- **Çeviri:** 2 yeni anahtar × 14 dil. **Cache-buster zinciri:** i18n 527, views/components 530, search 527, settings 548, notification 542, asks 544, auth 525, stats 543, history 552, rowview 18, utils 521, `nextep.js?v=578` (`__NX_BUILD` 509), `style.css?v=601`, `mobil.css?v=542`, `tv.css?v=558`, `tablet.css?v=511`.
### EN
- **New feature — "Up Next" strip:** at the top of the **Shows · Documentaries · Anime** tabs, a strip showing each title's **single next unwatched episode**. Each card has the poster plus `S02E05 · 45 min` (anime `EP12 · 24 min`); clicking the card opens the details modal.
- **Scope:** multi-episode titles only — shows, documentary **series** and anime. Movies and documentary films **never appear** (a single item has no "next episode"); archived titles are excluded too.
- **Started-watching requirement:** a title enters the strip only if its **first episode (lowest season/episode) is watched**; titles you never started do not appear.
- **Ordering:** air date, **newest first**. A `N titles · M min total` summary appears on the right of the header.
- **Movable section:** the strip can be moved up/down with the section arrows; the order is remembered in the browser (default: topmost).
- **Layout:** card **width matches the standard card below**, height is a fixed **84px**, and the gap matches the grid gap → the strip columns line up **exactly** with the cards beneath. **No horizontal scrollbar**; overflowing cards wrap to a **centred second row** (on a 6-column wide screen the 7th card drops to the second row).
- **Type scale:** the title uses the standard card title size and the `S02E05 · 45 min` line uses the standard card status size; the title is clamped to **two lines** with an ellipsis at the end of the second line.
- **Empty state:** when nothing is up next, the section is **hidden entirely** (header and arrows included).
- **Auto-removal:** marking an episode watched inside the app updates the strip immediately; when the **Stremio add-on or another client** writes, the 30-second notification-count check notices the change and refreshes the lists and the strip automatically.
- **Server:** `GET /api/next-up` (single next episode per show/anime plus `totals:{count,min}` and `genres`), cached via `list_cache`. The **`in_watched` filter was removed** (a show moved to Watched but with a new episode now also appears).
- **Fix:** the "Show archived" toggle and the row-view button in media tab headers **overlapping** is fixed (broken `#view-#view-*` selectors corrected — 3 CSS files).
- **Section summary line:** under the "Up Next" header (below the dotted rule, left-aligned) the same summary format used by other sections: `16 Shows | 285 Episodes | Watched 119 Episodes (180:18) | Unwatched 166 Episodes (147:01)`. (The old right-hand "N titles · M min total" was removed.) The line sits **immediately below the dotted rule, above the cards** (in the first cut it landed under the cards — `ensureSectionSummary` now recognises the strip container too).
- **Ordering:** the strip is now ordered by the **upcoming (future) episode date** — nearest first; titles with no future episode go last (ties: most recently aired episode first).
- **Visual tweaks:** strip card texts are centred; the `S04E01 · 45 min` line is green (`#22c55e`) — on mobile (≤600px) the duration is hidden, leaving only `S04E01`.
- **Archive visibility:** the "Show archived" toggle is **hidden when that tab has no archived titles**; when there are **no archived titles at all the "Archive" tab is hidden too** (if you unarchive the last item while on it, the app falls back to the Shows tab). The toggle/tab appears or disappears immediately after archiving or unarchiving.
- **i18n:** 2 new keys × 14 languages. **Cache-buster chain:** i18n 527, views/components 530, search 527, settings 548, notification 542, asks 544, auth 525, stats 543, history 552, rowview 18, utils 521, `nextep.js?v=578` (`__NX_BUILD` 509), `style.css?v=601`, `mobil.css?v=542`, `tv.css?v=558`, `tablet.css?v=511`.

## 1.83 - 17/10/2026-22:47
### TR
- **Yeni özellik — "Arşiv":** yapım artık takibi bırakmadan **arşive** alınabilir. Arşivli yapımın bildirimleri durur ama kaydı veritabanında kalır; "Takibi bırak" ise eskisi gibi kaydı siler.
- **Yeni "Arşiv" sekmesi** (İzlenmiş'in yanında, durum sekmesi): İzlenmiş deseniyle birebir — 4 alt bölüm (Dizi · Film · Belgesel · Anime), her bölümde arama, filtre/sıralama (**5 seçenek:** Ekleme · Alfabetik · Puan · Yaklaşan tarih · Tür), kart/satır görünümü, bölüm yukarı/aşağı taşıma ve boş durum.
- **Kart üst şeridi:** kart üstündeki butonlar tek şeride alındı — takvim · taşı · **arşiv** · takibi bırak — ve eşit aralıklarla dağıtılır; "taşı" butonu yoksa arşiv butonu **tam ortada** kalır. Arşivli kartlar "Arşivde" rozeti taşır ve görsel olarak soluklaşır.
- **Medya sekmeleri** (Dizi · Film · Belgesel · Anime) arşivlileri varsayılan olarak gizler; bölüm başlığındaki yeni **"Arşivlenenleri göster"** anahtarı ile aynı listede gösterilir (tercih tarayıcıda hatırlanır).
- **Arşiv bir durumdur** (İzlenmiş/İzlenmemiş gibi): arşivli yapımlar İzlenmemiş ve İzlenmiş listelerinden **ve** bildirimlerden çıkar, yalnız Arşiv sekmesinde yaşar. **Arşivleme ve arşivden çıkarma onaysız tek tıklamadır** (izlenmişten geri taşıma gibi).
- **Sunucu:** `/api/followed` ve `/api/anime/followed` artık `?archived=1` kabul eder (varsayılan yalnız aktifleri döner); yeni `POST /api/followed/archive` ve `POST /api/anime/archive` uçları eklendi. Veritabanına `followed.archived` ve `anime.archived` kolonları eklendi (mevcut kayıtlar 0). Zamanlanmış TMDB/AniList tazeleme işleri arşivlileri **dışlamaz**, böylece arşivden çıkarınca veri güncel olur.
- **Çeviri:** 19 yeni anahtar × 14 dil. **Cache-buster zinciri:** i18n 524, views/components 526, search 523, settings 544, notification 538, asks 541, auth 521, rowview 15, tv 527, `nextep.js?v=574` (`__NX_BUILD` 505), `style.css?v=598`, `mobil.css?v=539`, `tv.css?v=556`.
- **Düzeltmeler (1.83 içi, sürüm aynı):** arşivleme onayı kaldırıldı (tek tık, bildirim rozetiyle); aktif+arşivli birleşimde id-bazlı tekilleme (çift kart engeli); Arşiv kartlarına "takibi bırak" butonu eklendi (şerit: takvim · arşivden çıkar · takibi bırak); arşiv kartlarında İzlenmiş deseninde sayaç satırı (kart + satır görünümü); açılış yarışına koşu jetonu (switchView + dil-olayı çakışmasında çift kart engeli).
### EN
- **New feature — "Archive":** a title can now be **archived** without unfollowing it. Notifications stop, but the record stays in the database; "Unfollow" still deletes the record as before.
- **New "Archive" tab** (a state tab next to Watched): identical to the Watched pattern — 4 sub-sections (Shows · Movies · Documentaries · Anime), each with search, filter/sort (**5 options:** Added · Alphabetical · Score · Upcoming date · Type), card/row view, section move up/down and an empty state.
- **Card top strip:** the card buttons now live in a single strip — calendar · move · **archive** · unfollow — distributed with equal gaps; when there is no "move" button the archive button sits **exactly centred**. Archived cards carry an "Archived" badge and are dimmed.
- **Media tabs** (Shows · Movies · Documentaries · Anime) hide archived items by default; the new **"Show archived"** toggle in the section header reveals them in the same list (the preference is remembered in the browser).
- **Archive is a state** (like Watched/Unwatched): archived titles are removed from the Unwatched and Watched lists **and** from notifications, and live only in the Archive tab. **Archiving and unarchiving are both a single click with no confirm** (like move-back-from-watched).
- **Server:** `/api/followed` and `/api/anime/followed` now accept `?archived=1` (the default returns active items only); new `POST /api/followed/archive` and `POST /api/anime/archive` endpoints added. `followed.archived` and `anime.archived` columns were added to the database (existing rows default to 0). The scheduled TMDB/AniList refresh jobs deliberately **keep** refreshing archived rows, so unarchiving yields fresh data.
- **i18n:** 19 new keys × 14 languages. **Cache-buster chain:** i18n 524, views/components 526, search 523, settings 544, notification 538, asks 541, auth 521, rowview 15, tv 527, `nextep.js?v=574` (`__NX_BUILD` 505), `style.css?v=598`, `mobil.css?v=539`, `tv.css?v=556`.
- **Fixes (within 1.83, same version):** archive confirmation removed (single click with toast); id-based dedupe of the active+archived merge (duplicate-card guard); "unfollow" button added to Archive cards (strip: calendar · unarchive · unfollow); Watched-pattern count line on archive cards (card + row view); run-token guard for the boot race (duplicate-card guard for switchView + language-event collision).

## 1.82 - 17/10/2026-19:06
### TR
- **Bildirim ve İzlendi (ask) penceresi genişliği 378px'e sabitlendi:** iki pencere artık aynı genişlikte (içeriğe göre daralmıyor).
- **Bildirim listesinde ay adı tam yazılır:** 24 saatten eski kayıtlarda `12 Ekim 05:00` (kısaltma yok); tarih kullanıcı saat dilimine göre biçimlenir.
- **Ask metni dilbilgisi:** `2. Sezon 5. Bölümünü` → `2. Sezon 5. Bölümü` (dizi, belgesel, anime; veritabanındaki mevcut izlendi-soruları da güncellendi).
- **Dış push bildirimlerine yapım adı eklendi:** Telegram/ntfy/Discord/e-posta artık `Yapım mesaj` biçiminde (başlık bildirim merkezinde ayrı gösterildiği için mesajlardan çıkarılmıştı). Bildirim merkezi değişmedi.
- **Telegram Markdown kaçışı:** başlık/mesajdaki Markdown özel karakterleri (`_`, `*`, `[` ve ters tırnak) kaçışlanır; kaçışsız karakter yüzünden gönderimin reddedilmesi önlenir.
- **İzlenen penceresi poster boyutu** 34×50 → 45×68 (bildirimler penceresiyle aynı).
- **İzleme Geçmişi (History) tooltip'i satır görünümü tablosuna çevrildi:** alan ayraçları (`|`) sütun sütun hizalanır, boş alanlarda da `|` görünür, kutu genişliği en uzun satıra göre ayarlanır ve yapım ismi 30 karakterde `…` ile kesilir.
### EN
- **Notification and watched-ask window width fixed at 378px:** both windows now share the same width (no content-based shrinking).
- **Full month names in the notification list:** rows older than 24 h show `12 Ekim 05:00` (no abbreviation); the date is formatted per the user's timezone.
- **Ask message grammar:** `2. Sezon 5. Bölümünü` → `2. Sezon 5. Bölümü` (shows, documentaries, anime; existing watched-ask rows in the DB were updated too).
- **Series title added to external push notifications:** Telegram/ntfy/Discord/e-mail now send `Title message` (the title had been stripped from the messages since the notification centre shows it separately). The notification centre is unchanged.
- **Telegram Markdown escaping:** the Markdown special characters (`_`, `*`, `[` and backtick) in the title/message are escaped; unescaped characters no longer cause the send to be rejected.
- **Watched window poster size** 34×50 → 45×68 (same as the notifications window).
- **History tooltip converted to a row-view table:** the `|` field separators align in columns, empty fields still show a `|`, the box width follows the longest row, and the production name is cut at 30 characters with `…`.

## 1.81 - 17/10/2026-04:03
### TR
- **Ask mesajı artık 2 satır ve soru biçiminde:** `16.10.2026 - Cuma - 22:46` / `3. Sezon 4. Bölümünü izlediniz mi?`. "İzlendi bilgisi eklensin mi?" cümlesi kaldırıldı (Evet/Hayır butonları aynen kalır).
- Tüm türlerde aynı kalıp: `diziyi izlediniz mi?` · `filmi izlediniz mi?` · `belgeseli izlediniz mi?` · `animeyi izlediniz mi?` · `4. bölümünü izlediniz mi?` · `2. Sezon 3. Bölümünü izlediniz mi?`.
- **Eski kayıtlar arayüzde düzeltilir** (veri göçü yok): cümle atılır, gövde `izlediniz.` → `izlediniz mi?` çevrilir. Yeni kayıtlar sunucuda da 2 satır üretilir (`_ask_message`); push şablonları etkilenmedi.
### EN
- **The ask message is now two lines and phrased as a question:** `16.10.2026 - Cuma - 22:46` / `3. Sezon 4. Bölümünü izlediniz mi?`. The sentence "İzlendi bilgisi eklensin mi?" was removed (the Yes/No buttons stay).
- Same pattern for every media type: `diziyi izlediniz mi?` · `filmi izlediniz mi?` · `belgeseli izlediniz mi?` · `animeyi izlediniz mi?` · `4. bölümünü izlediniz mi?` · `2. Sezon 3. Bölümünü izlediniz mi?`.
- **Existing rows are fixed in the UI** (no data migration): the sentence is dropped and the body's `izlediniz.` becomes `izlediniz mi?`. New rows are produced as two lines on the server too (`_ask_message`); push templates are unaffected.

## 1.80 - 17/10/2026-03:54
### TR
- **Tarih/saat biçimi artık saat diliminin (tz) ülke yereline göre.** Ask mesajı 3 satıra ayrıldı ve damga yerel biçimde gösterilir: `16.10.2026 - Cuma - 22:46` / `3. Sezon 4. Bölümünü izlediniz.` / `İzlendi bilgisi eklensin mi?`.
  Gün adı, tarih sırası ve **12/24 saat tercihi** `Intl` + tz yerelinden gelir (elle 14 dilli tablo yoktur): tr `16.10.2026 - Cuma - 22:46` · en-US `10/16/2026 - Friday - 3:46 PM` · en-GB `16/10/2026 - Friday - 20:46` · ja `2026/10/16 - 土曜日 - 04:46` · zh-TW `下午4:46` · ko `AM/PM`.
- **Kart/takvim modalındaki `İzlendi:` satırı** aynı biçimi kullanır (`16.10.2026 - Cuma - 21:53`); aynı kodun kopyası kaldırıldı, tek `fmtDateTime` kaldı.
- **Bildirim merkezinde** başlık ile mesaj arasına ask paneliyle aynı boşluk (8px) konuldu.
- **24 saat zorlaması kaldırıldı** (İzleme Geçmişi saatleri, bildirim listesi saati, feed tarihi): AM/PM kullanan ülkeler (ABD, Kanada, Avustralya, Hindistan, Meksika, Kore, Tayvan, arap ülkeleri …) kendi biçimini görür; Türkiye 24 saat kalır. Önceden bu satırlarda 24 saat **ve** sabit `gg/aa/yyyy` sırası zorlanıyordu.
- Ask damgası **epoch'tan** üretilir (`created_at`) → tz sonradan değişse bile saat doğru görünür; backend'de yalnızca yedek metin tutulur (`GG.AA.YYYY - ss:dd`), gün adı sunucuda **yazılmaz**. Damgası tanınmayan eski kayıtlar bozulmaz.
### EN
- **Date/time is now formatted per the timezone's country locale.** The ask message is split into three lines with a locally formatted stamp: `16.10.2026 - Cuma - 22:46` / `3. Sezon 4. Bölümünü izlediniz.` / `İzlendi bilgisi eklensin mi?`.
  The weekday name, date order and the **12/24-hour choice** come from `Intl` + the tz locale (no manual 14-language table): tr `16.10.2026 - Cuma - 22:46` · en-US `10/16/2026 - Friday - 3:46 PM` · en-GB `16/10/2026 - Friday - 20:46` · ja `2026/10/16 - 土曜日 - 04:46` · zh-TW `下午4:46` · ko `AM/PM`.
- The **`İzlendi:` (watched) line** in the card/calendar modal uses the same format (`16.10.2026 - Cuma - 21:53`); the duplicated code was removed in favour of a single `fmtDateTime`.
- In the **notification centre** the title→message gap now matches the ask panel (8px).
- **The forced 24-hour clock was removed** (watch history times, notification-list time, feed date): countries that use AM/PM (US, Canada, Australia, India, Mexico, Korea, Taiwan, Arabic countries …) see their own convention, while Turkey stays 24-hour. Previously those rows forced 24-hour **and** the fixed `dd/mm/yyyy` order.
- The ask stamp is produced from the **epoch** (`created_at`), so the time stays correct even if the timezone is changed later; the backend keeps only a fallback text (`DD.MM.YYYY - HH:MM`) and never writes the weekday. Rows whose stamp is not recognised are left untouched.

## 1.79 - 17/10/2026-03:33
### TR
- **Ask kartındaki tip hapı artık postere göre ortalanıyor** (bildirimler penceresindeki gibi). "Evet/Hayır" verilmiş kartlarda hap, posterin bulunduğu grid kolonunda `justify-self: center` ile ortalanır; ✓/✗ aynı satırda sağda kalır.
- Hap posterden genişse (ör. "Belgesel") poster kolonu hapın genişliğine göre ölçeklenir ve poster yarım fark kadar içeri kayar — bildirimler penceresiyle birebir aynı davranış.
- Bekleyen kartlar değişmedi: hap posterin 5px altında ortalanmış, Evet/Hayır butonları mesajın altında ortada.
- Yalnız görünüm: veri, API ve buton davranışı aynı. Eski `.ask-foot` sarmalayıcısı ve TV ölçekleme satırı kaldırıldı.
### EN
- **The ask-card type pill is now centred on the poster** (as in the notifications panel). On answered ("Yes"/"No") cards the pill is centred inside the poster's grid column via `justify-self: center`; the ✓/✗ stays on the same row, on the right.
- When the pill is wider than the poster (e.g. "Belgesel") the poster column scales to the pill's width and the poster shifts inwards by half the difference — exactly the behaviour of the notifications panel.
- Pending cards are unchanged: pill centred 5px below the poster, Yes/No buttons centred under the message.
- Presentation only: data, API and button behaviour are untouched. The old `.ask-foot` wrapper and its TV scaling line were removed.

## 1.78 - 17/10/2026-03:28
### TR
- **Ask penceresi başlığı** ("İzlendi Bilgisi") artık **büyük harf ve turuncu** (`#f97316`).
- **Ask kartı boşluğu:** hap + ✓/✗ alt şeridinin posterle mesafesi, bildirimler penceresindeki poster↔hap mesafesiyle eşitlendi (`row-gap` 6→5px).
- **Mesajlardan yapım ismi kaldırıldı** — ad yalnızca üst satırda (`.notif-title`) görünür:
  - Ask: `16.10.2026 tarihinde saat 22:46 3. Sezon 4. Bölümünü izlediniz. İzlendi bilgisi eklensin mi?`
  - Bildirim merkezi: `2. Sezon 8. Bölüm Bugün Yayınlanacak`
- Eski kayıtlar arayüzde düzeltilir (veri göçü yok). Yeni ask mesajları (`_ask_message`) ve `scheduler.py`'deki **21 in-app bildirim metni** sunucuda da isimsiz üretilir; push/Telegram şablonları ve rol/bakım/yedek bildirimleri değişmedi.
- Anime mesajındaki küçük harfli "4. bölümünü" de artık renklenir ("N. Sezon/Bölüm" kalıbı büyük/küçük harf duyarsız).
### EN
- The **ask panel header** ("İzlendi Bilgisi") is now **uppercase and orange** (`#f97316`).
- **Ask card spacing:** the distance from the poster to the pill/✓-✗ bottom row now matches the poster↔pill distance in the notifications panel (`row-gap` 6→5px).
- **The production name was removed from the messages** — it is shown only on the title line (`.notif-title`):
  - Ask: `16.10.2026 tarihinde saat 22:46 3. Sezon 4. Bölümünü izlediniz. İzlendi bilgisi eklensin mi?`
  - Notification centre: `2. Sezon 8. Bölüm Bugün Yayınlanacak`
- Existing rows are fixed in the UI (no data migration). New ask messages (`_ask_message`) and the **21 in-app notification messages** in `scheduler.py` are produced without the name on the server too; push/Telegram templates and role/maintenance/backup notifications are untouched.
- The lowercase "4. bölümünü" in anime messages is now coloured as well (the "N. Sezon/Bölüm" pattern is case-insensitive).

## 1.77 - 17/10/2026-03:15
### TR
- **Ask kartı yerleşimi:** çözümlenmiş ("Evet"/"Hayır" verilmiş) kartlarda **tip hapı ile ✓/✗ işareti artık aynı alt şeritte** — hap solda (posterin sol hizasında), işaret sağda. Kart iki kolonlu grid'e alındı (`poster | içerik` + alt şerit); böylece işaret kendi satırını kaplamıyor ve satırlar hizalı görünüyor.
- **Bekleyen kartlar değişmedi:** hap posterin 5px altında (1.76 düzeni), **Evet/Hayır** butonları mesajın altında ortada.
- Yalnızca görünüm: veri, API ve buton davranışı aynı.
### EN
- **Ask card layout:** on resolved ("Yes"/"No" answered) cards the **type pill and the ✓/✗ marker now share the same bottom row** — pill on the left (aligned with the poster), marker on the right. The card became a two-column grid (`poster | content` + a bottom row), so the marker no longer occupies its own line and the rows look aligned.
- **Pending cards are unchanged:** the pill sits 5px below the poster (1.76 layout) and the **Yes/No** buttons stay centred under the message.
- Presentation only: data, API and button behaviour are untouched.

## 1.76 - 17/10/2026-03:07
### TR
- **Bildirim ve "İzlendi" mesajlarına tip hapı:** posterin **5px altında**, postere göre **ortalanmış** `Dizi / Film / Belgesel / Anime` hapı (kart hapı paletiyle birebir renk; poster gizli/yok iken de gösterilir).
- **Yapım ismi tip rengiyle:** hem bildirimin üst satırındaki yapım adı hem mesaj içindeki ad renklenir (dizi `#60a5fa`, film `#22c55e`, belgesel `#faef15`, anime `#f472b6`).
- **"N. Sezon / N. Bölüm" renkleri:** kart rozetleriyle aynı — Sezon **teal `#14b8a6`**, Bölüm **violet `#a78bfa`** ("4. Bölümünü" gibi ekler dahil).
- **`S02E08` → "2. Sezon 8. Bölüm":** arayüzde dönüştürülür; **eski kayıtlar da** yeni biçimde ve renkli görünür (veri göçü gerekmez). Yeni `episode_today` bildirimleri sunucuda da yeni biçimde üretilir (`scheduler.py`); Telegram/ntfy şablonları (14 dil) değişmedi.
- **"İzlendi" (ask) kartı** artık bildirim merkeziyle aynı iskelette: poster + tip hapı (5px) → **yapım ismi satırı** → mesaj → Evet/Hayır.
- Belgesel tespiti: bildirimlerde `doc_` bildirim tipi, ask kartlarında yeni **`is_doc`** alanı (`/api/asks`; `followed.genres` belgesel türleriyle karşılaştırılır).
- Okunabilirlik: yeni yüzeylerin en düşük kontrast oranı **4.65** (hedef ≥ 4.5).
### EN
- **Type pill for notifications and "watched" asks:** a `TV / Movie / Documentary / Anime` pill **5px below** the poster, **centred to the poster** (same palette as the card pill; also shown when the poster is hidden or missing).
- **Title in the type colour:** both the production name on the notification's first line and the name inside the message are coloured (tv `#60a5fa`, movie `#22c55e`, documentary `#faef15`, anime `#f472b6`).
- **"N. Sezon / N. Bölüm" colours:** same as the card badges — season **teal `#14b8a6`**, episode **violet `#a78bfa`** (suffixes like "4. Bölümünü" included).
- **`S02E08` → "2. Sezon 8. Bölüm":** converted in the UI, so **existing rows** also render in the new form and colour (no data migration). New `episode_today` notifications are produced in the new form on the server as well (`scheduler.py`); Telegram/ntfy templates (14 languages) are untouched.
- **The "watched" (ask) card** now matches the notification centre: poster + type pill (5px) → **title line** → message → Yes/No.
- Documentary detection: the `doc_` notification type in the centre, and a new **`is_doc`** field for ask cards (`/api/asks`; `followed.genres` compared against documentary genres).
- Legibility: the lowest contrast ratio across the new surfaces is **4.65** (target ≥ 4.5).

## 1.75 - 17/10/2026-02:44
### TR
- **Belgesel kimliği artık sarı (`#faef15`):** kart hapı, satır modu tip metni, detay modalı hapı, arama modalı filtresi, chiplet ve geçmiş sekmesi satır rengi aynı sarıyı kullanır (eskiden lime/yeşil-sarı `#d9f99d` / `#8ddb07` idi). TV modu odak halkası da sarıya çevrildi.
- **Arama modalındaki film kimliği düzeltildi:** film filtresi ve filtre chipleti kırmızıydı (`#3f1d1d` / `#b91c1c`), artık kartlardaki film yeşili (`#22c55e`); hover/aktif durumları ve TV modu odak halkası da uyumlu hâle getirildi.
- Değişmeyenler: TV mavisi, anime pembesi, chip kapatma (×) rengi ve durum renkleri (izlendi/OK/hata) — bunlar kimlik rengi değildir.
- Okunabilirlik: yeni yüzeylerin yazı/zemin kontrast oranları WCAG eşiğinin üzerinde (en düşük **5.55**, hedef ≥ 4.5).
### EN
- **Documentary identity is yellow now (`#faef15`):** the card pill, row-mode type text, details-modal pill, search-modal filter, chiplet and the history row colour all use the same yellow (previously lime `#d9f99d` / `#8ddb07`). The TV-mode focus ring is yellow as well.
- **The movie identity in the search modal was fixed:** the movie filter and its chiplet were red (`#3f1d1d` / `#b91c1c`); they now use the card movie green (`#22c55e`), with matching hover/active states and TV-mode focus ring.
- Unchanged: TV blue, anime pink, the chip close (×) colour and status colours (watched/OK/error) — those are not identity colours.
- Legibility: the new surfaces keep text/background contrast above the WCAG threshold (lowest **5.55**, target ≥ 4.5).

## 1.74 - 17/10/2026-02:30
### TR
- **Düzeltme (takvim "bugün" vurgusu):** Kart takviminde günü geçmiş bir bölümün tarihi hâlâ **bold mavi** ("bugün") görünüyordu. Neden: tarih sınıfı yerel "bugün" yerine **UTC günü** ile hesaplanıyordu; yerel gece yarısından sonraki ilk saatlerde (+03'te 00:00-03:00) UTC hâlâ önceki gün olduğu için dün yayınlanan bölüm "bugün" sayılıyordu (MobLand S02E05 vakası; 03:00'te kendiliğinden düzeliyordu).
- Takvim/tarih karşılaştırmaları artık **tek kaynaktan** (`todayInTzStr()` = backend `server_today` / kullanıcı dilimi): `utcStateStr` yerine `dayStateStr`, yeni `releaseDayStr` + `dayStrInTz`; `canSelectAll`, `isNewEpisode`, `isNewTr`, `isTodayTr`, `isReleaseToday` aynı kurala geçti. Renk artık ekranda **görünen tarihten** (`it.date`) türetiliyor.
- Anime takviminde tarih metni ve renk aynı yerel günden üretilir (tarayıcı dilimi kayması giderildi); `views.js`'te sezon/`next-ep` karşılaştırmaları ve `search.js` sıralama tarihi de yerel güne geçti. `utcTodayStr` kaldırıldı.
- Yan etki (iyileşme): 00:00-03:00 arasında dünün bölümü artık "geçmiş" sayıldığı için "sezonu izlendi işaretle" de doğru çalışır; bölüm işaretleme kutusu davranışı değişmedi.
### EN
- **Fix (calendar "today" highlight):** in the card calendar the date of an episode whose day had passed still showed as **bold blue** ("today"). Cause: the date class compared against the **UTC day** instead of the local day; during the first hours after local midnight (00:00-03:00 at +03) UTC is still the previous day, so a yesterday episode counted as "today" (MobLand S02E05; it corrected itself at 03:00).
- All calendar/date comparisons now come from a **single source** (`todayInTzStr()` = backend `server_today` / user timezone): `utcStateStr` → `dayStateStr`, new `releaseDayStr` + `dayStrInTz`; `canSelectAll`, `isNewEpisode`, `isNewTr`, `isTodayTr`, `isReleaseToday` follow the same rule. The colour is derived from the **displayed date** (`it.date`).
- In the anime calendar the date text and the colour are produced from the same local day (browser-timezone drift removed); season/`next-ep` comparisons in `views.js` and the search sort date in `search.js` also moved to the local day. `utcTodayStr` removed.
- Side effect (improvement): between 00:00-03:00 a yesterday episode is now "past", so "mark season watched" works correctly too; the per-episode checkbox behaviour is unchanged.

## 1.73 - 17/10/2026-02:28
### TR
- **Düzeltme (izleme saati):** "İzlendi mi?" bildiriminde **Evet**'e basıldığında izleme saati artık **bildirimde yazan saat** (sinyalin geldiği an) olarak kaydedilir; eskiden butona basıldığın an yazılıyordu (22:46'daki bildirime 00:51'de basınca izleme geçmişi 00:51 görünüyordu).
- Aynı düzeltme **film/belgesel film** ve **anime** onaylarını da kapsar: bu iki türde `watched_at` hiç yazılmıyordu, bu yüzden onaylanan film/anime kayıtları izleme geçmişinde hiç görünmüyordu; artık bildirim zamanıyla görünürler.
- Film onayında mevcut (doğrudan işaretlemeden gelen) zaman varsa korunur (`COALESCE`), üzerine yazılmaz. Ask zamanı yoksa (bozuk/0) onay anına düşülür.
- **Veri onarımı:** geçmişte onaylanmış 15 tv kaydı (1 NULL + 14 "tıklama anı") bildirim saatine çekildi (The Witcher S3E4: `17.10 00:51` → `16.10 22:46`). Onarım yedek + dry-run ile yapıldı; film/anime tarafında düzeltilecek kayıt yoktu.
### EN
- **Fix (watched time):** answering **Yes** to the "Did you watch it?" ask now records the watched time as **the time shown in the notification** (the moment the signal arrived); previously it used the moment you clicked (approving a 22:46 notification at 00:51 stored 00:51 in the watch history).
- The same fix covers **movie/documentary** and **anime** approvals: those never wrote `watched_at` at all, so approved movies/anime were missing from the watch history; they now appear with the notification time.
- For movies an existing time (from a direct mark) is preserved (`COALESCE`) instead of being overwritten. If the ask time is missing/invalid the approval moment is used as a fallback.
- **Data repair:** 15 previously approved tv rows (1 NULL + 14 click-time) were set to the notification time (The Witcher S3E4: `17.10 00:51` → `16.10 22:46`), done with a backup + dry-run; nothing needed fixing on the movie/anime side.

## 1.72 - 17/10/2026-01:47
### TR
- **Root kapısı:** "Sunucuya Kur"/"Onar" (Stremio + Uzak Bağlantı), "Peer Ekle" ve "Tüneli Kaldır" butonları artık **root yetkisi doğrulanmadan çalışmıyor**; kapalı butonun üzerine gelince neden görünür (kart bağlıysa "Sunucuya bağlısınız", değilse "Sunucu bağlantısı yapılandırılmamış veya root kullanıcısı ile giriş yapılmamış").
- Sunucu Bağlantı Ayarları'na **"Kullanıcı / root yetkisi"** satırı eklendi: `root (doğrudan)`, `<kullanıcı> → root (sudo ile)` ya da `<kullanıcı> — root yetkisi yok` + son hata nedeni (yanlış sudo parolası vb.).
- **Durum kalıcı:** `vps_login_user`, `vps_effective_user`, `vps_root_verified`, `vps_last_reason` saklanır; `/api/remote/vps-status` bunları (`loginUser`, `effectiveUser`, `rootVerified`, `rootReady`, `lastReason`) döner. Profil (host/kullanıcı/kimlik/parola) değişince doğrulama **sıfırlanır** (bayat "root var" izlenimi kalmaz); "Sunucu Değiştir" de bu alanları temizler.
- **İş başında canlı kontrol (preflight):** kurulum işleri başlamadan önce SSH ile `id -un` + `sudo -n id -un` çalıştırılır; log'a `kullanıcı: <user> -> root OK` / `root YOK` yazılır. Bayat `connected=1` durumu bu kontrolle yakalanır; başarısızsa iş `ABORT:root-yetkisi-yok` ile durur ve `vps_root_verified` 0'a çekilir.
- Peer uçları (ekle/durdur/sil) root doğrulanmamışsa `root-required` döner (arayüzde ikinci mesaj görünür).
- Stremio kartındaki **"Hazır"** durumu **bağlı sayılmaz**; ipucu bu durumda ikinci mesajı gösterir.
- `disabled` butonlar fare olayı almadığı için ipucu `<span class="btn-tip">` sarmalayıcısına taşındı; `Test Et` butonunun tooltip'i de aynı şekilde düzeltildi.
- 6 yeni çeviri anahtarı x 14 dil (`vps_login_user`, `vps_root_direct`, `vps_root_via_sudo`, `vps_root_missing`, `vps_btn_tip_connected`, `vps_btn_tip_no_root`) + `root-required` hata eşlemesi. Zincir bump: i18n 523, utils/auth 518, views/components 522, search 520, notification 531, asks 532, settings/stats 537, history 544, rowview 13, `nextep.js?v=561` (`__NX_BUILD` 492), `style.css?v=588`.
### EN
- **Root gate:** "Install on Server"/"Repair" (Stremio + Remote Connection), "Add Peer" and "Remove Tunnel" no longer work unless root access is verified; hovering a disabled button explains why ("You are connected to the server" when the card is connected, otherwise "Server connection is not configured or you are not logged in as root").
- Server Connection Settings gained a **"User / root access"** row: `root (direct)`, `<user> → root (via sudo)`, or `<user> — no root access` plus the last failure reason (wrong sudo password, etc.).
- **Persisted state:** `vps_login_user`, `vps_effective_user`, `vps_root_verified`, `vps_last_reason` are stored; `/api/remote/vps-status` returns them (`loginUser`, `effectiveUser`, `rootVerified`, `rootReady`, `lastReason`). Changing the profile (host/user/credentials/password) **resets** the verification (no stale "root is fine" state); "Change Server" clears them as well.
- **Live preflight before work:** install jobs run `id -un` + `sudo -n id -un` over SSH first and log `kullanıcı: <user> -> root OK` / `root YOK`. A stale `connected=1` flag is caught here; on failure the job aborts with `ABORT:root-yetkisi-yok` and the flag is set back to 0.
- Peer endpoints (add/suspend/delete) return `root-required` when root is not verified (the UI shows the second message).
- Stremio's **"Ready"** state does **not** count as connected; the tooltip shows the second message in that case.
- Disabled buttons receive no mouse events, so tooltips moved to a `<span class="btn-tip">` wrapper; the `Test` button tooltip was fixed the same way.
- 6 new translation keys x 14 languages (`vps_login_user`, `vps_root_direct`, `vps_root_via_sudo`, `vps_root_missing`, `vps_btn_tip_connected`, `vps_btn_tip_no_root`) plus a `root-required` error mapping. Chain bump: i18n 523, utils/auth 518, views/components 522, search 520, notification 531, asks 532, settings/stats 537, history 544, rowview 13, `nextep.js?v=561` (`__NX_BUILD` 492), `style.css?v=588`.

## 1.71 - 17/10/2026-00:45
### TR
- Sunucu Bağlantı Ayarları → Kimlik Doğrulama: SSH Key alanının üzerine **Kullanıcı Adı** ve **Parola** girişleri eklendi (tek ortak alan çifti, Key ve Parola modlarının ikisinde de görünür).
- Kullanıcı adı `root` iken parola alanı kilitli ("root için parola gerekmez"); `root` dışı bir ad girilince parola açılır ve zorunlu olur.
- `Test Et` artık koşullu: host + SSH Key + (kullanıcı root değilse parola) tamamlanmadan buton kapalı kalır; eksik alan tooltip ile bildirilir.
- root dışı kullanıcıda SSH girişi o kullanıcıyla yapılır, ardından **sudo ile root'a geçilir** (`sudo su` muadili). Test sırasında parola bir kez kullanılarak `/etc/sudoers.d/99-nextep-<kullanıcı>` yazılır (NOPASSWD, 440, `visudo -c` ile doğrulanır, hata olursa geri alınır); sonraki tüm uzak komutlar `sudo -n` ile çalışır — böylece stdin'e veri basan yazma komutları (`cat > dosya`) bozulmaz.
- Sudo parolası login secret'ından ayrı ve şifreli saklanır (`vps_hosts.sudo_enc`); kullanıcı adı `root` yapıldığında kayıttan silinir.
- Parola (sshpass) modu aynen korunur; o modda tek parola hem SSH girişi hem sudo için kullanılır.
- Yeni hata bildirimleri: "parolasız sudo yok: bu kullanıcı için parola gerekli", "sudo parolası hatalı", "bu kullanıcının sudo yetkisi yok" (14 dil).
- `vps_hosts` tablosuna `sudo_enc` + `sudo_nopasswd` kolonları eklendi (idempotent migration; mevcut kayıtlar bozulmaz).
- **Düzeltme (Ayarlar menüsü açılmıyor):** `?v=` cache-buster zinciri kırıktı — `notification.js` hâlâ `settings.js?v=534` isterken yeni `nextep.js` `?v=535` istiyordu; 11 dosya `i18n.js?v=521`, 4 dosya `views.js?v=518` kullanıyordu. Tarayıcı aynı modülü **iki ayrı URL** olarak iki kez yüklediği için `#tab-settings` tıklaması iki kez bağlanıyordu: birinci dinleyici menüye `open` ekliyor, ikincisi `open` görüp `closeSettingsMenu()` çağırıyordu → menü açılıp anında kapanıyordu. Zincir bump tamamlandı (içeriği değişen her modülün **kendi** sürümü + tüm import edenleri): i18n 522, settings 535, views 521, utils 517, components 521, search 519, auth 517, notification 529, asks 530, stats 536, history 543, rowview 12, nextep 559 (`__NX_BUILD` 490). Artık her modülün tek sürümü var.
- **Düzeltme (Test Et sonrası modal titremesi):** `Test Et` bitince `renderThirdPartyApps()` "Bağlantılar" modalının tüm gövdesini önce "Yükleniyor..." ile boşaltıp sonra yeniden kuruyordu → modal bir an kaybolup geri geliyor, kaydırma başa dönüyordu. Artık aksiyon sonrası yenilemeler **sessiz** (`renderThirdPartyApps({ silent: true })`): mevcut içerik ekranda kalır, veriler gelince içerik tek seferde değişir; kaydırma konumu ve odak korunur. Test sürerken buton "Test Et …" gösterir. Aynı düzeltme 14 yenileme noktasına uygulandı (tünel aç/kapat, peer ekle/sil/durdur, kurulum sihirbazı bitişi, sunucu değiştir, UUID yenile, base URL kaydı); yükleme göstergesi yalnızca modal ilk açılışında kalır. Sürümler: settings 536, notification 530, asks 531, nextep 560 (`__NX_BUILD` 491).
### EN
- Server Connection Settings → Authentication: added **Username** and **Password** inputs above the SSH Key field (one shared pair, visible in both Key and Password modes).
- While the username is `root` the password field stays locked ("no password needed for root"); entering any other user enables it and makes it required.
- `Test` is now gated: host + SSH key + (password when the user is not root) must be present; a tooltip names the missing field.
- For a non-root user the SSH login uses that user, then **sudo elevates to root** (the `sudo su` equivalent). During Test the password is used once to write `/etc/sudoers.d/99-nextep-<user>` (NOPASSWD, mode 440, validated by `visudo -c`, rolled back on failure); every later remote command runs via `sudo -n`, so file-write commands that feed stdin (`cat > file`) keep working.
- The sudo password is stored separately from the login secret and encrypted (`vps_hosts.sudo_enc`); it is removed from the record when the username is set back to `root`.
- The password (sshpass) mode is unchanged; there the single password serves both SSH login and sudo.
- New failure messages: "no passwordless sudo: password required for this user", "wrong sudo password", "this user has no sudo permission" (14 languages).
- Added `sudo_enc` + `sudo_nopasswd` columns to `vps_hosts` (idempotent migration; existing records are preserved).
- **Fix (settings menu would not open):** the `?v=` cache-buster chain was broken — `notification.js` still asked for `settings.js?v=534` while the new `nextep.js` asked for `?v=535`; 11 files used `i18n.js?v=521` and 4 files `views.js?v=518`. Because the browser loads the same module under **two different URLs**, the `#tab-settings` click ended up bound twice: the first listener added `open`, the second saw `open` and called `closeSettingsMenu()` → the menu opened and closed instantly. The chain bump is now complete (every module whose bytes changed got its own new version plus all its importers): i18n 522, settings 535, views 521, utils 517, components 521, search 519, auth 517, notification 529, asks 530, stats 536, history 543, rowview 12, nextep 559 (`__NX_BUILD` 490). Each module now has exactly one version.
- **Fix (modal flicker after Test):** when `Test` finished, `renderThirdPartyApps()` first wiped the whole "Connections" modal body with "Loading..." and then rebuilt it → the modal appeared to vanish and come back and the scroll position jumped to the top. Refreshes after an action are now **silent** (`renderThirdPartyApps({ silent: true })`): the current content stays on screen and is swapped in a single write once data arrives; scroll position and focus are preserved. While the test runs the button shows "Test Et …". The same fix was applied to 14 refresh points (tunnel connect/disconnect, peer add/remove/suspend, install wizard completion, server change, UUID refresh, base URL save); the loading indicator remains only for the first open of the modal. Versions: settings 536, notification 530, asks 531, nextep 560 (`__NX_BUILD` 491).

## 1.70 - 16/10/2026-18:52
### TR
- Stremio "Sunucuya Kur" artık tek sihirbaz modal: web sunucusu seçimi (Caddy/nginx/apache2) + adım listesi + katlanır salt-okunur terminal çıktısı bir arada.
- Kurulum tamamen Python'a taşındı (`py/vps_install.py`); `sh/vps_setup.sh` ve `sh/nextep_remote.sh` artık çağrılmıyor (WireGuard hub ve Pi istemcisi dahil).
- Sunucuda :80/:443 boşsa üç seçenek sunulur (Caddy önerilir); portu Caddy/nginx/apache2 tutuyorsa "mevcut üzerinden devam" moduna geçilir; başka bir servis tutuyorsa seçim yapılmaz, portu elle boşaltma talimatı gösterilir.
- nginx/apache2 seçilirse site yapılandırması üretilip `certbot --nginx` / `certbot --apache` ile TLS alınır; Caddy kendi TLS'ini alır.
- Pi→VPS ters tüneli (autossh, `nextep-tunnel.service`) şablondan üretiliyor; VPS profil anahtarı yeniden kullanılıyor (yeni anahtar/`authorized_keys` yok).
- "Tüneli Kaldır" kill-switch ve "Sunucu Değiştir" (profil + tünel + WireGuard izlerini sıfırlar) akışları eklendi.
- Stremio durumu artık ters tünelin kurulu/aktif olup olmadığını da bildiriyor; tünel birimi yoksa "bağlı" yanılgısı oluşmuyor (onarım modu).
- Mevcut çalışan servisler (nginx/apache/caddy) otomatik durdurulmaz veya silinmez; yalnız kendi yönettiği bloklar elle düzenlenir.
- Let's Encrypt e-postası: sihirbaz e-posta göndermezse uygulamanın gönderen adresine (`email_from`) düşülür; o da boşsa `certbot --register-unsafely-without-email` kullanılır — nginx/apache TLS yolu artık sertifika adımında düşmüyor.
### EN
- Stremio "Install on Server" is now a single wizard modal: web server selection (Caddy/nginx/apache2) + step list + collapsible read-only terminal output together.
- Installation moved fully to Python (`py/vps_install.py`); `sh/vps_setup.sh` and `sh/nextep_remote.sh` are no longer called (WireGuard hub and Pi client included).
- If :80/:443 are free, three options are offered (Caddy recommended); if Caddy/nginx/apache2 holds the port, it switches to "continue over existing"; if another service holds it, no selection is offered and a manual port-freeing instruction is shown.
- When nginx/apache2 is chosen, a site config is generated and TLS is obtained via `certbot --nginx` / `certbot --apache`; Caddy obtains its own TLS.
- The Pi→VPS reverse tunnel (autossh, `nextep-tunnel.service`) is generated from a template; the VPS profile key is reused (no new key or `authorized_keys` entry).
- Added a "Remove Tunnel" kill-switch and a "Change Server" flow (resets profile + tunnel + WireGuard traces).
- Stremio status now also reports whether the reverse tunnel is installed/active; no false "connected" state when the unit is missing (repair mode).
- Existing running services (nginx/apache/caddy) are never stopped or removed automatically; only self-managed blocks are rewritten.
- Let's Encrypt e-mail: if the wizard sends no address, the app falls back to its sender address (`email_from`); if that is empty too, `certbot --register-unsafely-without-email` is used — the nginx/apache TLS path no longer dies at the certificate step.

## 1.65 - 14/09/2026-16:46
### TR
- Belgesel sekmesi eklendi (Film-Anime arası): tür-99 belgeselleri takip/izlenmemiş/izlenmiş/önerilerde ayrı bölümde toplanıyor; kartlar dizi/film kartlarıyla birebir.
- Aramaya Belgesel butonu ve çoklu arada Belgesel etiketi/chiplet'i (koyu magenta) eklendi; tek-seçim mantığı film/dizi ile aynı.
- Arama kutusu ipucu seçili butona göre değişiyor (Dizi/Film/Belgesel/Anime ara...).
- Seçili dilde bilgi yoksa İngilizce'den dolduruluyor (14 dil, başlık ve tür dahil) ve her zaman önbelleğe yazılıyor.
- Mobil arama butonları tek satır, metin genişliğinde ve aralıklı.
- TV'de Geri/X/sort seçimi sonrası odak açılan butonda kalıyor (Dizi'ye sıçrama yok).
- TV odak çerçeveleri 1px'e inceltildi; etiketlerde kimlik rengi, utils X'te kırmızı halka kullanılıyor.
- TV arama/filtre D-pad zincirine Belgesel eklendi; APK derlemesi gerekmedi.
### EN
- Added a Documentaries tab (between Movies and Anime): genre-99 documentaries now have their own section in followed/unwatched/watched/recommendations; cards match show/movie cards.
- Added a Documentary button to search and a Documentary tag/chiplet (dark magenta) to multi-search; single-select logic matches movie/show.
- The search box hint now follows the selected button (Search shows/movies/documentaries/anime...).
- Missing details in the selected language are filled from English (14 languages, title and genres included) and always cached.
- Mobile search buttons are single-row, text-width and spaced.
- On TV, Back/X/sort selection now keeps focus on the opening button (no jump to Shows).
- TV focus frames slimmed to 1px; tag frames use identity colors, utils X uses a red ring.
- Added Documentaries to the TV search/filter D-pad chain; no APK rebuild needed.

## 1.60 - 12/09/2026-18:06
### TR
- Otomatik yedekleme düzeltildi: sabah cron'u artık gerçekten yedek alıp dolu olan tüm hedeflere (rsync + Samba) gönderiyor.
- Sabah TMDB sorguları azaldı: dizi bölüm taraması günde bir kez yapılıyor; aynı diziyi izleyen üyeler için tek sorgu yeterli.
- Güncelleme modalındaki "Database Bakım" başlık satırı kalktı.
- TV'de bildirim satırları odakta turuncu zeminle aydınlanıyor (çerçeve çizgisi yok); masaüstünde hover zemini belirginleşti.
- TV'de geri tuşu utils penceresini kapatıp açılan butonda kalıyor (Dizi'ye sıçrama yok).
- Üyelik bildirimlerinde (admin/üye/şifre sıfırlama/onay bekleyen) boş kutu yerine NextEp logosu görünüyor.
- Oturum kapalıyken açılışta konsolu kirleten hata giderildi.
- Stremio eklenti logosu artık uygulamadan geliyor; MiBox'ta da görünüyor ve odaklanınca net kalıyor.
- Android TV simgesi turuncu zemin + siyah logo oldu (APK 2.9).
- Güncelleme kontrolü artık eski sürümü "yeni" diye sunmuyor; daha düşük sürüme düşürme kilitlendi.
### EN
- Automatic backup fixed: the morning cron now really takes the backup and sends it to all filled targets (rsync + Samba).
- Fewer morning TMDB requests: episode scanning runs once a day; one request covers members watching the same show.
- Removed the "Database Maintenance" header row from the update modal.
- On TV, focused notification rows glow with an orange background (no frame lines); desktop hover is more visible.
- On TV, Back closes a utils popup and stays on the button that opened it (no jump to Shows).
- Membership notifications (admin/member/password reset/pending approval) show the NextEp logo instead of an empty box.
- Fixed a console error on launch while logged out.
- The Stremio addon logo is now served by the app; it shows on MiBox too and stays sharp when focused.
- Android TV icon is now black logo on orange (APK 2.9).
- Update check no longer offers an older version as "new"; downgrading is locked.

## 1.55 - 07/09/2026-19:20
### TR
- Bar satırlarına günlük toplam eklendi (`Toplam 1.250`); 00:00'da sıfırlanır, sayı dile göre gruplanır.
### EN
- Bar rows now show a daily total (`Total 1,250`); resets at 00:00, grouped per locale.

## 1.54 - 07/09/2026-18:55
### TR
- Açılıştaki iç senkron patlamaları (tür/puan) hız barlarına işlenmiyor; restart sonrası bar ve pik sıfır başlıyor.
### EN
- Boot-time internal sync bursts (genres/votes) no longer feed the rate bars; bars and peaks start at zero after restart.

## 1.53 - 07/09/2026-18:40
### TR
- Pik çizgisi titremesi bitti: pik artık her saniye yeniden sayılmıyor, istek anında mandallanıyor; trafik yokken çizgi sabit duruyor.
### EN
- Peak line flicker fixed: peak is now latched at request time instead of rescanned every second; the line stays put with no traffic.

## 1.52 - 07/09/2026-18:05
### TR
- Hız barları liste akışından bağımsız açılır, veri gelmeden iskelet görünür; hata üst üste binerse not düşer.
- Admin modalında küçük sürüm etiketi; giriş sayfası önbelleğe alınmaz (bayat ekran kalmaz).
### EN
- Rate bars open independently of list loading, skeleton shows before data; persistent failures leave a note.
- Small build tag in the admin modal; landing page is never cached (no stale screens).

## 1.51 - 07/09/2026-15:22
### TR
- Admin modalında TMDB / AniList / TVMaze canlı doluluk barları + gün-içi pik çizgisi eklendi.
- Dış istekler jeton kovasıyla sınırlanıyor (TMDB 30/10 sn, AniList 70/dk); 429'da bir kez tekrar deneniyor.
- Bar satırları `TMDB · Anlık %75 · Pik %90` diziliminde; pik gün-içi tavan, gece yarısı sıfırlanır, 1 sn güncellenir.
### EN
- Admin modal now shows live TMDB / AniList / TVMaze usage bars with an intraday peak line.
- Outbound requests are token-bucket throttled (TMDB 30/10s, AniList 70/min); a 429 is retried once.
- Bar rows read `TMDB · Now 75% · Peak 90%`; peak is the intraday max, resets at midnight, refreshes every second.

## 1.50 - 07/09/2026-03:41
### TR
- Üye simgeleri küçüldü, satırda iki üye görünüyor; uygulamayı kullanan üye yeşil görünüyor.
- Her üyenin takip listesi ayrıldı; yeni üyeler boş başlar.
- Her üye kendi Stremio bağlantısını alır.
- Stremio kartında Durum ve Son Sinyal ayrı çerçevede; Hazır rozeti eklendi, son izlenen yapım tek satırda yazıyor.
- Tüm bildirimler kişisel Bildirim Saati'nde tam dakikasında geliyor; Yayın ve Anime saati satırları kalktı.
### EN
- Member icons shrunk, two members per row; members using the app show in green.
- Each member now has a separate watchlist; new members start empty.
- Each member gets their own Stremio link.
- Stremio card split Status and Last Signal into separate frames; Ready badge added, last watched title on a single line.
- All notifications arrive at the personal notification hour, on the exact minute; Release and Anime hour rows removed.
## 1.43 - 06/09/2026-23:24
### TR
- Üye simgeleri artık her cihazda doğru görünüyor.
- Onay pencerelerinde doğru başlık yazıyor; silme onayı iki satır.
### EN
- Member icons now render correctly on every device.
- Confirmation dialogs show the right title; delete confirmation is two lines.
## 1.42 - 06/09/2026-22:58
### TR
- Admin çipinde eksik olan admin simgesi eklendi.
- Üye simgeleri sadeleşti ve büyüdü; hover renkleri açıldı.
- Üyeler en sağdaki X simgesiyle onaylı şekilde tamamen silinir.
### EN
- Missing admin icon added to the admin chip.
- Member icons simplified and enlarged; hover colors lightened.
- Members are fully removed with the rightmost X icon after confirmation.
## 1.41 - 06/09/2026-22:36
### TR
- Ayarlardaki Admin bölümünde üyeler etiket görünümüne geçti.
- Üyeler simgelerle yönetiliyor: onay, red, aktifleştirme, pasifleştirme ve admin/üye değişimi.
- Son admin indirilemez; adminliği bırakma karşılıklı değişimle olur.
- Rol değişince bildirim merkezine bildirim düşer.
### EN
- Members in the Admin section now appear as chips.
- Members are managed with icons: approve, reject, activate, deactivate and admin/member switch.
- The last admin can't be demoted; handover happens by mutual switch.
- Role changes drop a notification in the notification center.
## 1.40 - 06/09/2026-20:20
### TR
- Çoklu kullanıcı geldi: giriş ekranıyla kullanıcı adı ve şifreyle giriş yapılır.
- Yeni cihazda kayıt olunur, ilk kayıt yönetici olur, sonrakiler yönetici onayıyla açılır.
- Şifresini unutan yöneticiye istek gönderir, verilen geçici şifreyle ilk girişte yeniler.
- Yönetici, ayarlardaki Admin bölümünden bekleyen kayıtları ve üyeleri yönetir.
### EN
- Multi-user is here: sign in with username and password on the login screen.
- Register on a new device; the first account becomes admin, later ones open with admin approval.
- Forgotten passwords go to the admin as a request; sign in with the temporary password and set a new one.
- The admin manages pending registrations and members from the Admin section in settings.
## 1.3 - 06/09/2026-17:40
### TR
- Stremio'da izlenen dizi ve film artık hep algılanıyor, çift kayıt olmuyor.
- Stremio NextEp eklentisi telefonda ve bilgisayarda çalışır hale geldi.
- Takvimde butonlar kaymıyor, düzgün şekilde sağda duruyor.
- Dizi izlerken atlayarak izlenen bölüm takvimde izlendi sayılmaz, sırayla izleyince işlenir; eski artıklar temizlendi.
### EN
- Series and movies watched in Stremio are now always detected, with no duplicate entries.
- The Stremio NextEp add-on now works on phone and computer.
- Calendar buttons no longer shift around, they sit neatly on the right.
- When watching a series, an episode watched out of order is not marked as watched in the calendar; watching in order counts; old leftovers were cleaned up.
## 1.13 - 04/09/2026-02:28
### TR
- Sürüm bilgisi veritabanındaki `version` tablosunda tutuluyor; VERSION dosyası farklıysa sessizce düzeltilir.
- İlk açılışta `version` tablosu boşsa VERSION dosyasındaki sürüm tabloya yazılır.
- Güncelleme ayrıntıları penceresinde sistem sürümünden sonraki tüm sürümlerin notları listelenir.
### EN
- Version info is kept in the database `version` table; a differing VERSION file is silently corrected.
- On first boot, an empty `version` table is seeded from the VERSION file.
- The update details window lists the notes of all versions after the system version.
## 1.12 - 04/09/2026-01:25
### TR
- Mobil takvim modalında ilerleme çubuğu Temizle butonuyla çakışmayacak şekilde daraltıldı.
- "Uygulama Güncelleme" adı menü, başlık, saat etiketi ve butonda "NextEp Güncelleme" olarak değiştirildi.
- Ayarlar menüsü seçeneklere tam oturan genişliğe ayarlandı (masaüstü + mobil).
- Masaüstünde ayarlar menüsü bildirim butonuyla aynı hizada açılır.
- Güncelleme penceresinde yeni sürümdeki yenilikler listelenir.
### EN
- Progress bar in the mobile calendar modal narrowed so it no longer overlaps the Clear button.
- "App Update" renamed to "NextEp Update" (menu, header, hour label, button).
- Settings menu sized to fit its options (desktop + mobile).
- On desktop, the settings menu opens aligned with the notifications button.
- Update window lists what's new in the new version.
