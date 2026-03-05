const CACHE = "lopes-sm-cache-v4.0";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=4.0",
  "./app.js?v=4.0",
  "./manifest.json?v=4.0",
  "./sw.js",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCore(url){
  return (
    url.origin === self.location.origin &&
    (url.pathname.endsWith("/app.js") ||
     url.pathname.endsWith("/styles.css") ||
     url.pathname.endsWith("/index.html") ||
     url.pathname.endsWith("/manifest.json") ||
     url.pathname.endsWith("/sw.js"))
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // network-first for core files (so updates chegam rápido)
  if (isCore(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
