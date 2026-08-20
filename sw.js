const CACHE_NAME = "carvemino-shell-v1";

const PRECACHE_URLS = [
  "./index.html",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./src/adapters/webrtc.js",
  "./src/app/catalog.js",
  "./src/app/lan-session.js",
  "./src/app/multiplayer-catalog.js",
  "./src/app/network-match-runtime.js",
  "./src/app/profile.js",
  "./src/app/protocol.js",
  "./src/app/runtime.js",
  "./src/audio/engine.js",
  "./src/audio/music.js",
  "./src/audio/sounds.js",
  "./src/config.js",
  "./src/domain/game.js",
  "./src/domain/game/drop-planner.js",
  "./src/domain/game/garbage.js",
  "./src/domain/game/model.js",
  "./src/domain/game/piece-id.js",
  "./src/domain/game/random.js",
  "./src/domain/game/sculpt.js",
  "./src/domain/game/simulation.js",
  "./src/domain/game/state.js",
  "./src/domain/match.js",
  "./src/domain/match/policy-utils.js",
  "./src/domain/match/survival.js",
  "./src/domain/match/versus.js",
  "./src/domain/rules.js",
  "./src/i18n.js",
  "./src/main.js",
  "./src/match-policies/carver.js",
  "./src/match-policies/classic.js",
  "./src/palette.js",
  "./src/rulesets/carver.js",
  "./src/rulesets/classic.js",
  "./src/ui/attract.js",
  "./src/ui/game-input.js",
  "./src/ui/gamepad-input.js",
  "./src/ui/game-screen.js",
  "./src/ui/input-constants.js",
  "./src/ui/input-mode.js",
  "./src/ui/lan-lobby.js",
  "./src/ui/navigation.js",
  "./src/ui/profile-ui.js",
  "./src/ui/qr-code-generator.js",
  "./src/ui/qr-code.js",
  "./src/ui/responsive-shell.js",
  "./src/ui/startup-manual.js",
  "./src/ui/ui.js",
  "./styles/components/buttons.css",
  "./styles/components/menus.css",
  "./styles/components/panels.css",
  "./styles/components/screens.css",
  "./styles/controls/touch-controls.css",
  "./styles/foundation.css",
  "./styles/screens/attract.css",
  "./styles/screens/game.css",
  "./styles/screens/lan.css",
  "./styles/screens/manual.css",
  "./styles/screens/options.css",
  "./styles/screens/records.css",
  "./styles/shell.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("carvemino-shell-") && cacheName !== CACHE_NAME)
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
