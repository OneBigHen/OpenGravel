import { describe, expect, it } from "vitest";
import { buildLiveSuggestionIntent, buildNetworkSuggestionIntent } from "@/application/free-ride/suggestion-request";
import type { FreeRideNetworkOpportunity } from "@/application/free-ride/network-opportunities";
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


describe("buildNetworkSuggestionIntent", () => {
  it("routes through the network corridor to a real onward rejoin while retaining ride constraints", () => {
    const opportunity: FreeRideNetworkOpportunity = {
      id: "network:fixture:corridor",
      corridorId: "corridor",
      expectedUtility: 0.9,
      confidence: 0.8,
      origin: { lon: -77, lat: 40 },
      destination: { lon: -76.95, lat: 40.04 },
      via: [
        { lon: -76.99, lat: 40.01 },
        { lon: -76.96, lat: 40.03 },
      ],
      routeFragment: [
        { lon: -76.99, lat: 40.01 },
        { lon: -76.98, lat: 40.02 },
        { lon: -76.96, lat: 40.03 },
      ],
      triggerDistanceMeters: 900,
    };

    const next = buildNetworkSuggestionIntent({
      document,
      opportunity,
      accuracyMeters: 7,
      at: "2026-09-22T12:12:00.000Z",
    });

    expect(next.shape).toBe("destination");
    expect(next.start?.coordinate).toEqual(opportunity.origin);
    expect(next.finish?.coordinate).toEqual(opportunity.destination);
    expect(next.finish?.provenance).toEqual({
      type: "derived",
      reason: "directed Free Ride network rejoin",
    });
    expect(next.stops).toEqual([]);
    expect(next.sketch).toBeNull();
    expect(next.shaping.map((point) => point.coordinate)).toEqual(opportunity.via);
    expect(next.shaping.every((point) => point.source === "import")).toBe(true);

    expect(next.surface).toEqual(document.intent.surface);
    expect(next.terrain).toEqual(document.intent.terrain);
    expect(next.bike).toEqual(document.intent.bike);
    expect(next.avoidAreas).toEqual(document.intent.avoidAreas);
    expect(next.roadSpans).toEqual(document.intent.roadSpans);
    expect(next.avoidHighways).toBe(true);
    expect(next.tollPolicy).toBe("avoid");
  });
});
