import { describe, expect, it } from "vitest";

import {
  importBreadcrumbCandidates,
  importBreadcrumbDocument,
  pickImportBreadcrumbCandidate,
  type ImportBreadcrumbCandidate,
} from "@/application/import/import-breadcrumb";
import type { ImportArtifact } from "@/application/import/import-artifact";
import type { ParsedImport } from "@/application/import/types";
import { breadcrumbIssues } from "@/domain/breadcrumb/route";
import { MAX_BREADCRUMB_WAYPOINTS } from "@/domain/breadcrumb/thin";
import { validateRideIntent } from "@/domain/ride/validate";

const artifact: ImportArtifact = {
  artifactId: "import_test",
  filename: "sunday-cue-sheet.gpx",
  mime: "application/gpx+xml",
  sizeBytes: 128,
  importedAt: "2026-10-03T09:00:00.000Z",
  originalRef: "geo_original" as ImportArtifact["originalRef"],
};

const cueSheet: ParsedImport = {
  tracks: [],
  warnings: ["Preserved 3 GPX waypoints as metadata; they are not merged into the source track geometry."],
  waypoints: [
    { name: "Trailhead", coordinate: { lon: -75.7, lat: 40.1 }, elevation: 120, timestamp: null },
    { name: "Named pass", coordinate: { lon: -75.69, lat: 40.11 }, elevation: null, timestamp: null },
    { name: "Water", coordinate: { lon: -75.68, lat: 40.12 }, elevation: null, timestamp: null },
  ],
};

const routeOnly: ParsedImport = {
  tracks: [
    {
      name: "Grinder loop",
      sourceKind: "route",
      segments: [[{ lon: -75, lat: 40 }, { lon: -75.01, lat: 40.01 }, { lon: -75.02, lat: 40.005 }]],
      timestamps: [[null, null, null]],
      elevation: [[null, null, null]],
      pointNames: [[null, "Second turn", null]],
    },
  ],
  warnings: [],
};

function denseTrack(points: number): ParsedImport {
  return {
    tracks: [
      {
        name: "Recorded Sunday",
        sourceKind: "track",
        segments: [
          Array.from({ length: points }, (_value, index) => ({
            lon: -75 + index * 0.0002,
            lat: 40 + Math.sin(index / 30) * 0.004,
          })),
        ],
        timestamps: [Array.from({ length: points }, () => null)],
        elevation: [Array.from({ length: points }, () => null)],
      },
    ],
    warnings: [],
  };
}

function routeOf(candidate: ImportBreadcrumbCandidate) {
  return candidate.route;
}

describe("import breadcrumb candidates", () => {
  it("opens a cue sheet's waypoints as a route and keeps their names", () => {
    const candidates = importBreadcrumbCandidates(cueSheet);
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.source).toBe("waypoints");
    expect(candidate.trackIndex).toBeNull();
    expect(candidate.waypointCount).toBe(3);
    expect(candidate.thinned).toBe(false);
    expect(routeOf(candidate).waypoints.map((point) => point.name)).toEqual(["Trailhead", "Named pass", "Water"]);
    expect(routeOf(candidate).waypoints.map((point) => point.coordinate)).toEqual(
      cueSheet.waypoints!.map((waypoint) => waypoint.coordinate),
    );
    expect(breadcrumbIssues(routeOf(candidate))).toEqual([]);
  });

  it("keeps a route's named points and gives every waypoint a unique id", () => {
    const candidate = importBreadcrumbCandidates(routeOnly)[0]!;
    expect(candidate.source).toBe("route");
    expect(candidate.name).toBe("Grinder loop");
    expect(candidate.trackIndex).toBe(0);
    expect(routeOf(candidate).waypoints.map((point) => point.name)).toEqual([undefined, "Second turn", undefined]);
    const ids = routeOf(candidate).waypoints.map((point) => point.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(breadcrumbIssues(routeOf(candidate))).toEqual([]);
  });

  it("thins a dense track to the waypoint budget and says so", () => {
    const candidate = importBreadcrumbCandidates(denseTrack(900))[0]!;
    expect(candidate.source).toBe("track");
    expect(candidate.sourcePointCount).toBe(900);
    expect(candidate.waypointCount).toBeLessThanOrEqual(MAX_BREADCRUMB_WAYPOINTS);
    expect(candidate.thinned).toBe(true);
    expect(routeOf(candidate).waypoints).toHaveLength(candidate.waypointCount);
    expect(routeOf(candidate).legs.every((leg) => leg.kind === "straight" && leg.geometry.length === 2)).toBe(true);
    expect(breadcrumbIssues(routeOf(candidate))).toEqual([]);
    // The ends of the recorded line are still the ends of the breadcrumb.
    const source = denseTrack(900).tracks[0]!.segments[0]!;
    expect(routeOf(candidate).waypoints[0]!.coordinate).toEqual(source[0]);
    expect(routeOf(candidate).waypoints.at(-1)!.coordinate).toEqual(source.at(-1));
  });

  it("offers the file's own waypoints before its tracks and refuses fewer than two points", () => {
    const mixed: ParsedImport = { ...denseTrack(40), waypoints: cueSheet.waypoints };
    expect(importBreadcrumbCandidates(mixed).map((candidate) => candidate.id)).toEqual(["waypoints", "track_0"]);
    expect(importBreadcrumbCandidates({ tracks: [], warnings: [], waypoints: cueSheet.waypoints?.slice(0, 1) })).toEqual([]);
    expect(importBreadcrumbCandidates({ tracks: [], warnings: [] })).toEqual([]);
  });

  it("picks the requested candidate and reports a missing one as null", () => {
    const candidates = importBreadcrumbCandidates(denseTrack(40));
    expect(pickImportBreadcrumbCandidate(candidates)?.id).toBe("track_0");
    expect(pickImportBreadcrumbCandidate(candidates, "track_0")?.id).toBe("track_0");
    expect(pickImportBreadcrumbCandidate(candidates, "waypoints")).toBeNull();
  });
});

describe("imported breadcrumb ride", () => {
  it("commits the points through breadcrumb.set and validates as a ride", () => {
    const candidate = importBreadcrumbCandidates(denseTrack(300))[0]!;
    const document = importBreadcrumbDocument(artifact, candidate, { now: "2026-10-03T09:05:00.000Z" });

    expect(document.title).toBe("Recorded Sunday");
    expect(document.provenance).toEqual({ type: "import", sourceId: "import_test" });
    expect(document.intent.breadcrumb?.waypoints).toHaveLength(candidate.waypointCount);
    expect(document.intent.breadcrumb?.legs.every((leg) => leg.kind === "straight")).toBe(true);
    expect(validateRideIntent(document.intent)).toEqual([]);
    // One authored revision, undoable like a tapped breadcrumb.
    expect(document.revision).toBe(1);
    expect(document.history.entries.at(-1)?.label).toBe("Opened imported points as a breadcrumb");
    expect(document.intent.start).toBeNull();
    expect(document.intent.finish).toBeNull();
  });

  it("names the ride from the source, then the file, then a plain fallback", () => {
    const unnamed: ParsedImport = {
      tracks: [],
      warnings: [],
      waypoints: [
        { name: null, coordinate: { lon: -75, lat: 40 }, elevation: null, timestamp: null },
        { name: null, coordinate: { lon: -75.01, lat: 40.01 }, elevation: null, timestamp: null },
      ],
    };
    const candidate = importBreadcrumbCandidates(unnamed)[0]!;
    expect(importBreadcrumbDocument(artifact, candidate).title).toBe("sunday-cue-sheet");
    expect(importBreadcrumbDocument({ ...artifact, filename: ".gpx" }, candidate).title).toBe("Imported breadcrumb");
    expect(importBreadcrumbDocument(artifact, candidate, { title: "Saturday loop" }).title).toBe("Saturday loop");
  });
});
