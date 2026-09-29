/**
 * Planning-time Free Ride loop discovery (Wave 9.1).
 *
 * This is an application service, not a fourth ride authority. Providers only
 * propose closed paths through the existing routing port. OpenGravel enriches,
 * evaluates, scores, deduplicates, caps, and selects those paths through the
 * canonical candidate pipeline before immutable proposals leave this module.
 */

import {
  isUsableEvidence,
  type EvidenceSource,
  type EvidenceValue,
} from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { deepFreeze } from "@/domain/util/freeze";
import {
  resolveLanes,
  runLanes,
  type LaneDiagnostic,
} from "../planner/candidate-lanes";
import {
  runCandidatePipeline,
  type PipelineDiagnostic,
} from "../planner/pipeline";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
} from "../planner/route-provider";
import type {
  FreeRideCandidateEvidence,
  FreeRideDiscoveryDeps,
  FreeRideDiscoveryDiagnostic,
  FreeRideDiscoveryInput,
  FreeRideDiscoveryResult,
  FreeRideEvidenceContext,
  FreeRideLoopProposal,
  FreeRideTimeBudget,
  FreeRideTimeboxAssessment,
} from "./types";
import {
  coreRidingSection,
  evaluateFreeRideEligibility,
  freeRideRouteEvidence,
  normalizeFreeRideEvidence,
  unavailableFreeRideEvidence,
} from "./evaluation";

export type {
  FreeRideCandidateEvidence,
  FreeRideDiscoveryDeps,
  FreeRideDiscoveryDiagnostic,
  FreeRideDiscoveryInput,
  FreeRideDiscoveryResult,
  FreeRideDiscoveryStatus,
  FreeRideEvidenceContext,
  FreeRideEvidencePort,
  FreeRideLoopProposal,
  FreeRideTimeBudget,
  FreeRideTimeboxAssessment,
} from "./types";

const ROUTING_METRIC_SOURCE: EvidenceSource = {
  id: "route-candidate-metrics",
  label: "Routing candidate metrics",
  category: "routing",
  authoritativeFor: ["distance", "duration"],
};

const TIMEBOX_SOURCE: EvidenceSource = {
  id: "free-ride-timebox",
  label: "Free Ride timebox comparison",
  category: "derived",
  authoritativeFor: ["timebox"],
};

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/** Stable across the pipeline's defensive candidate copy. */
function candidateKey(candidate: ProviderCandidate): string {
  const fingerprint = candidate.providerMetadata?.["fingerprint"];
  if (typeof fingerprint === "string" && fingerprint.length > 0) {
    return `fingerprint:${fingerprint}`;
  }
  return JSON.stringify({
    providerId: candidate.providerId,
    profile: candidate.profile,
    distanceMeters: candidate.distanceMeters,
    durationSeconds: candidate.durationSeconds,
    geometry: candidate.geometry,
  });
}

function pipelineFingerprint(candidate: ProviderCandidate, index: number): string {
  const fingerprint = candidate.providerMetadata?.["fingerprint"];
  return typeof fingerprint === "string" && fingerprint.length > 0
    ? fingerprint
    : [
        candidate.providerId,
        candidate.profile,
        index,
        candidate.geometry.length,
        candidate.distanceMeters,
      ].join(":");
}

function isReliableOrigin(origin: EvidenceValue<Coordinate>): boolean {
  if (!isUsableEvidence(origin) || origin.value === null) return false;
  return (
    Number.isFinite(origin.value.lon) &&
    Number.isFinite(origin.value.lat) &&
    Math.abs(origin.value.lon) <= 180 &&
    Math.abs(origin.value.lat) <= 90 &&
    origin.confidence !== null &&
    origin.confidence > 0 &&
    origin.provenance.length > 0
  );
}

function requestFor(
  input: FreeRideDiscoveryInput,
  origin: Coordinate,
  profile: string,
): ProviderRouteRequest {
  return {
    requestId: `${input.discoveryId}:${profile}`,
    origin: copyCoordinate(origin),
    destination: copyCoordinate(origin),
    stops: [],
    shaping: [],
    profile,
    avoidPolygons: [],
    options: {
      includeAlternatives: true,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
    },
    discovery: {
      targetMinutes: input.timeBudget.targetMinutes,
      toleranceMinutes: input.timeBudget.toleranceMinutes,
    },
  };
}

function evidenceContext(input: FreeRideDiscoveryInput): FreeRideEvidenceContext {
  return {
    departure: input.departure,
    roadCharacter: input.roadCharacter,
    surface: input.surface,
    terrain: input.terrain,
    bike: input.bike,
    noveltyPreference: input.noveltyPreference,
    ...(input.weatherPreference === undefined
      ? {}
      : { weatherPreference: input.weatherPreference }),
  };
}

function timebox(
  durationSeconds: number,
  budget: FreeRideTimeBudget,
): FreeRideTimeboxAssessment {
  const actualMinutes = durationSeconds / 60;
  const differenceMinutes = Math.abs(actualMinutes - budget.targetMinutes);
  const matched = differenceMinutes <= budget.toleranceMinutes;
  const value = {
    matched,
    targetMinutes: budget.targetMinutes,
    actualMinutes,
    differenceMinutes,
  };
  return {
    status: matched ? "matched" : "mismatch",
    ...value,
    evidence: {
      value,
      status: "estimated",
      confidence: null,
      provenance: [TIMEBOX_SOURCE],
    },
  };
}

function proposal(
  candidate: ReturnType<typeof runCandidatePipeline>["candidates"][number],
  facts: FreeRideCandidateEvidence,
  budget: FreeRideTimeBudget,
  geometryRef: FreeRideLoopProposal["geometryRef"],
): FreeRideLoopProposal {
  return {
    id: `free-ride:${candidate.fingerprint}`,
    fingerprint: candidate.fingerprint,
    geometryRef,
    metrics: {
      distanceMeters: {
        value: candidate.distanceMeters,
        status: "estimated",
        confidence: null,
        provenance: [ROUTING_METRIC_SOURCE],
      },
      durationMinutes: {
        value: candidate.durationSeconds / 60,
        status: "estimated",
        confidence: null,
        provenance: [ROUTING_METRIC_SOURCE],
      },
    },
    timebox: timebox(candidate.durationSeconds, budget),
    facts,
    evidence: candidate.evidence,
    score: candidate.score,
    warnings: candidate.warnings,
  };
}

function emptyResult(
  status: "origin-unknown" | "empty",
  origin: EvidenceValue<Coordinate>,
  diagnostics: readonly (
    | PipelineDiagnostic
    | LaneDiagnostic
    | FreeRideDiscoveryDiagnostic
  )[] = [],
): FreeRideDiscoveryResult {
  return deepFreeze({
    status,
    origin,
    proposals: [],
    selectedProposalId: null,
    diagnostics,
  });
}

/** Discover zero to three eligible, distinct loop proposals. */
export async function discoverFreeRideLoops(
  input: FreeRideDiscoveryInput,
  deps: FreeRideDiscoveryDeps,
  signal: AbortSignal,
): Promise<FreeRideDiscoveryResult> {
  if (signal.aborted) throw signal.reason;
  if (!isReliableOrigin(input.origin) || input.origin.value === null) {
    return emptyResult("origin-unknown", input.origin);
  }

  const origin = input.origin.value;
  const lanes = resolveLanes({
    capabilities: deps.provider.capabilities(),
    intent: {
      shape: "loop",
      roadCharacter: input.roadCharacter,
      surface: input.surface,
      noveltyPreference: input.noveltyPreference,
    },
    includeAlternatives: true,
  });
  const laneResult = await runLanes({
    lanes,
    requestFor: (profile) => requestFor(input, origin, profile),
    provider: deps.provider,
    signal,
  });
  if (signal.aborted) throw signal.reason;

  const context = evidenceContext(input);
  const evidenceDiagnostics: FreeRideDiscoveryDiagnostic[] = [];
  const assessed = await Promise.all(
    laneResult.candidates.map(async (candidate, candidateIndex) => {
      try {
        return {
          candidate,
          facts: normalizeFreeRideEvidence(
            await deps.evidence.assess(candidate, context, signal),
          ),
        };
      } catch {
        if (signal.aborted) throw signal.reason;
        evidenceDiagnostics.push({
          stage: "evidence",
          code: "evidence-unavailable",
          candidateIndex,
          message: "Candidate evidence could not be loaded.",
        });
        return { candidate, facts: unavailableFreeRideEvidence() };
      }
    }),
  );
  if (signal.aborted) throw signal.reason;

  const factsByCandidate = new Map(
    assessed.map((entry) => [candidateKey(entry.candidate), entry.facts] as const),
  );
  const factsByFingerprint = new Map(
    assessed.map((entry, index) => [
      pipelineFingerprint(entry.candidate, index),
      entry.facts,
    ] as const),
  );
  const policy = deps.policy ?? PA_NJ_ROUTE_POLICY_VNEXT_1;
  const pipeline = runCandidatePipeline({
    candidates: laneResult.candidates,
    intent: {
      shape: "loop",
      roadCharacter: input.roadCharacter,
      surface: input.surface,
      noveltyPreference: input.noveltyPreference,
    },
    policy,
    discoveryTimebox: input.timeBudget,
    evidenceFor: (candidate) => freeRideRouteEvidence(
      factsByCandidate.get(candidateKey(candidate)) ?? normalizeFreeRideEvidence({}),
    ),
    additionalEligibilityFor: (candidate) => evaluateFreeRideEligibility(
      factsByCandidate.get(candidateKey(candidate)) ?? normalizeFreeRideEvidence({}),
      context,
    ),
    scoringGeometryFor: (candidate) => coreRidingSection(candidate.geometry),
  });
  const diagnostics = [
    ...laneResult.diagnostics,
    ...evidenceDiagnostics,
    ...pipeline.diagnostics,
  ];
  if (pipeline.candidates.length === 0 || pipeline.selectedIndex === null) {
    return emptyResult("empty", input.origin, diagnostics);
  }

  const proposals = await Promise.all(pipeline.candidates.map(async (candidate) => {
    if (signal.aborted) throw signal.reason;
    const record = await deps.geometryStore.put(
      { kind: "line", coordinates: candidate.geometry },
      { kind: "route" },
    );
    if (signal.aborted) throw signal.reason;
    return proposal(
      candidate,
      factsByFingerprint.get(candidate.fingerprint) ?? normalizeFreeRideEvidence({}),
      input.timeBudget,
      record.geometryRef,
    );
  }));
  const selected = proposals[pipeline.selectedIndex];

  return deepFreeze({
    status: "ready",
    origin: input.origin,
    proposals,
    selectedProposalId: selected?.id ?? null,
    diagnostics,
  });
}
