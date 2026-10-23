import { describe, expect, it, vi } from "vitest";

import { parseGpx } from "@/infrastructure/import/gpx-parser";
import {
  MAX_ROUTE_POINTS,
  buildPlannedRouteGpx,
  buildPlannedTrackGpx,
  buildTrackGpx,
  downloadExport,
  exportFilename,
  originalFileBytes,
  rideExportTitle,
  type ExportTrack,
} from "@/application/export/gpx-export";

const geometry = [
  { lon: -75, lat: 40 },
  { lon: -75.001, lat: 40.001 },
] as const;

/** A deterministic line long enough to exceed the route-point cap. */
function longLine(points: number): { lon: number; lat: number }[] {
  return Array.from({ length: points }, (_, index) => ({
    lon: -75 + index * 0.0001,
    lat: 40 + index * 0.0001,
  }));
}

function elementCount(xml: string, localName: string): number {
  return xml.match(new RegExp(`<${localName}[\\s>/]`, "g"))?.length ?? 0;
}

describe("GPX export", () => {
  it("writes a track file with the full line and named start, stop, and finish", () => {
    const line = longLine(40);
    const xml = buildPlannedTrackGpx({
      title: "Tom & Ada <loop>",
      geometry: line,
      createdTime: "2026-10-07T09:15:00.000Z",
      waypoints: [
        { name: "Start & go", coordinate: line[0]! },
        { name: "Fuel <stop>", coordinate: line[20]! },
        { name: "Finish", coordinate: line[39]! },
      ],
    });

    expect(xml).toContain('creator="OpenGravel"');
    expect(xml).toContain('version="1.1"');
    expect(xml).toContain("<metadata><name>Tom &amp; Ada &lt;loop&gt;</name><time>2026-10-07T09:15:00.000Z</time></metadata>");
    expect(elementCount(xml, "trk")).toBe(1);
    expect(elementCount(xml, "trkpt")).toBe(40);
    expect(elementCount(xml, "rtept")).toBe(0);
    expect(xml).not.toContain("<rte>");
    expect(elementCount(xml, "wpt")).toBe(3);
    expect(xml).toContain("<name>Start &amp; go</name>");
    expect(xml).toContain("<name>Fuel &lt;stop&gt;</name>");

    const roundTrip = parseGpx(xml, { filename: "round-trip.gpx" });
    expect(roundTrip.tracks).toHaveLength(1);
    expect(roundTrip.tracks[0]?.sourceKind).toBe("track");
    expect(roundTrip.tracks[0]?.name).toBe("Tom & Ada <loop>");
    expect(roundTrip.tracks[0]?.segments[0]).toHaveLength(40);
    expect(roundTrip.waypoints?.map((waypoint) => waypoint.name)).toEqual([
      "Start & go",
      "Fuel <stop>",
      "Finish",
    ]);
  });

  it("writes only known elevations into <ele> and never invents one", () => {
    const withElevation = buildPlannedTrackGpx({
      title: "Known elevation",
      geometry,
      elevation: [12, null],
    });
    expect(withElevation).toContain("<ele>12</ele>");
    expect(elementCount(withElevation, "ele")).toBe(1);

    const withoutElevation = buildPlannedTrackGpx({ title: "Unknown elevation", geometry });
    expect(withoutElevation).not.toContain("<ele>");
  });

  it("writes a bounded route file with no track duplicate", () => {
    const line = longLine(10_000);
    const xml = buildPlannedRouteGpx({ title: "Sunday loop", geometry: line });

    expect(elementCount(xml, "trk")).toBe(0);
    expect(xml).not.toContain("<trk");
    expect(elementCount(xml, "rte")).toBe(1);
    const routePoints = elementCount(xml, "rtept");
    expect(routePoints).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
    expect(routePoints).toBeGreaterThan(2);
    expect(xml).toContain(`<rtept lat="40" lon="-75" />`);
    expect(xml).toContain(`lat="${line.at(-1)!.lat}" lon="${line.at(-1)!.lon}"`);
    expect(new TextEncoder().encode(xml).byteLength).toBeLessThan(1_000_000);

    const roundTrip = parseGpx(xml, { filename: "route.gpx" });
    expect(roundTrip.tracks).toHaveLength(1);
    expect(roundTrip.tracks[0]?.sourceKind).toBe("route");
    expect(roundTrip.tracks[0]?.segments[0]?.[0]).toEqual(line[0]);
    expect(roundTrip.tracks[0]?.segments[0]?.at(-1)).toEqual(line.at(-1));
  });

  it("keeps stops and finish in a bounded route and names them there", () => {
    const line = longLine(5_000);
    const xml = buildPlannedRouteGpx({
      title: "Stops route",
      geometry: line,
      waypoints: [
        { name: "Start", coordinate: line[0]! },
        { name: "Fuel", coordinate: line[2_500]! },
        { name: "Finish", coordinate: line[4_999]! },
      ],
    });

    const routePoints = xml.slice(xml.indexOf("<rte>"));
    expect(routePoints).toContain("<name>Fuel</name>");
    expect(elementCount(xml, "rtept")).toBeLessThanOrEqual(MAX_ROUTE_POINTS);
  });

  it("round-trips a long planned line as one route without a duplicate", () => {
    const line = longLine(5_000);
    const route = parseGpx(buildPlannedRouteGpx({ title: "Sunday loop", geometry: line }), { filename: "r.gpx" });
    const track = parseGpx(buildPlannedTrackGpx({ title: "Sunday loop", geometry: line }), { filename: "t.gpx" });

    expect(route.tracks).toHaveLength(1);
    expect(track.tracks).toHaveLength(1);
    expect(track.tracks[0]?.segments[0]).toHaveLength(line.length);
  });

  it("echoes a route an exporter duplicated as both rte and trk once", () => {
    const line = longLine(20);
    const points = line.map((coordinate) => `<trkpt lat="${coordinate.lat}" lon="${coordinate.lon}" />`).join("");
    const routePoints = line.map((coordinate) => `<rtept lat="${coordinate.lat}" lon="${coordinate.lon}" />`).join("");
    const legacy = `<?xml version="1.0"?><gpx version="1.1" creator="OpenGravel" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Sunday loop</name></metadata><rte><name>Sunday loop</name>${routePoints}</rte><trk><name>Sunday loop</name><trkseg>${points}</trkseg></trk></gpx>`;

    const parsed = parseGpx(legacy, { filename: "legacy.gpx" });
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.sourceKind).toBe("track");
    expect(parsed.tracks[0]?.segments[0]).toHaveLength(20);
  });

  it("still reports two chooser entries for a genuine two-track file", () => {
    const first = `<trk><name>Morning</name><trkseg><trkpt lat="40" lon="-75" /><trkpt lat="40.01" lon="-75.01" /></trkseg></trk>`;
    const second = `<trk><name>Afternoon</name><trkseg><trkpt lat="41" lon="-76" /><trkpt lat="41.01" lon="-76.01" /></trkseg></trk>`;
    const xml = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${first}${second}</gpx>`;

    const parsed = parseGpx(xml, { filename: "two.gpx" });
    expect(parsed.tracks.map((track) => track.name)).toEqual(["Morning", "Afternoon"]);
  });

  it("preserves track segments and emits only known times", () => {
    const track: ExportTrack = {
      name: "Gapped ride",
      segments: [
        { coordinates: geometry, timestamps: [null, null], elevation: [null, null] },
        { coordinates: [{ lon: -76, lat: 41 }, { lon: -76.001, lat: 41.001 }], timestamps: ["2026-09-17T12:00:00.000Z", null], elevation: [5, null] },
      ],
    };
    const xml = buildTrackGpx({
      title: "Gapped ride",
      tracks: [track],
      waypoints: [{ name: "Camp & fuel", coordinate: geometry[0] }],
    });
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml).toContain("<time>2026-09-17T12:00:00.000Z</time>");
    expect(xml).not.toContain("1970");
    const noElevationXml = buildTrackGpx({
      title: "No elevation",
      tracks: [{ name: "No elevation", segments: [{ coordinates: geometry, elevation: [null, null] }] }],
    });
    expect(noElevationXml).not.toContain("<ele>");
    const roundTrip = parseGpx(xml, { filename: "gapped.gpx" });
    expect(roundTrip.tracks[0]?.segments).toHaveLength(2);
    expect(roundTrip.tracks[0]?.timestamps[0]).toEqual([null, null]);
    expect(roundTrip.tracks[0]?.timestamps[1]?.[1]).toBeNull();
    expect(roundTrip.waypoints?.map((waypoint) => waypoint.name)).toEqual(["Camp & fuel"]);
  });

  it("omits unnamed waypoint elements from fabricated names", () => {
    const xml = buildTrackGpx({
      title: "Unnamed source",
      tracks: [{ name: "Source", segments: [{ coordinates: geometry }] }],
      waypoints: [{ name: null, coordinate: geometry[0] }],
    });

    expect(xml).toContain('<wpt lat="40" lon="-75" />');
    expect(xml).not.toContain("Waypoint");
    expect(xml).not.toContain("Start");
    expect(xml).not.toContain("Finish");
  });

  it("creates bounded slug filenames and a dated fallback", () => {
    expect(exportFilename("Pine & River / Sunday", "planned-track")).toBe("opengravel-pine-river-sunday-planned-track.gpx");
    expect(exportFilename("***", "track")).toBe("opengravel-ride-track.gpx");
    expect(exportFilename("", "planned-route", { now: new Date(2026, 9, 7) })).toBe("opengravel-ride-2026-10-07-planned-route.gpx");
    expect(exportFilename("x".repeat(300), "original").length).toBeLessThanOrEqual(128);
    const originalFilename = exportFilename("Morning KMZ", "original", { extension: "kmz" });
    expect(originalFilename).toBe("opengravel-morning-kmz-original.kmz");
  });

  it("names an untitled ride by date without inventing a rider title", () => {
    const now = new Date(2026, 9, 7);
    expect(rideExportTitle("  Pine Loop  ")).toBe("Pine Loop");
    expect(rideExportTitle(null, now)).toBe("OpenGravel ride 2026-10-07");
    expect(rideExportTitle("", now)).toBe("OpenGravel ride 2026-10-07");
  });

  it("keeps original bytes unchanged", () => {
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    expect(Array.from(originalFileBytes(bytes))).toEqual(Array.from(bytes));
  });

  it("rejects degenerate route and track exports", () => {
    expect(() => buildPlannedRouteGpx({ title: "Empty", geometry: [] })).toThrow(/at least two geometry points/i);
    expect(() => buildPlannedTrackGpx({ title: "Empty", geometry: [] })).toThrow(/at least two geometry points/i);
    expect(() => buildTrackGpx({ title: "Empty", tracks: [] })).toThrow(/at least one track/i);
    expect(() => buildTrackGpx({ title: "Empty", tracks: [{ name: "Empty", segments: [{ coordinates: [] }] }] })).toThrow(/geometry point/i);
  });

  it("attaches the anchor during click and revokes it after the click task", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const anchor = document.createElement("a");
    anchor.click = vi.fn(() => {
      events.push(anchor.isConnected ? "click-attached" : "click-detached");
    });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {
      events.push("revoked");
    });
    const documentRef = {
      createElement: vi.fn(() => anchor),
      body: document.body,
    };

    downloadExport(Uint8Array.from([1, 2, 3]), "ride.gpx", documentRef);
    expect(events).toEqual(["click-attached"]);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(anchor.isConnected).toBe(true);
    vi.runAllTimers();
    expect(events).toEqual(["click-attached", "revoked"]);
    expect(anchor.isConnected).toBe(false);
    expect(createObjectUrl).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
