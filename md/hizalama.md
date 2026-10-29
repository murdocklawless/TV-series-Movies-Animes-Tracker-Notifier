# Hizalama / `|` düzeni — Kartları İçe Aktar + Aktarımı Geri Al

> Son güncelleme: 29/10/2026 (sürüm 2.24.6). Bu dosya, iki modalın istatistik bloklarını
> **dizi satır görünümüyle aynı** biçimde çizmek için gereken her şeyi içerir.

## 1. Kapsam

Etkilenen iki yüzey (ikisi de `settings.js` → `impRowsHTML()` kullanır):

| Yüzey | Kapsayıcı | Not |
|---|---|---|
| Kartları İçe Aktar (önizleme) | `#cards-import-stats.cards-imp` | HTML'de statik |
| Aktarımı Geri Al (özet) | `#cards-undo-text` | JS `className = "cards-imp"` atar |

Referans / hedef görünüm: **dizi satır görünümü** (`.poster-grid.row-mode`, `rowview.js`).

Hedef çıktı:
```
83 Kart | 0 Yeni     | 83 Mevcut
44 Dizi | 1499 Bölüm | İzlenmiş 859 Bölüm (858:08) | İzlenmemiş 640 Bölüm (515:26)
32 Film | 32 Bölüm   | İzlenmiş 19 Bölüm (40:21)   | İzlenmemiş 13 Bölüm (24:57)
7 Anime | 140 Bölüm  | İzlenmiş 12 Bölüm (4:48)    | İzlenmemiş 128 Bölüm (46:48)
```
- `|`'ler kolonlara göre **alt alta hizalı**
- Kolon genişliği = **o kolonun en uzun metni**
- Boru çevresinde **oransal** boşluk (`0.625em`), padding/margin karışımı yok

## 2. Referans: satır görünümü CSS'i (`static/css/style.css` ~7122-7152)

```css
.poster-grid.row-mode { display: table; width: 100%; table-layout: auto; font-size: 0.8rem; }
.poster-grid.row-mode .wcell {
  display: table-cell; vertical-align: bottom; white-space: nowrap;
  padding: 6px 0; border-bottom: 1px solid #262a36;
  font-weight: 600; text-align: left;
}
.poster-grid.row-mode .wcell + .wcell:not(.wc-spacer):not(.wc-actions)::before {
  content: "|"; color: #f97316; margin: 0 8px; font-weight: 400;
}
.poster-grid.row-mode .wcell.wc-spacer { width: 100%; border-bottom: none; padding: 0; }
```

Kritik nokta: `.wc-spacer { width: 100% }` — satırın artan genişliğini **yutar**, veri kolonlarının
şişmesini engeller. Bu hücre olmadan tablo kapsayıcıya gerilir ve kolonlar dağılır.

## 3. Neden modalda tutmuyordu (kök nedenler)

1. **Flex gerilmesi:** `#cards-import-stats` bir `.channel-frame` öğesidir
   (`.channel-frame { display:flex; flex-direction:column }` → `align-items: stretch`).
   Tablo, kapsayıcı genişliğine **gerilir**.
2. **`table-layout: auto` + spacer yokluğu:** artan genişlik kolonlara dağıtılır →
   boru önlerinde 4-8 karakterlik ekstra boşluk ("olmuyor" şikâyetinin asıl nedeni).
3. **Ayrı pipe hücresi:** eski `display:grid; repeat(7,auto)` + `&nbsp;|&nbsp;` yaklaşımı
   hizalamayı ve boşluğu birlikte tutturamaz (pipe kendi kolonunu açar).
4. **`text-align: right`** (`.is-piped`) denenmesi: boşluğu borunun solundan **sağına** taşır —
   yine yanlış (2.24.0 → 2.24.1'de geri alındı).

## 4. Doğru kurulum (2.24.6'da çalışan hâl)

### 4.1 HTML — `static/js/settings.js` → `impRow(cells)`

```js
function impRow(cells) {
  const arr = cells.slice();
  while (arr.length < 4) arr.push("");          // tüm satırlar 4 hücre → kolonlar birebir hizalı
  const row = arr
    .map((c) => `<span class="cards-imp-cell${c ? "" : " is-empty"}">${c ? escAttr(c) : ""}</span>`)
    .join("")
    + `<span class="cards-imp-spacer"></span>`;  // fazla genişliği yutar (satır görünümündeki .wc-spacer)
  return `<div class="cards-imp-row">${row}</div>`;
}
```

Kurallar:
- Her satır **4 hücreye** tamamlanır (boş olanlar `is-empty`) → bütün satırlar aynı kolonlara oturur.
- Satır sonuna **her zaman** spacer eklenir.
- `|` HTML'de **yazılmaz**; CSS `::before` üretir (satır görünümüyle aynı teknik).
- Hücre sayısı değişirse (`typeRow` yeni alan eklerse) `arr.length < 4` sayısı da güncellenir.

### 4.2 CSS — `static/css/style.css` (~5809-5853)

```css
#cards-import-stats.cards-imp,
#cards-undo-text.cards-imp {
  display: table;
  table-layout: auto;
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 2px;
  font-size: 0.68rem;        /* satır görünümü 0.8rem → burada KÜÇÜK */
  font-weight: 500;
  color: #fff;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;          /* yatay scrollbar yok */
  max-width: 100%;
}
.cards-imp-row  { display: table-row; }
.cards-imp-cell {
  display: table-cell;
  vertical-align: bottom;
  white-space: nowrap;
  color: #fff;
  font-weight: 500;
  padding: 0.47em 0;         /* 6px @0.8rem → oransal */
}
.cards-imp-cell + .cards-imp-cell::before {
  content: "|";
  color: #F97316;
  margin: 0 0.625em;         /* 8px @0.8rem → oransal (≈6.8px @0.68rem) */
  font-weight: 400;
}
.cards-imp-spacer { display: table-cell; width: 100%; padding: 0; }
.cards-imp-cell.is-empty::before { content: none; }
```

Mobil media query'de (`max-width: 600px`) kapsayıcı **`display: table`** kalmalı
(eski `display: grid` satırları bozar), `font-size: 0.62rem`, `overflow-x: auto`.

## 5. Boşluk matematiği (oransal ölçek)

| Satır görünümü (0.8rem = 12.8px) | em karşılığı | Modal (0.68rem = 10.88px) |
|---|---|---|
| `margin: 0 8px` | `0.625em` | ≈ **6.8px** |
| `padding: 6px 0` | `0.47em` | ≈ **5.1px** |

**Kural:** font küçültülünce px değerleri elle düşürülmez; **em** kullanılır (orantı korunur).

## 6. YAPILMAMASI gerekenler (denenip yanlış bulundu)

- `::before`'a `margin: 0 8px` → modal fontunda (0.68rem) **orantısız büyük** görünür.
- `content: "\00A0|\00A0"` (NBSP) + ayrıca margin → çift boşluk; "1 karakter" ile "margin" birlikte kullanılmaz.
- `text-align: right` / `.is-piped` → boşluk borunun sağına kayar.
- `display: grid; repeat(7, auto)` + ayrı `.cards-imp-pipe` hücresi → hizalama + boşluk birlikte tutmaz.
- **Modal genişliğini değiştirmek** (`max-width: 560px`) — kullanıcı talimatı: yasak.
- Hücreye `padding`/`margin` ile boşluk vermek: boşluk **yalnız** `::before` margin'inden gelir.
- `|`'yi `::before` yerine ayrı hücre/eleman yapmak (tablo düzeni bozulur).

## 7. Değişiklik sonrası zorunlu adımlar

1. `node --check static/js/settings.js`
2. `python py/jsver.py bump` (JS zinciri) → `python py/jsver.py check`
3. `style.css?v=` elle bump (`static/index.html`, `<link rel="stylesheet" href="/static/css/style.css?v=N">`)
4. `python py/eol.py check` → **OK** değilse scp **yapılmaz**
5. scp: `static/js/*.js`, `static/index.html`, `static/css/style.css` → `/etc/nextep/static/...`
6. Doğrulama: md5 yerel = pi (3/3), `curl 'http://127.0.0.1:8050/static/css/style.css?v=N'` → 200
7. Tarayıcıda **Ctrl+F5**; build no + `style.css?v=` kontrol edilir (statik → servis restart gerekmez)

## 8. Teşhis (ekran görüntüsü yoksa / "olmuyor" deniyorsa)

Modal açıkken F12 → Console:

```js
["cards-import-stats", "cards-undo-text"].forEach((id) => {
  const e = document.getElementById(id);
  if (!e) return console.log(id, "YOK");
  const cs = getComputedStyle(e);
  const c = e.querySelectorAll(".cards-imp-cell");
  console.log(
    id,
    "display:", cs.display,
    "| font:", cs.fontSize,
    "| hücre:", c.length,
    "| padding:", c[0] && getComputedStyle(c[0]).padding,
    "| pipe margin:", c[1] && getComputedStyle(c[1], "::before").margin,
    "| pipe content:", c[1] && getComputedStyle(c[1], "::before").content
  );
});
```

Beklenen çıktı: `display: table` · `font: 10.88px` · `hücre: 4` · `padding: 5.1px` · `pipe margin: 6.8px`.

> Not: `|` bir `::before` sözde elemanıdır → DOM'da **seçilemez**, Ctrl+C ile **kopyalanmaz**.
> Bu yüzden yapıştırılan metinde boşluk görünmez; ölçüm **computed style** ile yapılır.

## 9. Sürüm geçmişi (bu konu)

| Sürüm | Deneme | Sonuç |
|---|---|---|
| 2.23.5 | Geçmiş satırı ortalama, geri al pipe şeması | çalıştı |
| 2.23.6 | `#cards-undo-text.cards-imp` grid seçicisi | dikey yığılma düzeldi |
| 2.23.7 | `margin: 0 8px` (satır görünümü değeri) | orantısız |
| 2.23.8 | `padding: 0 0.25em` | yanlış referans |
| 2.23.9 | `&nbsp;|&nbsp;` karakter boşluğu | hizalama kayboldu |
| 2.24.0 | `text-align: right` (`.is-piped`) | boşluk sağa kaydı |
| 2.24.1 | sağa yaslama geri alındı | kolonlar şişti |
| 2.24.2 | gerçek tablo (`display: table`) | yapı doğru, boşluklar şişkin |
| 2.24.3/4/5 | margin 2px / 0.8rem / em oranları | hâlâ şişkin |
| **2.24.6** | **`width:100%` spacer + em boşluk** | **çalışan sürüm** |
