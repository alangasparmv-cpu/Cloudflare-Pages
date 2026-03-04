const CACHE = "lopes-sm-cache-v2.2";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=2.2",
  "./app.js?v=2.2",
  "./manifest.json?v=2.2",
  "./assets/logo-192.png",
  "./assets/logo-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

function isAppAsset(url) {
  // Always update core app assets from network first
  return (
    url.origin === self.location.origin &&
    (url.pathname.endsWith("/app.js") ||
      url.pathname.endsWith("/sw.js") ||
      url.pathname.endsWith("/styles.css") ||
      url.pathname.endsWith("/manifest.json") ||
      url.pathname === "/" ||
      url.pathname.endsWith("/index.html"))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Network-first for app shell assets (prevents old cached JS causing Supabase URL bugs)
  if (isAppAsset(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for other same-origin assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
      )
    );
  }
});
