import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createDemSource, demPixel } from "../../../../infra/trails/lib/dem";
import { measureTrail, sampleLine } from "../../../../infra/trails/lib/elevation";
import { buildTrailCatalog } from "../../../../infra/trails/build-trails";
import type { Trail } from "../../../../infra/trails/lib/types";
import { haversine } from "../../../../src/domain/geometry/analysis";

const a = { lon: -75, lat: 40 }, b = { lon: -75, lat: 40.002 };
const trail: Trail = {
  id: "test", lines: [[a, b]], sources: [], conflicts: [], trailheads: [], lengthMeters: 222,
  attributes: { name: "Test", ref: null, operator: null, sacScale: null, surface: null, trailVisibility: null, dog: null, access: null },
};

describe("catalog DEM measurements", () => {
  it("uses a 100 m grade window and honest per-segment Tobler time", async () => {
    const measured = await measureTrail(trail, { elevations: async (line) => line.map((p) => haversine(a, p) / 5) });
    expect(measured.elevationGainMeters).toBe(44);
    expect(measured.elevationLossMeters).toBe(0);
    expect(measured.maxGradePercent).toBeCloseTo(20, 1);
    expect(measured.toblerMinutes).toBeCloseTo(5.3, 1);
    expect(measured.elevationMeasuredShare).toBeCloseTo(1);
  });

  it("never adds a climb, grade or time across disconnected parts", async () => {
    let index = 0;
    const flat = await measureTrail({ ...trail, lines: [[a, b], [a, b]] }, {
      elevations: async (line) => { const height = index++ * 1000; return line.map(() => height); },
    });
    expect(flat.elevationGainMeters).toBe(0);
    expect(flat.elevationLossMeters).toBe(0);
    expect(flat.maxGradePercent).toBe(0);
    expect(flat.toblerMinutes).toBeCloseTo(5.3, 1);
  });

  it("keeps partial profiles unknown instead of presenting partial gain or flat fallback time as complete", async () => {
    const measured = await measureTrail(trail, { elevations: async (line) => line.map((_, i) => i === 2 ? null : 100) });
    expect(measured.elevationMeasuredShare).toBeGreaterThan(0);
    expect(measured.elevationMeasuredShare).toBeLessThan(1);
    expect(measured.elevationGainMeters).toBeNull();
    expect(measured.elevationLossMeters).toBeNull();
    expect(measured.maxGradePercent).toBeNull();
    expect(measured.toblerMinutes).toBeNull();
  });

  it("densifies long segments and preserves the corners of short closed loops", () => {
    const sampled = sampleLine([a, b]);
    expect(sampled[0]).toEqual(a);
    expect(sampled.at(-1)).toEqual(b);
    for (let i = 1; i < sampled.length; i++) expect(haversine(sampled[i - 1]!, sampled[i]!)).toBeLessThanOrEqual(30.01);
    const corner = { lon: -74.9999, lat: 40.0001 };
    expect(sampleLine([a, corner, a])).toEqual([a, corner, a]);
    expect(() => sampleLine([a, b], 0)).toThrow();
  });

  it("measures a short closed loop without collapsing it to one point", async () => {
    const loop = [a, { lon: -74.9999, lat: 40.0001 }, { lon: -75.0001, lat: 40.0001 }, a];
    const measured = await measureTrail({ ...trail, lines: [loop] }, { elevations: async (line) => line.map(() => 10) });
    expect(measured.elevationGainMeters).toBe(0);
    expect(measured.toblerMinutes).toBeGreaterThan(0);
  });

  it("writes DEM measurements into both artifacts", async () => {
    const result = await buildTrailCatalog({ osm: "tests/fixtures/trails/osm-trails.geojsonseq",
      demSource: { elevations: async (line) => line.map(() => 123) } });
    for (const hike of result.hikes.hikes) {
      expect(hike.elevationGainMeters).toBe(0);
      expect(hike.toblerMinutes).toBeGreaterThan(0);
      expect(result.trailsGeoJson.features.find((f) => f.id === hike.id)?.properties.toblerMinutes).toBe(hike.toblerMinutes);
    }
  });
});

describe("Mapterhorn tile cache", () => {
  it("decodes 512 px Terrarium tiles, interpolates, and reuses disk cache across builds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ogv-dem-test-"));
    try {
      const data = Buffer.alloc(512 * 512 * 3);
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 3;
        data[i] = 128; data[i + 1] = Math.floor(x / 2); data[i + 2] = x % 2 ? 128 : 0;
      }
      const bytes = await sharp(data, { raw: { width: 512, height: 512, channels: 3 } }).webp({ lossless: true }).toBuffer();
      const fetchImpl = vi.fn(async () => new Response(new Uint8Array(bytes))) as unknown as typeof fetch;
      const source = createDemSource({ cacheDir: dir, fetchImpl });
      const pixel = demPixel(a, 12);
      const [height] = await source.elevations([a]);
      expect(height).toBeCloseTo((pixel.x % 512) / 2, 4);
      const offlineFetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
      expect(await createDemSource({ cacheDir: dir, fetchImpl: offlineFetch }).elevations([a])).toEqual([height]);
      expect(offlineFetch).not.toHaveBeenCalled();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("interpolates across tile boundaries rather than clamping to one tile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ogv-dem-test-"));
    try {
      const tile = async (height: number) => sharp({ create: { width: 512, height: 512, channels: 3,
        background: { r: 128, g: height, b: 0 } } }).webp({ lossless: true }).toBuffer();
      const left = await tile(10), right = await tile(30);
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const x = Number(String(input).split("/").at(-2));
        return new Response(new Uint8Array(x < 2048 ? left : right));
      }) as unknown as typeof fetch;
      const source = createDemSource({ cacheDir: dir, fetchImpl });
      expect((await source.elevations([{ lon: 0, lat: 40 }]))[0]).toBeCloseTo(20, 5);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("bounds retries and preserves missing tiles as null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ogv-dem-test-"));
    try {
      const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
      const source = createDemSource({ cacheDir: dir, fetchImpl });
      expect(await source.elevations([a])).toEqual([null]);
      expect(await source.elevations([a])).toEqual([null]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
