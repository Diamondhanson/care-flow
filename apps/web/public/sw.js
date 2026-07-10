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
 *
 * Web Push (below): the `push` handler shows an OS notification from the payload
 * sent by the `send-push` Supabase Edge Function; `notificationclick` focuses an
 * existing CareFlow tab (or opens one) and deep-links to the related record.
 */

// Bumped v2 → v3: adds the push/notificationclick handlers. Bumping the cache
// name forces an SW update on next navigation so the `activate` handler purges
// the stale cache and clients pick up the new worker.
const CACHE = "careflow-v3";
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

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

// Show the notification pushed by the send-push Edge Function. The payload is
// JSON: { title, body, tag, link, data }. Tolerates a missing/non-JSON body so
// a malformed push still surfaces something rather than throwing.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "CareFlow", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "CareFlow";
  const options = {
    body: payload.body || "",
    tag: payload.tag || undefined,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      link: payload.link || "/",
      entity_type: payload.entity_type || null,
      entity_id: payload.entity_id || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking a notification: focus an open CareFlow tab if there is one (posting
// it the deep-link target so the client can open the patient drawer), else open
// a new window at the link.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const link = data.link || "/";
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsArr) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "careflow:notification-click", data });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(link);
    })(),
  );
});
