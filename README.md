# Watchlist Tracker — TV · Movies · Anime

A personal media tracking web app that lets you follow TV series, movies and anime,
get notified when new episodes or releases come out, keep track of what you have
and haven't watched, and receive personalized recommendations.

Built with Flask + SQLite on the backend and a lightweight vanilla-JS frontend.
Metadata is provided by [TMDB](https://www.themoviedb.org) (series & movies),
[AniList](https://anilist.co) (anime) and TVMaze (episode air times).

---

## Features

### Media tracking
- Separate views for **Series**, **Movies** and **Anime** you follow.
- Poster cards show rating, network/studio, show status (Ended, Canceled, In Production, next season date…) and the next upcoming episode with a countdown of remaining days.
- **Unwatched** view groups everything that has new episodes waiting for you; **Watched** view archives finished shows.
- Section order in these views can be rearranged with arrow buttons and is remembered per browser.

### Episode tracking
- Every followed title has an episode calendar. Episodes that **haven't aired yet are locked** — you can only mark episodes that have actually been released.
- Season progress bars count only aired episodes, so percentages stay honest.
- "Mark all watched" marks only episodes that already aired; future episodes are never touched.
- The Unwatched list uses a **sequential watch lock**: you can only check off the next unwatched episode, so you never lose track of where you left off (already-watched entries can always be unchecked).
- Anime episode lists work the same way: an episode unlocks only when it has aired *and* the previous one was watched.

### Marking as watched
- A finished series, anime or released movie can be moved to the Watched view with one button — all its episodes are marked as watched automatically.
- Items can be moved back to the active lists at any time.
- If a "watched" series suddenly gets a new episode, it automatically drops back into your active tracking.

### Search & smart filters
- Quick search for series, movies and anime by title.
- Multi-filter search combines **media type, actor/character, genre, year and score** — combined genres like "Action & Adventure" resolve correctly for both movies and series.
- Tap any cast member to see their other works and follow them directly.

### Personalized recommendations
- A Recommendations view suggests 18 titles per section (series / movies / anime), based on your favorite genres — or, if you haven't picked any, on the genres of what you already follow.
- Rotation ensures the same card doesn't come back right away; refreshing a section brings in fresh picks.
- Cards can be added to tracking, moved straight to Watched (when the title qualifies), or **hidden permanently** with the "don't show again" button. Hidden titles never return — not after restarts, nightly refreshes, or profile changes — unless you restore them from the Hidden panel, which also includes live search.

### Notifications
- Three independent channels: **Telegram**, **ntfy** and a built-in **notification center** in the web UI.
- 20 notification types grouped per media:
  - Series: episode airing today, season start, planned / in production / ended / canceled status changes, upcoming season, bulk-unwatched reminder, rating milestones.
  - Movies: theatrical release today, rescheduled date, platform change.
  - Anime: episode airing today, hiatus, cancellation, completion, start of broadcast, episode-count change.
- Each type can be toggled per channel; test messages can be sent from Settings.
- The notification center keeps a history with thumbnails, read/unread state, mark-all-read and cleanup.

### Settings
- **14 interface languages**, also used for TMDB metadata, plus timezone selection.
- Favorite actors, characters and genres feed both search filters and recommendations.
- Configurable schedules for episode sync, genre refresh, data refresh and notification checks.
- Adjustable list cache duration (off → 24 h); your own actions always reflect instantly.

### Interface
- Custom tooltips, toasts and confirmation dialogs; ESC / outside-click closes modals.
- Fully responsive: icon-only navigation and touch-friendly cards on mobile, three-column desktop layout.
- Posters are stored locally once downloaded, so lists load fast and work even when TMDB/AniList are unreachable.
- Smart caching with instant invalidation: restarts don't lose cached data, and every API response reports its cache status (`X-Cache` header).

---

## Tech Stack

Flask · SQLite · APScheduler · vanilla JavaScript (ES modules) · Font Awesome
Data sources: TMDB API · AniList GraphQL · TVMaze
