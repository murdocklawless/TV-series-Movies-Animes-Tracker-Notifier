# Çoklu Kullanıcı Planı — NextEp

> Durum: FAZ 30 + 31 + 31b + 31c + 31d UYGULANDI (2026-09-06, pi canlı + doğrulandı). Faz 32/33 bekliyor.
> İlgili tarama: auth yok (`secret_key`/session/`users` tablosu mevcut değil, ~59 endpoint korumasız), ayarlar+veri global, hash paketi yok (Werkzeug `pbkdf2` kullanılacak), frontend'de merkezi fetch yok.

## 1. Kilitli kararlar

| # | Konu | Karar |
|---|------|-------|
| 1 | Mevcut pi verisi | İlk kurulan admin'e (id=1) bağlanır, hiçbir şey kaybolmaz |
| 2 | TV | Aynı web login ekranı, bir kez giriş + kalıcı oturum |
| 3 | Oturum | 1 yıllık kalıcı çerez + Çıkış butonu |
| 4 | Kayıt politikası | Admin onaylı (ilk kayıt auto-admin+active, sonrakiler pending) |
| 5 | Kayıt Ol görünürlüğü | Dinamik: yazılan ad kayıtlıysa buton solar + "Bu hesap kayıtlı — giriş yap" |
| 6 | Admin kurtarma | `sh/reset-admin.sh` (SSH ile şifre sıfırlama) |
| 7 | Stremio | UUID per-user; VPS'te değişiklik YOK (Caddy kör geçit) |
| 8 | Şifremi Unuttum | İstek → admin geçici şifre verir → ilk girişte zorunlu değiştirme |
| 9 | Kayıt modu butonu | Ana buton "Kayıt Ol" (yeşil) + sönük "← Giriş'e Dön"; başlık=buton=aynı fiil |
| 10 | Mod yazıları | Giriş'e dönünce yazılanlar silinmez, durur (öneri — onay bekliyor) |
| 11 | Admin menüsü | Ayarlara "Admin" satırı (yalnız admin görür) + `#settings-admin-modal` (istekler/üyeler) + bekleyen rozeti |
| 12 | Üye ayar kapsamı | Dil ve Zaman · TMDB API Key · Favoriler · Bildirim Ayarları · Third Party Apps · Güncelleme Saatleri'nden yalnız Bildirim Saati; kural: üye=user_settings, sistem=global |
| 13 | Third Party Apps | Üyeye açık (kendi Stremio kurulum URL'si için şart) |

## 2. Login ekranı tasarımı (`#view-login`)

- Sayfa ortasında tek çerçeve (`.settings-modal` ölçüsü ~480px, ayarlar modal çerçeve rengi); elementlerin tek tek çerçevesi YOK.
- En üstte başlık: giriş modunda **"Giriş Yap"**, kayıt modunda **"Kayıt Ol"**.
- Alt alta: kullanıcı adı kutusu → altında `.7rem` çerçeve-yeşili hint: `Kullanıcı adı en az 3 en fazla 20 karakter olabilir` → şifre kutusu → altında hint: `Şifre en az 10 karakter olmalı ve, büyük, küçük harf, rakam ve sembol içermeli`.
- En altta `.tab` (navbar medya) stilli iki buton: ana eylem (turuncu girişte / yeşil kayıtta) + sönük mod değiştirici.
- Kayıt moduna geçince çerçeve koyu yeşile döner; "Şifremi Unuttum" bağlantısı yalnız giriş modunda görünür.
- Ekran her zaman giriş modunda açılır; kayıt modu yalnız "Kayıt Ol"a basınca gelir. Enter her zaman ana butonu tetikler.
- Dinamik kontrol: ad yazılırken `GET /api/auth/exists?u=` (gecikmeli, son-yazılan-geçerli) → kayıtlıysa Kayıt Ol solar + not çıkar. Bedel: kullanıcı adı varlığı yoklanabilir (ev ağı için kabul).

## 3. Kurallar ve toast mesajları (frontend + backend'de aynı)

- Kullanıcı adı `^[A-Za-z0-9]{3,20}$` → `Kullanıcı adı en az 3 karakter olmalı` / `Kullanıcı adı 20 karakteri geçemez` / `Kullanıcı adı sembol içeremez` (büyük/küçük harf + rakam serbest, gerisi yasak).
- Şifre ≥10 + büyük + küçük + rakam + sembol → `Şifre en az 10 karakter olmalı` / `Şifre en az bir büyük harf içermeli` / `... küçük harf ...` / `... rakam ...` / `... sembol içermeli`.
- Kayıtlı adla kayıt → `Bu kullanıcı adı alınmış`. Hatalı giriş → `Kullanıcı adı veya şifre hatalı` (hangisi söylenmez). Pending giriş → `Hesabın onay bekliyor`. Sıfırlama isteği alındı → `İsteğin yöneticiye iletildi`.

## 4. Faz 30 — Kimlik temeli (sürüm 1.40)

**DB (`py/db.py`):** `users(id, username UNIQUE, password_hash, role admin/member, status active/pending, force_pw_change, created_at)`, `sessions(token PK, user_id, device, created_at, expires_at)`, `password_resets(id, user_id, status, created_at)`, `login_attempts(key PK, count, locked_until)` (5 hata → 15 dk kilit).
**Auth (`py/auth.py` yeni + `py/routes/auth.py` yeni):** Werkzeug `pbkdf2` hash; `secret_key` pi'de dosyada (`/etc/nextep/.flask_secret`, 0600, repoya girmez); çerez `nextep_session`, 1 yıl, `HttpOnly + SameSite=Lax`; `login_required` guard'ı tüm `/api/*` uçlara (muaf: `/`, `/static/*`, `/api/auth/*`, `/stremio/*` — Stremio giriş yapamaz, UUID koruması aynen kalır); `POST /api/app-update/run` ayrıca admin ister.
**Uçlar:** `register` (ilk kullanıcı admin+active, sonrası pending), `login`, `logout`, `me`, `exists`, `forgot` (sıfırlama isteği), admin: `pending listesi`, `approve/reject`, `reset-password` (geçici şifre + `force_pw_change=1`).
**Admin paneli (Faz 30'a dahil):** ayarlar menüsüne `.settings-menu-item[data-target="settings-admin-modal"]` satırı (kalkan ikonu `fa-user-shield`, `settings_admin` ×14 dil; `role!=admin` ise `display:none`); yeni `#settings-admin-modal` (aynı `.modal-overlay` + `.settings-modal` kalıbı) 3 bölüm: ① bekleyen kayıtlar (ad+tarih+Onayla/Reddet) ② şifre sıfırlama istekleri (geçici şifre üret + Kopyala) ③ üyeler (rozet, pasifleştir/aktifleştir, tüm cihazlardan çıkış); bekleyen varsa `#tab-settings` dişlisinde sayı rozeti; TV D-pad döngüsüne otomatik girer.
**TV (`tv.js`):** login input odak zinciri (search emsali) + login'de Back/Escape engeli; APK'ya dokunulmaz.
**i18n:** tüm yeni metinler ×14 dil. **Test:** temp-DB kural matriksi + hash/session/kilit/pending/approve akışları.

## 5. Faz 31 — Üye çipleri + rol ikonları + rol bildirimi (sürüm 1.41) [UYGULANDI]

- Üyeler çerçevesinde favori desenli çipler (satırda 2, tek kalan ortada); sağda halka-çerçeveli `regular` ikonlar: onayla (koyu yeşil), reddet (kırmızı), aktifleştir (turuncu), pasifleştir (turuncu), çıkış (gri), üye→admin (yeşil user), admin→üye (kırmızı gem; tek adminse ölü).
- `POST promote/demote` (admin-only; son-admin koruması `auth_last_admin`; id==1 özel yasağı demote'ta kalktı).
- Rol değişiminde hedefe kişisel bildirim (başkasının işleminde; kendi işleminde sessiz); başlık tipe göre renkli (`data-ntype`, escaper'a dokunulmadan).
- Önden alınan Faz 32 parçası: `notifications.user_id` (0=herkese açık) + liste/sayaç/okuma/silme kullanıcı süzgeci + cache anahtarına user_id (sızıntı kapatıldı).

## 5b. Faz 31b — Çip düzeltmeleri + üye silme (sürüm 1.42) [UYGULANDI]

- id==1 çipine de gem (son-adminse ölü); `circle-*` glifler sadeye döndü (halka yalnız çerçevede) + ikonlar 0.95rem; hover'lar açıldı.
- En sağda X ile tam silme: onay modalı + `POST delete` (self/last-admin korumalı) + kaskad (`users/sessions/password_resets/notifications`; Faz 32 tabloları listede hazır).

## 5c. Faz 31c — SVG ikonlar + onay başlıkları (sürüm 1.43)

- pause/stop (ve tedbiren check/xmark/play) FA regular'da yoktu (tofu) → satır-içi SVG (`ROLE_*`, `currentColor`); göz/user/gem fontta kaldı.
- Onay modalı başlığı artık her çağrıda explicit (silmede "Üyeyi sil", diğerlerinde "Admin"); silme metni iki satır (`pre-line`).

## 5d. Faz 31d — Ölçüler + gerçek çevrimiçi (sürüm 1.44) [UYGULANDI]

- Halka 20px + glif 10px + satırda 2 çip; çevrimiçi ad/alt satır `#4ade80`.
- Kalp-atışı: açılışta anında ping + 30 sn döngü + `pagehide` beacon (`/api/auth/exit`); `sessions.last_seen`; çevrimiçi = son sinyal ≤ 90 sn; Admin modalı açıkken 30 sn sessiz yenileme.

## 6. Faz 32 — Veri ayrımı (sürüm 1.45)

- `followed`, `anime`, `notifications`, `stremio_signals`, `rec_cache` → `user_id` kolonu. **DİKKAT:** Faz 29c `UNIQUE(tmdb_id, media_type)` → `UNIQUE(user_id, tmdb_id, media_type)` olur; `anime.anilist_id UNIQUE` → `(user_id, anilist_id)`; `stremio_signals.dedupe` başına user_id öneki; `episodes/cast/anime_cast/anime_episodes` üst kayıt üzerinden dolaylı.
- Yeni `user_settings(user_id, key, value)`: dil, favoriler, `rec_seen/hidden`, bildirim tercihleri, **Stremio UUID per-user** (mevcut UUID admin'e miras).
- Global kalanlar: `anime_id_map`, `genres`, `cache_store`, saatler, güncelleme/yedek, `tp_base_url`.
- Migration: `ALTER + UPDATE user_id=1` + index rebuild; önce tam yedek, geri alınabilir.
- Frontend (`nextep.js`): açılışta `/api/auth/me` → 401 ise `#view-login`; `fetch` tek noktadan sarmalanır (`credentials:'include'`), 401 → login'e düşürme; Çıkış butonu (ayarlar menüsü; navbar `#tab-exit` ile çakışmamasına dikkat).

**Üye ayar kapsamı (kilitli):** üye menüde yalnız Dil ve Zaman · TMDB API Key · Favoriler · Bildirim Ayarları · Third Party Apps + Güncelleme Saatleri modalında yalnız Bildirim Saati satırı (`s-notification-hour`, diğer 8 satır gizli) görür; NextEp Güncelleme · Cache Süresi · Yedekleme · Admin gizlidir. Kural: üyenin gördüğü her şey `user_settings`'e taşınır (dil/zaman, TMDB key, favoriler, bildirim kanalları+tercihleri+saati, Stremio UUID); sistem geneli global `settings`'te kalır.

## 7. Faz 33 — Bildirimler (sürüm 1.46; sonrası 1.47+ — 1.15 bandı kullanılamaz, 1.40 kilidi)

- Scheduler kullanıcı döngüsüne alınır; her üye kendi kanalına bildirim alır. O zamana kadar bildirimler admin kanalına global gider.
- VPS landing'deki "Install" butonu: kişiselleştirilemez (çerez `192.168.2.11`'e ait) → ya genel kalır ya da "önce uygulamadan kendi bağlantını al" yazar (parkta).
- Uyarı notu: aynı Stremio hesabına iki kişinin URL'si kurulmamalı (sinyaller karışır).

## 7. `sh/reset-admin.sh`

- `sh/reset-admin.sh <yeni-sifre>` → admin (id=1) şifresini yazar, tüm admin oturumlarını düşürür; şifre kural denetiminden geçer, uymazsa yazmaz.
- Yalnız SSH/pi konsolundan, web'den erişilemez. Kılavuzu `md/AGENTS.md`'ye eklenecek.

## 8. Güvenlik notları

- Hash `pbkdf2` (Werkzeug hazır, yeni bağımlılık yok); `secret_key` dosyada.
- Brute-force kilidi (Faz 30); `exists` uç noktası kaba yoklamaya açık — ev ağı için kabul, istenirse kilit sayacına bağlanır.
- CSRF: `SameSite=Lax` LAN için yeterli; state-changing uçlar çerezle çalışır.
- Geçici şifreyle uygulamaya devam edilemez (`force_pw_change` ekranı atlanamaz).

## 9. Doğrulama ve dağıtım (her faz)

- `py_compile` + `node --check` + temp-DB birim testleri + pi canlı uçtan uca (register→pending→onayla→login→izolasyon→TV→Stremio sinyali doğru kullanıcıya).
- Her fazda pi `bak/<ts>/` yedeği, scp + md5 MATCH, `systemctl restart nextep`, `VERSION` bump + `CHANGELOG.md` TR/EN.

## 10. Parktaki açık noktalar (Faz 32 öncesi karar)

1. Landing "Install" butonu: genel mi, yönlendirme yazısı mı?
2. Şifre göz ikonu eklensin mi? (öneri)
3. Giriş'e dönünce yazılanlar dursun mu? (öneri: dursun)
