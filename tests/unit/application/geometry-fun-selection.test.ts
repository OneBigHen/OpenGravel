import { describe, expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import { haversine } from "@/domain/geometry/analysis";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { candidateGeometryFun } from "@/application/planner/geometry-fun";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";

const origin = { lat: 40, lon: -75 }, destination = { lat: 40, lon: -74.8 };
function route(minutes: number, winding: boolean, roadClass = "secondary", roadAccess = "yes"): ProviderCandidate {
  // Winding: tight bends (about 8 km of road-bends-v1 bend metres), which is what the Curvy pick spends.
  const geometry = Array.from({ length: 1601 }, (_, i) => ({ lon: origin.lon + (destination.lon - origin.lon) * i / 1600, lat: 40 + (winding ? Math.sin(i / 1600 * Math.PI * 60) * 0.0008 : 0) }));
  const meters = geometry.slice(1).reduce((sum, p, i) => sum + haversine(geometry[i]!, p), 0);
  return { providerId: "test", profile: "motorcycle_twisty", geometry, durationSeconds: minutes * 60, distanceMeters: meters,
    roadSummary: { totalMeters: meters, surfaceByRoadClassMeters: { [`asphalt|${roadClass}`]: meters }, curvatureMeters: {}, tollMeters: 0,
      roadRuns: [{ meters, roadClass, roadAccess, carAccess: true, urbanDensity: roadClass === "residential" ? "residential" : "rural", roadEnvironment: "road", surface: "asphalt", toll: false, durationSeconds: null, curvatureRatio: null }] },
  };
}
const identity = { rideId: "fun-selection", rideRevision: 1, planningGeneration: 1 };
const fast = route(60, false);
const sweep = route(66, true);
const overBudget = route(90, true);
const farm = route(64, true, "residential");

function request(style: "balanced" | "curvy" | "efficient"): ProviderRouteRequest {
  return { requestId: "fun-selection", origin, destination, stops: [], shaping: [], avoidPolygons: [], profile: style === "curvy" ? "motorcycle_twisty" : "motorcycle_fastest",
    options: { includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid", surfacePreference: "mixed", roadCharacter: style, traffic: "protect-ride", vehicle: "motorcycle", bike: DEFAULT_BIKE },
  };
}
const provider = (candidates: readonly ProviderCandidate[]) => ({ id: "test", capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }), candidates: vi.fn(async () => ({ candidates })) });
const deps = { env: {}, roadAuthority: null };

describe("geometry owns Best Ride before diversity and role assignment", () => {
  it("Balanced retains its material tight-curve selection instead of buying broad sweeps", async () => {
    const ridge = route(66, true);
    const ridgeRoads = { ...ridge.roadSummary!, bendMeters: 0 };
    // Geometry fun likes this line, but the established Balanced evaluator
    // sees no additional tight-bend mileage and therefore keeps its incumbent.
    const result = await planRide({ identity, request: request("balanced") }, {
      ...deps, provider: { ...provider([]), candidates: vi.fn(async (r: ProviderRouteRequest) => ({ candidates:
        r.options.riderModeFactor === undefined ? [fast] : [{ ...ridge, roadSummary: ridgeRoads }],
      })) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)?.durationSeconds).toBe(fast.durationSeconds);
  });
  it.each(["curvy"] as const)("%s selects a legal sweeping line inside the real ETA budget", async style => {
    expect(candidateGeometryFun(sweep)!.headingDegreesPerKm).toBeGreaterThan(candidateGeometryFun(fast)!.headingDegreesPerKm);
    const result = await planRide({ identity, request: request(style) }, { ...deps, provider: provider([fast, overBudget, farm, sweep]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const best = result.bundle.candidates.find(c => c.id === result.bundle.roles["best-ride"])!;
    expect(best.durationSeconds).toBe(sweep.durationSeconds);
    expect(result.bundle.selectedRouteId).toBe(best.id);
    expect(best.geometry).toEqual(sweep.geometry);
  });
  it.each(["no", "private"])("never promotes a %s sweeping line", async access => {
    const result = await planRide({ identity, request: request("curvy") }, { ...deps, provider: provider([fast, route(66, true, "secondary", access)]) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)?.durationSeconds).toBe(fast.durationSeconds);
  });
  it("keeps Fast selection identical with rider modes enabled or disabled", async () => {
    const selected: unknown[] = [];
    for (const off of [false, true]) {
      const result = await planRide({ identity, request: request("efficient") }, { ...deps, env: { ...(off ? { OGV_RIDER_MODES: "off" } : {}) }, provider: provider([fast, sweep]) });
      expect(result.ok).toBe(true);
      if (result.ok) selected.push(result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)?.geometry);
    }
    expect(selected[0]).toEqual(selected[1]);
  });
  it("keeps an in-timebox fun recommendation as the selected loop", async () => {
    const loopRequest = { ...request("curvy"), destination: origin, discovery: { targetMinutes: 120, toleranceMinutes: 15 } };
    const result = await planRide({ identity, request: loopRequest }, { ...deps, provider: provider([route(100, false), route(121, true), route(145, true)].map(c => ({ ...c,
      geometry: [...c.geometry, ...c.geometry.slice(0, -1).reverse()], distanceMeters: c.distanceMeters * 2,
      roadSummary: { ...c.roadSummary!, totalMeters: c.roadSummary!.totalMeters * 2,
        surfaceByRoadClassMeters: { "asphalt|secondary": c.distanceMeters * 2 },
        roadRuns: c.roadSummary!.roadRuns!.map(r => ({ ...r, meters: r.meters * 2 })),
      },
    }))) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const best = result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)!;
    expect(best.durationSeconds).toBe(121 * 60);
    expect(result.bundle.roles["best-ride"]).toBe(best.id);
  });
});
