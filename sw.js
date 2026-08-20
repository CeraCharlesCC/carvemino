importScripts("./precache-manifest.js");

const PRECACHE = self.__CARVEMINO_PRECACHE__;
if (!PRECACHE || typeof PRECACHE.version !== "string" || !Array.isArray(PRECACHE.urls)) {
  throw new Error("Carvemino precache manifest is missing or invalid");
}

const CACHE_PREFIX = "carvemino-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${PRECACHE.version}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE.urls))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    if (request.mode === "navigate") {
      const appShell = await cache.match("./index.html");
      if (appShell) return appShell;
    }

    throw error;
  }
}
