import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generatePrecacheManifest } from "../scripts/generate-precache.mjs";

test("service worker consumes the generated versioned precache manifest", async () => {
  const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const manifest = Object.freeze({
    version: "test-version",
    urls: ["./index.html", "./src/ui/input-mode.js"]
  });
  const listeners = new Map();
  const openedCaches = [];
  const addedUrls = [];
  const deletedCaches = [];
  let skippedWaiting = 0;
  let claimedClients = 0;
  const cache = {
    async addAll(urls) {
      addedUrls.push(...urls);
    }
  };
  const caches = {
    async open(name) {
      openedCaches.push(name);
      return cache;
    },
    async keys() {
      return ["carvemino-shell-old", "carvemino-shell-test-version", "other-app-cache"];
    },
    async delete(name) {
      deletedCaches.push(name);
      return true;
    }
  };
  const self = {
    location: { origin: "https://example.test" },
    clients: {
      async claim() {
        claimedClients += 1;
      }
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async skipWaiting() {
      skippedWaiting += 1;
    }
  };
  const importScripts = (url) => {
    assert.equal(url, "./precache-manifest.js");
    self.__CARVEMINO_PRECACHE__ = manifest;
  };

  Function("importScripts", "self", "caches", "fetch", "URL", serviceWorker)(
    importScripts,
    self,
    caches,
    async () => { throw new Error("fetch not expected during lifecycle test"); },
    URL
  );

  let installPromise;
  listeners.get("install")({ waitUntil: (promise) => { installPromise = promise; } });
  await installPromise;
  assert.deepEqual(openedCaches, ["carvemino-shell-test-version"]);
  assert.deepEqual(addedUrls, manifest.urls);
  assert.equal(skippedWaiting, 1);

  let activatePromise;
  listeners.get("activate")({ waitUntil: (promise) => { activatePromise = promise; } });
  await activatePromise;
  assert.deepEqual(deletedCaches, ["carvemino-shell-old"]);
  assert.equal(claimedClients, 1);
});

test("raw repository includes a valid no-op precache manifest", async () => {
  const manifestSource = await readFile(new URL("../precache-manifest.js", import.meta.url), "utf8");
  const scope = {};
  Function("self", manifestSource)(scope);

  assert.deepEqual(scope.__CARVEMINO_PRECACHE__, {
    version: "local",
    urls: []
  });
  assert(Object.isFrozen(scope.__CARVEMINO_PRECACHE__));
});

test("precache manifest is generated from the staged site graph and content-versioned", async (t) => {
  const site = await mkdtemp(path.join(tmpdir(), "carvemino-precache-"));
  t.after(() => rm(site, { recursive: true, force: true }));
  await mkdir(path.join(site, "src", "ui"), { recursive: true });
  await mkdir(path.join(site, "styles"), { recursive: true });
  await writeFile(path.join(site, "index.html"), "<main>alpha</main>\n");
  await writeFile(path.join(site, "precache-manifest.js"), "// local fallback\n");
  await writeFile(path.join(site, "sw.js"), "// service worker\n");
  await writeFile(path.join(site, "src", "ui", "gamepad-input.js"), "export const input = true;\n");
  await writeFile(path.join(site, "styles", "app.css"), "body {}\n");

  const first = await generatePrecacheManifest(site);
  assert.deepEqual(first.urls, [
    "./index.html",
    "./src/ui/gamepad-input.js",
    "./styles/app.css"
  ]);
  assert.match(first.version, /^[0-9a-f]{16}$/);
  assert.equal(first.urls.includes("./sw.js"), false);
  assert.equal(first.urls.includes("./precache-manifest.js"), false);

  const generatedSource = await readFile(path.join(site, "precache-manifest.js"), "utf8");
  assert.match(generatedSource, /self\.__CARVEMINO_PRECACHE__/);
  assert.match(generatedSource, /\.\/src\/ui\/gamepad-input\.js/);
  assert.doesNotMatch(generatedSource, /local fallback/);

  const repeated = await generatePrecacheManifest(site);
  assert.equal(repeated.version, first.version, "the generated manifest must not hash itself");

  await writeFile(path.join(site, "src", "ui", "input-mode.js"), "export const mode = 'keyboard';\n");
  const withNewAsset = await generatePrecacheManifest(site);
  assert.notEqual(withNewAsset.version, first.version);
  assert(withNewAsset.urls.includes("./src/ui/input-mode.js"));

  await writeFile(path.join(site, "sw.js"), "// changed service worker\n");
  const withChangedWorker = await generatePrecacheManifest(site);
  assert.notEqual(withChangedWorker.version, withNewAsset.version);
});
