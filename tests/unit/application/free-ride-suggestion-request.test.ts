import { describe, expect, it } from "vitest";
import { buildLiveSuggestionIntent } from "@/application/free-ride/suggestion-request";
import { newRideId, type ShapingId, type StopId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";

const document: RideDocument = {
  schemaVersion: 1,
  rideId: newRideId(),
  revision: 4,
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T12:00:00.000Z",
  title: "Saturday ride",
  provenance: { type: "new" },
  intent: {
    shape: "open",
    start: null,
    finish: null,
    stops: [{
      id: "stop_authored" as StopId, kind: "stop", coordinate: { lon: -77.02, lat: 40.02 },
      arrivalIntent: "fuel", provenance: { type: "derived", reason: "test" },
    }],
    shaping: [{ id: "shape_authored" as ShapingId, kind: "shape", coordinate: { lon: -77.03, lat: 40.03 }, source: "map-drag" }],
    time: { kind: "none" },
    departure: { kind: "now" },
    roadCharacter: "backroads",
    surface: { preference: "dirt-preferred", unknownSurfacePolicy: "avoid-when-possible" },
    terrain: { level: "known-easy-only" },
    traffic: "protect-ride",
    avoidHighways: true,
    tollPolicy: "avoid",
    bike: {
      bikeId: "bike_1", category: "adventure", fuelRangeMiles: 180, reserveMiles: 30,
      maintainedGravel: "allow", roughTracks: "avoid", unknownSurface: "avoid-when-possible",
    },
    avoidAreas: [],
    roadSpans: [],
    sketch: null,
    longTrip: null,
  },
  history: { entries: [], cursor: 0, baseIntent: {} as RideDocument["intent"], appliedProposalIds: [] },
};

describe("buildLiveSuggestionIntent", () => {
  it("routes ahead while retaining the ride's hard and preference constraints", () => {
    const next = buildLiveSuggestionIntent({
      document,
      origin: { lon: -77, lat: 40 },
      headingDegrees: 90,
      accuracyMeters: 8,
      at: "2026-09-22T12:10:00.000Z",
      segmentDistanceMeters: 2_000,
    });

    expect(next.shape).toBe("destination");
    expect(next.stops).toEqual([]);
    expect(next.shaping).toEqual([]);
    expect(next.sketch).toBeNull();
    expect(next.start?.coordinate).toEqual({ lon: -77, lat: 40 });
    expect(next.finish?.coordinate.lon).toBeGreaterThan(-77);
    expect(next.finish?.provenance).toEqual({
      type: "gps", accuracyMeters: 8, observedAt: "2026-09-22T12:10:00.000Z",
    });
    expect(next.surface).toEqual(document.intent.surface);
    expect(next.terrain).toEqual(document.intent.terrain);
    expect(next.bike).toEqual(document.intent.bike);
    expect(next.avoidAreas).toEqual(document.intent.avoidAreas);
    expect(next.roadSpans).toEqual(document.intent.roadSpans);
    expect(next.avoidHighways).toBe(true);
    expect(next.tollPolicy).toBe("avoid");
  });
});
