// Faz 4: Ortak (paylaşılan) değişken durumu.
// Modüller arası canlı durum tek nesnede tutulur; her modül `state.x` ile erişir.

export const state = {
  favGenres: new Set(),
  favActors: new Map(),
  favAnimeChars: new Map(),
  favAnimeGenres: new Set(),

  tmdbGenresCache: null,
  anilistGenresCache: null,

  tmdbKeySet: false,
  currentLang: "tr",
  currentTz: "Europe/Istanbul",
  allTimezones: [],

  sortKey: "added",
  searchMedia: "dizi",
  chips: [],
  pickerMode: "",
  pickerSelected: new Set(),
  settingsLoaded: false,

  // Bildirim Merkezi ayarlari (Faz 22)
  notifTimeFormat: "relative",
  notifCenterPoster: true,
  notifCenterHideRead: false,
  notifCenterLimit: 50,
};