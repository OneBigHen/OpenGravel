import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { MAX_FILE_BYTES, MAX_SEGMENTS, MAX_TRACKS } from "@/application/import/limits";
import { parseGpx, type ParsedImport } from "@/infrastructure/import/gpx-parser";
import { parseImportBytes } from "@/infrastructure/import/import-bytes";
import { parseKml } from "@/infrastructure/import/kml-parser";

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Morning &amp; Loop</name></metadata>
  <wpt lat="40.0000" lon="-75.0000"><name>Start</name></wpt>
  <trk><name>First track</name><trkseg>
    <trkpt lat="40" lon="-75"><ele>100</ele><time>2026-09-17T12:00:00Z</time></trkpt>
    <trkpt lat="40.001" lon="-75.001"><ele>110</ele><time>2026-09-17T12:01:00Z</time></trkpt>
    <trkpt lat="999" lon="-75"><ele>bad</ele></trkpt>
  </trkseg><trkseg>
    <trkpt lat="41" lon="-76"><time>2026-09-17T12:05:00Z</time></trkpt>
    <trkpt lat="41.001" lon="-76.001" />
  </trkseg></trk>
  <rte><name>Second route</name>
    <rtept lat="39" lon="-74"><ele>5</ele></rtept>
    <rtept lat="39.001" lon="-74.001" />
  </rte>
</gpx>`;

const KML = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document><name>Mixed tracks</name>
    <Placemark><name>Line</name><LineString><coordinates>
      -75,40,12 -75.001,40.001,13 999,40,0
    </coordinates></LineString></Placemark>
    <Placemark><name>Timed</name><gx:Track>
      <when>2026-09-17T12:00:00Z</when><gx:coord>-75 40 20</gx:coord>
      <when>2026-09-17T12:01:00Z</when><gx:coord>-75.001 40.001 21</gx:coord>
    </gx:Track></Placemark>
  </Document>
</kml>`;

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("GPX parser", () => {
  it("retains GPX track versus route source shape and the optional track type", () => {
    const parsed = parseGpx(`<?xml version="1.0"?>
      <gpx version="1.1" creator="OpenGravel" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Synthetic saved ride</name><type>recorded ride</type><trkseg>
          <trkpt lat="0" lon="0"/><trkpt lat="0.001" lon="0.001"/>
        </trkseg></trk>
        <rte><name>Synthetic route-only export</name>
          <rtept lat="0" lon="0"/><rtept lat="0.001" lon="0.001"/>
        </rte>
      </gpx>`);

    expect(parsed.tracks.map((track) => track.sourceKind)).toEqual(["track", "route"]);
    expect(parsed.tracks[0]?.sourceType).toBe("recorded ride");
  });

  it("parses the redacted SwitchBack Track + Waypoints export shape and its description", async () => {
    const fixture = await readFile(resolve("tests/fixtures/m10/switchback-track-waypoints.gpx"), "utf8");
    const parsed = parseGpx(fixture, { filename: "switchback-sample.gpx" });

    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]).toMatchObject({ name: "Redacted sample loop", sourceKind: "track", sourceType: "motorcycle" });
    expect(parsed.sourceDescription).toContain("sample route profile");
    expect(parsed.waypoints?.map((waypoint) => waypoint.name)).toEqual(["Sample start", "Named pass", "Scenic bend", "Sample finish"]);
    const bareTrack = parseGpx(await readFile(resolve("tests/fixtures/m10/switchback-track.gpx"), "utf8"));
    expect(bareTrack.tracks[0]).toMatchObject({ sourceKind: "track", sourceType: "motorcycle" });
    expect(bareTrack.waypoints).toEqual([]);
  });

  it("identifies redacted route-only and recorded export variants", async () => {
    const routeFixture = await readFile(resolve("tests/fixtures/m10/switchback-route-only.gpx"), "utf8");
    const cuesFixture = await readFile(resolve("tests/fixtures/m10/switchback-cues.gpx"), "utf8");
    const recordedFixture = await readFile(resolve("tests/fixtures/m10/switchback-recorded.gpx"), "utf8");

    expect(parseGpx(routeFixture).tracks[0]?.sourceKind).toBe("route");
    expect(parseGpx(cuesFixture).tracks[0]?.sourceKind).toBe("route");
    const recorded = parseGpx(recordedFixture);
    expect(recorded.tracks[0]?.sourceType).toBe("recorded ride");
    expect(recorded.sourceDescription).toContain("Recorded ride");
  });

  it("preserves track and route segments with aligned elevation and timestamps", () => {
    const parsed = parseGpx(GPX, { filename: "morning.gpx" });

    expect(parsed.tracks.map((track) => track.name)).toEqual([
      "First track",
      "Second route",
    ]);
    expect(parsed.tracks[0]?.segments.map((segment) => segment.length)).toEqual([2, 2]);
    expect(parsed.tracks[0]?.elevation[0]).toEqual([100, 110]);
    expect(parsed.tracks[0]?.timestamps[0]).toEqual([
      "2026-09-17T12:00:00.000Z",
      "2026-09-17T12:01:00.000Z",
    ]);
    expect(parsed.tracks[0]?.elevation[1]).toEqual([null, null]);
    expect(parsed.tracks[1]?.segments).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toMatch(/invalid coordinate/i);
    expect(parsed.warnings.join(" ")).toMatch(/waypoint/i);
  });

  it("rejects malformed XML and an unsupported root", async () => {
    expect(() => parseGpx("<gpx version=\"1.1\"><trk>", { filename: "bad.gpx" })).toThrow(
      /malformed/i,
    );
    await expect(parseImportBytes(bytes("<svg />"), "route.svg")).rejects.toThrow(
      /GPX, KML, or KMZ/i,
    );
    await expect(parseImportBytes(Uint8Array.from([0xc3, 0x28]), "route.gpx")).rejects.toThrow(/UTF-8/i);
  });

  it("requires GPX 1.1 and bounds cumulative XML text", () => {
    expect(() => parseGpx("<gpx><trk><trkseg><trkpt lat=\"40\" lon=\"-75\"/><trkpt lat=\"40.001\" lon=\"-75.001\"/></trkseg></trk></gpx>", { filename: "old.gpx" })).toThrow(/1\.1/i);
    const first = "a".repeat(40_000);
    const second = "b".repeat(40_000);
    expect(() => parseGpx(`<gpx version=\"1.1\"><metadata><desc>${first}<!-- split -->${second}</desc></metadata></gpx>`, { filename: "text.gpx" })).toThrow(/string limit/i);
  });

  it("rejects a file at the over-limit boundary before parsing", async () => {
    const oversized = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(parseImportBytes(oversized, "large.gpx")).rejects.toThrow(/10 MB/i);
  });

  it("enforces total points, tracks, and segments at their boundaries", () => {
    const pointLimits = {
      MAX_TOTAL_POINTS: 2,
      MAX_TRACKS,
      MAX_SEGMENTS,
    };
    const twoPoints = parseGpx(
      `<gpx version="1.1"><trk><trkseg><trkpt lat="40" lon="-75"/><trkpt lat="40.001" lon="-75.001"/></trkseg></trk></gpx>`,
      { filename: "two.gpx", limits: pointLimits },
    );
    expect(twoPoints.tracks).toHaveLength(1);
    expect(() => parseGpx(
      `<gpx version="1.1"><trk><trkseg><trkpt lat="40" lon="-75"/><trkpt lat="40.001" lon="-75.001"/><trkpt lat="40.002" lon="-75.002"/></trkseg></trk></gpx>`,
      { filename: "three.gpx", limits: pointLimits },
    )).toThrow(/2-point|total points/i);
  });
});

describe("KML parser", () => {
  it("parses LineString and gx:Track as separate segments with metadata", () => {
    const parsed = parseKml(KML, { filename: "mixed.kml" });
    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0]?.segments[0]).toEqual([
      { lon: -75, lat: 40 },
      { lon: -75.001, lat: 40.001 },
    ]);
    expect(parsed.tracks[1]?.timestamps[0]).toEqual([
      "2026-09-17T12:00:00.000Z",
      "2026-09-17T12:01:00.000Z",
    ]);
    expect(parsed.tracks[1]?.elevation[0]).toEqual([20, 21]);
    expect(parsed.warnings.join(" ")).toMatch(/invalid coordinate/i);
  });

  it("does not auto-stitch disconnected GPX segments", () => {
    const parsed = parseGpx(GPX, { filename: "gaps.gpx" });
    expect(parsed.tracks[0]?.segments).toHaveLength(2);
    expect(parsed.tracks[0]?.segments[0]).not.toContainEqual(parsed.tracks[0]?.segments[1]?.[0]);
  });
});

describe("import cancellation and progress", () => {
  it("cancels from the pure parser boundary after a progress callback", async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    await expect(parseImportBytes(bytes(GPX), "route.gpx", {
      signal: controller.signal,
      onProgress: (value) => {
        progress.push(value.points);
        if (value.points > 0) controller.abort();
      },
    })).rejects.toThrow(/cancel/i);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("accepts a ParsedImport-shaped result for the worker contract", () => {
    const value: ParsedImport = { tracks: [], warnings: [] };
    expect(value).toEqual({ tracks: [], warnings: [] });
  });
});
