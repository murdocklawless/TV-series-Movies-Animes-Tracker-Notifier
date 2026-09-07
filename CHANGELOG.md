# NextEp Değişiklik Geçmişi
<!-- Yeni sürümde en üste `## X.Y - GG/AA/YYYY-SS:DD` bölümü + `### TR` / `### EN` listesi ekle -->

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
