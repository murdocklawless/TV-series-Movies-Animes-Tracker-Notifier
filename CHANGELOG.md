# NextEp Değişiklik Geçmişi
<!-- Yeni sürümde en üste `## X.Y - GG/AA/YYYY-SS:DD` bölümü + `### TR` / `### EN` listesi ekle -->

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
- **Bölüm özeti satırı:** "Sıradaki Bölüm" şeridinin başlığı altında (dotted çizginin sol altında) diğer bölümlerle aynı biçimde özet satırı: `16 Dizi | 285 Bölüm | İzlenmiş 119 Bölüm (180:18) | İzlenmemiş 166 Bölüm (147:01)`. (Eski sağdaki "N yapım · toplam M dk" kaldırıldı.)
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
- **Section summary line:** under the "Up Next" header (below the dotted rule, left-aligned) the same summary format used by other sections: `16 Shows | 285 Episodes | Watched 119 Episodes (180:18) | Unwatched 166 Episodes (147:01)`. (The old right-hand "N titles · M min total" was removed.)
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
