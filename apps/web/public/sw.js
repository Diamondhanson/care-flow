/*
 * CareFlow service worker — installable + offline shell.
 *
 * Strategy (all GET, same-origin only):
 *   - content-hashed assets (/_next/static/, /icons/): cache-first (immutable,
 *     so this is HMR-safe even in `next dev`).
 *   - navigations: network-first → cache the fresh HTML → on failure serve the
 *     cached page, else the /offline shell. Network-first keeps Turbopack HMR
 *     working in development.
 *   - other same-origin GETs: stale-while-revalidate.
 *
 * Non-GET, cross-origin, and Next dev/HMR requests bypass the worker entirely.
 * Push/notification handling is intentionally out of scope (needs VAPID + a
 * server — deferred to a later phase).
 */

// Bumped v1 → v2: forces an SW update on next navigation so the `activate`
// handler purges the stale v1 cache. This is what lets already-poisoned dev
// browsers recover — the fresh chunks then carry the dev "unregister" logic in
// components/pwa/service-worker-register.tsx.
const CACHE = "careflow-v2";
const OFFLINE_URL = "/offline";

// App shell precached on install so the very first offline load has something.
const PRECACHE = [
  "/",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Tolerate individual precache misses (e.g. a route not yet built in dev).
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isHashedAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

function isBypassed(url) {
  // Next dev server / HMR endpoints must always hit the network.
  return (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.includes("/_next/static/webpack/") ||
    url.searchParams.has("__nextjs_original-stack-frame")
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
