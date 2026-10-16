# NextEp Değişiklik Geçmişi
<!-- Yeni sürümde en üste `## X.Y - GG/AA/YYYY-SS:DD` bölümü + `### TR` / `### EN` listesi ekle -->

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
