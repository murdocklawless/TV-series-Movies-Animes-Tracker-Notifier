# Yedekleme Düzeltmeleri — 6 madde (079f51c, pi v=376)

| # | Düzeltme | Nasıl |
|---|----------|-------|
| 1 | Database Yedekle / Herşeyi Yedekle + on/off aynı satırda | Her satır `notify-row` (`style.css:1563` `space-between`) — label sola, switch sağa aynı hizada, 2 satır alt alta, biri açılırsa diğeri kapanır |
| 2 | Rsync akordeonu kutular (SSH Key hariç) TMDB stili | `settings-form label input` (`style.css:1848` `12px 14px` `#171a23` `#2a2f3d` `8px`) — `#s-tmdb` ile birebir |
| 3 | Samba akordeonu kutular TMDB stili | Aynı — `style.css:1848` ile birebir |
| 4 | Yedekle butonu navbar `tab` hover | `class="tab"` (`style.css:148` `transparent` → `hover rgba(249,115,22,.3)` `#f97316`) |
| 5 | `Şimdi Yedekle` → `Yedekle` | `static/js/i18n.js:252` `backup_now` tr `Yedekle` / en `Backup` ×14 |
| 6 | `Geri Yükle` eklendi | `Yedekle` sağına `backup_restore` ×14, `class="tab"` `flex gap:12px`, `POST /api/backup/restore` stub + `static/js/settings.js` handler |
