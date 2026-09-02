# TV Planı — NextEp Android TV 14 WebView Kiosk (Kilitli)

**Tarih:** 2026-08-31
**Durum:** Plan kilitlendi, yarın Faz 1’den başlanacak
**Hedef:** Pi’de koşan mevcut web (`py/nextep.py:37`, `static/index.html:5`, `static/css/style.css:1` `#0f1117/#171a23/#f97316`) Android TV 14’te tek pencereli WebView ile %100 kumanda ile çalışsın. APK `C:\NextEp-Tv` (`build.gradle.kts:7` `com.nextep.tv`, `minSdk 23`, `targetSdk 34`).

---

## Kilitli Kararlar

1. **Bağlanma A — sadece Done/Bağlan ile** `MainActivity.kt:114` `LaunchedEffect(ip,port)` otomatik tetik kalkıyor. Sadece `ImeAction.Done` veya Port altındaki **Bağlan** butonu (ortalanmış, `enabled = isFullIpv4(ip) && port 1..65535`) ile `http://IP:Port`. Her rakamda siyah ekran biter. Buton Port kutusunun altına ortalanacak (kart `480dp` içinde `56%` genişlik, `48dp` yükseklik, `8dp` radius, aktif `border #f97316`).
   - **14 dil APK içinde:** `values/strings.xml` (default `en` fallback) + `values-tr/en/de/fr/es/it/ru/ar/pt/nl/pl/ja/ko/zh-rCN/strings.xml` her biri `button_connect=Bağlan/Connect/Verbinden/Connecter/Conectar/Connetti/Подключиться/اتصال/Conectar/Verbinden/Połącz/接続/연결/连接` (`static/js/i18n.js` 14 dil master). `MainActivity.kt:195` hardcoded 10 metin `stringResource` olacak. WebView’a `?lang=` + `localStorage` ile TV dili aktarılır, web kendi çevirisini kullanır — APK sadece shell çevirir.

2. **Info = desktop bilgi modalı** Sağ alt `tv-info-btn` (`index.html:841`) `position:fixed bottom:max(24px,5%+safe-area) right:same 56x56 z-index:60` sadece `.is-tv`’de görünür, modal açıkken gizli. Tık / `keydown Enter` odaklı kartı al (`views.js:246` `dataset.mediaType/tmdbId/anilistId`) -> `components.js:340` `openDetails` / `585` `openAnimeDetails` aynısını açar.

3. **A — takvim ayrı odak kalsın** `views.js:281` `calendar-btn` kartta direkt ayrı `tabIndex=0`, `style.css:656` `card:focus-within` ile görünür, `keydown Enter -> openReleases (15)` / `openAnimeSchedule (618)`. x/ban/taşı da ayrı odak korunur — info’ya rağmen tam D-pad.

---

## APK Kimlik Hibrit (1+2)

- `MainActivity.kt:248` `WebViewContainer` factory içinde:
  - `A) settings.userAgentString += " NextEpTV TV"` — ilk istekten server + erken JS `navigator.userAgent.includes("NextEpTV")`.
  - `C) addJavascriptInterface(TvBridge(),"NextEpTV")` + `keepRules:10` keep — web’de `window.NextEpTV.isTv()===true` kesin. Hibrit skor `UA || bridge`.
- `AndroidManifest.xml:29` `windowSoftInputMode="adjustResize"` + `network_security_config.xml` cleartext korunur.

## TV Algı

`tv.js` yeni `isAndroidTV()` triple: UA `AFT/BRAVIA/wv/NextEpTV` + `matchMedia (hover:none & pointer:coarse & min-width:960)` + `maxTouchPoints==0` + `?tv=1` debug. `html.is-tv` class tak.

---

## Fazlar

**Faz 1 — İskelet + siyah/klavye/Port kesilme (1 gün):** `MainActivity.kt:183` `Box imePadding + Column verticalScroll + bringIntoViewRequester`, `InputField:238` `hide()+clearFocus()` `onDone`, `adjustResize`, `isFullIpv4` regex `^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(...)$`, `Bağlan` butonu ortada, hibrit kimlik. Web’e dokunulmaz.

**Faz 2 — Kart grid odak (2 gün):** Her generator `views.js:246/372/482/517/547/625/654/690/872` + `search.js:211/274/436` + `components.js:449` `div.tabIndex=0 role=button aria-label` + `keydown Enter/Space/Center->div.click()`, butonlar `tabIndex=0` + ayrı `keydown`. CSS sadece `.tv-mode .card:focus-visible` ve `.tv-mode .card:focus-within` (`style.css:264/656` hover aynısı), desktop `@media (hover:hover)` izole.

**Faz 3 — Modal stack + Back (1.5 gün):** `tv.js` LIFO `pushModal/popModal`, her `openDetails/openReleases/.../showConfirm` stack’e koy, ilk focusable’a `focus()`, global `keydown Escape|Back(4)|GoBack|BrowserBack|461` en üsttekini kapatır. `notification.js:158` bildirim, `views.js:154` sort, `settings.js:603` settings aynı.

**Faz 4 — Pulldown/time/search (1 gün):** `settings.js:66` `initPulldown/initTz/initTimePicker` `DPAD_CENTER(23)` ekle, `ensureModalRoom` TV’de `max-height:50vh`.

**Faz 5 — Info + TV algı (0.5 gün):** `index.html:841` buton, `style.css` `z-index:60`, `tv.js` odaklı kart -> `openDetails`.

**Faz 6 — Doğrulama 1080p (0.5 gün):** `adb shell input keyevent 19/20/21/22/23/4` kart->takvim->x->modal, `Back` zinciri, `pm clear` sonrası SetupCard merkezde ve Tab Port’u kesmiyor, `10.0.2.2` / `192.168.2.11:8050` ile WebView.

---

## Dosya Bağlantı

- APK: `C:\NextEp-Tv\app\src\main\java\com\nextep\tv\MainActivity.kt`, `AndroidManifest.xml`, `themes.xml/colors.xml/drawable`, `keepRules`, `build.gradle.kts`, `res/values-xx/strings.xml` (14 dil), `res/xml/locales_config.xml`
- Web: `tv.js` (yeni) + `views.js`/`search.js`/`components.js`/`notification.js`/`settings.js` yama + `style.css` ek + `index.html` info butonu. `py/*` değişmez.

## Doğrulama

- Klavye: IP’ye `●` -> turuncu border, `Tab` Port kesilmeden görünür, `Done` -> klavye kapanır odak `Bağlan`’a gider, tıklayınca `http://IP:Port` yüklenir, siyah tek kare.
- D-pad: kartlarda `Arrow` gezme turuncu halka, `OK` kart->info, takvim ayrı odak->releases, x->confirm, bildirim/ayar menüler `ArrowDown/Up`.
- Dil: TV dili `de-DE` -> `Bağlan` `Verbinden`, `ar` RTL, fallback `en`.

## Sonraki Adım

Yarın Faz 1’den başla, APK `adb install -r app-debug.apk` ile `nextep-tv` emülatörde ve gerçek TV’de doğrula. Plan dosyası `.opencode/plans/tv-nextep-full.md`’de detaylı kopya duruyor.
