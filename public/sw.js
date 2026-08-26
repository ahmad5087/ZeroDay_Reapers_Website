const CACHE_NAME = "zdr-portal-v2";
const STATIC_ASSETS = ["/logo.png", "/logo.svg", "/manifest.webmanifest", "/offline.html"];

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
    // Network-first; when offline, serve the cached page if we have it, else a friendly offline fallback.
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/offline.html")))
    );
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

// ---- Web Push (Phase 17) ----
// Show a notification when a push arrives (works with the app closed).
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || "ZeroDay Reapers";
  const options = {
    body: data.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: data.tag || "zdr",
    renotify: !!data.tag,
    data: { url: data.url || "/portal" },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab (or open one) at the notification's target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/portal";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) { client.navigate && client.navigate(target); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
