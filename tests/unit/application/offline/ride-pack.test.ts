import { describe, expect, it } from "vitest";

import {
  createRidePackService,
  formatKeptSize,
  rideCorridorTiles,
  rideLineKey,
  rideTilePath,
  RideTileError,
  tileAt,
  tileKey,
  type KeepSource,
  type RidePackRecord,
  type RideTileStorePort,
} from "@/application/offline/ride-pack";
import type { Coordinate } from "@/domain/ride/types";

/** A ~25 km wiggly line near Rothrock, with a long straight leg. */
const LINE: readonly Coordinate[] = [
  { lon: -77.89, lat: 40.72 },
  { lon: -77.86, lat: 40.735 },
  { lon: -77.83, lat: 40.73 },
  { lon: -77.8, lat: 40.75 },
  { lon: -77.78, lat: 40.78 },
  { lon: -77.74, lat: 40.79 },
  { lon: -77.72, lat: 40.82 },
];

function fakeTiles(options: { readonly fail?: (path: string) => Error | null } = {}): RideTileStorePort & { readonly kept: Map<string, number>; assets: boolean } {
  const kept = new Map<string, number>();
  const store = {
    kept,
    assets: false,
    async fetchAndKeep(path: string) {
      const error = options.fail?.(path) ?? null;
      if (error !== null) throw error;
      kept.set(path, 1_000);
      return 1_000;
    },
    async missing(paths: readonly string[]) { return paths.filter((path) => !kept.has(path)); },
    async remove(paths: readonly string[]) { for (const path of paths) kept.delete(path); },
    async sizeOf(path: string) { return kept.get(path) ?? 0; },
    async keepMapAssets() { store.assets = true; },
    async hasMapAssets() { return store.assets; },
  };
  return store;
}

function fakePacks() {
  const rows = new Map<string, RidePackRecord>();
  return {
    rows,
    async get(rideId: string) { return rows.get(rideId) ?? null; },
    async put(record: RidePackRecord) { rows.set(record.rideId, record); },
    async delete(rideId: string) { rows.delete(rideId); },
    async list() { return [...rows.values()]; },
  };
}

const source = (rideId: string, line: readonly Coordinate[] = LINE): KeepSource => ({
  rideId,
  title: "Rothrock loop",
  line,
  instructions: [{ text: "Turn left", distanceMeters: 100, durationSeconds: 10, type: "turn", maneuver: "left" }],
  surfaceRuns: [{ from: 0, to: 500, kind: "gravel" }],
});

describe("ride corridor tiles", () => {
  it("is the same list every time for the same line", () => {
    const first = rideCorridorTiles(LINE).map(tileKey);
    const second = rideCorridorTiles([...LINE]).map(tileKey);
    expect(second).toEqual(first);
    expect(first).toMatchSnapshot();
  });

  it("covers every point of the line, and the points between them, at zoom 14", () => {
    const keys = new Set(rideCorridorTiles(LINE).map(tileKey));
    for (let index = 0; index + 1 < LINE.length; index += 1) {
      const a = LINE[index]!;
      const b = LINE[index + 1]!;
      for (let t = 0; t <= 1; t += 0.01) {
        const point = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
        expect(keys.has(tileKey(tileAt(point, 14)))).toBe(true);
      }
    }
  });

  it("reaches half a mile either side of the line", () => {
    const keys = new Set(rideCorridorTiles(LINE).map(tileKey));
    // 700 m north of the first point: inside the corridor.
    expect(keys.has(tileKey(tileAt({ lon: -77.89, lat: 40.72 + 700 / 111_320 }, 14)))).toBe(true);
  });

  it("holds zooms 8 to 14 only, and nothing for a line it cannot read", () => {
    const zooms = new Set(rideCorridorTiles(LINE).map((tile) => tile.z));
    expect([...zooms].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(rideCorridorTiles([{ lon: -77.89, lat: 40.72 }])).toEqual([]);
    expect(rideCorridorTiles([{ lon: Number.NaN, lat: 40 }, { lon: -77, lat: 40 }])).toEqual([]);
  });

  it("names tiles under our own tile path", () => {
    expect(rideTilePath({ z: 14, x: 4567, y: 6123 })).toBe("/api/offline/tiles/14/4567/6123");
    expect(rideTilePath({ z: 8, x: 1, y: 2 }, "/og")).toBe("/og/api/offline/tiles/8/1/2");
  });

  it("fingerprints a line exactly", () => {
    expect(rideLineKey(LINE)).toBe(rideLineKey([...LINE]));
    expect(rideLineKey(LINE)).not.toBe(rideLineKey([...LINE.slice(0, -1), { lon: -77.72, lat: 40.821 }]));
  });
});

describe("keeping a ride", () => {
  it("keeps every tile and the ride's data, then says it is kept", async () => {
    const tiles = fakeTiles();
    const packs = fakePacks();
    const progress: number[] = [];
    const service = createRidePackService({ loadRide: async (id) => source(id), tiles, packs, now: () => "2026-11-14T14:14:00.000Z" });
    const outcome = await service.keepRide("ride_a", { onProgress: (p) => progress.push(p.done) });
    const expected = rideCorridorTiles(LINE).length;
    expect(outcome).toEqual({ status: "kept", bytes: expected * 1_000, tiles: expected });
    expect(progress.at(-1)).toBe(expected);
    expect(await service.rideIsKept("ride_a")).toBe(true);
    const record = packs.rows.get("ride_a")!;
    expect(record.instructions).toHaveLength(1);
    expect(record.surfaceRuns).toEqual([{ from: 0, to: 500, kind: "gravel" }]);
    expect(await service.keptRides()).toEqual([{ rideId: "ride_a", title: "Rothrock loop", keptAt: "2026-11-14T14:14:00.000Z", bytes: expected * 1_000 }]);
    expect((await service.keptPackForLine(LINE))?.rideId).toBe("ride_a");
  });

  it("is not kept when one tile is missing, even though the record says it was", async () => {
    const tiles = fakeTiles();
    const service = createRidePackService({ loadRide: async (id) => source(id), tiles, packs: fakePacks() });
    await service.keepRide("ride_a");
    const [first] = tiles.kept.keys();
    tiles.kept.delete(first!);
    expect(await service.rideIsKept("ride_a")).toBe(false);
    expect(await service.keptRides()).toEqual([]);
    expect(await service.keptPackForLine(LINE)).toBeNull();
  });

  it("is not kept without the map's labels and symbols", async () => {
    const tiles = fakeTiles();
    const service = createRidePackService({ loadRide: async (id) => source(id), tiles, packs: fakePacks() });
    await service.keepRide("ride_a");
    tiles.assets = false;
    expect(await service.rideIsKept("ride_a")).toBe(false);
  });

  it("a failed tile says so, stays off and leaves nothing behind", async () => {
    const tiles = fakeTiles({ fail: (path) => path.startsWith("/api/offline/tiles/13/") ? new RideTileError("network", "x") : null });
    const packs = fakePacks();
    const service = createRidePackService({ loadRide: async (id) => source(id), tiles, packs, concurrency: 1 });
    const outcome = await service.keepRide("ride_a");
    expect(outcome).toEqual({ status: "failed", reason: "network", message: "Part of the map did not download. Try again with signal." });
    expect(await service.rideIsKept("ride_a")).toBe(false);
    expect(packs.rows.size).toBe(0);
    expect(tiles.kept.size).toBe(0);
  });

  it("full storage says so and stays off", async () => {
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const service = createRidePackService({ loadRide: async (id) => source(id), tiles: fakeTiles({ fail: () => quota }), packs: fakePacks() });
    expect(await service.keepRide("ride_a")).toMatchObject({ status: "failed", reason: "storage-full" });
    const refused = createRidePackService({ loadRide: async (id) => source(id), tiles: fakeTiles(), packs: fakePacks(), hasSpaceFor: async () => false });
    expect(await refused.keepRide("ride_a")).toMatchObject({ status: "failed", reason: "storage-full", message: "There is not enough storage on this phone to keep this ride." });
  });

  it("a ride outside our map is refused, not kept with holes", async () => {
    const service = createRidePackService({
      loadRide: async (id) => source(id),
      tiles: fakeTiles({ fail: () => new RideTileError("not-covered", "x") }),
      packs: fakePacks(),
    });
    expect(await service.keepRide("ride_a")).toMatchObject({ status: "failed", reason: "not-covered" });
  });

  it("a ride with no line has nothing to keep", async () => {
    const service = createRidePackService({ loadRide: async () => null, tiles: fakeTiles(), packs: fakePacks() });
    expect(await service.keepRide("ride_a")).toMatchObject({ status: "failed", reason: "no-line" });
  });

  it("removing one ride keeps the tiles another kept ride still needs", async () => {
    const tiles = fakeTiles();
    const service = createRidePackService({
      loadRide: async (id) => source(id, id === "ride_b" ? LINE.slice(0, 3) : LINE),
      tiles,
      packs: fakePacks(),
    });
    await service.keepRide("ride_a");
    await service.keepRide("ride_b");
    await service.dropRide("ride_a");
    expect(await service.rideIsKept("ride_a")).toBe(false);
    expect(await service.rideIsKept("ride_b")).toBe(true);
    await service.dropRide("ride_b");
    expect(tiles.kept.size).toBe(0);
  });

  it("reads sizes the way a rider does", () => {
    expect(formatKeptSize(31_400_000)).toBe("31 MB");
    expect(formatKeptSize(812_000)).toBe("812 KB");
    expect(formatKeptSize(0)).toBe("0 MB");
  });
});
