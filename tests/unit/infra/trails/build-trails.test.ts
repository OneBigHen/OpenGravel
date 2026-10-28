import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { buildTrailCatalog, parseArgs, writeCatalog } from "../../../../infra/trails/build-trails";
import type { HikeCatalog, TrailFeature, TrailFeatureCollection } from "../../../../infra/trails/lib/types";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "trails");
const OSM = join(FIXTURES, "osm-trails.geojsonseq");
const USFS = join(FIXTURES, "usfs-trails.geojson");
const NPS = join(FIXTURES, "nps-trails.geojson");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ogv-trails-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function build(withAgencies = true) {
  return buildTrailCatalog({
    osm: OSM,
    usfs: withAgencies ? USFS : undefined,
    nps: withAgencies ? NPS : undefined,
  });
}

function feature(result: Awaited<ReturnType<typeof build>>, id: string): TrailFeature {
  const found = result.trailsGeoJson.features.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no feature ${id} in ${result.trailsGeoJson.features.map((item) => item.id).join(", ")}`);
  return found;
}

describe("trail catalog build", () => {
  it("keeps hiking routes, named walking ways and nothing else", async () => {
    const result = await build();
    const ids = result.trailsGeoJson.features.map((item) => item.id);
    expect(ids).toEqual([
      "osm:relation/2001",
      "osm:relation/2002",
      "osm:way/1001",
      "osm:way/1005",
      "osm:way/1008",
    ]);
    // Unnamed path, bridleway, and the named member ways of the two relations
    // are not trails of their own.
    for (const dropped of ["osm:way/1003", "osm:way/1004", "osm:way/1006", "osm:way/1007", "osm:way/1010", "osm:way/1011"]) {
      expect(ids).not.toContain(dropped);
    }
  });

  it("assembles relation members into one line and keeps a gap as two lines", async () => {
    const result = await build();
    const loop = feature(result, "osm:relation/2001");
    expect(loop.geometry.type).toBe("LineString");
    // way/1003 runs A→D and way/1004 runs D→E: joined at D, not left as two parts.
    expect(loop.geometry.type === "LineString" ? loop.geometry.coordinates : []).toHaveLength(3);

    const traverse = feature(result, "osm:relation/2002");
    expect(traverse.geometry.type).toBe("MultiLineString");
    expect(traverse.geometry.type === "MultiLineString" ? traverse.geometry.coordinates : []).toHaveLength(2);
  });

  it("keeps every source of a duplicated trail and one geometry", async () => {
    const result = await build();
    const hawk = feature(result, "osm:way/1001");
    expect(hawk.properties.sources.map((source) => [source.sourceId, source.recordId])).toEqual([
      ["osm", "way/1001"],
      ["usfs", "F-101"],
      ["nps", "4242"],
    ]);
    // OSM is the routing base, so its surface wins...
    expect(hawk.properties.surface).toBe("ground");
    // ...and the disagreement is visible rather than lost.
    expect(hawk.properties.conflicts).toEqual([
      { field: "surface", kept: { sourceId: "osm", value: "ground" }, other: { sourceId: "nps", value: "GRAVEL" } },
    ]);
    // A field OSM never set is filled from the agency record that did.
    expect(hawk.properties.ref).toBe("F-101");
    expect(hawk.properties.operator).toBe("USDA Forest Service");
    expect(hawk.properties.name).toBe("Hawk Mountain Trail");
    expect(result.hikes.counts.merged).toBe(2);
  });

  it("merges a near-duplicate digitization instead of listing the trail twice", async () => {
    const result = await build();
    const rail = feature(result, "osm:way/1005");
    expect(rail.properties.sources.map((source) => source.sourceId)).toEqual(["osm", "usfs"]);
    // The most complete line is kept; the id still follows OSM.
    expect(rail.geometry.type).toBe("LineString");
    expect(rail.geometry.type === "LineString" ? rail.geometry.coordinates : []).toHaveLength(3);
    expect(result.trailsGeoJson.features.filter((item) => item.properties.name === "Kutztown Rail Trail")).toHaveLength(1);
  });

  it("leaves missing attributes null instead of guessing", async () => {
    const result = await build();
    const rail = feature(result, "osm:way/1005");
    expect(rail.properties.sacScale).toBeNull();
    expect(rail.properties.trailVisibility).toBeNull();
    expect(rail.properties.access).toBeNull();
    expect(rail.properties.dog).toBe("yes");
    const hike = result.hikes.hikes.find((item) => item.id === "osm:way/1005");
    expect(hike?.elevationGainMeters).toBeNull();
    expect(hike?.elevationLossMeters).toBeNull();
  });

  it("attaches only trailheads and parking within 300 m of a trail end", async () => {
    const result = await build();
    const loop = feature(result, "osm:relation/2001");
    expect(loop.properties.trailheads.map((trailhead) => [trailhead.name, trailhead.distanceMeters, trailhead.end])).toEqual([
      ["Hawk Mountain Trailhead", 48, "start"],
      ["Loop Trailhead Lot", 70, "end"],
    ]);
    const named = result.trailsGeoJson.features.flatMap((item) => item.properties.trailheads.map((trailhead) => trailhead.name));
    expect(named).not.toContain("Hillside Commuter Lot");
    expect(feature(result, "osm:way/1008").properties.trailheads).toEqual([]);
    expect(result.hikes.counts.withTrailhead).toBe(2);
  });

  it("writes a deterministic GeoJSON file and hike index", async () => {
    const first = await build();
    const out = tempDir();
    const written = writeCatalog(out, first);
    const trailsRaw = readFileSync(written.trailsPath, "utf8");
    const hikesRaw = readFileSync(written.hikesPath, "utf8");
    const trails = JSON.parse(trailsRaw) as TrailFeatureCollection;
    const hikes = JSON.parse(hikesRaw) as HikeCatalog;

    expect(trails.type).toBe("FeatureCollection");
    expect(trails.features).toHaveLength(5);
    expect(hikes.version).toBe(1);
    expect(hikes.counts).toEqual({ trails: 5, bySource: { osm: 5, usfs: 2, nps: 1 }, withTrailhead: 2, merged: 2 });
    expect(hikes.hikes.map((hike) => hike.id)).toEqual(trails.features.map((item) => item.id ?? ""));

    const loop = hikes.hikes.find((hike) => hike.id === "osm:relation/2001");
    expect(loop?.bbox).toEqual([-75.98, 40.61, -75.972, 40.614]);
    expect(loop?.start).toEqual({ lon: -75.98, lat: 40.61 });
    expect(loop?.end).toEqual({ lon: -75.972, lat: 40.61 });

    // Rebuilding the same inputs must not change a byte: no clock, no random ids.
    const second = await build();
    writeCatalog(out, second);
    expect(readFileSync(written.trailsPath, "utf8")).toBe(trailsRaw);
    expect(readFileSync(written.hikesPath, "utf8")).toBe(hikesRaw);
  });

  it("builds from OSM alone when the agency files are not supplied", async () => {
    const result = await build(false);
    expect(result.trailsGeoJson.features.map((item) => item.id)).toContain("osm:way/1001");
    expect(result.hikes.counts.bySource.usfs).toBe(0);
    expect(result.hikes.counts.bySource.nps).toBe(0);
    expect(feature(result, "osm:way/1001").properties.name).toBe("Hawk Mountain Trail");
  });
});

describe("command line", () => {
  it("requires --osm, --out and existing inputs", () => {
    expect(() => parseArgs([])).toThrow(/--osm is required/);
    expect(() => parseArgs(["--osm", OSM])).toThrow(/--out is required/);
    expect(() => parseArgs(["--osm", join(FIXTURES, "nope.geojsonseq"), "--out", "out"])).toThrow(/missing input file/);
    expect(() => parseArgs(["--osm", OSM, "--out", "out", "--trailhead-radius", "-5"])).toThrow(/positive number of metres/);
  });

  it("accepts the cached DEM options and rejects invalid zooms and misspelled flags", () => {
    const options = parseArgs(["--osm", OSM, "--out", "out", "--dem-cache", "/tmp/dem", "--dem-zoom", "13"]);
    expect(options.demCache).toBe("/tmp/dem");
    expect(options.demZoom).toBe(13);
    expect(() => parseArgs(["--osm", OSM, "--out", "out", "--dem-cache", "/tmp/dem", "--dem-zoom", "11"])).toThrow(/12–14/);
    expect(() => parseArgs(["--osm", OSM, "--out", "out", "--dem-zoom", "13"])).toThrow(/requires --dem-cache/);
    expect(() => parseArgs(["--osm", OSM, "--out", "out", "--dem-cahce", "bad"])).toThrow(/unknown option/);
  });

  it("accepts the documented flags", () => {
    expect(parseArgs(["--osm", OSM, "--usfs", USFS, "--nps", NPS, "--out", "out", "--trailhead-radius", "250"])).toEqual({
      osm: OSM,
      outDir: "out",
      usfs: USFS,
      nps: NPS,
      osmPlaces: undefined,
      trailheadRadiusMeters: 250,
    });
  });
});
