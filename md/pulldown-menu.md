# Pulldown Menü — E-posta Sağlayıcısı (Stil ve Açılır Pencere Dokümanı)

> İnceleme tarihi: 2026-08-24 · Kaynak: pi `/etc/nextep` canlı kod (yerel kopyayla md5 doğrulamalı senkron)
> Sürümler: `style.css?v=343` · `nextep.js?v=348` (settings.js + i18n.js dahil)

## 0. Desenin Uygulandığı Yerler

| Pulldown | Modal | Yapı | Durum |
|---|---|---|---|
| E-posta Sağlayıcısı (`s-email-provider`) | Bildirim Kanalları | select + `#email-provider-list` | ✅ desen kaynağı |
| Uygulama Dili / TMDB Dili (`s-lang`) | Dil ve Zaman | select + `#s-lang-list` | ✅ aynı desen (`initPulldownCombobox`) |
| Liste Önbelleği Süresi (`s-cache-ttl`) | Cache Süresi | select + `#s-cache-ttl-list` | ✅ aynı desen (`initPulldownCombobox`) |
| Zaman Dilimi (`s-tz`) | Dil ve Zaman | yazılabilir arama input'u + `.tz-list` | ✅ pencere/satır stili desende; arama davranışı korunur |

- Yeni select tabanlı pulldown gerektiğinde bu dosyadaki desen birebir kullanılır:
  HTML'de `.provider-combobox` sarmalayıcı + `.provider-list` popup; JS'te
  `initPulldownCombobox(selectId, listId)` çağrısı yeterlidir.
- Zaman Dilimi istisnası: değer yazarak aranabildiği için focus/input ile açılır;
  mousedown-toggle yerine arama davranışı korunmuştur. ESC/dış tık kapatma ve
  turuncu selected dahil diğer her şey desendedir.

## 1. Genel Bakış

Bildirim Kanalları modalindeki **E-posta Sağlayıcısı** pulldown menüsü, tarayıcının native
dropdown'ını KULLANMAZ. Select'e tıklanınca `mousedown` olayı `preventDefault()` ile kesilir
ve yerine **saat seçici penceresi** (`.time-list`) ile birebir aynı stilde özel bir açılır
pencere açılır. Pencere içeriği, select'in kendi `<option>` elemanlarından her açılışta
üretilir — böylece i18n çevirileri otomatik yansır ve seçenek listesi tek kaynaktan yönetilir.

Seçenekler: Brevo API, Gmail, Outlook / Hotmail, Yahoo, Yandex, iCloud, Zoho, Diğer (8 adet).

## 2. HTML Yapısı

`static/index.html` (satır ~322-371):

```html
<div class="channel-frame">                        <!-- diğer kanallarla aynı çerçeve -->
  <label>
    <span class="settings-label-head">
      <span data-i18n="label_email_provider">E-posta Sağlayıcısı</span>
      <span class="saved-hint" data-i18n="saved">Kaydedildi</span>
    </span>
    <div class="provider-combobox">                <!-- position:relative sarmalayıcı -->
      <select id="s-email-provider">
        <option value="brevo"  data-i18n="prov_brevo">Brevo API</option>
        <option value="gmail"  data-i18n="prov_gmail">Gmail</option>
        <!-- ... outlook / yahoo / yandex / icloud / zoho ... -->
        <option value="other"  data-i18n="prov_other">Diğer</option>
      </select>
      <div id="email-provider-list" class="provider-list" style="display:none"></div>
    </div>
  </label>
  <div id="email-provider-frame" class="email-frame" style="display:none">
    <!-- akordeon: Brevo API anahtarı VEYA SMTP alanları + Test butonu.
         Pulldown'a dokununca açılır; çerçevenin İÇİNE gömülü (kendi kenarlığı yok). -->
  </div>
</div>
```

- `<select>` gizli durum taşıyıcısı olarak kalır: tüm mevcut JS (`value` okuma/yazma,
  `change` event'i) aynen çalışır.
- Popup satırları `<button type="button" class="provider-cell" data-value="...">` olarak üretilir.

## 3. Stiller

### 3.1 Select görünümü (kapalı durum)

| Özellik | Değer | Nereden |
|---|---|---|
| Zemin / border / radius | `#171a23` / `1px solid #2a2f3d` / 8px | `.settings-form select` (~1729) |
| Yazı | `#fff`, 0.95rem | aynı |
| Genişlik | `width:100%` (modaldeki diğer öğelerle eş) | `.provider-combobox select#s-email-provider` (~3796) |
| Chevron | `appearance:none` + gömülü SVG ok — renk `#888`, konum `right 10px center`, boyut `14px` | paylaşımlı grup `select#s-lang, select#s-cache-ttl, select#s-email-provider` (~1746) |
| Desktop padding | `12px 30px 12px 14px` (sağda oka yer) | aynı grup |
| Mobil padding | `0 30px 0 16px` (+ genel mobil kural: height 33px) | medya sorgu grubu (~3260) |

Chevron SVG (data URI): `polyline points='6 9 12 15 18 9'`, stroke `%23888`, stroke-width 2.

### 3.2 Aktiflik vurgusu (`.email-lit`, turuncu `#f97316`)

| Eleman | Kural | Yer |
|---|---|---|
| Select | `select#s-email-provider.email-lit { border-color:#f97316 }` | style.css ~3786 |
| Akordeon çerçevesi | `.email-frame.email-lit { border-color:#f97316 }` | style.css ~3782 |

Aktif olma koşulları (`updateEmailFocusUI`, settings.js ~567):
1. Açılır pencere açık (`#email-provider-list` görünüyor), VEYA
2. Odak select'in üzerinde, VEYA
3. Odak akordeon çerçevesinin içindeki bir inputta.

Odak tamamen dışarı çıkınca griye döner.

### 3.3 Açılır pencere (`.provider-list`, saat penceresi stili)

style.css ~3800:

```css
.provider-list {
  position: absolute;
  top: calc(100% + 4px);        /* select'in hemen altında */
  left: 0; right: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  padding: 8px;
  background: #171a23;
  border: 1px solid #2a2f3d;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: none;         /* scrollbar gizli (Firefox/IE) */
}
.provider-list::-webkit-scrollbar { display: none; }
```

Kaynak desen: `.time-list` (saat simgesi penceresi, style.css ~1810) ile aynı zemin/border/
radius/gölge/padding/max-height değerleri.

### 3.4 Satır öğeleri (`.provider-cell`)

style.css ~3823:

```css
.provider-cell {
  display: block;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 0;
  color: #ddd;                    /* normal satır */
  font-size: 0.95rem;             /* select ile aynı — boyutlar korunur */
  cursor: pointer;
}
.provider-cell:hover     { background:#262a36; color:#fff; }
.provider-cell.selected  { background:#f97316; color:#fff; font-weight:600; }  /* turuncu vurgu */
```

## 4. JS Mantığı

`static/js/settings.js`:

| Fonksiyon / blok | Satır | İş |
|---|---|---|
| `renderProviderList()` | ~601 | Option'lardan satır üretir; `selected` sınıfı güncel değere göre |
| `openProviderList()` | ~624 | Render + gösterim + seçili satırı `scrollIntoView({block:"center"})` + aktiflik |
| `closeProviderList()` | ~632 | Gizleme + aktiflik yeniden hesabı |
| select `mousedown` | ~639 | `preventDefault()` (native menü engeli) + toggle |
| select `keydown` | ~644 | Enter/Space → toggle (native engellenir) |
| document `click` | ~650 | Combobox dışına tık → kapat |
| document `keydown` | ~653 | ESC → kapat |
| satır `onclick` | ~609 | Değer ata + `change` event'i tetikle + kapat + odak/aktiflik |

**Seçim sonrası akış (mevcut handler'larla zincir):**
1. `select.value = opt.value`
2. `change` event → kaydetme (`email_provider`, `smtp_preset`, preset host/port) + toast hint
   + `applyEmailProviderUI()` (Brevo/SMTP grup geçişi, app-password hint) + bildirim toggle kontrolü
3. Popup kapanır, select turuncu kalır; akordeon çerçevesi de lit

**İlgili diğer bloklar:** `EMAIL_PRESETS` (~560, preset host/port tablosu) ·
`updateEmailFocusUI` (~567, aktiflik) · akordeon açma listener'ları (~585-597,
`setEmailFrameVisible(true)`: mousedown/focus/change/keydown) · `loadSettings` (~233).

## 5. Bağımlılıklar ve Notlar

- **Tek kaynak ilkesi:** Seçenek metinleri `<option data-i18n>` üzerinden yönetilir;
  popup her açılışta option'lardan yeniden üretilir → dil değişimi otomatik yansır.
- **Akordeon:** `#email-provider-frame` sağlayıcı çerçevesine GÖMÜLÜdür (kendi kenarlığı
  yok, `.channel-frame > div` flex/gap kurallarını paylaşır); sadece pulldown'a dokununca açılır.
- **Mobil:** Genel mobil select kuralı (height 33px, width %100) + chevron grubundaki
  padding override uygulanır; popup genişliği combobox'ı takip eder.
- **Erişilebilirlik:** Klavye ile Enter/Space açar, ESC kapatır; satırlar gerçek `<button>`.
- **Sürümler:** CSS değişikliğinde `style.css?v=` bump, JS değişikliğinde `nextep.js?v=`
  bump gerekir (statik dosyalar restart istemez).
- **İlgili yedekler (pi `/etc/nextep/bak/`):**
  - `20260823_230921` — ilk özel popup uygulaması öncesi
  - `20260823_233422` — genişlik/aktiflik düzeltmeleri öncesi
  - `20260823_234123` — akordeon gömme öncesi
  - `20260824_000659` — chevron stil birleştirmesi öncesi
  - `20260824_001640` — desenin s-lang / s-cache-ttl / tz-list'e uygulanması öncesi
