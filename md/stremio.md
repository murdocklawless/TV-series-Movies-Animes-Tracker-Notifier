# Stremio → Nextep İzledi Senkronu ("NextEp Tracker") — PLAN + ARAŞTIRMA NOTU

Tarih: 2026-09-05 · Durum: **UYGULANDI (Faz 29)** · Trakt YOK · Kapsam: ev ağı

> Dosya konumu: `md/stremio.md` (repo içi kalıcı not; `.gitignore`'da değil —
> pi5.md gibi gizli bilgi içermez, commit edilebilir).

## 0. Bağlayıcı kararlar

1. Sinyal kaynağı: Stremio eklentisi (AIOMetadata'nın altyazı kancası deseni). Trakt köprüsü KAPANDI.
2. Yön tek taraflı: Stremio → Nextep. `izlenmedi`ye alma yakalanamaz (protokol eklentiye
   istek üretmez) — geri alma Nextep arayüzünden.
3. Takipte olmayan içerik OTOMATİK takip edilir (dizi + film + anime).
4. Eklenti `in_watched`'a DOKUNMAZ. İzlenmiş'e taşıma / İzlenmiş'ten geri alma kullanıcıda
   (mevcut davranış).
5. Sinyal açılış anında gelir (bitirme bilgisi protokole uğramaz) → açıp kapatınca izlendi
   sayılır. Kabul edildi. **Sinyal sıralı kilide uyar (Faz 29e):** `(S,E)` sinyali yalnız
   önceki bölüm izlenmişse yazılır + tampona girer (S1E1/E1 her zaman geçer; önceki
   satır yoksa fail-open yaz+logla). Kilit-dışı sinyal yazılmaz, tampona girmez;
   E5'i kazanmak için E1–E4 sonrası yeniden açmak gerekir. `clear-apply` tamponu
   `(S,E)` sıralı + kilitli uygular ve tüm satırları siler; `purge_ungated_signals`
   eski kilit-dışı/yetim satırları temizler.
6. Harici oynatıcı (VLC/mpv) kör noktası kabul edildi. Altyazısız izleme sorunsuz
   (istek altyazı seçimine değil oynatma açılışına bağlı).
7. Tam sıfırlamada tampon OTOMATİK uygulanır (sormadan); kısmi işlemde uygulanmaz.
8. Barındırma (Faz 29b): eklenti `https://stremio.cembol.com` üzerinden servis edilir
   (Stremio HTTPS + CORS zorunlu kılar; HTTP LAN IP reddedilir). VPS (80.211.22.203)
   Caddy: `/` = statik landing (plugin sayfası + Install butonu), `/stremio/*` =
   `reverse_proxy 127.0.0.1:8050` → Pi'den VPS'e autossh ters tünel
   (`nextep-tunnel.service`, WG yok) → Pi:8050. Tüm eklenti mantığı Pi'de;
   VPS yalnız TLS geçidi. `tp_base_url=settings` (varsayılan `https://stremio.cembol.com`);
   manifest/kanca/install-info yanıtları `Access-Control-Allow-Origin: *` taşır.
   Güvenlik: hostname public, kimlik = UUID (128-bit).
9. Önce BOŞ Stremio hesabında kur-kaldır provası, sonra asıl hesaba kurulum.
9. Önce BOŞ Stremio hesabında kur-kaldır provası, sonra asıl hesaba kurulum.
10. Dağıtım kuralı: yerelde düzenle → scp → (gerekirse) restart; pi'de doğrudan
    düzenleme YOK. JS/HTML'de PowerShell Set-Content YASAK (Edit tool; Faz 28c dersi).
11. **QR YOK (build kararı):** Stremio eklentileri hesaba kurulur; aynı hesaba girişli
    TV otomatik alır → TV'de URL taşıma ihtiyacı yok. Tarif: telefon/PC → stremio.com/addons
    → aynı hesap → yapıştır → Kur → TV senkron alır. TV almadıysa: kapat-aç → Eklentiler →
    Sync Addons → çıkış-giriş; doğrulama gözle değil ilk sinyalle (modal "Bağlı").
12. **Configure sayfası YOK (build kararı):** `behaviorHints.configurable` eklenmez;
    Stremio'da yalnız Kaldır + Eklentiyi paylaş görünür (dişli yok). Ayar adresi = Nextep
    Third Party Apps modalı.
13. **Third Party Apps genel modalı:** Stremio ilk uygulama; gelecekte Nuvio vb. aynı
    modalın renderer defterine satır eklenerek bağlanır. **UUID per-app:** `settings.tp_<app>_uuid`
    (örn. `tp_stremio_uuid`, `tp_nuvio_uuid`); uçlar jenerik
    `POST /api/thirdparty/<app>/refresh-uuid|disconnect`.

## 1. Araştırma bulgusu — AIOMetadata mekanizması (cedya77/aiometadata, dal: dev)

- Sinyal kanalı: `resources: ["subtitles"]` ilanı → Stremio her oynatma başlangıcında
  `GET /stremio/:userUUID/subtitles/:type/:id{/:extra}.json` sorar
  (`addon/index.ts` → "// --- Subtitle Route (for watch tracking) ---").
  `extra` (filename/videoSize/videoHash) görmezden gelinir.
- İşleyici `addon/lib/subtitleHandler.ts → handleSubtitleRequest`: cevabı bekletmeden
  `{subtitles: []}` döner (`cacheMaxAge: 0`), check-in'leri `await`'siz ateşler.
- `parseMediaId`: `tt:S:E`, `tmdb:id:S:E`, `tvdb:id:S:E`, `trakt:id:S:E`,
  `kitsu:id:E` (filmde S/E yok). `resolveSeriesIds` hedef ID'ye çevirir.
- Stremio `type` paramı `movie` / `series` değerlerini alır (`tv` DEĞİL) —
  route-tipi ile parse-tipi çelişirse istek atlanır
  (`normalizeWatchTrackingMediaType` eşdeğeri bizde de olacak).
- Trakt yazımı (referans, BİZ KULLANMIYORUZ): `POST https://api.trakt.tv/checkin`,
  dizi `{show:{ids}, episode:{season,number}}`, film `{movie:{ids}}`,
  header `Bearer + trakt-api-key`; 409 başarı sayılır. `POST /checkin` = "şu an
  izliyor" oturumu; Trakt süre dolunca history'e çevirir (o yüzden 1 dk izleme
  sayılmaz, kapatılsa da sayaç işlemeye devam eder — gözlemle doğrulandı).
- AIOStreams (Viren070) NOTU: o repoda Trakt push YOK (sadece alias okuma
  `metadata/trakt.ts` + OAuth'suz clientId; tek OAuth `oauth-callback.tsx` =
  Google Drive). Kullanıcının gördüğü Trakt yazımı AIOMetadata'dandı —
  repo karışıklığı çözüldü, tekrar açılmayacak.
- BAĞIMLILIK YOK (2026-09-05 kararı): AIOMetadata / AIOStreams / Cinemeta'ya istek
  atılmaz, anahtarları kullanılmaz, kurulu olmaları gerekmez. AIOMetadata yalnızca
  tekniğin kanıtıydı (altyazı kancası deseni); kod sıfırdan bizim eklentide yazılır.
  ID önekleri (`tt/tmdb/tvdb/trakt/kitsu`) ekosistemin ortak dilidir, Cinemeta'ya
  özel entegrasyon değildir.

## 2. Backend — eklenti iskeleti (yeni: py/routes/stremio.py + nextep.py kaydı)

- 2.1 Barındırma: AYNI Flask uygulaması, AYNI port (8050), yeni blueprint
  (`stremio_bp`). Ayrı servis/port yok — tek systemd servisi korunur.
  Manifest URL: `http://192.168.2.11:8050/stremio/<uuid>/manifest.json`.
- 2.2 `GET /stremio/<uuid>/manifest.json` — statik içerik: id `nextep-tracker`,
  `name: "NextEp Watch Sync"` (2026-09-05 kararı), `description: "Syncs what you
  play in Stremio to NextEp as watched"` (İngilizce — Stremio ekosistem dili;
  Türkçe açıklama yalnız Nextep ayar modalında), `resources: ["subtitles"]`,
  `types: ["movie","series"]`,
  `idPrefixes: ["tt","tmdb:","tvdb:","trakt:","kitsu:"]`.
  NOT: Stremio manifesti kurulum başına önbellekler → UUID yenilenince
  Stremio'da eklentiyi kaldırıp yeni linkle yeniden kurmak gerekir (modal metnine yaz).
- 2.3 UUID: `settings.tp_stremio_uuid` (per-app deseni §0.13); status ucu çağrılınca
  otomatik üretilir (kurulum URL'si hep hazır). "Bağlı" = en az bir sinyal alındı
  (ilk sinyalle onaylanır). Eşleşmeyen istek 404. Uçlar: refresh-uuid (eskisi ölür +
  yeniden kurulum gerekir), disconnect (yazma durur + sinyal tamponu temizlenir).
- 2.4 `GET /stremio/<uuid>/subtitles/<type>/<id>.json` — anında `{subtitles: []}`;
  çözümleme + yazım yanıtı bekletmez. Flask'ta post-response zor olduğundan:
  yanıt ÖNCE hazırlanır, DB işleri yerel SQLite (ms mertebesi) ile hızlı tutulur;
  yavaş kalırsa thread'e alınır (build'de ölçülür).

## 3. ID çözümleme + yazım (mevcut uçların iç mantığı yeniden kullanılır)

- 3.1 `parse_stremio_id(id)` → `(kind, key, season, episode)`; hatalı ID → logla,
  HTTP 200 + `{subtitles: []}` dön (Stremio'yu asla bozma).
- 3.2 Stremio `type`: `series` → tv, `movie` → film. Route-tipi ↔ parse-tipi çelişkisi
  → atla (AIOMetadata `normalize…` kuralı).
- 3.3 Dizi: `tmdb_id` takipte yoksa `follow` + `sync_episodes` (ÖNCE liste, SONRA
  write — sıra garantisi) → `episode_watch` iç mantığı `watched=1` + `bump()`.
  (Kaynak: py/routes/followed.py:492)
- 3.4 Film: yoksa `follow` → `watched=1, in_watched=1` (doğrudan İzlenmiş;
  önerilerdeki move-watched deseni). (Kaynak: followed.py:608 + recommendations.py:132)
- 3.5 Anime: `kitsu:id:E` → AniList mutlak bölüm dönüşümü (mevcut py/anilist.py +
  mapping; çözülemeyen atlanır + loglanır) → yoksa anime-takip →
  `anime_episode_watch` `watched=1` + `bump()`. (Kaynak: py/routes/anime.py:324)
- 3.6 HİBRİT ŞELALE (D1 kararı, 2026-09-05 — anime/dizi ayrımı): kullanıcının
  kurulumu Cinemeta (`tt…` ağırlıklı) + AIOMetadata (`kitsu:` anime katalogları)
  olduğundan `tt…` ile gelen anime DİZİYE DÜŞEBİLİR; aşağıdaki sıra bunu kapatır.
  Ucuz ve kesin olandan pahalı olana:
  1. ID `kitsu:` mi? → DİREKT ANİME kolu (`anilist_id + mutlak bölüm`;
     bölümsüz `kitsu:<id>` = anime-filmi → E9'a bak).
  2. `anime` tablosunda eşleşme var mı? (`tt`→imdb kolonu, `tmdb:`→tmdb kolonu,
     `tvdb:`→tvdb kolonu) → ANİME kolu. S/E → mutlak bölüm: S1 ise bölüm aynen;
     S2+ ise mevcut anime-list eşlemesi, yoksa logla + atla (yanlış yazma yok).
  3. TMDB sezgisi (türlerde Animation + köken JP)? Tek seferlik sorgu, sonuç kalıcı
     önbelleğe yazılır (`rec_detail` deseni) → ANİME kolu (2. satırdaki S/E kuralıyla)
     + eşleşme `anime` tablosuna işlenir (bir dahaki sefere 2. sırada yakalanır,
     sorgu giderek seyrekleşir).
  4. Varsayılan: DİZİ kolu (`tmdb_id + S/E`) veya S/E yoksa FİLM kolu.
  Kenar: `tt…` anime-filmi → 2. sıra yakalarsa anime-filmi, yakalayamazsa normal
  film kolu (ikisinde de İzlenmiş'e varır, kayıp yok).
- 3.7 AÇIK NOKTA (E9) — anime-filmi hedefi: `anime` tablosunda film kaydı modeli
  (`in_watched` yeterli mi?) build'in ilk DB incelemesinde netleştirilecek; planı
  bloklamaz.
- 3.8 `in_watched`'a dokunulmaz. İzlenmiş'teyken gelen sinyal yazımda no-op
  (bölümler zaten watched=1) ama TAMPOANA KAYDEDİLİR (bkz. §4).

## 4. Sinyal tamponu — yeni tablo stremio_signals (db/nextep.db, pi: /etc/nextep/db/)

- 4.1 Neden tablo: `settings` (key-value, şekil uymaz) DEĞİL; `cache_store`
  (bump/TTL siler) DEĞİL; RAM (restart siler) DEĞİL. Desen: Faz 17 `rec_detail`.
- 4.2 Şema: `dedupe TEXT PRIMARY KEY` (= `kind|tmdb_id|anilist_id|season|episode`,
  NULL-UNIQUE tuzağından kaçınır) + `kind TEXT (tv/movie/anime)`,
  `tmdb_id INT NULL`, `anilist_id INT NULL`, `season INT NULL`, `episode INT NULL`,
  `ts INT`. Ekleme: `db.py init_db` içine `CREATE TABLE IF NOT EXISTS` (~10 satır).
  Harici→anilist esleme ayrı tablo `anime_id_map(source, external_id, anilist_id, ts)`
  (Kitsu API mappings üzerinden doldurulur; `resolve_external_anilist`).
- 4.3 Yazım: her altyazı sinyalinde `INSERT … ON CONFLICT DO UPDATE ts`
  (`in_watched` durumundan bağımsız; film sinyalleri de kaydedilir ama §5'te
  film için tetikleyici UI yoktur — filmde geri alma manueldir).
- 4.4 Budama: gecelik iş (scheduler), 30 günden eskileri siler.
- 4.5 Tüketim: uygulanan satır silinir (tekrar uygulanmaz).

## 5. Takvim butonları — sinyal tetikleme (components.js)

Mevcut: her sezon kutusunda `.season-watch-all` (`Tümünü izle ↔ Temizle`,
`POST /api/season/watch`, components.js:81,187). Anime tarafı: components.js:726,783.

- 5.1 Yeni uç `POST /api/seasons/clear-apply {tmdb_id}`: TÜM bölümler `watched=0`
  → tampon otomatik uygulanır (sinyalliler `watched=1`) → `{cleared, applied:[S/E]}`
  döner. Tek uç = atomik sıra (önce temizle, sonra doldur).
- 5.2 Anime dalı: anime için toplu-temizleme ucu YOK (mevcutta yalnızca tekil
  `anime_episode_watch` + `in_watched` anahtarı var) → clear-apply içinde anime
  kolu yazılacak (tüm `anime_episodes` → 0, sonra tamponu uygula). Build maddesi.
- 5.3 Çok sezonlu dizi: ilk sezon kutusunda mevcut butonun SOLUNA
  "Tüm Sezonları Temizle" (`t("clear_all_seasons")` ×14 dil) → 5.1 ucuna gider →
  `groups` güncellenir + mevcut `renderAll` deseniyle modal ANINDA yeniden çizilir
  (sayfa yenileme yok) + toast (uygulanan sayısı / sinyal yoksa "temizlendi").
- 5.4 Çok sezonlu sezonluk `Temizle`ler: sinyal TETİKLEMEZ (bugünkü davranış).
- 5.5 Tek sezonlu dizi: mevcut `Temizle` (`data-w=0`) 5.1 ucuna gider (temizle+doldur).
  `Tümünü izle` (`data-w=1`) yönü değişmez, tetiklemez.
- 5.6 Anime takvimi (openAnimeSchedule): aynı davranış tek liste üzerinden (5.2 kolu).
  Film: sezon yok, akış değişmez.
- 5.7 i18n: `clear_all_seasons` + toast metinleri ×14 dil; index.html v-bump
  (Edit tool ile).

## 6. Ayarlar ekranı — settings-stremio-modal (index.html + settings.js + i18n.js)

- 6.1 `#settings-menu`'ye Stremio ikonlu "Stremio Bağlantısı" satırı (TMDB kilidi yok;
  mevcut 8 modalın deseni: settings-lang/tmdb/favorites/notify/appupdate/update/cache/backup).
- 6.2 Modal: durum (Bağlı/Bağlı değil + son sinyal zamanı) · kurulum URL kutusu +
  kopyala butonu · 3 adımlı tarif (Stremio → Eklentiler → yapıştır → Kur;
  TV için `stremio.com/addons` notu; UUID yenilenince yeniden kurulum gerekir notu) ·
  UUID yenile · bağlantıyı kes.
- 6.3 Kurulum Stremio içinden yapılır (üçüncü-parti sayfa kuramaz); `stremio://`
  derin-link denenmez (platformda güvenilmez). Kurulum teyidi = ilk sinyalde durum
  "Bağlı"ya döner.
- 6.4 Kaldırma: Stremio → Eklentilerim → Kaldır (standart; geride veri kalmaz) +
  pi tarafında UUID iptali (eklenti dursa da yazma durur).

## 7. Davranış matrisi (kabul edilen)

| Açılan | Takip durumu | Sonuç |
|---|---|---|
| Dizi bölümü | Yok | follow + sync + bölüm watched=1; eksikler İzlenmemiş'te |
| Dizi bölümü | Var | bölüm watched=1 |
| Dizi bölümü | İzlenmiş'te | no-op + tampona kayıt |
| Film | Yok | follow + watched=1,in_watched=1 → doğrudan İzlenmiş |
| Film | İzlenmiş'te | no-op |
| Anime bölümü | Yok/var/İzlenmiş'te | diziyle aynı (mutlak bölüm; D1 kuralıyla ayrışır) |
| Tam sıfırlamayla geri alma (tüm sezonlar → izlenmedi) | — | tampon OTOMATİK uygulanır (sormadan) |
| Kısmi geri alma | — | uygulanmaz |

## 8. Değişmez sınırlar

Açıp kapatınca izlendi sayılır · geri alma yakalanamaz · harici oynatıcı kör ·
Trakt yok · ev ağı (dış erişim ayrı faz) · eklenti salt-okunur (boş altyazı,
hesap bozamaz) · manifest statik · EKLENTİ BAĞIMSIZLIĞI: kanca oynatıcıya takılıdır;
katalog/akış hangi eklentiden (Torrentio/Comet/MediaFusion/…) gelirse gelsin sinyal
aynı kapıdan girer — AIOMetadata/Cinemeta'nın kurulu olması gerekmez. Egzotik
önekler (`anilist:` vb.) bugün log + atla; gerekirse parse listesine tek satır.

## 9. Doğrulama (build sırasında)

- 9.1 Birim (temp DB): ID matriksi + hatalı girdiler · type-mismatch atlama ·
  tampon dedupe/uygula-sil/budama · clear-apply sırası (dizi + anime kolu) ·
  `in_watched`'a dokunulmama.
- 9.2 node --check + vm tam-dosya kontrolü (Faz 17 dersi: --check tek başına yetmez).
- 9.3 Pi canlı: dizi + film + anime açılışı → watched=1 · modal anlık güncellenme ·
  md5 MATCH · servis active · `/api/followed` 200.
- 9.4 Boş Stremio hesabında kur-kaldır provası → asıl hesaba kurulum.
- 9.5 Yedek: pi `/etc/nextep/bak/<ts>/` + AGENTS.md faz notu.

## 10. Build sırası

1. DB tablo + tampon yardımcısı (py) 2. stremio.py (manifest + kanca + çözümleme +
   yazım; D1 kararı dahil) 3. clear-apply ucu (dizi + anime kolu) 4. takvim
   butonları + i18n 5. settings-stremio-modal 6. testler (9.1–9.2) 7. pi dağıtım +
   prova hesabı (9.3–9.5) 8. asıl kurulum + AGENTS.md notu.
