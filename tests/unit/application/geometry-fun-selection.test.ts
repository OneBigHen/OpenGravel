import { describe, expect, it, vi } from "vitest";
import { planRide } from "@/server/planning/plan-service";
import { haversine } from "@/domain/geometry/analysis";
import { DEFAULT_BIKE } from "@/domain/ride/create";
import { candidateGeometryFun } from "@/application/planner/geometry-fun";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";

const origin = { lat: 40, lon: -75 }, destination = { lat: 40, lon: -74.8 };
function route(minutes: number, winding: boolean, roadClass = "secondary", roadAccess = "yes"): ProviderCandidate {
  const geometry = Array.from({ length: 801 }, (_, i) => ({ lon: origin.lon + (destination.lon - origin.lon) * i / 800, lat: 40 + (winding ? Math.sin(i / 800 * Math.PI * 16) * 0.002 : 0) }));
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
const deps = { env: { OGV_JEV_FUN_JUDGE: "on", OGV_ATLAS_GENERATORS: "off" }, roadAuthority: null, funCharacterClassifier: null };

describe("geometry owns Best Ride before diversity and role assignment", () => {
  it.each(["balanced", "curvy"] as const)("%s selects a legal sweeping line inside the real ETA budget", async style => {
    expect(candidateGeometryFun(sweep)!.headingDegreesPerKm).toBeGreaterThan(candidateGeometryFun(fast)!.headingDegreesPerKm);
    const judge = { judge: vi.fn(async () => { throw new Error("Jev must not choose geometry fun routes"); }) };
    const result = await planRide({ identity, request: request(style) }, { ...deps, provider: provider([fast, overBudget, farm, sweep]), funJudge: judge });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const best = result.bundle.candidates.find(c => c.id === result.bundle.roles["best-ride"])!;
    expect(best.durationSeconds).toBe(sweep.durationSeconds);
    expect(result.bundle.selectedRouteId).toBe(best.id);
    expect(best.geometry).toEqual(sweep.geometry);
    expect(judge.judge).not.toHaveBeenCalled();
  });
  it.each(["no", "private"])("never promotes a %s sweeping line", async access => {
    const result = await planRide({ identity, request: request("balanced") }, { ...deps, provider: provider([fast, route(66, true, "secondary", access)]) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)?.durationSeconds).toBe(fast.durationSeconds);
  });
  it("keeps Fast selection identical with rider modes enabled or disabled", async () => {
    const selected: unknown[] = [];
    for (const off of [false, true]) {
      const result = await planRide({ identity, request: request("efficient") }, { ...deps, env: { ...deps.env, OGV_JEV_FUN_JUDGE: "off", ...(off ? { OGV_RIDER_MODES: "off" } : {}) }, provider: provider([fast, sweep]) });
      expect(result.ok).toBe(true);
      if (result.ok) selected.push(result.bundle.candidates.find(c => c.id === result.bundle.selectedRouteId)?.geometry);
    }
    expect(selected[0]).toEqual(selected[1]);
  });
  it("keeps an in-timebox fun recommendation as the selected loop", async () => {
    const loopRequest = { ...request("balanced"), destination: origin, discovery: { targetMinutes: 120, toleranceMinutes: 15 } };
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
