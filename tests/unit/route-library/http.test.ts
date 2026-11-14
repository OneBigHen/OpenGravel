import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseCatalogEntry } from "@/application/explore/catalog";
import { parseGpx } from "@/infrastructure/import/gpx-parser";
import { libraryRideAsCatalogEntry } from "@/server/route-library/as-catalog-entry";
import { gpxResponse, indexResponse, linesResponse, manifestResponse, rideResponse } from "@/server/route-library/http";
import { packManifest, resetPackForTests } from "@/server/route-library/pack";

const FIXTURE = path.resolve(import.meta.dirname, "../../fixtures/route-library/pack.sqlite");

interface RideBody {
  readonly line?: string;
  readonly segments?: readonly string[];
  readonly credit: { readonly creditLine: string };
  readonly [key: string]: unknown;
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/route-library/x", { headers });
}

beforeEach(() => {
  process.env["OGV_ROUTE_LIBRARY_PACK"] = FIXTURE;
  resetPackForTests();
});
afterEach(() => {
  delete process.env["OGV_ROUTE_LIBRARY_PACK"];
  resetPackForTests();
});

async function version(): Promise<string> {
  return ((await manifestResponse().json()) as { version: string }).version;
}

describe("the manifest", () => {
  it("answers with the counts and a five-minute cache", async () => {
    const response = manifestResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(await response.json()).toMatchObject({ rides: 14, located: 12, withLine: 11, polylinePrecision: 5, states: { PA: 4, NC: 2, TN: 2, NY: 1 } });
  });

  it("is 404 with no pack configured, or a missing file, or a file that is not a pack", async () => {
    delete process.env["OGV_ROUTE_LIBRARY_PACK"];
    expect(manifestResponse().status).toBe(404);
    process.env["OGV_ROUTE_LIBRARY_PACK"] = "/nonexistent/pack.sqlite";
    expect(manifestResponse().status).toBe(404);
    process.env["OGV_ROUTE_LIBRARY_PACK"] = path.resolve(import.meta.dirname, "pack-build.test.ts");
    expect(manifestResponse().status).toBe(404);
    expect(packManifest()).toBeNull();
  });
});

describe("the index and the state lines", () => {
  it("sends the stored gzip as it is, cached for a year", async () => {
    const response = indexResponse(request({ "accept-encoding": "gzip" }), await version());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")) as { rows: unknown[]; precision: number };
    expect(body.rows).toHaveLength(14);
    expect(body.precision).toBe(5);
  });

  it("unpacks it for a client that cannot read gzip", async () => {
    const response = indexResponse(request(), await version());
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(((await response.json()) as { rows: unknown[] }).rows).toHaveLength(14);
  });

  it("answers 404 for a wrong version", async () => {
    expect(indexResponse(request(), "deadbeef0000").status).toBe(404);
    expect(linesResponse(request(), "deadbeef0000", "PA.json").status).toBe(404);
  });

  it("serves a state's lines as <ST>.json", async () => {
    const response = linesResponse(request({ "accept-encoding": "gzip" }), await version(), "PA.json");
    expect(response.status).toBe(200);
    const body = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")) as { state: string; lines: [string, string][] };
    expect(body.state).toBe("PA");
    expect(body.lines).toHaveLength(4);
    expect(linesResponse(request(), await version(), "ZZ.json").status).toBe(404);
    expect(linesResponse(request(), await version(), "../index.json").status).toBe(404);
  });
});

describe("a ride", () => {
  it("returns the detail with its line and a one-hour cache keyed by the version", async () => {
    const response = rideResponse(request(), "nc-diamondback-loop");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(response.headers.get("etag")).toBe(`"${await version()}"`);
    const ride = (await response.json()) as RideBody;
    expect(ride).toMatchObject({ id: "nc-diamondback-loop", kind: "road", precision: 5, score: 5, states: ["NC", "TN"] });
    expect(typeof ride.line).toBe("string");
    expect(ride.credit.creditLine.length).toBeGreaterThan(5);
  });

  it("gives a bundle as separate segments", async () => {
    const ride = (await rideResponse(request(), "mi-orv-route-slc").json()) as RideBody;
    expect(ride.segments).toHaveLength(3);
    expect(ride.line).toBeUndefined();
  });

  it("answers 304 to a matching ETag, 404 to an unknown or malformed id", async () => {
    expect(rideResponse(request({ "if-none-match": `"${await version()}"` }), "nc-diamondback-loop").status).toBe(304);
    expect(rideResponse(request(), "no-such-ride").status).toBe(404);
    expect(rideResponse(request(), "../../etc").status).toBe(404);
  });
});

describe("the GPX", () => {
  it("is written from the stored line with the credit, and opens in the app's own importer", async () => {
    const response = gpxResponse("nc-diamondback-loop");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/gpx+xml");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    const xml = await response.text();
    expect(xml).toContain("Route by ");
    expect(xml).toContain("Not checked against today's roads");
    const parsed = parseGpx(xml);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]!.segments[0]!.length).toBeGreaterThan(20);
    expect(parsed.sourceDescription).toContain("BestBikingRoads");
  });

  it("keeps a bundle's segments apart", async () => {
    const parsed = parseGpx(await gpxResponse("mi-orv-route-slc").text());
    expect(parsed.tracks[0]!.segments).toHaveLength(3);
  });

  it("answers 403 with the source link for a link-only source", async () => {
    const response = gpxResponse("az-arizona-bdr");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { sourceUrl: string; sourceName: string };
    expect(body.sourceUrl).toMatch(/^https:\/\//);
    expect(body.sourceName).toBeTruthy();
    expect(response.headers.get("link")).toContain(body.sourceUrl);
  });

  it("answers 403 with the source link for a ride that has no track at all", async () => {
    expect(gpxResponse("ok-white-water-orv-area").status).toBe(403);
    expect(gpxResponse("not-a-ride").status).toBe(404);
  });
});

describe("a library ride as a catalog entry", () => {
  it("carries the credit, the source name and honest provenance, and marks itself a reference track", () => {
    const entry = libraryRideAsCatalogEntry("pa-us-220-pennsdale-athens")!;
    expect(entry).toMatchObject({
      id: "pa-us-220-pennsdale-athens",
      source: "catalog",
      provenance: "BestBikingRoads",
      referenceTrack: true,
      region: "Pennsylvania",
    });
    expect(entry.provenanceDetail).toBe("Source track from BestBikingRoads (2010). Not checked against today's roads, closures or surface.");
    expect(entry.credit?.sourceUrl).toMatch(/^https:\/\//);
    expect(entry.geometry.length).toBeGreaterThan(20);
    expect(entry.surfaceSummary).toBe("Paved");
    expect(entry.distanceKm).toBeGreaterThan(100);
  });

  it("says 'undated' when the track has no year, and names a multi-state ride's states", () => {
    const entry = libraryRideAsCatalogEntry("tx-lovelady-loop")!;
    expect(entry.provenanceDetail).toContain("(undated)");
    expect(entry.surfaceSummary).toBeUndefined();
    expect(libraryRideAsCatalogEntry("nc-diamondback-loop")!.region).toBe("North Carolina, Tennessee");
  });

  it("gives empty geometry for a rough track, a trail bundle and a ride with no line", () => {
    expect(libraryRideAsCatalogEntry("al-the-heart-run")!.geometry).toEqual([]);
    expect(libraryRideAsCatalogEntry("mi-orv-route-slc")!.geometry).toEqual([]);
    expect(libraryRideAsCatalogEntry("az-arizona-bdr")!.geometry).toEqual([]);
    expect(libraryRideAsCatalogEntry("ok-white-water-orv-area")!.geometry).toEqual([]);
  });

  it("survives the catalog parser with its reference flag", () => {
    const entry = libraryRideAsCatalogEntry("nc-cherohala-skyway")!;
    const parsed = parseCatalogEntry(JSON.parse(JSON.stringify(entry)));
    expect(parsed?.referenceTrack).toBe(true);
    expect(parsed?.credit?.sourceName).toBe("MotoCurve");
  });

  it("is null for an unknown ride and when no pack is configured", () => {
    expect(libraryRideAsCatalogEntry("no-such-ride")).toBeNull();
    delete process.env["OGV_ROUTE_LIBRARY_PACK"];
    expect(libraryRideAsCatalogEntry("nc-cherohala-skyway")).toBeNull();
  });
});

describe("reopening", () => {
  it("reads the environment each time, so unsetting it turns the library off", async () => {
    expect(manifestResponse().status).toBe(200);
    delete process.env["OGV_ROUTE_LIBRARY_PACK"];
    expect(manifestResponse().status).toBe(404);
    process.env["OGV_ROUTE_LIBRARY_PACK"] = FIXTURE;
    expect(manifestResponse().status).toBe(200);
    expect(await version()).toMatch(/^[0-9a-f]{12}$/);
  });
});
