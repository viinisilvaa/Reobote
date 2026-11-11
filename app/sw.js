// REOBOTE | app/sw.js — Aplicativo: guarda as telas para funcionar sem internet
// Service worker do aplicativo REOBOTE (escopo /app/): mantém a interface disponível sem internet.
// A API nunca é guardada em cache; os registros offline ficam na fila do próprio aplicativo.
const CACHE = "reobote-app-v7";
const SHELL = [
  "/app/",
  "/app/index.html",
  "/app/manifest.webmanifest",
  "/app/css/app.css",
  "/app/js/config.js",
  "/app/js/app.js",
  "/app/js/vendor/jsQR.min.js",
  "/app/icons/icon-192.png",
  "/app/icons/icon-512.png",
  "/compartilhado/js/theme.js",
  "/compartilhado/js/api-client.js",
  "/compartilhado/assets/reobote-mark.png",
  "/compartilhado/assets/intelbras-logo.png",
  "/compartilhado/assets/rede-americas-logo.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("reobote-app-") && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;

  // Página do aplicativo: tenta a rede primeiro para receber atualizações e usa o cache sem conexão.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          if (response.ok) caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then(cached => cached || caches.match("/app/index.html")))
    );
    return;
  }

  // Arquivos do aplicativo, compartilhados e externos (ícones e fontes): cache com atualização em segundo plano.
  const isStatic = (url.origin === location.origin && (url.pathname.startsWith("/app/") || url.pathname.startsWith("/compartilhado/")))
    || /(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(url.hostname);
  if (!isStatic) return;
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok || response.type === "opaque") {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
