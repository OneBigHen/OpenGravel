import { fixtureElevations } from "@/server/elevation/handler";
import { fnv1a64Hex } from "@/application/planner/build-plan-request";
import type { PlanRideInput, PlanServiceDeps, PlanServiceResult } from "./plan-service";
import { createHikeProvider, HikeRoutingError } from "@/infrastructure/routing/graphhopper/hike-provider";
import { newRouteCandidateId } from "@/domain/route/ids";
import type { RouteScoreComponents, RouteWarning } from "@/domain/route/types";
import type { RoutePlanCandidate } from "@/application/planner/ports/route-plan-contract";

/** Hiking bypasses every motorcycle lane, scoring rule and fallback. */
export async function planHike(input: PlanRideInput, deps: PlanServiceDeps): Promise<PlanServiceResult> {
  const env = deps.env ?? process.env;
  const url = env.OGV_HIKE_GRAPHHOPPER_URL?.trim();
  if (!url && !deps.provider) return unavailable();
  const signal = deps.signal ?? new AbortController().signal;
  if (input.request.avoidPolygons.length || input.request.roadSpans?.length) return { ok: false, error: { code: "constraint-conflict", message: "Hike routing cannot yet honor avoid areas or road constraints. Remove them before planning.", recoverable: false } };
  try {
    const provider = deps.provider ?? createHikeProvider({ url: url!, ...(env.OGV_ELEVATION_FIXTURE === "1" ? { elevation: { elevations: async (points) => fixtureElevations(points) } } : {}), ...(env.OGV_HIKE_GRAPHHOPPER_API_KEY ? { apiKey: env.OGV_HIKE_GRAPHHOPPER_API_KEY } : {}) });
    const answer = await provider.candidates({ ...input.request, profile: "hike" }, signal);
    const source = answer.candidates[0];
    if (!source || source.profile !== "hike") throw new HikeRoutingError("no-trail-route");
    const warnings: RouteWarning[] = [];
    const warn = (code: string, message: string) => warnings.push({ id: `hike:${code}`, code, severity: "warning", message });
    const hike = source.hike;
    if (hike) {
      if (hike.roadMeters === null) warn("hike-roads-unknown", "Road distance unknown.");
      else if (hike.roadMeters > 1) warn("hike-roads", `${(hike.roadMeters / 1609.344).toFixed(1)} mi on roads`);
      hike.snapMeters.forEach((meters, index) => {
        if (meters > 300) warn(`hike-snap-${index}`, `${index === 0 ? "Starts" : index === hike.snapMeters.length - 1 ? (input.request.hikeReturnToStart ? "Turnaround" : "Ends") : `Waypoint ${index}`} ${(meters / 1609.344).toFixed(1)} mi from the nearest trail. Access to the trail is not included.`);
      });
      if (hike.elevationMeasuredShare < 0.999) warn("hike-elevation", "Elevation unknown for part of this hike. Tobler time uses flat terrain there; gain/loss may be incomplete.");
    }
    const components = Object.fromEntries(["curvature", "backroad", "surfaceFit", "elevation", "traffic", "junctionFriction", "novelty", "closureRisk", "timeCost", "confidence"].map(key => [key, { input: null, weight: 0, contribution: 0, explanationKey: "hike.unscored", evidenceStatus: "unknown" }])) as unknown as RouteScoreComponents;
    const candidate: RoutePlanCandidate = { id: newRouteCandidateId(), provider: { providerId: provider.id, profile: "hike" }, geometry: source.geometry, distanceMeters: source.distanceMeters, durationSeconds: source.durationSeconds, eligibility: { eligible: true, failures: [] }, evidence: {}, score: { policyVersion: "hike-v1", total: 0, components }, warnings, fingerprint: `hike:${fnv1a64Hex(JSON.stringify(source.geometry))}`, ...(hike ? { hike } : {}) };
    return { ok: true, identity: input.identity, bundle: { policyVersion: "hike-v1", graphVersion: env.OGV_GRAPH_VERSION ?? "unknown", evidenceVersion: "unknown", candidates: [candidate], roles: { "best-ride": candidate.id, fastest: candidate.id, "fast-and-fun": null, "more-twisties": null, "more-dirt": null, "lower-workload": null }, selectedRouteId: candidate.id, selectionSource: "automatic" }, diagnostics: { optionalProvidersUnavailable: [] } };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof HikeRoutingError) return { ok: false, error: { code: error.code, message: error.message, recoverable: error.code === "hike-routing-unavailable" } };
    return unavailable();
  }
}
function unavailable(): PlanServiceResult { return { ok: false, error: { code: "hike-routing-unavailable", message: "Hike routing unavailable. The trail router is not configured or could not be reached.", recoverable: true } }; }
