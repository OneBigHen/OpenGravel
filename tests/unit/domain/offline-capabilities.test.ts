import { describe, expect, it } from "vitest";

import {
  buildCapabilityMatrix,
  buildCorridorPackManifest,
  routeReadiness,
  type OfflineRuntimeFacts,
  type RouteReadinessInput,
} from "@/domain/offline/capabilities";

const NOW = "2026-09-18T12:00:00.000Z";
const FRESH = "2026-09-18T11:55:00.000Z";
const STALE = "2026-09-17T00:00:00.000Z";

function cache(presence: "present" | "absent" | "unknown", cachedAt = FRESH) {
  return { presence, cachedAt, maxAgeMs: 60 * 60 * 1000 } as const;
}

function facts(overrides: Partial<OfflineRuntimeFacts> = {}): OfflineRuntimeFacts {
  return {
    now: NOW,
    networkOnline: false,
    serviceWorker: { state: "controlled" },
    caches: {
      appShell: cache("present"),
      routeGeometry: cache("present"),
      routeInstructions: cache("present"),
      mapTiles: cache("present"),
      routeData: cache("present"),
      exploreCatalog: cache("present"),
      offlineGraph: cache("present"),
    },
    local: {
      library: { state: "available", reason: null },
      importExport: { state: "available", reason: null },
    },
    providers: {
      weather: { state: "available", reason: null },
      traffic: { state: "available", reason: null },
    },
    ...overrides,
  };
}

describe("offline capability matrix", () => {
  it("derives network-free capabilities from present fresh runtime facts", () => {
    const matrix = buildCapabilityMatrix(facts());

    expect(matrix["plan.route"].state).toBe("available");
    expect(matrix["plan.replan"].state).toBe("available");
    expect(matrix["nav.guidance"].state).toBe("available");
    expect(matrix["nav.reroute"].state).toBe("available");
    expect(matrix["explore.browse"].state).toBe("available");
    expect(matrix["weather.live"].state).toBe("requires_network");
    expect(matrix["traffic.live"].state).toBe("requires_network");
    expect(matrix["library.read"].state).toBe("available");
    expect(matrix["import.export"].state).toBe("available");
  });

  it("reports absent and stale facts without turning them into readiness", () => {
    const matrix = buildCapabilityMatrix(facts({
      caches: {
        ...facts().caches,
        appShell: cache("absent"),
        routeGeometry: cache("absent"),
        routeInstructions: { ...cache("present", STALE) },
        mapTiles: { ...cache("present", STALE) },
        offlineGraph: cache("absent"),
      },
      providers: {
        weather: { state: "unavailable", reason: "No cached forecast." },
        traffic: { state: "degraded", reason: "Traffic cache is stale." },
      },
    }));

    expect(matrix["plan.route"].state).toBe("requires_network");
    expect(matrix["plan.replan"].state).toBe("requires_network");
    expect(matrix["nav.guidance"].state).not.toBe("available");
    expect(matrix["nav.reroute"].state).toBe("requires_network");
    expect(matrix["explore.browse"].state).toBe("requires_network");
    expect(matrix["weather.live"]).toMatchObject({ state: "requires_network" });
    expect(matrix["traffic.live"]).toMatchObject({ state: "requires_network" });
    expect(matrix["nav.guidance"].reason).toMatch(/route geometry|shell/i);
  });

  it("does not call planning or explore available without a controlled app shell", () => {
    const matrix = buildCapabilityMatrix(facts({
      serviceWorker: { state: "absent" },
    }));

    expect(matrix["plan.route"].state).not.toBe("available");
    expect(matrix["plan.replan"].state).not.toBe("available");
    expect(matrix["explore.browse"].state).not.toBe("available");
  });
});

describe("corridor pack and route readiness", () => {
  const geometry = [
    { lon: -75.5, lat: 40 },
    { lon: -75.4, lat: 40 },
    { lon: -75.3, lat: 40 },
  ] as const;

  it("derives durable bounds, tile references, and provider data references", () => {
    const manifest = buildCorridorPackManifest({
      rideId: "ride_offline_1",
      routeRevision: 4,
      geometry,
      createdAt: NOW,
      dataRefs: ["graph:unknown", "road-data:unknown"],
    });

    expect(manifest).toMatchObject({
      version: 1,
      rideId: "ride_offline_1",
      routeRevision: 4,
      bounds: { minLon: -75.5, maxLon: -75.3, minLat: 40, maxLat: 40 },
      dataRefs: ["graph:unknown", "road-data:unknown"],
    });
    expect(manifest.tiles.length).toBeGreaterThan(0);
  });

  it.each([
    [0, 0, 0],
    [5, 10, 50],
    [10, 10, 100],
    [20, 10, 100],
  ] as const)("computes coverage at the %s/%s boundary", (ready, total, expected) => {
    const input: RouteReadinessInput = {
      now: NOW,
      rideId: "ride_offline_1",
      routeRevision: 4,
      manifest: buildCorridorPackManifest({
        rideId: "ride_offline_1",
        routeRevision: 4,
        geometry,
        createdAt: NOW,
      }),
      pieces: [
        { ref: "tile:ready", kind: "map-tile", lengthMeters: ready, state: "cached" },
        { ref: "tile:missing", kind: "map-tile", lengthMeters: Math.max(0, total - ready), state: "uncached" },
      ],
    };
    expect(routeReadiness(input).coveragePercent).toBe(expected);
  });

  it("never reports a route ready when any corridor piece is unknown, uncached, or stale", () => {
    const manifest = buildCorridorPackManifest({
      rideId: "ride_offline_1",
      routeRevision: 4,
      geometry,
      createdAt: NOW,
    });
    for (const state of ["unknown", "uncached", "stale"] as const) {
      const result = routeReadiness({
        now: NOW,
        rideId: "ride_offline_1",
        routeRevision: 4,
        manifest,
        pieces: [
          { ref: "tile:one", kind: "map-tile", lengthMeters: 100, state: "cached" },
          { ref: `tile:${state}`, kind: "map-tile", lengthMeters: 100, state },
        ],
      });

      expect(result.state).not.toBe("ready");
      expect(result.ready).toBe(false);
    }
  });
});
