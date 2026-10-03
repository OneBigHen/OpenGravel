import type { GeometryStore } from "@/application/geometry/geometry-store";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import type { RideRepositoryPort } from "@/application/persistence/ride-repository";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
} from "@/application/planner/route-provider";
import { newRouteCandidateId } from "@/domain/route/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { LiveSuggestionCandidate } from "./live-suggestions";
import {
  buildLiveSuggestionIntent,
  buildNetworkSuggestionIntent,
} from "./suggestion-request";
import {
  isUsableEvidence,
  unknownEvidence,
  type EvidenceValue,
} from "@/domain/evidence/types";
import {
  personalNoveltyEvidence,
  type PersonalRideTrace,
} from "@/application/roads/personal-road-history";
import { haversine } from "@/domain/geometry/analysis";
import type { RouteInstruction } from "@/domain/route/types";
import type { Coordinate } from "@/domain/ride/types";
import {
  findFreeRideNetworkOpportunities,
  freeRideFragmentTraversalRatio,
  type FreeRideNetworkIndex,
} from "./network-opportunities";

export interface LiveSuggestionRouteProvider {
  beginAttempt(identity: {
    readonly rideId: string;
    readonly rideRevision: number;
    readonly planningGeneration: number;
  }): void;
  candidates(
    request: ProviderRouteRequest,
    signal: AbortSignal,
  ): Promise<ProviderCandidateSet>;
}

const NETWORK_MINIMUM_TRAVERSAL_RATIO = 0.6;
const NETWORK_MINIMUM_CATALOG_UTILITY = 0.6;
const NETWORK_MINIMUM_CATALOG_CONFIDENCE = 0.65;
const NETWORK_PROBE_DEADLINE_MS = 2_500;
const MPS_TO_MPH = 2.2369362921;

export interface LiveSuggestionNetworkPolicy {
  readonly minimumExpectedUtility?: number;
  readonly minimumConfidence?: number;
  readonly probeDeadlineMs?: number;
}

interface ResolvedLiveSuggestionNetworkPolicy {
  readonly minimumExpectedUtility: number;
  readonly minimumConfidence: number;
  readonly probeDeadlineMs: number;
}

function resolvedNetworkPolicy(
  policy: LiveSuggestionNetworkPolicy | undefined,
): ResolvedLiveSuggestionNetworkPolicy {
  const minimumExpectedUtility =
    policy?.minimumExpectedUtility ?? NETWORK_MINIMUM_CATALOG_UTILITY;
  const minimumConfidence =
    policy?.minimumConfidence ?? NETWORK_MINIMUM_CATALOG_CONFIDENCE;
  const probeDeadlineMs =
    policy?.probeDeadlineMs ?? NETWORK_PROBE_DEADLINE_MS;

  return {
    minimumExpectedUtility:
      Number.isFinite(minimumExpectedUtility) &&
      minimumExpectedUtility >= 0 &&
      minimumExpectedUtility <= 1
        ? minimumExpectedUtility
        : NETWORK_MINIMUM_CATALOG_UTILITY,
    minimumConfidence:
      Number.isFinite(minimumConfidence) &&
      minimumConfidence >= 0 &&
      minimumConfidence <= 1
        ? minimumConfidence
        : NETWORK_MINIMUM_CATALOG_CONFIDENCE,
    probeDeadlineMs:
      Number.isFinite(probeDeadlineMs) &&
      probeDeadlineMs > 0 &&
      probeDeadlineMs <= 10_000
        ? probeDeadlineMs
        : NETWORK_PROBE_DEADLINE_MS,
  };
}

async function optionalNetworkProbe(
  provider: LiveSuggestionRouteProvider,
  request: ProviderRouteRequest,
  callerSignal: AbortSignal,
  deadlineMs: number,
): Promise<ProviderCandidateSet | null> {
  if (callerSignal.aborted) throw callerSignal.reason;

  const deadline = new AbortController();
  const combined = AbortSignal.any([callerSignal, deadline.signal]);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const answer = provider
    .candidates(request, combined)
    .then(
      (value) => ({ kind: "answer" as const, value }),
      (error) => ({ kind: "error" as const, error }),
    );
  const timeout = new Promise<{ readonly kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      deadline.abort(new Error("optional network probe deadline exceeded"));
      resolve({ kind: "timeout" });
    }, deadlineMs);
  });

  try {
    const result = await Promise.race([answer, timeout]);
    if (callerSignal.aborted) throw callerSignal.reason;
    return result.kind === "answer" ? result.value : null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Resolves the optional network catalogue within the same deadline as the
 * probe. A slow or failing loader means "no network hint", never a delay to
 * the projected-ahead fallback.
 */
async function optionalNetworkLoad(
  load: () => FreeRideNetworkIndex | null | Promise<FreeRideNetworkIndex | null>,
  deadlineMs: number,
): Promise<FreeRideNetworkIndex | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(load)
        .catch(() => null),
      timeout,
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function bearingDegrees(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
): number {
  const startLat = (from.lat * Math.PI) / 180;
  const endLat = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  return (
    ((Math.atan2(
      Math.sin(deltaLon) * Math.cos(endLat),
      Math.cos(startLat) * Math.sin(endLat) -
        Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}

function headingDelta(left: number, right: number): number {
  return ((left - right + 540) % 360) - 180;
}

function actionableInstruction(
  instructions: readonly RouteInstruction[] | undefined,
  geometryLength: number,
): RouteInstruction | null {
  if (instructions === undefined) return null;
  return (
    instructions.find((instruction) => {
      const index = instruction.geometryIndex;
      if (index === undefined || index < 0 || index >= geometryLength) return false;
      if (
        instruction.maneuver !== undefined &&
        instruction.maneuver !== "straight"
      ) {
        return true;
      }
      return (
        instruction.type === "turn" ||
        instruction.type === "keep-left" ||
        instruction.type === "keep-right" ||
        instruction.type === "roundabout"
      );
    }) ?? null
  );
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

function numericEvidence(
  value: EvidenceValue<unknown> | undefined,
  reason: string,
): EvidenceValue<number> {
  return value !== undefined &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
    ? (value as EvidenceValue<number>)
    : unknownEvidence(reason);
}

function validCandidate(candidate: ProviderCandidate): boolean {
  return (
    candidate.geometry.length >= 2 &&
    Number.isFinite(candidate.distanceMeters) &&
    candidate.distanceMeters > 0 &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds > 0
  );
}

function nearestGeometryIndex(
  geometry: readonly Coordinate[],
  point: Coordinate,
): number | null {
  if (geometry.length < 2) return null;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const current = geometry[index];
    if (current === undefined) continue;
    const distance = haversine(current, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return Number.isFinite(bestDistance) ? bestIndex : null;
}

function roadNameNear(
  instructions: readonly RouteInstruction[] | undefined,
  geometryIndex: number,
): string | null {
  const named = (instructions ?? [])
    .filter(
      (instruction) =>
        instruction.geometryIndex !== undefined &&
        instruction.geometryIndex >= geometryIndex &&
        instruction.roadName !== undefined &&
        instruction.roadName.trim().length > 0,
    )
    .sort(
      (left, right) =>
        (left.geometryIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.geometryIndex ?? Number.MAX_SAFE_INTEGER),
    )[0]?.roadName?.trim();

  return named ?? null;
}

async function storedSuggestion(input: {
  readonly candidate: ProviderCandidate;
  readonly suggestionId: string;
  readonly label: string;
  readonly decisionIndex: number;
  readonly currentHeadingDegrees: number;
  readonly planningGeneration: number;
  readonly geometry: GeometryStore;
  readonly rideHistory: readonly PersonalRideTrace[] | null;
  readonly now: () => string;
}): Promise<LiveSuggestionCandidate | null> {
  const entry = input.candidate.geometry[input.decisionIndex];
  const afterDecision = input.candidate.geometry[input.decisionIndex + 1];
  if (entry === undefined || afterDecision === undefined) return null;

  const distanceToDecisionMeters = distanceAlong(
    input.candidate.geometry,
    input.decisionIndex,
  );
  if (
    !Number.isFinite(distanceToDecisionMeters) ||
    distanceToDecisionMeters < 0
  ) {
    return null;
  }

  const geometry = await input.geometry.put(
    { kind: "line", coordinates: input.candidate.geometry },
    { kind: "route", now: input.now() },
  );
  const decisionHeading = bearingDegrees(entry, afterDecision);
  const delta = headingDelta(
    decisionHeading,
    input.currentHeadingDegrees,
  );
  const serverNovelty = numericEvidence(
    input.candidate.assessment?.evidence.novelty,
    "Ride history is unknown.",
  );
  const localNovelty =
    input.rideHistory === null
      ? null
      : personalNoveltyEvidence(
          input.candidate.geometry,
          input.rideHistory,
          { now: input.now() },
        );

  return {
    id: input.suggestionId,
    label: input.label,
    entry,
    distanceToDecisionMeters,
    distanceMeters: input.candidate.distanceMeters,
    route: {
      planningGeneration: input.planningGeneration,
      routeId: newRouteCandidateId(),
    },
    routeGeometryRef: geometry.geometryRef,
    durationSeconds: input.candidate.durationSeconds,
    headingDeltaDegrees: delta,
    requiresUTurn: Math.abs(delta) > 120,
    ...(input.candidate.instructions === undefined
      ? {}
      : { instructions: input.candidate.instructions }),
    evidence: {
      roadCharacterFit: numericEvidence(
        input.candidate.assessment?.evidence.roadClassMix,
        "Road character is unknown.",
      ),
      surfaceFit: numericEvidence(
        input.candidate.assessment?.evidence.surfaceMix,
        "Surface evidence is unknown.",
      ),
      novelty:
        localNovelty !== null && isUsableEvidence(localNovelty)
          ? localNovelty
          : serverNovelty,
    },
  };
}

/** Routes a short ahead segment through the same constraints and endpoint as planning. */
export function createLiveSuggestionQuery(deps: {
  readonly rides: RideRepositoryPort;
  readonly geometry: GeometryStore;
  readonly provider: LiveSuggestionRouteProvider;
  readonly dislikedSuggestionIds?: () => readonly string[];
  /** Local-only ride history. Nothing returned here crosses the route API. */
  readonly rideHistory?: () => Promise<readonly PersonalRideTrace[]>;
  /**
   * Optional local/trusted directed corridor network.
   *
   * Failure to load it falls back to projected-ahead discovery. It is a search
   * accelerator, never required ride truth.
   */
  readonly network?: () =>
    | FreeRideNetworkIndex
    | null
    | Promise<FreeRideNetworkIndex | null>;
  readonly recentNetworkSegmentIds?: () => readonly string[];
  /**
   * In-motion interruption threshold. This is deliberately stricter than the
   * network catalogue itself: a weak/uncertain hint should remain quiet rather
   * than consume rider attention.
   */
  readonly networkPolicy?: LiveSuggestionNetworkPolicy;
  readonly now?: () => string;
}) {
  let generation = Math.max(1, Date.now());
  const now = deps.now ?? (() => new Date().toISOString());
  const networkPolicy = resolvedNetworkPolicy(deps.networkPolicy);

  return {
    async propose(
      navigation: SessionNavigationState,
      signal: AbortSignal,
    ): Promise<readonly LiveSuggestionCandidate[]> {
      if (
        navigation.activity !== "free" ||
        navigation.position.coordinate === null ||
        navigation.position.headingDegrees === null ||
        navigation.position.observedAt === null ||
        navigation.position.accuracyMeters === null
      ) {
        return [];
      }

      const loaded = await deps.rides.loadRide(navigation.plan.rideId);
      if (signal.aborted) throw signal.reason;
      if (
        loaded === null ||
        !loaded.ok ||
        loaded.document.revision !== navigation.plan.rideRevision
      ) {
        return [];
      }

      const disliked = new Set(deps.dislikedSuggestionIds?.() ?? []);
      const rideHistory =
        deps.rideHistory === undefined
          ? null
          : await deps.rideHistory().catch(() => null);
      if (signal.aborted) throw signal.reason;

      // Preferred search: a directed, forward, rejoinable road-network
      // opportunity. This spends one provider call and returns immediately when
      // it verifies the proposed corridor on the routed geometry.
      if (deps.network !== undefined) {
        // One deadline covers the whole optional phase (catalogue load and
        // provider probe) so the fallback is never late by more than it.
        const networkPhaseStartedAt = Date.now();
        const network = await optionalNetworkLoad(
          deps.network,
          networkPolicy.probeDeadlineMs,
        );
        if (signal.aborted) throw signal.reason;

        if (network !== null) {
          const speedMph =
            navigation.position.speedMps === null
              ? undefined
              : navigation.position.speedMps * MPS_TO_MPH;
          const opportunities = findFreeRideNetworkOpportunities(
            network,
            navigation.position.coordinate,
            navigation.position.headingDegrees,
            speedMph,
            new Set(deps.recentNetworkSegmentIds?.() ?? []),
          );
          const opportunity = opportunities.find(
            (candidate) =>
              !disliked.has(candidate.id) &&
              candidate.expectedUtility >=
                networkPolicy.minimumExpectedUtility &&
              candidate.confidence >=
                networkPolicy.minimumConfidence,
          );

          if (opportunity !== undefined) {
            const planningGeneration = ++generation;
            const intent = buildNetworkSuggestionIntent({
              document: loaded.document,
              opportunity,
              accuracyMeters: navigation.position.accuracyMeters,
              at: navigation.position.observedAt,
            });
            const planned = await buildProviderRequest(intent, {
              requestId: `free-network-suggestion-${planningGeneration}`,
              includeAlternatives: false,
              resolveGeometry: async (ref) =>
                (await deps.geometry.get(ref))?.payload ?? null,
            });

            // Missing rider-authored geometry weakens constraints for both the
            // network query and the fallback, so stay quiet.
            if (!planned.ok || planned.unresolvedRefs.length > 0) return [];

            const remainingMs =
              networkPolicy.probeDeadlineMs -
              (Date.now() - networkPhaseStartedAt);
            if (remainingMs > 0) {
              deps.provider.beginAttempt({
                rideId: navigation.plan.rideId,
                rideRevision: navigation.plan.rideRevision,
                planningGeneration,
              });
            }
            const answer =
              remainingMs <= 0
                ? null
                : await optionalNetworkProbe(
                    deps.provider,
                    planned.request,
                    signal,
                    remainingMs,
                  );
            if (signal.aborted) throw signal.reason;

            const candidate = answer?.candidates.find(validCandidate);
            if (
              candidate !== undefined &&
              freeRideFragmentTraversalRatio(
                candidate.geometry,
                opportunity.routeFragment,
              ) >= NETWORK_MINIMUM_TRAVERSAL_RATIO
            ) {
              const decisionIndex = nearestGeometryIndex(
                candidate.geometry,
                opportunity.via[0]!,
              );
              if (decisionIndex !== null) {
                const suggestion = await storedSuggestion({
                  candidate,
                  suggestionId: opportunity.id,
                  label:
                    roadNameNear(candidate.instructions, decisionIndex) ??
                    "Suggested road",
                  decisionIndex,
                  currentHeadingDegrees:
                    navigation.position.headingDegrees,
                  planningGeneration,
                  geometry: deps.geometry,
                  rideHistory,
                  now,
                });
                if (suggestion !== null) return [suggestion];
              }
            }
          }
        }
      }

      // Stable fallback: today's projected-ahead request with engine
      // alternatives. The network experiment can fail without making Free Ride
      // less useful than the existing product.
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
        resolveGeometry: async (ref) =>
          (await deps.geometry.get(ref))?.payload ?? null,
      });
      if (!planned.ok || planned.unresolvedRefs.length > 0) return [];

      deps.provider.beginAttempt({
        rideId: navigation.plan.rideId,
        rideRevision: navigation.plan.rideRevision,
        planningGeneration,
      });
      const answer = await deps.provider.candidates(planned.request, signal);
      if (signal.aborted) throw signal.reason;

      const result: LiveSuggestionCandidate[] = [];
      for (const candidate of answer.candidates) {
        if (!validCandidate(candidate)) continue;
        const fingerprint = candidate.providerMetadata?.["fingerprint"];
        const suggestionId =
          typeof fingerprint === "string"
            ? fingerprint
            : `live-${result.length + 1}`;
        if (disliked.has(suggestionId)) continue;

        const decision = actionableInstruction(
          candidate.instructions,
          candidate.geometry.length,
        );
        if (decision?.geometryIndex === undefined) continue;
        const decisionIndex = decision.geometryIndex;
        const roadName =
          decision.roadName?.trim() ||
          candidate.instructions
            ?.find(
              (instruction) =>
                instruction.roadName !== undefined &&
                instruction.roadName.trim().length > 0,
            )
            ?.roadName?.trim();

        const suggestion = await storedSuggestion({
          candidate,
          suggestionId,
          label: roadName ?? "Suggested road",
          decisionIndex,
          currentHeadingDegrees: navigation.position.headingDegrees,
          planningGeneration,
          geometry: deps.geometry,
          rideHistory,
          now,
        });
        if (suggestion !== null) result.push(suggestion);
      }
      return result;
    },
  };
}
