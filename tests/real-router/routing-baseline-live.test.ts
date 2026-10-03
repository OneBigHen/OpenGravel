/**
 * Production routing baseline through the common experiment scorecard.
 *
 * For every corpus case, runs the real production planner once against live
 * GraphHopper (sequential, ~3–4 provider calls per case) and scores
 * control = Classic (the automatic production winner) against
 * treatment = Frontier (the opt-in comparison pick) over the SAME candidate set.
 *
 *   ROUTING_BASELINE_OUT=docs/vnext/research/<file>.json \
 *     ./node_modules/.bin/vitest run --config vitest.realrouter.config.mts \
 *     tests/real-router/routing-baseline-live.test.ts
 *
 * Only a broken live contract fails the test; quality is reported, not judged.
 */

import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import {
  scoreExperimentCase,
  type ExperimentCaseResult,
  type MeasuredExperimentCandidate,
} from "@/application/planner/routing-experiment-measure";
import { aggregateRoutingExperimentScorecards } from "@/application/planner/routing-experiment-scorecard";

import { runProductionBaselineCase, type ProductionBaselineCase } from "./routing-baseline";
import { ROUTING_QUALITY_CORPUS } from "./routing-quality-corpus";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const OUT = process.env.ROUTING_BASELINE_OUT;
const ROAD_CHARACTER = "curvy" as const;
const GENERATOR = "frontier-vs-classic-baseline";

const reachable = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) }).then(
  (response) => response.ok,
  () => false,
);
const live = reachable ? describe : describe.skip;

function round(value: number | null | undefined, digits = 4): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function candidateRecord(measured: MeasuredExperimentCandidate, baseline: ProductionBaselineCase): Record<string, unknown> {
  const { metrics, diagnostics } = measured;
  return {
    id: metrics.id,
    methods: [
      ...(baseline.classicId === metrics.id ? ["classic"] : []),
      ...(baseline.frontierId === metrics.id ? ["frontier"] : []),
      ...(baseline.sustainedCurvesId === metrics.id ? ["sustained-curves"] : []),
    ],
    eligible: metrics.eligible,
    canonicalScore: round(metrics.canonicalScore),
    distanceMiles: round(metrics.distanceMeters / 1_609.344, 2),
    durationMinutes: round(metrics.durationSeconds / 60, 1),
    sustainedBendShare: round(metrics.sustainedBendShare),
    longestBendRunMeters: round(measured.longestBendRunMeters, 0),
    maneuversPer10Miles: round(metrics.maneuversPer10Miles, 2),
    backtrackingShare: round(metrics.backtrackingShare),
    selfOverlapShare: round(metrics.selfOverlapShare),
    geometryReversalCount: metrics.geometryReversalCount ?? null,
    alternatingShortTurnPairs: metrics.alternatingShortTurnPairs ?? null,
    coherenceFlags: diagnostics.path?.flags ?? null,
    worthwhileMinuteRatio: round(metrics.worthwhileMinuteRatio),
    rideArcUnavailable: diagnostics.arcUnavailable,
    orderedEvidence:
      diagnostics.orderedEvidence === null
        ? null
        : { runCount: diagnostics.orderedEvidence.runCount, timedShare: round(diagnostics.orderedEvidence.timedShare) },
  };
}

const results: { baseline: ProductionBaselineCase; scored: ExperimentCaseResult; label: string }[] = [];

live(`production routing baseline via scorecard (${BASE_URL})`, () => {
  for (const entry of ROUTING_QUALITY_CORPUS) {
    it(entry.label, { timeout: 60_000 }, async () => {
      const baseline = await runProductionBaselineCase(entry, { baseUrl: BASE_URL, roadCharacter: ROAD_CHARACTER });
      expect(baseline.candidates.length).toBeGreaterThan(0);
      expect(baseline.classicId).not.toBeNull();
      const scored = scoreExperimentCase({
        caseId: entry.id,
        generator: GENERATOR,
        control: baseline.arm(baseline.classicId),
        treatment: baseline.arm(baseline.frontierId),
      });
      results.push({ baseline, scored, label: entry.label });
      console.log(`ROUTING_BASELINE_JSON ${JSON.stringify({ caseId: entry.id, validity: scored.scorecard.validity })}`);
    });
  }

  afterAll(() => {
    if (OUT === undefined || results.length === 0) return;
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      graphhopper: BASE_URL,
      roadCharacter: ROAD_CHARACTER,
      generator: GENERATOR,
      note: "control = Classic (automatic production winner); treatment = Frontier (opt-in comparison pick); same candidate set and provider calls.",
      cases: results.map(({ baseline, scored, label }) => ({
        caseId: baseline.caseId,
        label,
        providerCalls: baseline.providerCalls,
        planningLatencyMs: baseline.planningLatencyMs,
        classicId: baseline.classicId,
        frontierId: baseline.frontierId,
        sustainedCurvesId: baseline.sustainedCurvesId,
        frontierSameAsClassic: baseline.frontierId === baseline.classicId,
        candidates: scored.control.measured.map((measured) => candidateRecord(measured, baseline)),
        scorecard: scored.scorecard,
      })),
      aggregate: aggregateRoutingExperimentScorecards(GENERATOR, results.map(({ scored }) => scored.scorecard)),
    };
    writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  });
});
