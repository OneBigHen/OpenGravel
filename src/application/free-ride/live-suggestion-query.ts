import type { GeometryStore } from "@/application/geometry/geometry-store";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type { ProviderCandidateSet, ProviderRouteRequest } from "@/application/planner/route-provider";
import { newRouteCandidateId } from "@/domain/route/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { LiveSuggestionCandidate } from "./live-suggestions";
import { buildLiveSuggestionIntent } from "./suggestion-request";
import { unknownEvidence, type EvidenceValue } from "@/domain/evidence/types";
import { haversine } from "@/domain/geometry/analysis";
import type { RouteInstruction } from "@/domain/route/types";
import type { Coordinate } from "@/domain/ride/types";

export interface LiveSuggestionRouteProvider {
  beginAttempt(identity: { readonly rideId: string; readonly rideRevision: number; readonly planningGeneration: number }): void;
  candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<ProviderCandidateSet>;
}

function bearingDegrees(from: { lon: number; lat: number }, to: { lon: number; lat: number }): number {
  const startLat = from.lat * Math.PI / 180;
  const endLat = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  return (Math.atan2(
    Math.sin(deltaLon) * Math.cos(endLat),
    Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon),
  ) * 180 / Math.PI + 360) % 360;
}

function headingDelta(left: number, right: number): number {
  return ((left - right + 540) % 360) - 180;
}

function actionableInstruction(
  instructions: readonly RouteInstruction[] | undefined,
  geometryLength: number,
): RouteInstruction | null {
  if (instructions === undefined) return null;
  return instructions.find((instruction) => {
    const index = instruction.geometryIndex;
    if (index === undefined || index < 0 || index >= geometryLength) return false;
    if (instruction.maneuver !== undefined && instruction.maneuver !== "straight") return true;
    return instruction.type === "turn" ||
      instruction.type === "keep-left" ||
      instruction.type === "keep-right" ||
      instruction.type === "roundabout";
  }) ?? null;
}

function distanceAlong(
  geometry: readonly Coordinate[],
  throughIndex: number,
): number {
  let meters = 0;
  for (let index = 0; index < throughIndex; index += 1) {
    const from = geometry[index];
    const to = geometry[index + 1];
    if (from === undefined || to === undefined) break;
    meters += haversine(from, to);
  }
  return meters;
}

function numericEvidence(value: EvidenceValue<unknown> | undefined, reason: string): EvidenceValue<number> {
  return value !== undefined && typeof value.value === "number" && Number.isFinite(value.value)
    ? value as EvidenceValue<number>
    : unknownEvidence(reason);
}

/** Routes a short ahead segment through the same constraints and endpoint as planning. */
export function createLiveSuggestionQuery(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly provider: LiveSuggestionRouteProvider;
  readonly dislikedSuggestionIds?: () => readonly string[];
  readonly now?: () => string;
}) {
  let generation = Math.max(1, Date.now());
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async propose(navigation: SessionNavigationState, signal: AbortSignal): Promise<readonly LiveSuggestionCandidate[]> {
      if (navigation.activity !== "free" || navigation.position.coordinate === null ||
          navigation.position.headingDegrees === null || navigation.position.observedAt === null ||
          navigation.position.accuracyMeters === null) return [];
      const loaded = await deps.rides.loadRide(navigation.plan.rideId);
      if (signal.aborted) throw signal.reason;
      if (loaded === null || !loaded.ok || loaded.document.revision !== navigation.plan.rideRevision) return [];
      const intent = buildLiveSuggestionIntent({
        document: loaded.document,
        origin: navigation.position.coordinate,
        headingDegrees: navigation.position.headingDegrees,
        accuracyMeters: navigation.position.accuracyMeters,
        at: navigation.position.observedAt,
        segmentDistanceMeters: 2_000,
      });
      const planningGeneration = ++generation;
      const planned = await buildProviderRequest(intent, {
        requestId: `free-suggestion-${planningGeneration}`,
        includeAlternatives: true,
        resolveGeometry: async (ref) => (await deps.geometry.get(ref))?.payload ?? null,
      });
      // If any authored geometry is missing, stay quiet instead of sending a
      // weakened request that appears to honor an exclusion or access span.
      if (!planned.ok || planned.unresolvedRefs.length > 0) return [];
      deps.provider.beginAttempt({
        rideId: navigation.plan.rideId,
        rideRevision: navigation.plan.rideRevision,
        planningGeneration,
      });
      const answer = await deps.provider.candidates(planned.request, signal);
      if (signal.aborted) throw signal.reason;
      const result: LiveSuggestionCandidate[] = [];
      const disliked = new Set(deps.dislikedSuggestionIds?.() ?? []);
      for (const candidate of answer.candidates) {
        if (
          candidate.geometry.length < 2 ||
          !Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters <= 0 ||
          !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0
        ) continue;
        const fingerprint = candidate.providerMetadata?.["fingerprint"];
        const suggestionId = typeof fingerprint === "string" ? fingerprint : `live-${result.length + 1}`;
        if (disliked.has(suggestionId)) continue;
        const decision = actionableInstruction(candidate.instructions, candidate.geometry.length);
        if (decision?.geometryIndex === undefined) continue;
        const decisionIndex = decision.geometryIndex;
        const entry = candidate.geometry[decisionIndex];
        const afterDecision = candidate.geometry[decisionIndex + 1];
        if (entry === undefined || afterDecision === undefined) continue;
        const roadName = decision.roadName?.trim() ||
          candidate.instructions?.find((instruction) =>
            instruction.roadName !== undefined && instruction.roadName.trim().length > 0,
          )?.roadName?.trim();
        const distanceToDecisionMeters = distanceAlong(candidate.geometry, decisionIndex);
        if (!Number.isFinite(distanceToDecisionMeters) || distanceToDecisionMeters < 0) continue;
        const geometry = await deps.geometry.put(
          { kind: "line", coordinates: candidate.geometry },
          { kind: "route", now: now() },
        );
        const decisionHeading = bearingDegrees(entry, afterDecision);
        const delta = headingDelta(decisionHeading, navigation.position.headingDegrees);
        result.push({
          id: suggestionId,
          label: roadName ?? "Suggested road",
          entry,
          distanceToDecisionMeters,
          distanceMeters: candidate.distanceMeters,
          route: { planningGeneration, routeId: newRouteCandidateId() },
          routeGeometryRef: geometry.geometryRef,
          durationSeconds: candidate.durationSeconds,
          headingDeltaDegrees: delta,
          requiresUTurn: Math.abs(delta) > 120,
          ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
          evidence: {
            roadCharacterFit: numericEvidence(candidate.assessment?.evidence.roadClassMix, "Road character is unknown."),
            surfaceFit: numericEvidence(candidate.assessment?.evidence.surfaceMix, "Surface evidence is unknown."),
            novelty: numericEvidence(candidate.assessment?.evidence.novelty, "Ride history is unknown."),
          },
        });
      }
      return result;
    },
  };
}
