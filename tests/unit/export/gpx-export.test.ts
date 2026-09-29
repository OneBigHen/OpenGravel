import { describe, expect, it, vi } from "vitest";

import { parseGpx } from "@/infrastructure/import/gpx-parser";
import {
  buildPlannedRouteGpx,
  buildTrackGpx,
  downloadExport,
  exportFilename,
  originalFileBytes,
  type ExportTrack,
} from "@/application/export/gpx-export";

const geometry = [
  { lon: -75, lat: 40 },
  { lon: -75.001, lat: 40.001 },
] as const;

describe("GPX export", () => {
  it("builds an escaped named route with rtept and a track fallback", () => {
    const xml = buildPlannedRouteGpx({
      title: "Tom & Ada <loop>",
      geometry,
      waypoints: [
        { name: "Start & go", coordinate: geometry[0] },
        { name: "Finish", coordinate: geometry[1] },
      ],
    });

    expect(xml).toContain("<rte>");
    expect(xml).toContain("<rtept lat=\"40\" lon=\"-75\" />");
    expect(xml).toContain("Tom &amp; Ada &lt;loop&gt;");
    expect(xml).toContain("<trk>");
    const roundTrip = parseGpx(xml, { filename: "round-trip.gpx" });
    expect(roundTrip.tracks[0]?.name).toBe("Tom & Ada <loop>");
    expect(roundTrip.waypoints?.map((waypoint) => waypoint.name)).toEqual(["Start & go", "Finish"]);
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

  it("creates bounded slug filenames", () => {
    expect(exportFilename("Pine & River / Sunday", "planned-route")).toBe("opengravel-pine-river-sunday-planned-route.gpx");
    expect(exportFilename("***", "track")).toBe("opengravel-ride-track.gpx");
    expect(exportFilename("x".repeat(300), "original").length).toBeLessThanOrEqual(128);
    const originalFilename = exportFilename("Morning KMZ", "original", { extension: "kmz" });
    expect(originalFilename).toBe("opengravel-morning-kmz-original.kmz");
  });

  it("keeps original bytes unchanged", () => {
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    expect(Array.from(originalFileBytes(bytes))).toEqual(Array.from(bytes));
  });

  it("rejects degenerate route and track exports", () => {
    expect(() => buildPlannedRouteGpx({ title: "Empty", geometry: [] })).toThrow(/at least two geometry points/i);
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
