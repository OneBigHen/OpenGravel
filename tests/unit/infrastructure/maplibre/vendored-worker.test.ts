/**
 * The vendored MapLibre worker (05 §2; see `scripts/vendor-maplibre-worker.mjs`).
 *
 * MapLibre's worker URL is built from a dynamic expression, so no bundler emits a
 * loadable worker chunk: Turbopack hashes the emitted worker and leaves its
 * relative `import "./maplibre-gl-shared.mjs"` unrewritten (the worker 404s), and
 * webpack resolves the URL to the page itself. The host therefore serves the two
 * files from `public/vendor/maplibre` and registers them with `setWorkerUrl`.
 *
 * That makes two things worth asserting, because both fail *silently* in the
 * browser — the map draws its background and no source ever finishes loading:
 *
 * - the vendored files are byte-identical to the installed `maplibre-gl`, so a
 *   version bump cannot leave a stale worker behind, and
 * - the worker still imports the shared chunk by the relative name the copy
 *   provides, which is the assumption the whole arrangement rests on.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "node_modules", "maplibre-gl", "dist");
const VENDOR = path.join(ROOT, "public", "vendor", "maplibre");

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"] as const;

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const installed = existsSync(path.join(DIST, FILES[0]));
const vendored = existsSync(path.join(VENDOR, FILES[0]));

describe.skipIf(!installed || !vendored)("the vendored MapLibre worker", () => {
  it("is byte-identical to the installed maplibre-gl", () => {
    for (const name of FILES) {
      expect(sha256(path.join(VENDOR, name)), name).toBe(sha256(path.join(DIST, name)));
    }
  });

  it("imports its shared chunk by the name the copy provides", () => {
    const worker = readFileSync(path.join(VENDOR, FILES[0]), "utf8");
    const specifiers = [...worker.matchAll(/from\s*"([^"]+)"/g)].map((match) => match[1]);

    // A relative import is only resolvable because the shared chunk sits beside
    // it under its original, unhashed name.
    const relative = specifiers.filter((specifier) => specifier?.startsWith("."));
    expect(relative.length).toBeGreaterThan(0);
    for (const specifier of relative) {
      const resolved = path.join(VENDOR, specifier ?? "");
      expect(existsSync(resolved), specifier).toBe(true);
    }
  });

  it("is served from the path the host registers", () => {
    // The host's default, kept in sync by construction: this is the same string
    // `PlannerMap` cannot diverge from without failing its own browser gate.
    expect(existsSync(path.join(VENDOR, "maplibre-gl-worker.mjs"))).toBe(true);
  });
});

describe.skipIf(installed && vendored)("the vendored MapLibre worker", () => {
  it("is missing", () => {
    throw new Error(
      "public/vendor/maplibre is not populated — run `npm run vendor:maplibre`",
    );
  });
});
