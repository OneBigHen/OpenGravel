import "fake-indexeddb/auto";

import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { offlineSearchArea } from "@/domain/offline/graph-tile";
import { routeOffline } from "@/domain/offline/offline-router";
import { deleteOfflineRegionDatabase, RegionDownloadStore } from "@/infrastructure/offline/region-download-store";
import { handleRegionManifest, handleRegionTile } from "@/server/offline/handler";

const ROOT = join(process.cwd(), "tests/fixtures/offline-regions");
const REGION = "lehigh-fixture";
// The critical e2e ride's own start and destination.
const START = { lon: -75.4385, lat: 40.1385 };
const FINISH = { lon: -75.4335, lat: 40.1325 };
const deps = { root: ROOT, limiter: { check: () => null } };

/** Serves `/api/offline/regions/...` straight from the fixture root through the real handlers. */
function serverFetch(log: string[] = [], failTileAfter = Infinity): typeof fetch {
  let tiles = 0;
  return async (input, init) => {
    const url = new URL(String(input), "http://ogv.test");
    log.push(url.pathname);
    const request = new Request(url, init);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[4] === "manifest") return handleRegionManifest(request, decodeURIComponent(parts[3]!), deps);
    if (tiles++ >= failTileAfter) throw new TypeError("network down");
    return handleRegionTile(request, decodeURIComponent(parts[3]!), decodeURIComponent(parts[5]!), deps);
  };
}

let names = 0;
const stores: RegionDownloadStore[] = [];
function store(fetcher: typeof fetch): RegionDownloadStore {
  const created = new RegionDownloadStore({ name: `offline-test-${names++}`, fetcher });
  stores.push(created);
  return created;
}

afterEach(async () => {
  for (const created of stores.splice(0)) created.close();
});

describe("RegionDownloadStore", () => {
  it("downloads a region, verifies it and routes offline from what it stored", async () => {
    const progress: number[] = [];
    const regions = store(serverFetch());
    const installed = await regions.download(REGION, (p) => progress.push(p.completedBytes / p.totalBytes));
    expect(installed.regionId).toBe(REGION);
    expect(progress.at(-1)).toBe(1);
    expect(await regions.list()).toEqual([expect.objectContaining({ regionId: REGION, version: "fixture-1" })]);
    expect(await regions.storedBytes()).toBe(installed.byteSize);

    const tiles = await regions.tilesFor(offlineSearchArea([START, FINISH])!);
    expect(tiles).toHaveLength(2);
    const route = routeOffline(tiles, { waypoints: [START, FINISH], profile: "balanced", bike: "street" });
    expect(route.ok).toBe(true);
    if (!route.ok) return;
    expect(route.distanceMeters).toBeGreaterThan(700);
    expect(route.distanceMeters).toBeLessThan(3_000);
  });

  it("resumes after a dropped connection without fetching verified tiles again", async () => {
    const regions = store(serverFetch([], 1));
    await expect(regions.download(REGION, () => undefined)).rejects.toThrow("network down");
    expect(await regions.list()).toEqual([]);

    const log: string[] = [];
    const resumed = new RegionDownloadStore({ name: `offline-test-${names - 1}`, fetcher: serverFetch(log) });
    stores.push(resumed);
    await resumed.download(REGION, () => undefined);
    expect(log.filter((path) => path.includes("/tiles/"))).toHaveLength(1);
    expect(await resumed.list()).toHaveLength(1);
  });

  it("refuses a tile whose bytes do not match the manifest", async () => {
    const honest = serverFetch();
    const tampering: typeof fetch = async (input, init) => {
      const response = await honest(input, init);
      if (!String(input).includes("/tiles/")) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      return new Response(bytes);
    };
    await expect(store(tampering).download(REGION, () => undefined)).rejects.toMatchObject({ code: "integrity" });
  });

  it("finds no tiles outside what was downloaded, and forgets a removed region", async () => {
    const regions = store(serverFetch());
    await regions.download(REGION, () => undefined);
    expect(await regions.tilesFor({ minLon: -80, minLat: 41, maxLon: -79.9, maxLat: 41.1 })).toEqual([]);
    await regions.remove(REGION);
    expect(await regions.list()).toEqual([]);
    expect(await regions.storedBytes()).toBe(0);
  });

  it("deletes its whole database on request", async () => {
    const regions = new RegionDownloadStore({ name: "offline-test-delete", fetcher: serverFetch() });
    await regions.download(REGION, () => undefined);
    regions.close();
    await deleteOfflineRegionDatabase("offline-test-delete");
    const reopened = store(serverFetch());
    expect(await reopened.list()).toEqual([]);
  });
});

describe("RegionDownloadStore rate limits", () => {
  it("waits out a 429 and carries on", async () => {
    const honest = serverFetch();
    let limited = 0;
    const limiting: typeof fetch = async (input, init) => {
      if (String(input).includes("/tiles/") && limited < 2) {
        limited += 1;
        return new Response(null, { status: 429, headers: { "retry-after": "3" } });
      }
      return honest(input, init);
    };
    const regions = new RegionDownloadStore({ name: `offline-test-${names++}`, fetcher: limiting, waitScale: 0 });
    stores.push(regions);
    await regions.download(REGION, () => undefined);
    expect(limited).toBe(2);
    expect(await regions.list()).toHaveLength(1);
  });
});
