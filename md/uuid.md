# NextEp — Donmuş Plan: hane bölmesi + giriş (uuid.md)

Tarih: 2026-09-06. Durum: PLAN — kod uygulanmadı, pi'ye dokunulmadı.
Canlı sistem (Faz 29 + statik v418/v422) çalışıyor, dosyalar 2026-09-05 tarihli.

## 0. Kilitli kararlar

1. Login var: kullanıcı adı + parola; ilk hesap admin, sonrakiler üye.
2. Hane ≠ kullanıcı: hane = veri bölmesi (liste + UUID + bildirim hedefi),
   kullanıcı = giriş anahtarı; **1 kullanıcı = 1 hane**.
3. Kurulum linki giriş arkasında; anonim mint yok.
4. Üye yalnız kendi satırını görür; admin üye listesini göremez;
   slotu yalnız admin açar; bildirim hedefini üye kendisi bağlar.
5. Taşıma değişmez: `autossh -N -R 8050:127.0.0.1:8050 -p 52222` (tek boru, tek port).
   WireGuard / misafir-önek yolu / port defteri / `vps-setup.sh` YOK.
6. TV APK dokunulmaz (TV girişi ayrı faz).
7. Eski ara kararlar (loginsiz anonim kurulum, public-login hunisi,
   Torrentio-modeli açık kurulum, misafir-önek) GEÇERSİZDİR — yukarıdaki 1-6 geçerlidir.

## 1. Kavramlar

| Kavram | Nedir | Örnek |
|---|---|---|
| Hane (household) | Veri bölmesi: liste + UUID + bildirim hedefi (`stremio_households` satırı) | `Ev`, `Ev-2` |
| Kullanıcı (user) | Giriş kimliği: kullanıcı adı + hash'li parola (`users` satırı) | `admin`, `arkadaş` |
| Hane anahtarı | Household UUID (etiket değişebilir, anahtar sabittir) | `uuid4().hex` |

Adresleme kuralı: port → kutuyu seçer (8050 = Pi5), UUID → kutudaki haneyi seçer.

## 2. Fazlar

| Faz | Ne yapılır | Dosyalar | Doğrulama | Not |
|---|---|---|---|---|
| A1 | `stremio_households` tablosu (uuid PK, label, created_ts, last_seen); mevcut tek UUID `Ev` slotuna taşınır; 4 tabloya `household` kolonu; eski satırlar `Ev`'ye bağlanır; tampon dedupe hane-önekli forma migrate edilir (bayraklı, tek seferlik) | `py/db.py`, `py/routes/stremio.py` (helper: lookup/touch/create) | Temp-DB: tablo + migrasyon + Ev slotu | Restart gerekir |
| A2 | Kanca UUID→haneden çözer (`_check_uuid` yerine defter), `last_seen` tazelenir; `_tv/_anime/_movie_branch` + `_ensure_*` + `record_signal` + `signals_for_*` + clear-apply household kapsamlı; `followed` unique indexi `(household,tmdb_id,media_type)` olur; `anime.anilist_id` UNIQUE'ı `(household,anilist_id)`'ye taşınır (tablo rebuild, id'ler korunur) | `py/routes/stremio.py`, `py/stremio_buffer.py`, `py/db.py` | İzolasyon matrisi: X'in sinyali Y'ye düşmez; yanlış UUID 404 | Restart gerekir; **güvenliğin tamamı burada** |
| L1 | `users` (ad + hash, admin/üye) + giriş ekranı (`/`), session (HttpOnly/Secure/SameSite), ilk hesap admin; mevcut veri + `Ev` admin'e taşınır; `setup.sh`'ye dokunulmaz (soru sormaz ilkesi) | Yeni + `py/nextep.py`, `static/` | İlk ziyarette kurulum formu, sonra 404 | Restart gerekir |
| L2 | 53 endpointte login-guard + hane kapsamı; modal hesap-filtreli (üye yalnız kendi satırı); kurulum linki giriş arkasında | Tüm route'lar + `static/js/settings.js` | Hesaplar arası sızma testi | Anonim kötüye kullanım ölür |
| L3 | Sertleştirme: hız-limiti + artan bekleme + geçici kilit, genel hata mesajı, CSRF, parola kuralı, parse-edilebilir FAIL log + gerçek istemci IP; fail2ban jail'leri (`sshd`, `nextep-login`, `nextep-register`, `stremio-abuse`) | App + VPS | Jail kuru-testleri | VPS dokunuşu gerekli |
| B2 | LAN modalı hane listesi: public-adres kutusu DURUR, hane-başı link kutusu YOK; satır başına durum + son sinyal + Yenile + Kes (Kes ortak confirm-modal ile) | `static/js/settings.js`, `static/index.html`, `static/js/i18n.js` | Kes yalnız o haneyi keser | Statik, restart yok |
| B3 | Hane-başı bildirim hedefleri (üye kendi hedefini bağlar) + scheduler hane döngüsü | `py/scheduler.py`, `py/db.py` | X'in bildirimi X'e gider | En büyük faz |
| B4 | Yetim slot budama (sinyalsiz + N günlük), log'lu fail-soft | `py/scheduler.py` | Kuru-çalıştırma temiz | — |
| Kalkanlar | Pi P1-P5: SSH anahtar-only + `PermitRootLogin prohibit-password`, fail2ban + `sshd`/`nextep-login` jail, host-duvarı (varsayılan-reddet), servis envanteri (`:3306`, Samba, `:3000`…), kilitlenme sigortası. Tünel T5-T9: root dışı kısıtlı tünel hesabı, `GatewayPorts`/bind doğrulama, anahtar rotasyonu, kill-switch (`stop nextep-tunnel`) | Pi + VPS | — | Tünel bayrakları bugün: `-N BatchMode StrictHostKeyChecking`, ayrı `vps_tunnel` anahtarı (iyi); hesap `root` (kötü → T5) |

## 3. Yetki matrisi (kilitli)

Admin-özel: hesap yönetimi, hane slotu aç/adlandır/sil, global ayarlar (TMDB key, saatler, TTL, timezone),
yedekle/geri-yükle, app-update, herhangi haneyi Kes.
Üye (yalnız kendi hanesi): takip/izle/takvim/clear-apply, anime seti, öneriler+gizleme,
kişisel ayarlar + kendi bildirim hedefleri, kendi UUID'sini gör + yenile, arama (salt-okunur).
Girişsiz açık: yalnız `/stremio/<uuid>/manifest.json` + `/subtitles/...` (protokol kimlik taşıyamaz).
Kısıtlar: üye başka haneyi göremez, slot açamaz, global/yedek/güncellemeye dokunamaz;
admin üye listelerini göremez.

## 4. Kapsam dışı

- Anonim kurulum / Torrentio-modeli açık huni / misafir-önek yolu / per-hane subdomain.
- 1000-kullanıcı S-fazları (federasyon + kota yeter; tek kutu ≤15 hesap).
- TV girişi (karar açık soru 3'te).
- `vps-setup.sh` yazılmayacak.

## 5. Açık sorular

1. Kayıt anında mı açılsın, admin onayıyla mı?
2. Caddy arayüz yolunu (5 satır: `/` + `/app` → Pi, `/stremio/*` aynen) sen mi yapıştırırsın, erişi verip ben mi girerim?
3. TV: cihaz-token muafiyeti mi, ayrı TV-giriş fazı mı?
4. Sıra: A1-A2 önce mi, L1-L2 önce mi? (Öneri: bölme önce.)

## 6. Başlamak için gerekenler

Build onayı + VPS SSH erişisi (L3 + Caddy için) + yukarıdaki 4 cevap.
Dağıtım kuralı (değişmez): pi'de doğrudan edit yok — çek → yerelde editle →
`bak/<ts>/` yedeği → scp → md5 MATCH → gerekirse `systemctl restart nextep` →
curl doğrulama (`/` + `/api/followed` 200).

## 7. Geçmiş not (2026-09-06)

"Devam" talimatı kod onayı sanılıp A1'e başlandı (4 edit), onay olmadığı
anlaşılınca tamamı geri alındı; artakalan sıfır (grep kanıtlı), pi'ye yazma
olmadı (canlı dosyalar 2026-09-05 tarihli, servisler active, uçlar 200).
Bu dosya planın tek kaynağıdır.
