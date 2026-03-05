// ===== Lopes Serviços Mecânicos - Service Worker =====
const CACHE = "lopes-sm-cache-v4.1";

// Arquivos "core" que queremos garantir (offline + update rápido)
const CORE = [
  "./",
  "./index.html",
  "./styles.css?v=4.1",
  "./app.js?v=4.1",
  "./manifest.json?v=4.1",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE))
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

// Detecta arquivos principais (mesmo com querystring ?v=)
function isCoreRequest(url){
  if(url.origin !== self.location.origin) return false;
  const p = url.pathname;

  return (
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith("/app.js") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/manifest.json") ||
    p.endsWith("/sw.js")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 1) Navegação (abrir o app): NETWORK-FIRST
  // Isso evita abrir "versão antiga" quando existe internet.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match("./index.html");
          return cached || caches.match("./") || new Response("Offline", { status: 503 });
        })
    );
    return;
  }

  // 2) Arquivos core: NETWORK-FIRST (atualiza rápido)
  if (isCoreRequest(url)) {
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

  // 3) Demais arquivos: CACHE-FIRST (rápido e funciona offline)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      });
    })
  );
});
