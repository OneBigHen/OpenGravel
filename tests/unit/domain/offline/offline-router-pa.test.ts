/**
 * Optional integration check against a locally installed Pennsylvania region.
 * Set OGV_OFFLINE_REGION_ROOT to the directory that contains `pennsylvania/`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { isOfflineGraphTile, isOfflineRegionManifest, tilesCovering, type OfflineGraphTile } from "@/domain/offline/graph-tile";
import { routeOffline } from "@/domain/offline/offline-router";

const ROOT = process.env.OGV_OFFLINE_REGION_ROOT;
const REGION = ROOT === undefined ? null : path.join(ROOT, "pennsylvania");

describe.skipIf(REGION === null || !existsSync(path.join(REGION, "active.json")))("offline router on a configured region", () => {
  it("routes between two coordinates in the installed region", () => {
    const region = REGION!;
    const { version } = JSON.parse(readFileSync(path.join(region, "active.json"), "utf8")) as { version: string };
    const manifest: unknown = JSON.parse(readFileSync(path.join(region, version, "manifest.json"), "utf8"));
    expect(isOfflineRegionManifest(manifest)).toBe(true);
    if (!isOfflineRegionManifest(manifest)) return;
    const start = { lon: -75.5149, lat: 40.1301 };
    const finish = { lon: -75.9269, lat: 40.3356 };
    const area = { minLon: -75.95, minLat: 40.1, maxLon: -75.5, maxLat: 40.36 };
    const tiles: OfflineGraphTile[] = tilesCovering(manifest, area).map((entry) => {
      const parsed: unknown = JSON.parse(gunzipSync(readFileSync(path.join(region, version, "tiles", `${entry.tileId}.json.gz`))).toString("utf8"));
      if (!isOfflineGraphTile(parsed)) throw new Error(`corrupt tile ${entry.tileId}`);
      return parsed;
    });
    const result = routeOffline(tiles, { waypoints: [start, finish], profile: "twisty", bike: "street" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.distanceMeters / 1609.344).toBeGreaterThan(25);
    expect(result.distanceMeters / 1609.344).toBeLessThan(55);
  }, 120_000);
});
