import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MANIFEST_FILENAME = "precache-manifest.js";
const SERVICE_WORKER_FILENAME = "sw.js";

async function listFiles(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function generatePrecacheManifest(siteDirectory) {
  const absoluteSiteDirectory = path.resolve(siteDirectory);
  // The generated manifest cannot include itself in its content hash.
  const allFiles = (await listFiles(absoluteSiteDirectory))
    .filter((relativePath) => relativePath !== MANIFEST_FILENAME)
    .sort();
  const fileHashes = [];
  for (const relativePath of allFiles) {
    const content = await readFile(path.join(absoluteSiteDirectory, ...relativePath.split("/")));
    fileHashes.push([relativePath, hashContent(content)]);
  }

  const version = hashContent(fileHashes.map(([relativePath, hash]) => `${relativePath}\0${hash}`).join("\n"))
    .slice(0, 16);
  // sw.js still contributes to the version so worker changes rotate the shell
  // cache, but the browser updates the worker itself rather than precaching it.
  const urls = allFiles
    .filter((relativePath) => relativePath !== SERVICE_WORKER_FILENAME)
    .map((relativePath) => `./${relativePath}`);
  const manifest = { version, urls };
  const source = `self.__CARVEMINO_PRECACHE__ = Object.freeze(${JSON.stringify(manifest, null, 2)});\n`;
  await writeFile(path.join(absoluteSiteDirectory, MANIFEST_FILENAME), source, "utf8");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const siteDirectory = process.argv[2];
  if (!siteDirectory) {
    console.error("Usage: node scripts/generate-precache.mjs <site-directory>");
    process.exitCode = 1;
  } else {
    const manifest = await generatePrecacheManifest(siteDirectory);
    console.log(`Generated ${MANIFEST_FILENAME} with ${manifest.urls.length} URLs (${manifest.version}).`);
  }
}
