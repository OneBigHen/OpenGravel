import { describe, expect, it, vi } from "vitest";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { createLiveSuggestionQuery } from "@/application/free-ride/live-suggestion-query";
import { buildFreeRideNetwork } from "@/application/free-ride/network-opportunities";
import { createRideDocument } from "@/domain/ride/create";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";

const document = createRideDocument({ now: "2026-09-22T12:00:00.000Z" });
const navigation: SessionNavigationState = {
  sessionId: "sess_live" as SessionNavigationState["sessionId"],
  activity: "free", resumeActivity: null, startedAt: "2026-09-22T12:00:00.000Z",
  endedAt: null, endReason: null,
  plan: { rideId: document.rideId, rideRevision: document.revision, route: null },
  recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: null,
  nextStopId: null, completedStopIds: [], remainingStopIds: [],
  position: { coordinate: { lon: -77, lat: 40 }, observedAt: "2026-09-22T12:00:00.000Z", ageMs: 0,
    accuracyMeters: 8, headingDegrees: 90, speedMps: 12, quality: "fresh-good" },
};

describe("createLiveSuggestionQuery", () => {
  it("plans only for the current document revision and persists a route handle", async () => {
    const geometry = createMemoryGeometryStore();
    let request: ProviderRouteRequest | null = null;
    const provider = {
      id: "api", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        request = next;
        return { candidates: [{
          providerId: "api", profile: "motorcycle", geometry: [
            { lon: -77, lat: 40 }, { lon: -76.999, lat: 40 }, { lon: -76.99, lat: 40 },
          ], distanceMeters: 900, durationSeconds: 240,
          instructions: [
            {
              text: "Continue",
              type: "continue",
              maneuver: "straight" as const,
              geometryIndex: 0,
              distanceMeters: 85,
              durationSeconds: 20,
              roadName: "Current Road",
            },
            {
              text: "Turn onto Old Mill Road",
              type: "turn",
              maneuver: "right" as const,
              geometryIndex: 1,
              distanceMeters: 815,
              durationSeconds: 220,
              roadName: "Old Mill Road",
            },
          ],
        }] };
      }),
    };
    const query = createLiveSuggestionQuery({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry,
      provider,
      rideHistory: async () => [{
        geometry: [{ lon: -77, lat: 40 }, { lon: -76.999, lat: 40 }],
        riddenAt: "2026-08-01T12:00:00.000Z",
      }],
      now: () => "2026-09-22T12:00:01.000Z",
    });

    const candidates = await query.propose(navigation, new AbortController().signal);

    expect(provider.beginAttempt).toHaveBeenCalledWith({
      rideId: document.rideId, rideRevision: document.revision, planningGeneration: expect.any(Number),
    });
    expect(request).toMatchObject({
      origin: navigation.position.coordinate,
      destination: expect.objectContaining({ lon: expect.any(Number), lat: expect.any(Number) }),
      profile: "motorcycle", options: { vehicle: "motorcycle", includeAlternatives: true },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.distanceToDecisionMeters).toBeGreaterThan(80);
    expect(candidates[0]!.distanceToDecisionMeters).toBeLessThan(90);
    expect(candidates[0]).toMatchObject({
      label: "Old Mill Road",
      entry: { lon: -76.999, lat: 40 },
      distanceToDecisionMeters: expect.any(Number),
      distanceMeters: 900,
      durationSeconds: 240,
      requiresUTurn: false,
    });
    expect(candidates[0]!.evidence?.novelty.status).toBe("estimated");
    expect(candidates[0]!.evidence?.novelty.value).toBeGreaterThan(0.8);
    expect(await geometry.get(candidates[0]!.routeGeometryRef!)).toMatchObject({
      payload: { kind: "line", coordinates: expect.arrayContaining([{ lon: -76.99, lat: 40 }]) },
    });
  });

  it("prefers one verified directed-network opportunity before generic projected search", async () => {
    const geometry = createMemoryGeometryStore();
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "unit-network-v1",
      graphVersion: "unit-graph-v1",
      segments: [
        {
          id: "approach",
          fromNodeId: "n0",
          toNodeId: "n1",
          geometry: [{ lon: -77, lat: 40 }, { lon: -76.99, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "creek-road",
          fromNodeId: "n1",
          toNodeId: "n2",
          geometry: [{ lon: -76.99, lat: 40 }, { lon: -76.98, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "rejoin",
          fromNodeId: "n2",
          toNodeId: "n3",
          geometry: [{ lon: -76.98, lat: 40 }, { lon: -76.97, lat: 40 }],
          lengthMeters: 900,
        },
      ],
      corridors: [{
        id: "creek-corridor",
        segmentIds: ["creek-road"],
        entryNodeId: "n1",
        exitNodeId: "n2",
        expectedUtility: 0.92,
        confidence: 0.9,
      }],
    });
    const requests: ProviderRouteRequest[] = [];
    const provider = {
      id: "api",
      capabilities: () => ({
        profiles: [],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        requests.push(next);
        return { candidates: [{
          providerId: "api",
          profile: "motorcycle",
          geometry: [
            { lon: -77, lat: 40 },
            { lon: -76.99, lat: 40 },
            { lon: -76.98, lat: 40 },
            { lon: -76.97, lat: 40 },
          ],
          distanceMeters: 2_700,
          durationSeconds: 360,
          providerMetadata: { fingerprint: "network-route" },
          instructions: [{
            text: "Turn onto Creek Road",
            type: "turn",
            maneuver: "right" as const,
            geometryIndex: 1,
            distanceMeters: 1_800,
            durationSeconds: 240,
            roadName: "Creek Road",
          }],
        }] };
      }),
    };
    const query = createLiveSuggestionQuery({
      rides: {
        loadRide: vi.fn(async () => ({ ok: true as const, document })),
      } as never,
      geometry,
      provider,
      network: () => network,
      now: () => "2026-09-22T12:00:01.000Z",
    });

    const candidates = await query.propose(
      navigation,
      new AbortController().signal,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      origin: navigation.position.coordinate,
      destination: { lon: -76.97, lat: 40 },
      shaping: [
        { lon: -76.99, lat: 40 },
        { lon: -76.98, lat: 40 },
      ],
      options: { includeAlternatives: false },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "network:unit-network-v1:creek-corridor",
      label: "Creek Road",
      entry: { lon: -76.99, lat: 40 },
      requiresUTurn: false,
    });
  });

  it("falls back to projected-ahead discovery when the routed network probe misses its corridor", async () => {
    const geometry = createMemoryGeometryStore();
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "unit-network-v1",
      graphVersion: "unit-graph-v1",
      segments: [
        {
          id: "approach",
          fromNodeId: "n0",
          toNodeId: "n1",
          geometry: [{ lon: -77, lat: 40 }, { lon: -76.99, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "creek-road",
          fromNodeId: "n1",
          toNodeId: "n2",
          geometry: [{ lon: -76.99, lat: 40 }, { lon: -76.98, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "rejoin",
          fromNodeId: "n2",
          toNodeId: "n3",
          geometry: [{ lon: -76.98, lat: 40 }, { lon: -76.97, lat: 40 }],
          lengthMeters: 900,
        },
      ],
      corridors: [{
        id: "creek-corridor",
        segmentIds: ["creek-road"],
        entryNodeId: "n1",
        exitNodeId: "n2",
        expectedUtility: 0.92,
        confidence: 0.9,
      }],
    });
    const requests: ProviderRouteRequest[] = [];
    const provider = {
      id: "api",
      capabilities: () => ({
        profiles: [],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        requests.push(next);
        if (next.shaping.length > 0) {
          return { candidates: [{
            providerId: "api",
            profile: "motorcycle",
            geometry: [
              { lon: -77, lat: 40 },
              { lon: -77, lat: 40.05 },
              { lon: -76.97, lat: 40.05 },
            ],
            distanceMeters: 8_000,
            durationSeconds: 600,
          }] };
        }
        return { candidates: [{
          providerId: "api",
          profile: "motorcycle",
          geometry: [
            { lon: -77, lat: 40 },
            { lon: -76.999, lat: 40 },
            { lon: -76.99, lat: 40 },
          ],
          distanceMeters: 900,
          durationSeconds: 240,
          instructions: [{
            text: "Turn onto Old Mill Road",
            type: "turn",
            maneuver: "right" as const,
            geometryIndex: 1,
            distanceMeters: 815,
            durationSeconds: 220,
            roadName: "Old Mill Road",
          }],
        }] };
      }),
    };
    const query = createLiveSuggestionQuery({
      rides: {
        loadRide: vi.fn(async () => ({ ok: true as const, document })),
      } as never,
      geometry,
      provider,
      network: () => network,
    });

    const candidates = await query.propose(
      navigation,
      new AbortController().signal,
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.options.includeAlternatives).toBe(false);
    expect(requests[1]?.options.includeAlternatives).toBe(true);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.label).toBe("Old Mill Road");
  });

  it("does not call the provider when the saved ride revision moved", async () => {
    const provider = { id: "api", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), beginAttempt: vi.fn(), candidates: vi.fn() };
    const query = createLiveSuggestionQuery({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document: { ...document, revision: document.revision + 1 } })) } as never,
      geometry: createMemoryGeometryStore(), provider,
    });
    expect(await query.propose(navigation, new AbortController().signal)).toEqual([]);
    expect(provider.candidates).not.toHaveBeenCalled();
  });

  it("does not re-suggest a segment the rider marked less like", async () => {
    const geometry = createMemoryGeometryStore();
    const provider = {
      id: "api", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
      beginAttempt: vi.fn(), candidates: vi.fn(async () => ({ candidates: [{
        providerId: "api", profile: "motorcycle", geometry: [{ lon: -77, lat: 40 }, { lon: -76.999, lat: 40 }],
        distanceMeters: 900, durationSeconds: 240, providerMetadata: { fingerprint: "disliked" },
      }] })),
    };
    const query = createLiveSuggestionQuery({
      rides: { loadRide: vi.fn(async () => ({ ok: true as const, document })) } as never,
      geometry, provider, dislikedSuggestionIds: () => ["disliked"],
    });
    expect(await query.propose(navigation, new AbortController().signal)).toEqual([]);
  });

  it("keeps a low-confidence network hint quiet and uses the proven fallback", async () => {
    const geometry = createMemoryGeometryStore();
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "low-confidence-v1",
      graphVersion: "unit-graph-v1",
      segments: [
        {
          id: "approach",
          fromNodeId: "n0",
          toNodeId: "n1",
          geometry: [{ lon: -77, lat: 40 }, { lon: -76.99, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "maybe-road",
          fromNodeId: "n1",
          toNodeId: "n2",
          geometry: [{ lon: -76.99, lat: 40 }, { lon: -76.98, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "rejoin",
          fromNodeId: "n2",
          toNodeId: "n3",
          geometry: [{ lon: -76.98, lat: 40 }, { lon: -76.97, lat: 40 }],
          lengthMeters: 900,
        },
      ],
      corridors: [{
        id: "maybe-corridor",
        segmentIds: ["maybe-road"],
        entryNodeId: "n1",
        exitNodeId: "n2",
        expectedUtility: 0.95,
        confidence: 0.2,
      }],
    });
    const requests: ProviderRouteRequest[] = [];
    const provider = {
      id: "api",
      capabilities: () => ({
        profiles: [],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      beginAttempt: vi.fn(),
      candidates: vi.fn(async (next: ProviderRouteRequest) => {
        requests.push(next);
        return { candidates: [{
          providerId: "api",
          profile: "motorcycle",
          geometry: [
            { lon: -77, lat: 40 },
            { lon: -76.999, lat: 40 },
            { lon: -76.99, lat: 40 },
          ],
          distanceMeters: 900,
          durationSeconds: 240,
          instructions: [{
            text: "Turn onto Old Mill Road",
            type: "turn",
            maneuver: "right" as const,
            geometryIndex: 1,
            distanceMeters: 815,
            durationSeconds: 220,
            roadName: "Old Mill Road",
          }],
        }] };
      }),
    };
    const query = createLiveSuggestionQuery({
      rides: {
        loadRide: vi.fn(async () => ({ ok: true as const, document })),
      } as never,
      geometry,
      provider,
      network: () => network,
    });

    const candidates = await query.propose(
      navigation,
      new AbortController().signal,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.shaping).toEqual([]);
    expect(requests[0]?.options.includeAlternatives).toBe(true);
    expect(candidates[0]?.label).toBe("Old Mill Road");
  });

  it("abandons a slow optional network probe quickly and falls back", async () => {
    const geometry = createMemoryGeometryStore();
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "slow-network-v1",
      graphVersion: "unit-graph-v1",
      segments: [
        {
          id: "approach",
          fromNodeId: "n0",
          toNodeId: "n1",
          geometry: [{ lon: -77, lat: 40 }, { lon: -76.99, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "good-road",
          fromNodeId: "n1",
          toNodeId: "n2",
          geometry: [{ lon: -76.99, lat: 40 }, { lon: -76.98, lat: 40 }],
          lengthMeters: 900,
        },
        {
          id: "rejoin",
          fromNodeId: "n2",
          toNodeId: "n3",
          geometry: [{ lon: -76.98, lat: 40 }, { lon: -76.97, lat: 40 }],
          lengthMeters: 900,
        },
      ],
      corridors: [{
        id: "good-corridor",
        segmentIds: ["good-road"],
        entryNodeId: "n1",
        exitNodeId: "n2",
        expectedUtility: 0.9,
        confidence: 0.9,
      }],
    });
    const requests: ProviderRouteRequest[] = [];
    const provider = {
      id: "api",
      capabilities: () => ({
        profiles: [],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      }),
      beginAttempt: vi.fn(),
      candidates: vi.fn((next: ProviderRouteRequest) => {
        requests.push(next);
        if (next.shaping.length > 0) {
          return new Promise<never>(() => {});
        }
        return Promise.resolve({ candidates: [{
          providerId: "api",
          profile: "motorcycle",
          geometry: [
            { lon: -77, lat: 40 },
            { lon: -76.999, lat: 40 },
            { lon: -76.99, lat: 40 },
          ],
          distanceMeters: 900,
          durationSeconds: 240,
          instructions: [{
            text: "Turn onto Fallback Road",
            type: "turn",
            maneuver: "right" as const,
            geometryIndex: 1,
            distanceMeters: 815,
            durationSeconds: 220,
            roadName: "Fallback Road",
          }],
        }] });
      }),
    };
    const query = createLiveSuggestionQuery({
      rides: {
        loadRide: vi.fn(async () => ({ ok: true as const, document })),
      } as never,
      geometry,
      provider,
      network: () => network,
      networkPolicy: { probeDeadlineMs: 5 },
    });

    const candidates = await query.propose(
      navigation,
      new AbortController().signal,
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]?.shaping.length).toBeGreaterThan(0);
    expect(requests[1]?.shaping).toEqual([]);
    expect(candidates[0]?.label).toBe("Fallback Road");
  });

});
