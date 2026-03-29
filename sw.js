const CACHE_NAME = "cafard-board-v1";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./drag.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon.svg"
];

// Install: pre-cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static, network-first for Firebase/external
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Let Firebase SDK and Firestore requests go to network directly
  if (
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firebase")
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
