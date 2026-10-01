import { describe, expect, it } from "vitest";
import {
  evaluateJevFrontierReplay,
  validateJevReplayLabels,
} from "@/application/planner/jev-frontier-evaluation";
import { runJevFrontierReplay } from "@/application/planner/jev-frontier-replay";
import { policy, replayCase } from "../../helpers/jev-frontier";

function label(
  partition: "test" | "calibration" = "test",
  preferredCandidateId = "route-2",
) {
  const c = replayCase(2);
  return {
    caseId: c.caseId,
    corridorKey: c.corridorKey,
    rideSessionKey: c.rideSessionKey,
    riderKey: "rider-1",
    phase: "pre-ride" as const,
    partition,
    fingerprints: c.fingerprints,
    preferredCandidateId,
    pair: null,
    meaningfulImprovement: true,
  };
}
async function record() {
  return runJevFrontierReplay(
    replayCase(2),
    {
      judge: {
        async judge({ state }) {
          return {
            status: "ok",
            latencyMs: 1,
            judgment: {
              model: "typesafe/jev-1.13",
              choice: {
                type: "choice",
                choice: "route-2",
                confidence: 0.9,
                probabilities: { "route-1": 0.1, "route-2": 0.8, NONE: 0.1 },
              },
              fitByCandidateId: Object.fromEntries(
                state.candidates.map((c) => [
                  c.id,
                  {
                    type: "score",
                    score: 2,
                    confidence: 0.9,
                    probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 },
                  },
                ]),
              ),
              meaningfulImprovement: { type: "noul", noul: 0.7 },
            },
          };
        },
      },
      seed: "e",
      repeats: 2,
      policy,
    },
    new AbortController().signal,
  );
}
describe("held-out evaluation", () => {
  it("computes known log loss, Brier, ECE and paired incremental D comparisons", async () => {
    const r = await record();
    const report = evaluateJevFrontierReplay([r], [label()]);
    const a = report.test["pre-ride"]!.pooled.A;
    expect(a).toMatchObject({
      labelCount: 1,
      scoredCount: 1,
      topChoiceAccuracy: 1,
      selectiveAccuracy: 1,
      coverage: 1,
      abstentionCoverage: 0,
    });
    expect(a.logLoss).toBeCloseTo(-Math.log(0.8));
    expect(a.brierScore).toBeCloseTo(0.06);
    expect(a.ece).toBeCloseTo(0.2);
    expect(a.noulBrierScore).toBeCloseTo(0.09);
    expect(report.test["pre-ride"]!.incrementalAgainstD.A).toMatchObject({
      pairedCount: 1,
    });
    expect(
      report.test["pre-ride"]!.incrementalAgainstD.A.brierDelta,
    ).toBeCloseTo(-1.94);
    expect(report.test["pre-ride"]!.byRider["rider-1"]!.A.logLoss).toBeCloseTo(
      -Math.log(0.8),
    );
    expect(report.diagnostics.A).toMatchObject({
      baselineAgreement: 0,
      orderFlipRate: 0,
      repeatedRequestStability: 1,
    });
  });
  it("keeps unavailable labels and unavailable provider results explicit", async () => {
    const r = await runJevFrontierReplay(
      replayCase(2),
      { judge: null, seed: "e", repeats: 1, policy },
      new AbortController().signal,
    );
    expect(evaluateJevFrontierReplay([r], []).test).toEqual({});
    const m = evaluateJevFrontierReplay([r], [label()]).test["pre-ride"]!.pooled
      .A;
    expect(m).toMatchObject({
      labelCount: 1,
      scoredCount: 0,
      logLoss: null,
      brierScore: null,
      ece: null,
      coverage: 0,
      abstentionCoverage: 1,
      selectiveAccuracy: null,
    });
  });
  it("conditions pairwise probabilities without using the excluded third/NONE option", async () => {
    const r = await record();
    const l = {
      ...label(),
      preferredCandidateId: null,
      pair: { leftId: "route-1", rightId: "route-2", preferredId: "route-2" },
    };
    const m = evaluateJevFrontierReplay([r], [l]).test["pre-ride"]!.pooled.A;
    expect(m.logLoss).toBeCloseTo(-Math.log(8 / 9));
    expect(m.brierScore).toBeCloseTo(2 / 81);
  });
  it("rejects corridor/session split leakage and stale label fingerprints", async () => {
    const r = await record();
    expect(() =>
      evaluateJevFrontierReplay(
        [r],
        [label(), { ...label("calibration"), riderKey: "rider-2" }],
      ),
    ).toThrow(/partition/);
    expect(() =>
      evaluateJevFrontierReplay(
        [r],
        [
          {
            ...label(),
            fingerprints: { ...label().fingerprints, "route-1": "stale" },
          },
        ],
      ),
    ).toThrow(/fingerprint/);
    expect(
      validateJevReplayLabels([{ ...label(), rawRiderIdentity: "private" }]),
    ).toBe(false);
  });
  it("keeps pre-ride and post-ride outcomes separate", async () => {
    const r = await record();
    const report = evaluateJevFrontierReplay(
      [r],
      [label(), { ...label("test", "route-1"), phase: "post-ride" }],
    );
    expect(report.test["pre-ride"]!.pooled.A.topChoiceAccuracy).toBe(1);
    expect(report.test["post-ride"]!.pooled.A.topChoiceAccuracy).toBe(0);
  });
});
