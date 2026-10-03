/**
 * Production baseline arm for a routing-quality corpus case.
 *
 * Runs one corpus case through the real production planner (`planRide`, the
 * same candidate lanes, pipeline, RouteScore and roles the app uses), counts
 * the provider calls it spent, and returns the candidate set in the shape the
 * common scorecard measures (`ExperimentArmInput`). Two selections over the
 * SAME candidate set are reported:
 *
 * - `classicId`: the automatic production winner (Best Ride / selected route);
 * - `frontierId`: the opt-in Frontier comparison method's pick.
 *
 * Generator experiments build their own treatment arm and call
 * `scoreExperimentCase({ control: baseline.arm(baseline.frontierId), treatment })`
 * with the same `providerCalls` budget.
 */

import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { ExperimentArmInput } from "@/application/planner/routing-experiment-measure";
import { buildRoutingMethodComparison } from "@/application/planner/routing-method-comparison";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, newRideId } from "@/domain/ride/ids";
import type { RideIntent } from "@/domain/ride/types";
import type { RouteBundle } from "@/domain/route/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { profileFor } from "@/infrastructure/routing/graphhopper/profiles";
import { planRide } from "@/server/planning/plan-service";

import type { RoutingQualityCase } from "./routing-quality-corpus";

export interface ProductionBaselineCase {
  readonly caseId: string;
  readonly roadCharacter: RideIntent["roadCharacter"];
  readonly providerCalls: number;
  readonly planningLatencyMs: number;
  readonly candidates: ExperimentArmInput["candidates"];
  readonly classicId: string | null;
  readonly frontierId: string | null;
  readonly sustainedCurvesId: string | null;
  /** Arm view of the same candidate set with one method's selection. */
  arm(selectedCandidateId: string | null): ExperimentArmInput;
}

function countingProvider(inner: RouteCandidateProvider): {
  readonly provider: RouteCandidateProvider;
  readonly calls: () => number;
  readonly answers: readonly ProviderCandidate[];
} {
  let calls = 0;
  const answers: ProviderCandidate[] = [];
  return {
    provider: {
      id: inner.id,
      capabilities: () => inner.capabilities(),
      candidates: async (
        request: ProviderRouteRequest,
        signal: AbortSignal,
      ): Promise<ProviderCandidateSet> => {
        calls += 1;
        const set = await inner.candidates(request, signal);
        answers.push(...set.candidates);
        return set;
      },
    },
    calls: () => calls,
    answers,
  };
}

function sameLine(left: ProviderCandidate, right: { readonly distanceMeters: number; readonly durationSeconds: number; readonly geometry: readonly unknown[] }): boolean {
  return (
    left.distanceMeters === right.distanceMeters &&
    left.durationSeconds === right.durationSeconds &&
    left.geometry.length === right.geometry.length
  );
}

/** One corpus case through production planning against a live router. */
export async function runProductionBaselineCase(
  entry: RoutingQualityCase,
  options: {
    readonly baseUrl: string;
    readonly roadCharacter: RideIntent["roadCharacter"];
  },
): Promise<ProductionBaselineCase> {
  const counted = countingProvider(createGraphHopperProvider({ baseUrl: options.baseUrl }));
  const base = defaultRideIntent();
  const surfacePreference = entry.options?.surfacePreference ?? base.surface.preference;
  const intent: RideIntent = {
    ...base,
    roadCharacter: options.roadCharacter,
    avoidHighways: entry.options?.avoidHighways ?? base.avoidHighways,
    surface: { ...base.surface, preference: surfacePreference },
  };
  const rideId = newRideId();
  const started = performance.now();
  const result = await planRide(
    {
      identity: { rideId, rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: `baseline_${entry.id}`,
        origin: entry.origin,
        destination: entry.destination,
        stops: [],
        shaping: [],
        avoidPolygons: [],
        profile: profileFor(intent),
        options: {
          includeAlternatives: true,
          avoidHighways: intent.avoidHighways,
          tollPolicy: intent.tollPolicy,
          surfacePreference,
          roadCharacter: intent.roadCharacter,
          vehicle: "motorcycle",
        },
      },
    },
    { provider: counted.provider, env: {}, roadAuthority: null, funCharacterClassifier: null },
  );
  const planningLatencyMs = Math.round(performance.now() - started);
  if (!result.ok) throw new Error(`baseline ${entry.id}: ${result.error.code}`);

  const wire = result.bundle.candidates;
  const candidates: ExperimentArmInput["candidates"] = wire.map((candidate) => {
    const source = counted.answers.find((answer) => sameLine(answer, candidate));
    return {
      id: candidate.id,
      eligible: candidate.eligibility.eligible,
      canonicalScore: Number.isFinite(candidate.score.total) ? candidate.score.total : null,
      distanceMeters: candidate.distanceMeters,
      durationSeconds: candidate.durationSeconds,
      geometry: candidate.geometry,
      ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
      ...(source?.roadSummary === undefined ? {} : { roadSummary: source.roadSummary }),
    };
  });

  const bundle: RouteBundle = {
    ...result.bundle,
    candidates: wire.map((candidate, index) => {
      const { geometry, ...stored } = candidate;
      if (geometry.length < 2) throw new Error(`baseline ${entry.id}: route without geometry`);
      return { ...stored, geometryRef: asGeometryRef(`baseline_${entry.id}_${index}`) };
    }),
    rideId,
    rideRevision: 1,
    planningGeneration: 1,
    createdAt: new Date().toISOString(),
  };
  const comparison = buildRoutingMethodComparison({
    bundle,
    selectedRouteId: bundle.selectedRouteId,
    intent,
    stale: false,
  });
  const pick = (id: "classic" | "frontier" | "sustained-curves"): string | null =>
    comparison.methods.find((method) => method.id === id)?.routeId ?? null;
  const providerCalls = counted.calls();

  return {
    caseId: entry.id,
    roadCharacter: options.roadCharacter,
    providerCalls,
    planningLatencyMs,
    candidates,
    classicId: pick("classic"),
    frontierId: pick("frontier"),
    sustainedCurvesId: pick("sustained-curves"),
    arm: (selectedCandidateId) => ({
      providerCalls,
      planningLatencyMs,
      candidates,
      selectedCandidateId,
    }),
  };
}
