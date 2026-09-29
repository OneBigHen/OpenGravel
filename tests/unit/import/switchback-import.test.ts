import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { newGeometryRef } from "@/domain/ride/ids";
import { switchBackImportReport, switchBackTrackToRideDocument } from "@/application/import/switchback-import";
import type { ImportArtifact } from "@/application/import/import-artifact";
import { parseGpx } from "@/infrastructure/import/gpx-parser";

const ARTIFACT: ImportArtifact = {
  artifactId: "import_redacted_fixture",
  filename: "switchback-track-waypoints.gpx",
  mime: "application/gpx+xml",
  sizeBytes: 10,
  importedAt: "2026-09-24T12:00:00.000Z",
  originalRef: newGeometryRef(),
};

describe("SwitchBack import mapping", () => {
  it("keeps the source line and waypoint metadata while creating one typed ride revision", async () => {
    const fixture = await readFile(resolve("tests/fixtures/m10/switchback-track-waypoints.gpx"), "utf8");
    const parsed = parseGpx(fixture);
    const track = parsed.tracks[0]!;
    const document = switchBackTrackToRideDocument(ARTIFACT, track, parsed.waypoints ?? []);

    expect(document.provenance).toEqual({ type: "import", sourceId: ARTIFACT.artifactId, source: "SwitchBack" });
    expect(document.intent.start).toMatchObject({ coordinate: track.segments[0]?.[0], label: "Sample start" });
    expect(document.intent.finish).toMatchObject({ coordinate: track.segments[0]?.at(-1), label: "Sample finish" });
    expect(document.intent.shaping.map((point) => point.coordinate)).toEqual(track.segments[0]?.slice(1, -1));
    expect(document.revision).toBe(1);
    expect(document.history.entries).toHaveLength(1);
    expect(parsed.waypoints?.map((waypoint) => waypoint.name)).toContain("Named pass");
  });

  it("reports unsupported settings and records without pretending to restore RideSession", async () => {
    const fixture = await readFile(resolve("tests/fixtures/m10/switchback-recorded.gpx"), "utf8");
    const parsed = parseGpx(fixture);
    const report = switchBackImportReport(parsed);

    expect(report).toEqual(expect.arrayContaining([
      expect.stringContaining("avoid areas"),
      expect.stringContaining("bike profile"),
      expect.stringContaining("stop-versus-shaping"),
      expect.stringContaining("RideSession, ride-journal notes/photo metadata"),
      expect.stringContaining("Recorded ride · synthetic sample"),
    ]));
  });

  it("bounds the routed corridor and reports preserved waypoints beyond that bound", async () => {
    const fixture = await readFile(resolve("tests/fixtures/m10/switchback-track-waypoints.gpx"), "utf8");
    const parsed = parseGpx(fixture);
    const track = parsed.tracks[0]!;
    const interiorWaypoints = Array.from({ length: 34 }, (_, index) => ({
      name: `Synthetic point ${index + 1}`,
      coordinate: { lon: 0.11 + index / 10_000, lat: 0.11 + index / 10_000 },
      elevation: null,
      timestamp: null,
    }));
    const waypoints = [...(parsed.waypoints ?? []).filter((point) => point.name === "Sample start" || point.name === "Sample finish"), ...interiorWaypoints];
    const document = switchBackTrackToRideDocument(ARTIFACT, track, waypoints);
    const report = switchBackImportReport({ ...parsed, waypoints });

    expect(document.intent.shaping).toHaveLength(32);
    expect(report).toEqual(expect.arrayContaining([
      expect.stringContaining("2 additional interior GPX waypoints remain in saved import data"),
    ]));
  });
});
