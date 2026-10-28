import { describe, expect, it, vi } from "vitest";
import { createHikeProvider } from "@/infrastructure/routing/graphhopper/hike-provider";
import type { ProviderRouteRequest, RouteCandidateProvider } from "@/application/planner/route-provider";
import { planRide } from "@/server/planning/plan-service";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";
import { providerStates } from "@/server/health/provider-registry";
import { withOfflineFallback } from "@/application/offline/offline-route-fallback";
import { toblerTime } from "@/domain/hike/time";
import { buildHikeProfile } from "@/domain/hike/profile";
import { hikeElevationLine } from "@/infrastructure/routing/graphhopper/hike-provider";

const origin = { lon: -75.99, lat: 40.63 }, destination = { lon: -75.994, lat: 40.642 };
const request: ProviderRouteRequest = { requestId: "hike", origin, destination, stops: [], shaping: [], profile: "hike", avoidPolygons: [], options: { vehicle: "motorcycle", includeAlternatives: true, avoidHighways: false, tollPolicy: "avoid" } };
const input = { identity: { rideId: "hike", rideRevision: 1, planningGeneration: 1 }, request };
const xy = (p: typeof origin) => [p.lon, p.lat];
function fixture(points = [origin, destination]) {
  return { paths: [{ distance: 1500, time: 1, points: { coordinates: points.map(xy) }, snapped_waypoints: { coordinates: points.map(xy) }, details: { road_class: [[0, points.length - 1, "path"]] } }] };
}
const elevation = { elevations: vi.fn(async (points: readonly unknown[]) => ({ availability: "available" as const, elevationsMeters: points.map((_, i) => 100 + i * 2) })) };
function provider(body = fixture(), status = 200) {
  const fetcher = vi.fn(async () => Response.json(body, { status }));
  return { fetcher, router: createHikeProvider({ url: "http://hike.invalid", apiKey: "test-key", fetcher, elevation }) };
}
const signal = () => new AbortController().signal;

describe("isolated hike routing", () => {
  it("requires dedicated configuration even when motorcycle and fixture routers are configured", async () => {
    const result = await planRide(input, { env: { GRAPHHOPPER_URL: "http://rider.invalid", GRAPHHOPPER_API_KEY: "rider-key", OGV_ROUTE_PLAN_FIXTURE: "1" } });
    expect(result).toMatchObject({ ok: false, error: { code: "hike-routing-unavailable" } });
    const http = await handleRoutePlanRequest(input, { plan: async () => result });
    expect(http.status).toBe(502);
    expect(JSON.stringify(http.body)).not.toMatch(/rider.invalid|rider-key/);
  });
  it("sends hike and ordered stops; times its own elevation instead of the engine's motorcycle-like time", async () => {
    const stop = { lon: -75.991, lat: 40.636 };
    const { router, fetcher } = provider(fixture([origin, stop, destination]));
    const answer = await router.candidates({ ...request, stops: [stop] }, signal());
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://hike.invalid/route?key=test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ profile: "hike", points: [origin, stop, destination].map(xy), points_encoded: false });
    const candidate = answer.candidates[0]!;
    const line = hikeElevationLine(candidate.geometry);
    const expected = toblerTime(buildHikeProfile(line, line.map((_, i) => 100 + i * 2)));
    expect(candidate.durationSeconds).toBeCloseTo(expected.preciseMinutes * 60);
    expect(candidate.hike).toMatchObject({ gainMeters: (line.length - 1) * 2, lossMeters: 0, roadMeters: 0, elevationMeasuredShare: 1 });
  });
  it("there and back reverses the routed line and measures both directions", async () => {
    const { router } = provider();
    const answer = await router.candidates({ ...request, hikeReturnToStart: true }, signal());
    const candidate = answer.candidates[0]!;
    expect(candidate.geometry).toEqual([origin, destination, origin]);
    expect(candidate.distanceMeters).toBe(3000);
    // Distinct directional elevations are sampled on the entire return line.
    expect(elevation.elevations).toHaveBeenLastCalledWith(hikeElevationLine(candidate.geometry), expect.any(AbortSignal));
  });
  it("surfaces roads and remote trail approaches without inventing a connector", async () => {
    const snapped = { ...origin, lat: origin.lat + 0.006 };
    const raw = fixture([snapped, destination]);
    raw.paths[0]!.details.road_class = [[0, 1, "tertiary"]];
    const { router } = provider(raw);
    const result = await planRide(input, { provider: router, env: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const candidate = result.bundle.candidates[0]!;
    expect(candidate.geometry[0]).toEqual(snapped);
    expect(candidate.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "hike-roads" }), expect.objectContaining({ message: expect.stringContaining("Starts 0.4 mi from the nearest trail") })]));
  });
  it("keeps absent elevation and road details unknown", async () => {
    const raw = fixture();
    const router = createHikeProvider({ url: "http://hike.invalid", fetcher: async () => Response.json({ paths: [{ ...raw.paths[0], details: {} }] }), elevation: { elevations: async () => ({ availability: "unavailable", reason: "No DEM" }) } });
    const answer = await router.candidates(request, signal());
    expect(answer.candidates[0]?.hike).toMatchObject({ gainMeters: null, lossMeters: null, roadMeters: null, elevationMeasuredShare: 0 });
  });
  it("distinguishes no trail connection from outage and never exposes provider text", async () => {
    const router = createHikeProvider({ url: "http://hike.invalid", fetcher: async () => Response.json({ hints: [{ details: "com.graphhopper.util.exceptions.ConnectionNotFoundException", message: "secret diagnostic" }] }, { status: 400 }) });
    const result = await planRide(input, { provider: router });
    expect(result).toMatchObject({ ok: false, error: { code: "no-trail-route" } });
    expect(JSON.stringify(result)).not.toContain("secret diagnostic");
    const outage = createHikeProvider({ url: "http://hike.invalid", fetcher: async () => { throw new Error("private address"); } });
    expect(await planRide(input, { provider: outage })).toMatchObject({ ok: false, error: { code: "hike-routing-unavailable" } });
  });
  it("preserves cancellation and forbids offline motorcycle fallback even on transport failure", async () => {
    const abort = new AbortController(); abort.abort(new Error("cancelled"));
    const { router } = provider();
    await expect(router.candidates(request, abort.signal)).rejects.toThrow("cancelled");
    const engine = { route: vi.fn() };
    const offline = withOfflineFallback<RouteCandidateProvider>({ ...router, candidates: async () => { throw { code: "provider-unavailable", httpStatus: 502 }; } }, engine);
    await expect(offline.candidates(request, signal())).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(engine.route).not.toHaveBeenCalled();
  });
  it("reports the separate provider and never treats an API key alone as configuration", async () => {
    const absent = await providerStates({ OGV_HIKE_GRAPHHOPPER_API_KEY: "secret" });
    expect(absent.find(p => p.id === "graphhopper-hike")).toMatchObject({ configured: false, status: "unconfigured" });
    const configured = await providerStates({ OGV_HIKE_GRAPHHOPPER_URL: "http://hike.invalid" });
    expect(configured.find(p => p.id === "graphhopper-hike")).toMatchObject({ configured: true, status: "unknown" });
    expect(JSON.stringify(configured)).not.toContain("http://hike.invalid");
  });
});
