/**
 * Equal-budget library-corridor routing experiment.
 *
 * The treatment replaces the generic "balanced" lane with exactly one
 * library-derived corridor probe. It never adds an extra provider call. This
 * lets replay and rider tests answer the real question:
 *
 *   Is a targeted corridor probe a better use of one routing call than the
 *   generic middle profile?
 *
 * Explicit rider/surface lanes are preserved. The experiment fails closed when
 * there is no replaceable balanced lane or no compatible corridor probe.
 */

import type {
  CandidateLane,
  LaneDiagnostic,
  LaneFailureLike,
} from "./candidate-lanes";
import { runLanes } from "./candidate-lanes";
import {
  applyLibraryCorridorProbe,
  assessLibraryCorridorAdherence,
  selectLibraryCorridorProbes,
  type LibraryCorridorAdherence,
  type LibraryCorridorProbe,
  type LibraryCorridorProbeOptions,
  type LibraryCorridorSource,
} from "./library-corridor-probes";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "./route-provider";

export const LIBRARY_CORRIDOR_LANE_ID = "library-corridor";
const REPLACEABLE_LANE_ID = "balanced";
const LIBRARY_CORRIDOR_DEADLINE_MS = 20_000;

export type LibraryCorridorTreatmentSkipReason =
  | "no-balanced-lane"
  | "no-compatible-probe"
  | "probe-request-unavailable";

export interface LibraryCorridorTreatmentPlan {
  readonly normalLanes: readonly CandidateLane[];
  readonly probeLane: CandidateLane;
  readonly probe: LibraryCorridorProbe;
  readonly probeRequest: ProviderRouteRequest;
  readonly replacedLane: CandidateLane;
  /** Equal to the original lane count by construction. */
  readonly providerCallBudget: number;
}

export type LibraryCorridorTreatmentPlanResult =
  | {
      readonly applied: true;
      readonly plan: LibraryCorridorTreatmentPlan;
    }
  | {
      readonly applied: false;
      readonly reason: LibraryCorridorTreatmentSkipReason;
    };

export interface LibraryCorridorTreatmentRun<
  Failure extends LaneFailureLike = LaneFailureLike,
> {
  readonly candidates: readonly ProviderCandidate[];
  readonly diagnostics: readonly LaneDiagnostic<Failure>[];
  readonly probe: LibraryCorridorProbe;
  readonly adherence: LibraryCorridorAdherence | null;
  readonly replacedLaneId: string;
  readonly providerCallBudget: number;
}

function singlePathRequest(
  request: ProviderRouteRequest,
  profile: string,
): ProviderRouteRequest {
  return {
    ...request,
    profile,
    options: {
      ...request.options,
      includeAlternatives: false,
    },
  };
}

/**
 * Builds the treatment without making provider calls.
 *
 * Only the generic balanced lane is replaceable in P0. Baseline, curvy,
 * surface-targeted and rider-character lanes express important/extreme or
 * explicit rider questions and are not silently displaced.
 */
export function planLibraryCorridorTreatment(input: {
  readonly request: ProviderRouteRequest;
  readonly lanes: readonly CandidateLane[];
  readonly sources: readonly LibraryCorridorSource[];
  readonly probeOptions?: LibraryCorridorProbeOptions;
}): LibraryCorridorTreatmentPlanResult {
  const replaceIndex = input.lanes.findIndex(
    (lane) => lane.id === REPLACEABLE_LANE_ID,
  );
  if (replaceIndex < 0) {
    return { applied: false, reason: "no-balanced-lane" };
  }

  const replacedLane = input.lanes[replaceIndex];
  if (replacedLane === undefined) {
    return { applied: false, reason: "no-balanced-lane" };
  }

  const probe = selectLibraryCorridorProbes(
    input.request,
    input.sources,
    {
      ...input.probeOptions,
      maxProbes: 1,
    },
  )[0];
  if (probe === undefined) {
    return { applied: false, reason: "no-compatible-probe" };
  }

  const probeRequest = applyLibraryCorridorProbe(input.request, probe);
  if (probeRequest === null) {
    return { applied: false, reason: "probe-request-unavailable" };
  }

  const normalLanes = input.lanes.filter(
    (_lane, index) => index !== replaceIndex,
  );
  const probeLane: CandidateLane = {
    id: LIBRARY_CORRIDOR_LANE_ID,
    profile: input.request.profile,
    purpose: "one caller-approved library corridor at equal provider-call budget",
    maxCalls: 1,
    deadlineMs: LIBRARY_CORRIDOR_DEADLINE_MS,
  };

  return {
    applied: true,
    plan: {
      normalLanes,
      probeLane,
      probe,
      probeRequest,
      replacedLane,
      providerCallBudget: input.lanes.length,
    },
  };
}

/**
 * Runs one equal-budget treatment.
 *
 * The regular treatment lanes and the one corridor lane run concurrently. Every
 * regular lane is forced to a single path so the treatment is comparable to the
 * existing fast-first control. The resulting candidates still need to pass the
 * normal OpenGravel eligibility/evidence/scoring pipeline.
 */
export async function runLibraryCorridorTreatment<
  Failure extends LaneFailureLike = LaneFailureLike,
>(input: {
  readonly plan: LibraryCorridorTreatmentPlan;
  readonly request: ProviderRouteRequest;
  readonly provider: RouteCandidateProvider;
  readonly signal: AbortSignal;
  readonly classifyFailure?: (error: unknown) => Failure | null;
}): Promise<LibraryCorridorTreatmentRun<Failure>> {
  if (input.signal.aborted) throw input.signal.reason;

  const ordinaryRun = runLanes<Failure>({
    lanes: input.plan.normalLanes,
    requestFor: (profile) => singlePathRequest(input.request, profile),
    provider: input.provider,
    signal: input.signal,
    concurrency: Math.max(1, input.plan.normalLanes.length),
    ...(input.classifyFailure === undefined
      ? {}
      : { classifyFailure: input.classifyFailure }),
  });

  const probeRun = runLanes<Failure>({
    lanes: [input.plan.probeLane],
    requestFor: () => input.plan.probeRequest,
    provider: input.provider,
    signal: input.signal,
    ...(input.classifyFailure === undefined
      ? {}
      : { classifyFailure: input.classifyFailure }),
  });

  const [ordinary, corridor] = await Promise.all([ordinaryRun, probeRun]);
  if (input.signal.aborted) throw input.signal.reason;

  const corridorCandidate = corridor.candidates[0];
  const adherence =
    corridorCandidate === undefined
      ? null
      : assessLibraryCorridorAdherence(
          corridorCandidate.geometry,
          input.plan.probe,
        );

  return {
    candidates: [...ordinary.candidates, ...corridor.candidates],
    diagnostics: [...ordinary.diagnostics, ...corridor.diagnostics],
    probe: input.plan.probe,
    adherence,
    replacedLaneId: input.plan.replacedLane.id,
    providerCallBudget: input.plan.providerCallBudget,
  };
}
