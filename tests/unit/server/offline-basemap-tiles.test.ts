import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tileAt } from "@/application/offline/ride-pack";
import { handleBasemapTile } from "@/server/offline/basemap-tiles";

const deps = { root: join(process.cwd(), "tests/fixtures/basemap"), limiter: { check: () => null } };
const get = (method = "GET") => new Request("http://ogv.test/api/offline/tiles", { method });
const at = (z: number, lon: number, lat: number) => {
  const tile = tileAt({ lon, lat }, z);
  return { z: String(tile.z), x: String(tile.x), y: String(tile.y) };
};

describe("basemap tile handler", () => {
  it("serves one tile from our archive, as vector tile bytes", async () => {
    const response = await handleBasemapTile(get(), at(14, -75.4375, 40.1375), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-protobuf");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
  });

  it("says a tile no archive reaches is not covered, never blank", async () => {
    const response = await handleBasemapTile(get(), at(14, -77.89, 40.72), deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: "OFFLINE_TILE_NOT_COVERED" }) });
  });

  it("refuses an address that is not a tile", async () => {
    expect((await handleBasemapTile(get(), { z: "3", x: "8", y: "0" }, deps)).status).toBe(400);
    expect((await handleBasemapTile(get(), { z: "a", x: "0", y: "0" }, deps)).status).toBe(400);
  });

  it("is rate limited", async () => {
    const limited = await handleBasemapTile(get(), at(14, -75.4375, 40.1375), { ...deps, limiter: { check: () => 30 } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
  });
});
