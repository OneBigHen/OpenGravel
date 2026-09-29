#!/usr/bin/env node
/**
 * Vendors MapLibre's worker module (and the shared chunk it imports) into
 * `public/vendor/maplibre`.
 *
 * Why this exists: MapLibre GL v6 computes its worker URL from a *dynamic*
 * expression (`new URL(\`./${dev ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs"}\`,
 * import.meta.url)`), which no bundler can resolve statically. Turbopack emits
 * the worker as a hashed asset and leaves its `import "./maplibre-gl-shared.mjs"`
 * untouched, so the worker 404s; webpack resolves the URL to the page itself. In
 * both cases the map renders its background and every GeoJSON source silently
 * never finishes parsing — a blank-but-not-erroring map.
 *
 * Serving the two files from `public/` under their real names and registering
 * them with `maplibregl.setWorkerUrl` is bundler-independent and keeps the
 * renderer offline-capable. The files are committed, and
 * `tests/unit/infrastructure/maplibre/vendored-worker.test.ts` fails if they drift
 * from the installed `maplibre-gl`, so an upgrade cannot leave a stale worker
 * behind.
 *
 * Usage: `npm run vendor:maplibre` (after changing the maplibre-gl version).
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "node_modules", "maplibre-gl", "dist");
const target = path.join(root, "public", "vendor", "maplibre");

/** The files the worker entry needs, by their name *inside* the worker's imports. */
export const VENDORED_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(target, { recursive: true });

const manifest = VENDORED_FILES.map((name) => {
  const source = path.join(dist, name);
  const bytes = readFileSync(source);
  copyFileSync(source, path.join(target, name));
  return { name, sha256: createHash("sha256").update(bytes).digest("hex") };
});

const version = JSON.parse(
  readFileSync(path.join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"),
).version;

console.log(`[vendor] maplibre-gl ${version}`);
for (const entry of manifest) {
  console.log(`[vendor] ${entry.name} sha256=${entry.sha256}`);
}
console.log(`[vendor] written to ${path.relative(root, target)}`);
