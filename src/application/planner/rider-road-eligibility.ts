import type { RouteEligibility, RouteEligibilityFailure } from "@/domain/route/eligibility";
import type { ProviderCandidate, ProviderRouteOptions } from "./route-provider";

/** Known current road restrictions remain hard gates after every generator. */
export function riderRoadEligibility(candidate: ProviderCandidate, options: Partial<ProviderRouteOptions>): RouteEligibility {
  const runs = candidate.roadSummary?.roadRuns ?? [];
  const failures: RouteEligibilityFailure[] = [];
  if (runs.some(run => run.meters > 0 && (run.surface === "sand" || run.carAccess === false || run.roadAccess === "private" || run.roadAccess === "no"))) {
    failures.push({ code: "access-prohibited", message: "The returned route includes a road this ride cannot use." });
  }
  const dualRough = options.bike?.category === "dual-sport" && options.bike.roughTracks === "allow";
  if (runs.some(run => run.meters > 0 && (run.trackType === "grade5" || (!dualRough && ["grade3", "grade4"].includes(run.trackType ?? "")) || ["horrible", "very_horrible", "impassable"].includes(run.smoothness ?? "") || (!dualRough && options.bike !== undefined && ["bad", "very_bad"].includes(run.smoothness ?? ""))))) {
    failures.push({ code: "bike-incompatible", message: "The returned route exceeds this bike's rough-road allowance." });
  }
  return { eligible: failures.length === 0, failures, warnings: [] };
}
