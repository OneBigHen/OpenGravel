import { describe, expect, it, vi } from "vitest";

import { US_STATE_BOXES } from "@/infrastructure/route-intelligence/us-states";
import { createWzdxRegistrySource, usableRegistryFeeds } from "@/infrastructure/route-intelligence/wzdx/wzdx-registry-source";
import { createMvumSource, motorcycleAccessOf, parseMvumDates } from "@/infrastructure/route-intelligence/usfs-mvum/mvum-source";
import { createWzdxSource, decodeFeedBody, parseWzdxFeed, roadFromDescription, scheduleFromDescription } from "@/infrastructure/route-intelligence/wzdx/wzdx-source";

const corridor = { west: -75.9, south: 40.4, east: -75.4, north: 40.8 };
const signal = new AbortController().signal;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("WZDx", () => {
  it("all lanes closed on a line is a closure; a sign-method point pair stays two points", () => {
    const records = parseWzdxFeed({
      type: "FeatureCollection",
      features: [
        {
          id: "a",
          type: "Feature",
          properties: {
            core_details: { event_type: "work-zone", road_names: ["US 46"], description: "Bridge work." },
            vehicle_impact: "all-lanes-closed",
            start_date: "2026-09-26T05:00:00-04:00",
            end_date: "2026-09-28T17:00:00-04:00",
          },
          geometry: { type: "LineString", coordinates: [[-74.49, 40.89], [-74.48, 40.9]] },
        },
        {
          id: "b",
          type: "Feature",
          properties: { core_details: { event_type: "work-zone" }, vehicle_impact: "all-lanes-open" },
          geometry: { type: "MultiPoint", coordinates: [[-74.4, 40.8], [-74.3, 40.85]] },
        },
        { id: "c", type: "Feature", properties: {}, geometry: null },
      ],
    }, "wzdx");
    expect(records[0]).toMatchObject({ kind: "closure", allLanesClosed: true, roadName: "US 46", geometry: { type: "line" } });
    expect(records[0]?.validUntil).toBe("2026-09-28T21:00:00.000Z");
    expect(records.slice(1).map((record) => record.geometry.type)).toEqual(["point", "point"]);
  });

  it("takes the real work window from an NJDOT description, in Eastern time", () => {
    expect(scheduleFromDescription("Roadwork on US 22 Eastbound, Friday October 2, 2026 09:00 AM thru 03:00 PM, right lane closed", "America/New_York"))
      .toEqual({ validFrom: "2026-10-02T13:00:00.000Z", validUntil: "2026-10-02T19:00:00.000Z" });
    expect(scheduleFromDescription("Roadwork, Monday September 28, 2026 08:00 PM thru 05:00 AM, lane closed", "America/New_York"))
      .toEqual({ validFrom: "2026-09-29T00:00:00.000Z", validUntil: "2026-09-29T09:00:00.000Z" });
    expect(scheduleFromDescription("Continuous Friday September 25, 2026 08:00 PM thru Saturday October 3, 2026 06:00 AM, right lane closed", "America/New_York"))
      .toEqual({ validFrom: "2026-09-26T00:00:00.000Z", validUntil: "2026-10-03T10:00:00.000Z" });
    expect(scheduleFromDescription("Pothole patching.", "America/New_York")).toBeNull();
    expect(roadFromDescription("NJDOT - STMC: Roadwork on US 22 Eastbound between East of N. Main St")).toBe("US 22");
    expect(roadFromDescription("Roadwork on NJ 57 Westbound")).toBe("NJ 57");
  });

  it("a scheduled window replaces unverified feed dates", () => {
    const [record] = parseWzdxFeed({ features: [{ id: "a", properties: {
      core_details: { event_type: "work-zone", road_names: ["East of N. Main St"], description: "Roadwork on US 22 Eastbound, Friday October 2, 2026 09:00 AM thru 03:00 PM, right lane closed" },
      start_date: "2026-09-26T01:24:07-04:00", end_date: "2026-10-02T15:00:00-04:00", is_start_date_verified: false, vehicle_impact: "some-lanes-closed",
    }, geometry: { type: "Point", coordinates: [-74.4, 40.8] } }] }, "wzdx");
    expect(record).toMatchObject({ roadName: "US 22", validFrom: "2026-10-02T13:00:00.000Z" });
  });

  it("unwraps a feed that JSON-encodes its collection twice (NJIT, live)", async () => {
    const collection = { type: "FeatureCollection", features: [] };
    expect(decodeFeedBody(JSON.stringify(collection))).toEqual(collection);
    expect(decodeFeedBody(collection)).toBe(collection);
    const wzdx = createWzdxSource({
      info: { id: "wzdx", label: "Feed", authority: "authoritative-operational", coverage: [corridor], precedence: 1 },
      url: "https://example.test/wzdx",
      fetch: (async () => json(JSON.stringify(collection))) as unknown as typeof fetch,
    });
    expect((await wzdx.snapshot(corridor, signal)).status).toBe("fresh");
  });

  it("an outage after a good answer serves it as stale; with none it is unavailable", async () => {
    let clock = 0;
    const fetcher = vi.fn(async () => json({ type: "FeatureCollection", features: [] }));
    const wzdx = createWzdxSource({
      info: { id: "wzdx", label: "Feed", authority: "authoritative-operational", coverage: [corridor], precedence: 1 },
      url: "https://example.test/wzdx",
      fetch: fetcher as unknown as typeof fetch,
      now: () => clock,
    });
    expect((await wzdx.snapshot(corridor, signal)).status).toBe("fresh");
    clock = 120_000;
    fetcher.mockRejectedValueOnce(new Error("down"));
    expect((await wzdx.snapshot(corridor, signal)).status).toBe("stale");
    clock = 3_600_000;
    fetcher.mockRejectedValueOnce(new Error("down"));
    expect((await wzdx.snapshot(corridor, signal)).status).toBe("unavailable");
  });
});

describe("USFS MVUM", () => {
  it("reads dates and street-legal motorcycle access", () => {
    expect(parseMvumDates("05/15-12/15")).toEqual([{ startMonth: 5, startDay: 15, endMonth: 12, endDay: 15 }]);
    expect(parseMvumDates("garbage")).toEqual([]);
    expect(motorcycleAccessOf({ passengervehicle: "open", passengervehicle_datesopen: "01/01-12/31" }, "road")).toEqual({ status: "open", seasons: null });
    expect(motorcycleAccessOf({ highclearancevehicle: "open", highclearancevehicle_datesopen: "04/01-11/30" }, "road"))
      .toEqual({ status: "open", seasons: [{ startMonth: 4, startDay: 1, endMonth: 11, endDay: 30 }] });
    expect(motorcycleAccessOf({ atv: "open" }, "trail")).toEqual({ status: "closed", seasons: null });
    expect(motorcycleAccessOf({ highclearancevehicle: "open" }, "trail")).toEqual({ status: "closed", seasons: null });
    expect(motorcycleAccessOf({}, "road")).toEqual({ status: "unknown", seasons: null });
    expect(motorcycleAccessOf({ highclearancevehicle: "open", seasonal: "seasonal" }, "road")).toEqual({ status: "open", seasons: [] });
  });

  it("ingests each cell once and reports partial coverage when a cell fails", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (new URL(url).searchParams.get("geometry")?.startsWith("-77,")) throw new Error("down");
      return json({ features: [{ attributes: { objectid: 1, name: "DUTCHMAN", id: "500", highclearancevehicle: "open" }, geometry: { paths: [[[-75.5, 40.5], [-75.5, 40.51]]] } }] });
    });
    const mvum = createMvumSource({ fetch: fetcher as unknown as typeof fetch });
    // Spans two one-degree cells; the western one fails.
    const first = await mvum.snapshot({ west: -76.2, south: 40.4, east: -75.4, north: 40.8 }, signal);
    expect(first.status).toBe("fresh");
    expect(first.covered).toEqual([{ west: -76, south: 40, east: -75, north: 41 }]);
    expect(first.reason).toMatch(/only part/);
    expect(first.records[0]).toMatchObject({ kind: "motor-vehicle-designation", roadName: "Dutchman (FS 500)", motorcycleAccess: { status: "open" } });
    const calls = fetcher.mock.calls.length;
    await mvum.snapshot({ west: -75.5, south: 40.5, east: -75.45, north: 40.55 }, signal);
    expect(fetcher.mock.calls.length).toBe(calls);
  });

});

describe("WZDx registry (every keyless state feed)", () => {
  const registry = [
    { active: true, needapikey: false, version: "4.1", format: "geojson", state: "new jersey", feedname: "njdot", issuingorganization: "NJIT", url: { url: "https://nj.test/wzdx" } },
    { active: true, needapikey: false, version: "4.1", format: "geojson", state: "new york", feedname: "nysdot", url: { url: "https://ny.test/wzdx" } },
    { active: true, needapikey: true, version: "4.1", format: "geojson", state: "pennsylvania", feedname: "ptc", url: { url: "https://pa.test/wzdx?api_key=X" } },
    { active: false, needapikey: false, version: "4.1", format: "geojson", state: "ohio", url: { url: "https://oh.test/wzdx" } },
    { active: true, needapikey: false, version: "3.1", format: "geojson", state: "n/a", url: { url: "https://qc.test/wzdx" } },
  ];

  it("keeps only active, keyless, WZDx 4 feeds for known states", () => {
    expect(usableRegistryFeeds(registry).map((feed) => feed.id)).toEqual(["wzdx-njdot", "wzdx-nysdot"]);
  });

  it("asks only the feeds a corridor touches, and marks states without a feed as unknown", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("datahub") ? json(registry) : json({ type: "FeatureCollection", features: [] }));
    const source = createWzdxRegistrySource({ registryUrl: "https://datahub.test/registry", fetch: fetcher as unknown as typeof fetch });
    // Easton, PA to Phillipsburg, NJ: across the Delaware.
    const snapshot = await source.snapshot({ west: -75.3, south: 40.6, east: -75.1, north: 40.75 }, signal);
    const asked = fetcher.mock.calls.map(([url]) => url).filter((url) => !url.includes("datahub"));
    // New York's coarse box reaches Easton too; an extra ask is harmless.
    expect(asked).toContain("https://nj.test/wzdx");
    expect(asked).not.toContain("https://pa.test/wzdx?api_key=X");
    expect(snapshot.status).toBe("fresh");
    // Pennsylvania has no keyless feed: its box is an area this answer cannot speak for.
    expect(snapshot.unknownAreas).toContainEqual(US_STATE_BOXES["pennsylvania"]);
  });

  it("its records carry its own source id, so the coordinator can weigh them", async () => {
    const feed = { type: "FeatureCollection", features: [{ id: "z1", type: "Feature",
      properties: { core_details: { event_type: "work-zone" }, vehicle_impact: "all-lanes-closed" },
      geometry: { type: "LineString", coordinates: [[-74.9, 40.9], [-74.89, 40.91]] } }] };
    const fetcher = vi.fn(async (url: string) => (url.includes("datahub") ? json(registry) : json(feed)));
    const source = createWzdxRegistrySource({ registryUrl: "https://datahub.test/registry", fetch: fetcher as unknown as typeof fetch });
    const snapshot = await source.snapshot({ west: -75, south: 40.8, east: -74.8, north: 41 }, signal);
    expect(snapshot.records[0]).toMatchObject({ sourceId: "wzdx-states", sourceRecordId: "wzdx-njdot:z1", kind: "closure" });
  });

  it("a registry outage is unavailable, never clear", async () => {
    const source = createWzdxRegistrySource({ fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
    expect((await source.snapshot(corridor, signal)).status).toBe("unavailable");
  });
});
