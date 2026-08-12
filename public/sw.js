const CACHE_NAME = "zdr-portal-v1";
const STATIC_ASSETS = ["/logo.png", "/logo.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // Never intercept the app, APIs, or third-party session/storage traffic.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/portal")) return;
  if (url.hostname.includes("supabase.co") || url.hostname.includes("r2.cloudflarestorage.com")) return;

  // HTML navigations: network-first so a redeploy is picked up immediately, falling back to cache only
  // when offline. We deliberately do NOT cache navigations here — cache-first HTML would pin stale
  // marketing pages until CACHE_NAME is bumped (which never happens since sw.js is static).
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Static sub-resources (hashed /_next/static chunks, images, fonts): cache-first is safe because the
  // URL changes when the content changes.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (!response || response.status !== 200 || response.type === "opaque") return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => cached))
  );
});
