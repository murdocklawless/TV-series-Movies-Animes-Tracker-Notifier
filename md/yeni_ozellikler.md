# NextEp — Yeni Özellik Planı (1.83 → 1.86)

> Durum: **PLAN** (henüz uygulanmadı). Sürüm başlangıcı: 1.82 (canlı).
> Kapsam: 4 özellik, her biri **ayrı sürüm**. Uygulama sırası: 1.83 → 1.84 → 1.85 → 1.86.
> Bu dosya Plan modunda `~/.opencode/plan/` altına yazıldı; Build'e geçilince repo konvansiyonuna göre
> `md/yeni_ozellikler.md` (veya sürüm başına ayrı `md/<is>.md`) altına taşınır.

---

## Kilitli kararlar (kullanıcı onaylı)

| Konu | Karar |
|---|---|
| "Sıradaki" şeridi konumu | **İzlenmemiş sekmesinin en üstünde** (tek yer, yatay şerit) |
| .ics kapsamı | **Yaklaşan + hatırlatıcı** (bugün ve sonrası; yayından 1 gün önce `VALARM`) |
| Webhook kapsamı | **Plex + Jellyfin/Emby ikisi birden**, tek sürümde |
| Sürüm planı | **Her özellik ayrı sürüm**: 1.83 arşiv · 1.84 sıradaki · 1.85 ics · 1.86 webhook |

---

## Ortak mimari çıpa noktaları (mevcut, yeniden kullanılacak)

- **Third Party Apps defteri:** `py/routes/stremio.py:62` `THIRDPARTY_APPS = [{stremio},{remote}]` +
  `renderThirdPartyApps()` (`static/js/settings.js:2154`) — yeni kartlar (takvim, plex, jellyfin) buraya satır.
- **Per-user token deseni:** `_get_uuid(app_id)` / `_find_owner_by_uuid()` (`stremio.py:74-135`),
  `settings.tp_<app>_uuid` ↔ `user_settings` — hem ICS hem webhook aynı deseni kullanır.
- **Public kanca:** `py/auth.py:300-306` — yalnız `/api/*` kapılıdır; `/stremio/*` gibi `/calendar/*` ve
  `/webhook/*` da kapsam dışıdır (token = kimlik).
- **Sinyal/yazım çekirdeği:** `stremio.py` → `parse_stremio_id`, `process_signal`, `_resolve_tmdb`,
  `_resolve_anime`, `_is_anime_like`, `_tv_branch`, `_anime_branch`, `_movie_branch`,
  `_ensure_tmdb_follow`, `_ensure_anime_follow` — webhook aynı dalları çağırır.
- **Sinyal tamponu:** `stremio_signals(dedupe PK, kind, tmdb_id, anilist_id, season, episode, ts, user_id)`
  — webhook idempotentliği için aynı desen.
- **Liste önbelleği:** `list_cache` (`("unwatched", uid, gen(), today_str())` deseni) — `next-up` de aynı.
- **Bildirim tipleri:** `py/scheduler.py NOTIF_TYPES` ↔ `static/js/settings.js:12` birebir.

---

# 1.83 — "Arşiv" (arşivleme) durumu

**Amaç:** Takibi bırakmadan arşive al; bildirimler durur, öğe yalnız Arşiv sekmesinde yaşar.
(`remove` = "Takibi bırak" kaydı **SİLER**; `archive` kaydı **KORUR** — ayrı iş. `deferred` = "sonra izle", dokunulmaz.)

> **Adlandırma (kilitli):** Arayüzde her yerde **"Arşiv"**. Kod içinde de `archived` / `archive-btn`.
> (İlk taslaktaki "dropped / Bıraktım" adı bırakıldı.)

### DB (`py/db.py` — mevcut `ALTER TABLE` deseni)
- `followed.archived INTEGER DEFAULT 0`
- `anime.archived INTEGER DEFAULT 0`

### Backend filtreleri (`archived=0`)
- `py/scheduler.py`: `check_notifications` (satır ~639, 748), `check_anime_notifications` (~797),
  `unwatched_bulk` (~708, 858), `vote_threshold` (~740), cleanup/liste sorguları (~1052, 1074, 1095),
  kullanıcısız taramalar (~894, 924).
- `py/routes/followed.py`: `/api/followed`, `/api/unwatched`, `/api/watched`.
- `py/routes/anime.py`: `/api/anime/followed`.
- `_build_card` dokunulmaz (yalnız görsel).

### Uçlar
- `POST /api/followed/archive` `{id, archived:0|1}`
- `POST /api/anime/archive` `{id, archived:0|1}`

### Görünüm yeri (kilitli karar — 2026-10-17)
- **Yeni "Arşiv" DURUM sekmesi** (İzlenmiş'in yanında): `#view-archive` + 4 alt bölüm
  (`archive-shows/movies/docs/anime-wrap`), İzlenmiş/İzlenmemiş deseniyle; `views.js` `switchView` + yükleyici.
- **Medya sekmelerinde (Dizi/Film/Belgesel/Anime) varsayılan GİZLİ**; sekme başlığında
  **"Arşivlenenleri göster"** anahtarı → açınca soluk + "Arşivde" rozetli görünür.
- "Arşiv" sekmesindeki kartta **"Arşivden çıkar"** (unarchive) butonu.
- NOT: `settings-follow-modal` ("Takip / İzlenmiş") yalnız Erken İzlenmiş Eşiği tutar; liste oraya konmaz.

### Kart butonu düzeni (KİLİTLİ — kullanıcı spec'i)
- **Poster üst şeridi, sıra soldan sağa: `takvim · taşı · arşiv · takibi bırak`.**
- **Buton araları eşit olacak** → yeni `.poster-top` sargısı + `display:flex; justify-content:space-between`.
  (Mevcut 3'lü sol/orta/sağ dizilim birebir korunur.)
- **`taşı` butonu görünmüyorsa arşiv tam ortaya gelir:** `showMoveBtn=false`
  (film `watched=1` / dizi `completed` / `can_move_watched` yok) ise buton hiç basılmaz →
  space-between + eşit genişlikte 3 öğe (takvim, arşiv, takibi bırak) arşivi **tam ortalar**.
- Sargı: `position:absolute; top/left/right:8px; display:flex; justify-content:space-between;
  align-items:center; pointer-events:none; z-index:2`; çocuklar `pointer-events:auto`,
  `position:static` resetlenir (mobil/TV konum ezmeleri dahil).
- İkon `fa-box-archive`; renk önerisi `#fbbf24` (amber — kırmızı "sil"e ayrılmış).
- **Adanmış onay YOK (1.83 düzeltmesi):** arşivleme de arşivden çıkarma gibi onaysız tek tıklamadır (`archiveAskAndArchive` silindi; `#archive-confirm-modal` yok). TV `hookModals` / `resolveLiveButton` listelerinde arşiv kaydı yoktur (unarchive dönüş odağı rowview slotuyla çözülür).
- TV: `tv.js` `RANK` + `CARD_BTN_SEL` + `:hover`/`:focus-within` display listelerine arşiv eklenir;
  `views.js` `setTvCardAttrs` arşiv keydown'unu bağlar.

### Dokunulacak şablon yerleri (yalnız 3 render = 4 medya sekmesi)
- `views.js:343` (`loadFollowed` → **Dizi + Film**), `views.js:465` (`loadBelgesel`), `views.js:609` (`loadAnime`).
- İzlenmemiş (782/820/869/908) ve İzlenmiş (995/1037/1086/1124) şablonları **DEĞİŞMEZ**.
- `search.js` (395/999), `components.js` (1095, kişi/favori modalları) **DEĞİŞMEZ** → mevcut absolute düzen korunur.

### CSS (3 dosya)
- `style.css`: `.card .poster-top` + reset + `.card .archive-btn` (+ `:hover` renk, `.card:hover .archive-btn{display:flex}`).
- `mobil.css`: şerit inset/ölçü (21px, top 4px, yan 4px) + `hover:none`'da arşiv görünür + strip reset.
  **Risk:** mobilde `move` zaten zorla görünür → üstte 4×21px; ~320px'te aralar ~3px.
  Gerekirse ≤480px'te 19px'e düşürülür (doğrulama maddesi).
- `tv.css`: şerit inset/ölçü (`var(--tv-scale)`), `:hover`/`:focus-within` listelerine `.archive-btn`, strip reset, focus ring.

### Frontend (i18n + zincir)
- i18n ×14: `tab_archive`, `archive`, `unarchive`, `archive_confirm_title`, `archive_confirm_text`,
  `archived_badge`, `show_archived`, `archive_empty`.
- Cache-buster zinciri: `rowview.js` + `views.js` + `tv.js` + `i18n.js` → `nextep.js` → `index.html` → `__NX_BUILD`.

### Doğrulama
- Temp-DB: archive → `/api/followed` dışı, bildirim üretmez, unarchive → geri gelir.
- Scheduler kuru çalıştırma: arşivli yapım için bildirim yok.
- Render: 4 buton eşit aralık · `taşı` yokken arşiv tam ortada · mobil 320/390/480px · TV odak modu.
- md5 MATCH · servis active · `VERSION`+DB 1.83 · CHANGELOG TR/EN · `md/faz.md` notu.

---

# 1.84 — "Sıradaki Bölüm" (Continue watching) şeridi  ✅ UYGULANDI (v2)

> **Kilitli kararlar (2026-10-17 → 18, uygulama sırasında netleşti):**
> - **Kapsam = A:** yalnız **çoklu bölümlü** yapımlar — dizi, belgesel **dizisi** (`media_type='tv'`) ve anime.
>   **Film / belgesel filmi YOK.**
> - **Yerleşim:** **Dizi · Belgesel · Anime** sekmelerinin en üstünde (İzlenmemiş'te **değil**); her sekmede o türe ait öğeler.
> - Başlık: **"Sıradaki Bölüm"**; sağda `N yapım · toplam M dk` özeti.
> - **Sıralama:** yayın tarihi **en yeni önce**.
> - **İzlemeye başlanmış şartı:** yapımın **ilk bölümü** (en düşük sezon/bölüm) izlenmiş olmalı.
> - **Taşınabilir bölüm** (oklar + kalıcı sıra, varsayılan en üst).
> - **Kart:** genişlik = alttaki standart kart genişliği · yükseklik **84px** sabit · gap = grid gap'i → sütunlar hizalı.
> - **Diziliş:** `flex-wrap: wrap` + `justify-content: center` → **yatay scrollbar yok**, taşanlar alt satırda ortalanır.
> - **Tipografi:** başlık = standart kart başlığı · `S02E05 · 45 dk` = standart kart statüsü · isim **en fazla 2 satır**.
> - **"İzledim" butonu YOK** (karta tıklama → detay).
> - **Boşsa bölüm tümüyle gizli.**
> - **Otomatik kalkma:** uygulama içi anında; Stremio/dış istemci → `/api/notifications/count` `gen` + 30 sn polling ile tazeleme.
> - Başlıkta arama/filtre/sıralama/kart-satır anahtarı yok.

**Amaç:** Her yapının **tek sonraki izlenmemiş** bölümünü sekme başına tek şeritte topla; karta tıkla→detay.

### Backend — `GET /api/next-up`
- Dizi (belgesel dizisi dahil): `archived=0` + **ilk bölüm `watched=1`** → en düşük `(season, episode)` (yayında, `watched=0`), `air_date<=today`.
- Anime: `archived=0` + **ilk bölüm `watched=1`** → en küçük `episode` (`air_at<=now`).
- `in_watched` **filtrelenmez**; öğelere `genres` eklenir (belgesel ayrımı frontend'de).
- Dönüş: `{items:[…], totals:{count,min}}`; sıralama `air_date` desc; önbellek `("next_up", uid, gen(), today_str())`.

### Frontend
- `loadNextUp()` tüm `.nextup-strip`'leri tek fetch ile besler; tür filtresi `data-nextup-kind`.
- Kart: poster + başlık (2 satır clamp) + `S02E05 · 45 dk`; tıklama → `openDetails` / `openAnimeDetails`.
- `refreshListsAfterWatch()` (export) → aktif görünümü tazeler; `app:external-refresh` olayı da bunu çağırır.
- i18n: `nextup_title`, `nextup_min_left` ×14.

### Doğrulama
- Temp-DB birim testi (16/16): ilk-bölüm şartı, `in_watched` dahil, arşivli/film dışta, belgesel + genres, sıralama, boş durum.
- Headless ölçüm: 170×84 = grid kartı, fontlar eşit, 6+2 alt satır ortalanmış, wrap/overflow yok, taşıma + localStorage, boş durumda gizli.
- Ayrıca **bug fix:** `#view-#view-*` → `#view-*` (arşiv anahtarı ↔ satır görünümü çakışması).

---

# 1.85 — .ics takvim aboneliği (yaklaşan + hatırlatıcı)

**Amaç:** Kişiye özel ICS URL → Google/Apple Takvim'e abone; bölüm çıkışları otomatik düşer.

### Token
- `user_settings.tp_calendar_uuid` — mevcut `_get_uuid("calendar")` deseni.

### Uç
- `GET /calendar/<token>/nextep.ics` — public (auth kapısı `/api/*` dışı olduğu için zaten açık; netlik için
  `auth.py` muafiyet listesine açık satır eklenir). Yol `<token>/nextep.ics` (`.ics` uzantı çakışmasını önler).
- İçerik: **bugün ve sonrası** dizi bölümleri + film vizyon + anime bölümleri.
- `VEVENT`: `UID=nextep-<kind>-<id>-<S/E>@nextep`; saat varsa `DTSTART;TZID=<kullanıcı dilimi>`,
  yoksa `DTSTART;VALUE=DATE`; `DTSTAMP`; `SUMMARY` = yapım + `S02E03` + bölüm adı; `DESCRIPTION`.
- **`VALARM`**: yayından **1 gün önce** hatırlatıcı.
- Yeni modül `py/ics.py` — **elle minimal ICS üreteci** (dış paket YOK; Stremio "sıfırdan yaz" felsefesi).

### Frontend
- Üçüncü Parti Apps'a **"Takvim (ICS)"** kartı (Stremio kartı deseni: URL + Kopyala + Yenile + Kes).
- `THIRDPARTY_APPS`'e `{"id":"calendar","name":"Takvim (ICS)","protocol":"ics"}`.
- `_install_url()` içine ICS dalı → `_base_url() + "/calendar/<uuid>/nextep.ics"`.
- `/api/thirdparty/<app>/refresh-uuid|disconnect` **jenerikleştirilir** (`md/stremio.md` §0.13 öngörüsü).
- i18n: kart/etiket anahtarları ×14.

### Doğrulama
- `curl /calendar/<tok>/nextep.ics` → geçerli `VCALENDAR`; Google Takvim'e ekleme denemesi.
- Yanlış token → 404; yalnız yaklaşan olaylar; VALARM var.
- md5 MATCH · servis active · sürüm 1.85 · CHANGELOG TR/EN · faz notu.

---

# 1.86 — Plex + Jellyfin/Emby webhook

**Amaç:** Ev sunucusunda izleyince otomatik "izlendi". Stremio kancasının kardeşi.

### Tokenlar (ayrı, tek tek iptal edilebilir)
- `user_settings.tp_jellyfin_uuid`, `user_settings.tp_plex_uuid`.

### Uç
- `POST /webhook/<app>/<token>` — public; yanlış token → 404.
- **Jellyfin/Emby:** JSON (`NotificationType=PlaybackStop` + `Item.Played`,
  `ProviderIds.{Tmdb,Imdb,Tvdb}`, `ParentIndexNumber`, `IndexNumber`).
- **Plex:** `multipart/form-data` → `payload` JSON (`event=media.scrobble` ≈ %90,
  `Metadata.type=episode|movie`, `grandparentTitle`, `parentIndex`, `index`, `guid`).

### Çekirdek yeniden kullanımı
- `stremio.py` → `_resolve_tmdb`, `_resolve_anime`, `_is_anime_like`, `_tv_branch`, `_anime_branch`,
  `_movie_branch`, `_ensure_tmdb_follow`, `_ensure_anime_follow`.
- Idempotentlik: aynı `stremio_signals` tamponu (`kind|tmdb|anilist|season|episode`) — çift olay tek satır.

### Yazım politikası (varsayılan — build'de teyit)
- Yalnız **"izlendi/finish"** olayı yazar (play/stop yazmaz).
- **"İzlendi sorusu" (Evet/Hayır) tetiklenmez**, doğrudan izlendi yazılır (scrobble = net izlendi).

### Frontend
- Üçüncü Parti Apps'a **"Plex"** ve **"Jellyfin"** kartları (URL + Kopyala + Yenile + Kes).
- Kurulum tarifi: Plex → Ayarlar → Webhooks → URL (Plex Pass gerekir notu);
  Jellyfin → Webhook eklentisi.
- i18n: kart + tarif anahtarları ×14.

### Doğrulama
- `curl` ile sahte Plex (`multipart`) ve Jellyfin (`JSON`) gövdesi → bölüm/film `watched=1`.
- Çift olay → tek satır (dedupe). Yanlış token → 404.
- md5 MATCH · servis active · sürüm 1.86 · CHANGELOG TR/EN · faz notu.

---

## Her sürümde zorunlu adımlar (AGENTS kuralları)

1. **Yedek:** pi `bak/<is>_<ts>/` (+ `db/nextep.db`).
2. **Kod:** pi'de **doğrudan düzenleme YOK** — yerelde düzenle → `scp` → pi.
3. **Kontroller:** `py_compile` · `node --check` · **LINK_TEMIZ** (ESM bağ testi) · temp-DB birim testleri.
4. **Dağıtım:** scp (`VERSION` + `CHANGELOG.md` dahil) → `md5sum` **MATCH**.
5. **Py değişti ise:** `systemctl restart nextep`.
6. **Sürüm:** DB `version` **+** `VERSION` dosyası aynı değere (asla yalnız dosya) → `available:false`.
7. **Not:** `md/faz.md` sonuna kronolojik faz notu (AGENTS.md'ye faz bloğu yazılmaz).
8. **i18n ×14** + `?v=` cache-buster zinciri (eksik zincir = çift bağlama hatası).

## Risk notları
- **Webhook (1.86):** en büyük iş; iki sağlayıcı formatı + test edilebilirlik. Plex Pass şartı belgelenmeli.
- **Scheduler filtreleri (1.83):** 10+ nokta tek tek denetlenmeli; atlanan sorgu "bıraktım"a rağmen bildirim gönderir.
- **ICS (1.85):** kullanıcı dilimi (`TZID`) ve epoch→tarih dönüşümü AGENTS "tek kaynak" kuralına uymalı
  (`dayStrInTz` / `utcDayStr` ayrımı).
- **Cache-buster:** her sürümde zincir bump'ı unutulursa "aç→kapa" / çift dinleyici hataları döner.