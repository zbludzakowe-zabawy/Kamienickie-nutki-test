/* Kamienickie Nutki – service worker (działanie offline).
 * Przy publikacji (workflow publikacji → tools/build-sw.mjs) VERSION
 * dostaje skrót wszystkich plików, a ASSETS ich pełną listę. Nowa wersja czeka,
 * aż użytkownik stuknie „Odśwież” – bez niespodziewanych przeładowań. */
const VERSION = 'aeda927aa458';
// Wersja testowa (podfolder test/) podmienia przedrostek na 'test-kamienickie-nutki-' (tools/build-test.mjs) –
// ten sam adres = wspólne schowki, a każdy service worker przy aktywacji kasuje stare schowki ze swoim przedrostkiem.
const PREFIX = 'test-kamienickie-nutki-';
const CACHE = `${PREFIX}${VERSION}`;
// Podfoldery z osobną aplikacją (wersja testowa) – ten service worker ich nie obsługuje.
const SKIP = ['test/'].map((p) => new URL(p, self.registration.scope).pathname);
const ASSETS = [
  "./",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./js/app.js",
  "./js/catalog.js",
  "./js/config.js",
  "./js/crypto.js",
  "./js/datamerge.js",
  "./js/drive.js",
  "./js/dups.js",
  "./js/guest.js",
  "./js/matcher.js",
  "./js/mode.js",
  "./js/noteview.js",
  "./js/pdfbuild.js",
  "./js/preview.js",
  "./js/progimport.js",
  "./js/programs.js",
  "./js/publish.js",
  "./js/pwa.js",
  "./js/reports.js",
  "./js/songlist.js",
  "./js/songs.js",
  "./js/store.js",
  "./js/vendor/pdf-lib.LICENSE.md",
  "./js/vendor/pdf-lib.min.js",
  "./js/vendor/pdfjs.LICENSE",
  "./js/vendor/pdfjs.min.js",
  "./js/vendor/pdfjs.worker.min.js",
  "./js/works.js",
  "./js/zip.js",
  "./manifest.webmanifest",
  "./style.css"
];

self.addEventListener('install', (event) => {
  // `cache: 'reload'` omija pamięć HTTP, żeby nowa wersja nie zapisała starych plików
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (SKIP.some((p) => url.pathname.startsWith(p))) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      return fetch(req);
    }),
  );
});
