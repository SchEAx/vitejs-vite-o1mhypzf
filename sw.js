const CACHE_NAME = "garage-pro-v1";
const urlsToCache = ["/", "/index.html", "/manifest.json", "/logo.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.url.includes("/api/")) return;
  event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
});
