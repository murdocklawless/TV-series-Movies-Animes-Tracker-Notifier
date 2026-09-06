# NextEp Değişiklik Geçmişi
<!-- Yeni sürümde en üste `## X.Y - GG/AA/YYYY-SS:DD` bölümü + `### TR` / `### EN` listesi ekle -->

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
