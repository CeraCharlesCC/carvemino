import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { generatePrecacheManifest } from "../scripts/generate-precache.mjs";

test("service worker consumes the generated versioned precache manifest", async () => {
  const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /importScripts\("\.\/precache-manifest\.js"\)/);
  assert.match(serviceWorker, /const CACHE_PREFIX = "carvemino-shell-"/);
  assert.match(serviceWorker, /`\$\{CACHE_PREFIX\}\$\{PRECACHE\.version\}`/);
  assert.match(serviceWorker, /PRECACHE\.urls/);
  assert.doesNotMatch(serviceWorker, /\.\/src\/ui\/gamepad-input\.js/);
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
