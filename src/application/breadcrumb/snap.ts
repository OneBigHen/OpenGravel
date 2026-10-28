import { getActivityMode } from "@/application/map/activity-mode";
import { createClientRouteCandidateProvider } from "@/application/planner/client-planning-service";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { haversine } from "@/domain/geometry/analysis";
import type { RideDocument } from "@/domain/ride/types";
import { profileFor } from "@/infrastructure/routing/graphhopper/profiles";

export async function snapBreadcrumbLeg(document: RideDocument, index: number, signal: AbortSignal) {
  const route = document.intent.breadcrumb;
  const start = route?.waypoints[index]?.coordinate;
  const end = route?.waypoints[index + 1]?.coordinate;
  if (start === undefined || end === undefined) throw new Error("This leg no longer exists.");
  const provider = createClientRouteCandidateProvider();
  provider.beginAttempt({ rideId: document.rideId, rideRevision: document.revision, planningGeneration: 1 });
  const intent = document.intent;
  const request: ProviderRouteRequest = {
    requestId: crypto.randomUUID(), origin: start, destination: end, stops: [], shaping: [], avoidPolygons: [],
    profile: getActivityMode() === "hike" ? "hike" : profileFor(intent),
    options: { includeAlternatives: false, avoidHighways: intent.avoidHighways, tollPolicy: intent.tollPolicy, surfacePreference: intent.surface.preference, roadCharacter: intent.roadCharacter, traffic: intent.traffic, bike: { category: intent.bike.category, maintainedGravel: intent.bike.maintainedGravel, roughTracks: intent.bike.roughTracks }, vehicle: "motorcycle" },
  };
  const answer = await provider.candidates(request, signal);
  const line = answer.candidates[0]?.geometry;
  if (line === undefined || line.length < 2 || haversine(start, line[0]!) > 100 || haversine(end, line[line.length - 1]!) > 100) throw new Error("No nearby trail or road was found for this leg.");
  return [start, ...line, end];
}
