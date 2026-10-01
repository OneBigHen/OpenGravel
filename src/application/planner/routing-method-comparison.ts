/** Read-only comparisons over one canonically eligible PlanningSession bundle. */
import { isUsableEvidence } from "@/domain/evidence/types";
import type { RideIntent, RoadCharacterIntent } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import { funFeaturesFromRouteScore, mappedGravelAffinityFromEvidence } from "@/domain/route/fun";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import type { RouteBundle, RouteCandidate, RouteScoreComponents } from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";
import { selectLowRegretRepresentatives, type FrontierCandidate } from "./frontier-routing";
import { frontierComparisonProfiles } from "./frontier-comparison-policy";
import { isFrozenJevModelIdentity } from "./ports/jev-model-identity";
import type { RoutePlanFunCharacterWire } from "./ports/route-plan-contract";
import { timeboxPreferredIndexes } from "./pipeline";
import { DEFAULT_LOOP_MINUTES, defaultLoopToleranceMinutes } from "./build-plan-request";

export interface RoutingMethodVm {
  readonly id: "classic" | "frontier" | "sustained-curves";
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
  readonly routeId: RouteCandidateId | null;
  readonly routeLabel: string | null;
  readonly addedMinutes: number | null;
  readonly addedTimeReference: "fastest-shown" | "loop-comparison";
  readonly caveat: string | null;
}

export interface RoutingComparisonVm {
  readonly methods: readonly RoutingMethodVm[];
  readonly selectedRouteId: RouteCandidateId | null;
  readonly stale: boolean;
  readonly jev: {
    readonly state: "available" | "unavailable";
    readonly routeId: RouteCandidateId | null;
    readonly label: string | null;
    readonly confidence: number | null;
    readonly model: string | null;
  };
}

interface ComparisonInput {
  readonly bundle: RouteBundle | null;
  readonly selectedRouteId: RouteCandidateId | null;
  readonly intent: RideIntent;
  readonly stale: boolean;
  readonly reading?: RoutePlanFunCharacterWire;
  readonly labelFor?: (id: RouteCandidateId) => string | null;
}

function validRoute(candidate: RouteCandidate): boolean {
  return candidate.eligibility.eligible && Number.isFinite(candidate.durationSeconds) && candidate.durationSeconds > 0 &&
    Number.isFinite(candidate.distanceMeters) && candidate.distanceMeters > 0;
}

function measuredBendRun(candidate: RouteCandidate): { readonly longest: number; readonly sustainedQuality: number; readonly legacyContinuity: number | null } | null {
  const evidence = candidate.evidence.curvature;
  if (evidence === undefined || !isUsableEvidence(evidence) || typeof evidence.value !== "object" || evidence.value === null) return null;
  const value = evidence.value as Record<string, unknown>;
  const longest = value["longestRunMeters"];
  const bends = value["curvyMeters"];
  const total = value["totalMeters"];
  if (typeof longest !== "number" || typeof bends !== "number" || typeof total !== "number" ||
    !Number.isFinite(longest) || !Number.isFinite(bends) || !Number.isFinite(total) ||
    longest < 0 || bends < longest || total < bends || total <= 0 || longest > candidate.distanceMeters) return null;
  // A tiny isolated bend can have longest/bends = 1. Scale that continuity by
  // the measured route share, without a fitted distance threshold or traffic
  // claim. Recompute from validated lengths instead of trusting a stored ratio.
  const legacy = value["continuityShare"];
  return {
    longest, sustainedQuality: bends === 0 ? 0 : Math.sqrt((longest / bends) * (longest / total)),
    legacyContinuity: typeof legacy === "number" && Number.isFinite(legacy) && legacy >= 0 && legacy <= 1 ? legacy : null,
  };
}

function frontierCandidate(candidate: RouteCandidate, fastestSeconds: number, roadCharacter: RoadCharacterIntent): FrontierCandidate<RouteCandidate> {
  // Finite inputs with unknown, stale or unavailable provenance stay unknown.
  const measuredScore = { ...candidate.score, components: Object.fromEntries(
    Object.entries(candidate.score.components).map(([key, component]) => [key,
      component.evidenceStatus === "known" || component.evidenceStatus === "estimated" ? component : { ...component, input: null },
    ]),
  ) as RouteScoreComponents };
  const features = funFeaturesFromRouteScore(measuredScore);
  const bendRun = measuredBendRun(candidate);
  return {
    id: candidate.fingerprint || candidate.id,
    payload: candidate,
    quality: {
      timeEfficiency: fastestSeconds / candidate.durationSeconds,
      curvature: features.curvature,
      flow: roadCharacter === "curvy" ? bendRun?.sustainedQuality ?? null : bendRun?.legacyContinuity ?? null,
      backroad: features.backroad,
      surfaceFit: features.surfaceFit,
      gravelAffinity: mappedGravelAffinityFromEvidence(candidate.evidence, candidate.distanceMeters),
      trafficFlow: features.trafficFlow,
      junctionFlow: features.junctionFlow,
      novelty: features.novelty,
    },
  };
}

const CHARACTER_LABELS: Readonly<Record<RoutePlanFunCharacterWire["label"], string>> = {
  FLOWING: "Flowing", TWISTY: "Twisty", BACKROAD: "Backroad", DIRT_FOCUSED: "Dirt focused", UNKNOWN: "Unknown",
};

const ROADS_LABELS = { efficient: "Fast", balanced: "Balanced", curvy: "Curvy", backroads: "Backroads" } as const;

export function buildRoutingMethodComparison(input: ComparisonInput): RoutingComparisonVm {
  const routes = input.bundle?.candidates.filter(validRoute) ?? [];
  const fastestShownSeconds = Math.min(...routes.map((route) => route.durationSeconds));
  const loopBudget = input.intent.shape !== "loop" ? undefined : input.intent.time.kind === "budget" ? input.intent.time :
    { targetMinutes: DEFAULT_LOOP_MINUTES, toleranceMinutes: defaultLoopToleranceMinutes(DEFAULT_LOOP_MINUTES) };
  const timebox = timeboxPreferredIndexes(routes, loopBudget);
  const comparable = routes.filter((route, index) => timebox === null
    ? route.durationSeconds <= fastestShownSeconds * (1 + PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes["best-ride"].maximumPct)
    : timebox.has(index));
  const fastestSeconds = Math.min(...comparable.map((route) => route.durationSeconds));
  const quality = comparable.map((route) => frontierCandidate(route, fastestSeconds, input.intent.roadCharacter));
  // Enough common evidence must exist; time alone cannot earn a comparison.
  const enoughEvidence = quality.filter((candidate) => candidate.quality.curvature !== null && candidate.quality.backroad !== null);
  const commonContinuity = enoughEvidence.length > 0 && enoughEvidence.every((candidate) => candidate.quality.flow !== null);
  // Only Curvy opts into the new metric and common-support projection. Balanced
  // keeps its complete baseline dominance vector, including partial evidence.
  const comparisonQuality = input.intent.roadCharacter !== "curvy" || commonContinuity ? enoughEvidence : enoughEvidence.map((candidate) => ({ ...candidate, quality: { ...candidate.quality, flow: null } }));
  const frontier = enoughEvidence.length === 0 ? null : selectLowRegretRepresentatives(comparisonQuality, frontierComparisonProfiles(input.intent.roadCharacter, commonContinuity), 1, { minimumUtilityCoverage: 0.8 })[0]?.payload ?? null;
  const sustained = comparable.filter((route) => (measuredBendRun(route)?.longest ?? 0) > 0).sort((left, right) =>
    measuredBendRun(right)!.longest - measuredBendRun(left)!.longest || left.durationSeconds - right.durationSeconds || left.fingerprint.localeCompare(right.fingerprint),
  )[0] ?? null;
  const classic = routes.find((route) => route.id === input.bundle?.roles["best-ride"]) ??
    routes.find((route) => route.id === input.bundle?.selectedRouteId) ?? routes[0] ?? null;
  const method = (id: RoutingMethodVm["id"], label: string, summary: string, detail: string, route: RouteCandidate | null, caveat: string | null): RoutingMethodVm => ({
    id, label, summary, detail, routeId: route?.id ?? null,
    routeLabel: route === null ? null : input.labelFor?.(route.id) ?? `Route ${routes.indexOf(route) + 1}`,
    addedMinutes: route === null ? null : Math.round((route.durationSeconds - fastestSeconds) / 60),
    addedTimeReference: loopBudget === undefined ? "fastest-shown" : "loop-comparison", caveat,
  });
  const unknown = quality.some((candidate) => candidate.quality.trafficFlow === null || candidate.quality.junctionFlow === null);
  const budgetCaveat = loopBudget === undefined ? "Experimental picks stay within the Best Ride detour limit." :
    "Uses your loop time range, or the closest valid route if none fits. Check the route time before riding.";
  const continuityCaveat = input.intent.roadCharacter === "curvy" && !commonContinuity
    ? " Mapped bend continuity is not comparable across every choice, so it is left out." : "";
  const frontierDetail = `Uses your ${ROADS_LABELS[input.intent.roadCharacter]} Roads choice to weigh time, curves and backroads. Chooses the smallest worst tradeoff across small variations of that preference.${input.intent.roadCharacter === "curvy" ? " When every choice has measured bend lengths, Curvy also values sustained sections on the mapped route. This estimates road shape, not traffic flow or safety." : ""} Compares existing routes from this search.`;
  const reading = input.reading;
  const assessed = reading === undefined ? undefined : routes.find((route) => route.fingerprint === reading.fingerprint);
  const jevAvailable = assessed !== undefined && reading !== undefined && !input.stale && reading.label !== "UNKNOWN" &&
    Object.hasOwn(CHARACTER_LABELS, reading.label) && Number.isFinite(reading.confidence) && reading.confidence >= 0.65 && reading.confidence <= 1 && isFrozenJevModelIdentity(reading.model);
  return deepFreeze({
    selectedRouteId: input.selectedRouteId, stale: input.stale,
    methods: routes.length === 0 ? [] : [
      method("classic", "Classic", "The usual recommendation for your ride.", "Uses the route score, your ride preferences, and the normal role and detour policy.", classic, null),
      method("frontier", "Frontier", "Follows your Roads choice while balancing measured tradeoffs.", frontierDetail, frontier,
        frontier === null ? "Not enough comparable evidence for a frontier recommendation." : `${budgetCaveat}${continuityCaveat}${unknown ? " Traffic or junction quality is unknown and is not guessed." : ""}`),
      method("sustained-curves", "Sustained curves", "Looks for a longer uninterrupted run of bends.", "Compares the longest bend run measured on the mapped route geometry, rather than counting every turn. This estimates road shape, not traffic flow, pavement condition or safety.", sustained,
        sustained === null ? comparable.some((route) => measuredBendRun(route) !== null)
          ? "No sustained bend run was measured in the valid choices within the time limit."
          : "Sustained curve continuity is unavailable for these routes." : budgetCaveat),
    ],
    jev: jevAvailable ? { state: "available", routeId: assessed.id, label: CHARACTER_LABELS[reading.label], confidence: reading.confidence, model: reading.model } :
      { state: "unavailable", routeId: null, label: null, confidence: null, model: null },
  });
}
