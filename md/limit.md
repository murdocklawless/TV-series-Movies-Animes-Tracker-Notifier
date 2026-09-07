# Faz Planı — API Hız Göstergesi + Jeton Kovası (limit.md)

> Durum: CANLI (2026-09-07, sürüm 1.51) — pi `/etc/nextep` üzerinde aktif.
> Kapsam: gözlem (rate monitor) + hız sınırlama (token bucket). TVmaze'e kova yok.

## 1. Amaç

- Admin modalında TMDB / AniList / TVMaze dış isteklerinin **canlı doluluk barları** + **son 1 saat pik çizgisi**.
- Sağlayıcı limitlerinin altında kalmak için **jeton kovalı hız sınırlama** (TMDB 30/10 sn, AniList 70/dk) + `429 + Retry-After` yedeği.
- Ağ davranışı dışında hiçbir işlev değişmez; bildirim/senkron mantığına dokunulmaz.

## 2. Mimari kararlar (kilitli)

| Karar | Değer | Gerekçe |
|---|---|---|
| Boğaz noktaları | `tmdb_request()`, `anilist_query()`, TVmaze `singlesearch` çağrısı | Tüm dış trafik zaten bu 3 noktadan geçer; başka yere dokunmaya gerek yok |
| Kova modeli | Damlatan kova (token bucket), kapasite dolu başlar | Sabit 10 sn pencereler sınır-tiklemesi yapar; kova patlamayı pürüzsüz yayar |
| Limitler (tek yerden ayarlı) | TMDB: kapasite 30, dolum 3/sn · AniList: kapasite 70, dolum 70/60 sn | Sağlayıcı limitinin altında %20-25 pay (40/10 sn, 90/dk) |
| TVmaze kovası | YOK | Sıralı çağrı + 6 saat ortak önbellek + tek verimli istek; burst kurulamaz |
| Kuyruk modeli | Kullanıcı-kuyruğu YOK; servis başına tek global kova | Jeton biterse thread kısa bekler, istek düşmez; FIFO'ya yakın geçiş |
| 429 yedeği | `Retry-After` saygısı + bir kez tekrar (tavan ~120 sn), sonra mevcut fail-soft (`None`) | Kovadan kaçan + aynı IP'deki yabancı trafik için son sigorta |
| Restart davranışı | Kovalar dolu başlar; kayıt kuyrukları boş başlar (pik gün içinde yeniden birikir) | Kalıcı kuyruk tablosu yok, gerek de yok |
| Bar metriği | Pencere içi istek / öz-limit: TMDB 10 sn-30, AniList 60 sn-70, TVMaze 10 sn-20 | Bar dolarsa kova tavanına değilmiş olunur, sağlayıcı limitine değil |
| Pik metriği | Gün-içi maksimum pencere doluluğu (dakika-kovalı tarama, poll anında; pi yerel tarihi, gece yarısında sıfırlanır) | Ek arka-plan işi yok |
| Kayıt kuralı | Yalnız gerçek HTTP anında (önbellek isabeti sayılmaz; TVmaze'de yalnız ıska) | Bar kotayı gösterir, uygulama içi önbelleği değil |

## 3. Backend

### 3.1 `py/rate_track.py` (yeni, küçük modül)

- `threading.Lock` korumalı 3 kova (kapasite, jeton, son-dolum zamanı) + 3 timestamp kuyruğu (`collections.deque`).
- `acquire(service)` — jeton varsa düşer ve döner; yoksa bir sonraki doluma kadar kısa uyuyup tekrar dener (çağıranı bloklar, isteği düşürmez).
- `record(service)` — mikrosaniyelik `append`; akışı bekletmez.
- `handle_429(service, response)` — `Retry-After` (yoksa 60 sn, tavan 120 sn) uyur, `True` dönerse çağıran bir kez tekrar dener.
- `snapshot()` — `{tmdb: {pct, peak, hits}, anilist: {...}, tvmaze: {...}}` döndürür (yalnız RAM okur).

### 3.2 Kayıt/kovalama çağrıları (her dosyada tek satır)

- `py/tmdb.py` → `tmdb_request()`: istekten önce `acquire("tmdb")`, 429'da `handle_429` + bir tekrar, giden istekte `record("tmdb")`.
- `py/anilist.py` → `anilist_query()`: aynı desen (`acquire("anilist")` + `record("anilist")`).
- `py/tvmaze.py` → `_tvmaze_episode_times()`: yalnız önbellek ıskasında `record("tvmaze")`; kova yok.

### 3.3 `GET /api/admin/rate` (`py/routes/auth.py`, `@admin_required` emsaliyle)

- `snapshot()` sonucunu aynen döndürür; dış istek yapmaz, maliyeti sıfır.

## 4. Frontend (admin modalı)

### 4.1 Konum — `static/index.html`

- Üyeler çerçevesinin üstüne aynı boy `.channel-frame` (başlık + `<div id="admin-rate-bars">`). Boyut otomatik aynı, CSS işi yok.

### 4.2 Satır çizimi — `static/js/auth.js` + `static/css/style.css`

```
TMDB · Anlık %75 · Pik %90
[///////////////|░░░░░░░░░░]   (çizgili yeşil dolgu = Anlık%, kırmızı çizgi = Pik%)
```

- Etiket satırı (tek satır, `.7rem`): `TMDB` / `AniList` / `TVMaze` (`#aab`) + orta-nokta `·` ayraçlar + `Anlık` (`#22c55e`) + `Pik` (`#ef4444`, tooltip'li).
- Yüzde konumu locale'e göre: `tr` öne ekler (`%75`), diğer diller sona ekler (`75%`).
- Dolgu yeşil çizgili: `repeating-linear-gradient(90deg, #22c55e 0 1px, transparent 1px 2px)`, genişlik = Anlık%.
- Pik çizgisi kırmızı 2px (`left: calc(pik% - 1px)`); pik %0 ise çizilmez.
- `Pik` metninde tooltip (`rate_peak_tip`, `[data-tip]` mekanizması, ek CSS yok).
- Canlılık: modal açıkken **1 sn** poll (`armAdminRefresh` ikizi timer; kapanınca durur). Dolgu `width` geçişli → sorgu patlamasında soldan sağa akış izlenir.

### 4.3 Önbellek kırma (cache-bust zinciri)

- İç modül import'larında `?v=` yoksa giriş `?v=` bump'ı iç modül cache'ini kırmaz (canlıda görüldü: başlık geldi, barlar gelmedi).
- Kural: değişen modülün **tüm import noktaları** (statik + dinamik `import()`) aynı `?v=`'yi taşır (`auth.js` + `i18n.js` → 11 nokta).
- Kapı testi: çıplak `"./auth.js"` / `"./i18n.js"` sayısı = 0.

### 4.4 i18n — `static/js/i18n.js`

- 4 yeni anahtar (`admin_rate_title`, `rate_now`, `rate_peak`, `rate_peak_tip`) ×14 dil. Servis adları özel isim, çevirisiz. Yüzde konumu locale'e göre JS'te (`ratePct`: tr önek, diğerleri sonek).

## 5. Test (uygulama günü)

- Kova matematiği (sahte saatle): dolum hızı, tavan, bekleme-sıfır-düşürme, gece-yarısı sıfırlama.
- Kayıt → `snapshot()` (bar% + pik%) tutarlılığı; önbellek isabetinin sayılmadığı.
- Uç şekli (`admin_required`, 401/403 kapıları).
- `py_compile` + `esmcheck_all` 11/11 + i18n anahtar kapsama (14 dil) + çıplak-import kapısı (0).
- Render: etiket satırı formatı, pik-div var/yok, tooltip attr, locale-% (canlı console deneyleriyle teyit).
- Canlı: barların yükselip pik çizgisinin tavanda sabitlendiği gözle teyit; journal temiz; md5 MATCH.

## 6. Dağıtım (uygulama günü)

1. Pi yedeği (`bak/limit_<ts>/` + DB).
2. scp: `py/rate_track.py` (yeni), `py/tmdb.py`, `py/anilist.py`, `py/tvmaze.py`, `py/routes/auth.py`, `static/js/auth.js`, `static/js/i18n.js`, `static/css/style.css`, `static/index.html` (+ `VERSION`/`CHANGELOG`).
3. `py_compile` (pi venv) → `systemctl restart nextep` (py değişikliği var).
4. Doğrulama: `/api/admin/rate` şekli, modalda 3 bar, journal temiz.

## 7. Kilitli kabuller

- Limitler tek yerden (`rate_track.py` başı) ayarlanır.
- Ağ davranışı dışında işlev değişmez; bildirim/senkron/tavsiye mantığı aynen.
- Kalıcı kuyruk tablosu yok; kullanıcı önceliği/rezervasyon yok (FIFO'ya yakın geçiş).
- Kova + monitor birbirinden bağımsız çalışır; barlar kovanın denetçisidir, önşartı değil.
