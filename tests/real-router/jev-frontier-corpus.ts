/** PR #39 measurement substrate; these are public-place scenarios, not rider history. */
import { freezeJevFrontierCorpusCase } from "@/application/planner/jev-frontier-corpus";
import { runCandidatePipeline } from "@/application/planner/pipeline";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import { engineRoadEvidence } from "@/application/roads/engine-road-evidence";
import { preferenceVectorFromRoute } from "@/application/personalization/route-features";
import { isUsableEvidence } from "@/domain/evidence/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { ROUTE_EVIDENCE_KEYS } from "@/domain/route/types";
import type { RoutingQualityCase } from "./routing-quality-corpus";

export function freezeQualityCase(
  entry: RoutingQualityCase,
  candidates: readonly ProviderCandidate[],
) {
  const surface = entry.options?.surfacePreference ?? "mixed";
  const pipeline = runCandidatePipeline({
    candidates,
    intent: {
      shape: "destination",
      roadCharacter: "curvy",
      surface: { preference: surface },
    },
    policy: PA_NJ_ROUTE_POLICY_VNEXT_1,
    evidenceFor: (c) => engineRoadEvidence(c.roadSummary, surface),
  });
  const shortest = Math.min(
    ...pipeline.candidates.map((c) => c.durationSeconds),
  );
  const ranked = [...pipeline.candidates].sort(
    (a, b) =>
      b.score.total - a.score.total ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return freezeJevFrontierCorpusCase({
    caseId: entry.id,
    corridorKey: entry.id,
    rideSessionKey: `corpus-${entry.id}`,
    intent: {
      roadCharacter: "curvy",
      surfacePreference: surface,
      terrainLevel: "moderate",
      noveltyPreference: "balanced",
      avoidHighways: entry.options?.avoidHighways ?? false,
      tollPolicy: entry.options?.tollPolicy ?? "allow-with-warning",
      timeboxSatisfied: null,
    },
    rider: null,
    // Limit two makes exact bounded subset enumeration relevant when three distinct routes survive.
    maxResults: 2,
    candidates: ranked.map((c, i) => {
      const f = preferenceVectorFromRoute(c.score, c.evidence);
      return {
        eligible: c.eligibility.eligible,
        fingerprint: c.fingerprint,
        candidate: {
          id: `candidate-${i + 1}`,
          canonicalRank: i + 1,
          canonicalScore: c.score.total,
          distanceMeters: c.distanceMeters,
          durationSeconds: c.durationSeconds,
          evidenceCoverage:
            ROUTE_EVIDENCE_KEYS.filter(
              (k) =>
                c.evidence[k] !== undefined && isUsableEvidence(c.evidence[k]!),
            ).length / ROUTE_EVIDENCE_KEYS.length,
          riderPreferenceUtility: null,
          // One normalized intrinsic measurement per axis. No aggregate fun/coherence score.
          frontier: {
            timeEfficiency: shortest / c.durationSeconds,
            curvature: f.curvature,
            flow: null,
            backroad: f.backroad,
            surfaceFit: c.score.components.surfaceFit.input,
            gravelAffinity: null,
            trafficFlow: f.trafficCalm,
            junctionFlow: f.junctionFlow,
            novelty: f.novelty,
          },
          // The current mainline has no trusted reversal/backtracking measurement seam.
          coherence: {
            explicitUTurns: null,
            geometryReversals: null,
            maneuverDensityPer10Miles: null,
            immediateBacktrackingShare: null,
            selfOverlapShare: null,
          },
        },
      };
    }),
  });
}
