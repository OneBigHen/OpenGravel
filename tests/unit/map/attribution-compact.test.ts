import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The MapLibre attribution control is created **compact** (05 §23; touch
 * dead-band probe, 2026-09-17).
 *
 * ## Why this is a source guard and not a rendered assertion
 *
 * The control is constructed inside the MapLibre host's renderer attempt, which
 * needs WebGL: jsdom cannot build one, and the browser gate draws the `empty`
 * basemap, which has no attribution to assert on (a false attribution is worse
 * than none — that is the same 05 §23 rule). What is left is the decision itself,
 * and that is a single expression in `host.ts`:
 *
 * - `empty` → no control at all;
 * - any basemap with attribution → `{ compact: true }`, so the pill is an (i)
 *   button that expands on demand instead of a sentence of links lying across the
 *   map's lower edge, which swallowed every tap in a ~40 px band.
 *
 * A guard that reads the rule fails loudly if someone drops `compact`, which is
 * exactly what the browser gate cannot see.
 */
describe("the renderer's attribution control", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "infrastructure", "map", "maplibre", "host.ts"),
    "utf8",
  );

  it("creates a compact control when the basemap has attribution", () => {
    // A downloaded offline basemap (Lane A2) carries OSM attribution even in `empty` mode.
    expect(source).toMatch(
      /attributionControl:\s*options\.basemap !== "empty" \|\| drawingOfflineBasemap\s*\?\s*\{\s*compact:\s*true\s*\}\s*:\s*false/,
    );
  });

  it("still creates no control for the empty basemap, where there is nothing to attribute", () => {
    const line = /attributionControl:[^,]*/.exec(source)?.[0] ?? "";
    expect(line).toContain('options.basemap !== "empty"');
    expect(line).toContain("false");
  });
});
