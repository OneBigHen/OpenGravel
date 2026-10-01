import { describe, expect, it } from "vitest";
import {
  runJevFrontierReplay,
  validateJevReplayCase,
} from "@/application/planner/jev-frontier-replay";
import {
  buildBalancedJevFrontierPermutations,
  type JevFrontierJudge,
} from "@/application/planner/jev-frontier-shadow";

import { policy, replayCase } from "../../helpers/jev-frontier";
function judgeFor(choice = "route-2", confidence = 0.9): JevFrontierJudge {
  return {
    async judge({ state }) {
      return {
        status: "ok",
        latencyMs: 1,
        judgment: {
          model: "typesafe/jev-1.13",
          choice: {
            type: "choice",
            choice,
            confidence,
            probabilities: Object.fromEntries(
              [...state.candidates.map((c) => c.id), "NONE"].map((id) => [
                id,
                id === choice ? 0.85 : 0.15 / state.candidates.length,
              ]),
            ),
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
          meaningfulImprovement: { type: "noul", noul: 0.9 },
        },
      };
    },
  };
}

describe("shadow replay", () => {
  it.each([2, 3])(
    "runs A/B/C on the same balanced %s-candidate requests and never calls D",
    async (count) => {
      const calls: string[] = [];
      const judge = judgeFor();
      const record = await runJevFrontierReplay(
        replayCase(count),
        {
          judge: {
            judge: (input, s) => {
              calls.push(`${input.variant}/${input.permutation.id}`);
              return judge.judge(input, s);
            },
          },
          seed: "experiment-1",
          repeats: 2,
          policy,
        },
        new AbortController().signal,
      );
      expect(calls).toHaveLength(count === 3 ? 36 : 12);
      expect(record).toHaveProperty("orderDesign", "complete-factorial-v1");
      for (const variant of ["A", "B", "C"] as const) {
        expect(record.variants[variant].runs).toHaveLength(count === 3 ? 12 : 4);
        expect(record.variants[variant]).toMatchObject({
          verdict: "alternative",
          repeatedRequestStability: 1,
          orderFlipRate: 0,
        });
        expect(record.variants[variant].runs[0]!.permutation).toEqual(
          buildBalancedJevFrontierPermutations(
            replayCase(count).state,
            "experiment-1:synthetic-case",
          )[0],
        );
      }
      expect(record.control).toEqual(replayCase(count).control);
    },
  );
  it("abstains on any nonzero order flip, retaining all raw runs", async () => {
    const judge: JevFrontierJudge = {
      judge: (input, s) =>
        judgeFor(input.permutation.slots[0]!.candidateId).judge(input, s),
    };
    const record = await runJevFrontierReplay(
      replayCase(),
      { judge, seed: "e", repeats: 1, policy },
      new AbortController().signal,
    );
    expect(record.variants.A).toMatchObject({
      verdict: "abstain",
      orderFlipRate: 0.8,
      choiceCandidateId: null,
      repeatedRequestStability: null,
    });
    expect(record.variants.A.runs).toHaveLength(6);
  });
  it("freezes the exact complete-order mappings before any injected judge can mutate them", async () => {
    const mutations: boolean[] = [];
    const stableJudge = judgeFor();
    const record = await runJevFrontierReplay(replayCase(), {
      seed: "frozen-orders",
      repeats: 1,
      policy,
      judge: {
        judge(input, signal) {
          mutations.push(Reflect.set(input.permutation.slots[0]!, "candidateId", input.permutation.slots[1]!.candidateId));
          mutations.push(Reflect.set(input.permutation, "id", "invented"));
          return stableJudge.judge(input, signal);
        },
      },
    }, new AbortController().signal);
    expect(mutations).toHaveLength(36);
    expect(mutations.every((changed) => !changed)).toBe(true);
    const expected = buildBalancedJevFrontierPermutations(replayCase().state, "frozen-orders:synthetic-case");
    for (const variant of ["A", "B", "C"] as const) {
      expect(record.variants[variant].runs.map((run) => run.permutation)).toEqual(expected);
      expect(record.variants[variant].verdict).toBe("alternative");
    }
  });
  it("abstains when reversing candidate order flips a cyclically stable winner", async () => {
    const forwardOrders = new Set([
      "route-1,route-2,route-3",
      "route-2,route-3,route-1",
      "route-3,route-1,route-2",
    ]);
    const judge: JevFrontierJudge = {
      judge: (input, signal) => {
        const order = input.permutation.slots.map((slot) => slot.candidateId).join(",");
        return judgeFor(forwardOrders.has(order) ? "route-2" : "route-3").judge(input, signal);
      },
    };
    const record = await runJevFrontierReplay(
      replayCase(),
      { judge, seed: "e", repeats: 1, policy },
      new AbortController().signal,
    );
    expect(record.variants.A.verdict).toBe("abstain");
    expect(record.variants.A.orderFlipRate).toBeCloseTo(0.6);
    expect(record.variants.A.runs).toHaveLength(6);
  });
  it.each([
    "absent",
    "agree",
    "disagree",
    "NONE",
    "low-confidence",
    "malformed",
    "timeout",
    "throw",
    "abort",
  ])("preserves the frozen bundle when %s", async (mode) => {
    const c = replayCase();
    const bundle = Object.freeze({
      candidates: Object.freeze(c.state.candidates),
      roles: Object.freeze({ fastest: "route-1" }),
      selectedRouteId: "route-1",
      selectionSource: "automatic",
    });
    const before = JSON.stringify(bundle);
    const judge: JevFrontierJudge | null =
      mode === "absent"
        ? null
        : {
            async judge(input, s) {
              if (mode === "throw") throw Error("private error");
              if (mode === "timeout")
                return { status: "failed", reason: "timeout", latencyMs: 1500 };
              if (mode === "abort")
                return { status: "failed", reason: "aborted", latencyMs: 1 };
              if (mode === "malformed")
                return { status: "ok", judgment: null, latencyMs: 0 } as never;
              return judgeFor(
                mode === "agree"
                  ? "route-1"
                  : mode === "NONE"
                    ? "NONE"
                    : "route-2",
                mode === "low-confidence" ? 0.1 : 0.9,
              ).judge(input, s);
            },
          };
    const record = await runJevFrontierReplay(
      c,
      { judge, seed: "e", repeats: 1, policy },
      new AbortController().signal,
    );
    expect(JSON.stringify(bundle)).toBe(before);
    expect(JSON.stringify(c)).toBe(JSON.stringify(replayCase()));
    expect(record.variants.A.verdict).toBe(
      mode === "agree"
        ? "same-as-baseline"
        : mode === "disagree"
          ? "alternative"
          : mode === "low-confidence"
            ? "below-threshold"
            : "abstain",
    );
  });
  it("detects repeated identical-request flips independently of order", async () => {
    let calls = 0;
    const judge: JevFrontierJudge = {
      judge: (input, s) =>
        judgeFor(
          Math.floor(calls++ / 6) % 2 === 0 ? "route-1" : "route-2",
        ).judge(input, s),
    };
    const record = await runJevFrontierReplay(
      replayCase(),
      { judge, seed: "e", repeats: 2, policy },
      new AbortController().signal,
    );
    expect(record.variants.A).toMatchObject({
      orderFlipRate: 0,
      repeatedRequestStability: 0,
      verdict: "abstain",
    });
  });
  it("rejects unsafe IDs, raw history and non-probability D controls", () => {
    expect(validateJevReplayCase({ ...replayCase(), rawGpsHistory: [] })).toBe(
      false,
    );
    expect(
      validateJevReplayCase({ ...replayCase(), caseId: "__proto__" }),
    ).toBe(false);
    expect(
      validateJevReplayCase({
        ...replayCase(),
        control: {
          ...replayCase().control,
          probabilitiesByCandidateId: { "route-1": 2 },
        },
      }),
    ).toBe(false);
  });
});

it("rejects a policy with four unrelated numeric fields", async () => {
  await expect(
    runJevFrontierReplay(
      replayCase(),
      {
        judge: null,
        seed: "e",
        repeats: 1,
        policy: { a: 0.1, b: 0.2, c: 0.3, d: 0.4 } as never,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/configuration/);
});
it("does not copy arbitrary failure messages from a replay judge", async () => {
  const judge: JevFrontierJudge = {
    async judge() {
      return {
        status: "invalid",
        reason: "raw-private-history",
        latencyMs: 1,
      } as never;
    },
  };
  const record = await runJevFrontierReplay(
    replayCase(),
    { judge, seed: "e", repeats: 1, policy },
    new AbortController().signal,
  );
  expect(JSON.stringify(record)).not.toContain("raw-private-history");
  expect(record.variants.A.runs[0]!.result).toMatchObject({
    status: "invalid",
    reason: "malformed-response",
  });
});

it.each([400, 999])(
  "retains only valid numeric HTTP failure metadata (%s)",
  async (httpStatus) => {
    const record = await runJevFrontierReplay(
      replayCase(),
      {
        judge: {
          async judge() {
            return {
              status: "failed",
              reason: "transport-error",
              latencyMs: 1,
              httpStatus,
              message: "raw-private-history",
            } as never;
          },
        },
        seed: "e",
        repeats: 1,
        policy,
      },
      new AbortController().signal,
    );
    const result = record.variants.A.runs[0]!.result;
    expect(result).toMatchObject({
      status: "failed",
      reason: "transport-error",
    });
    if (httpStatus === 400) expect(result).toHaveProperty("httpStatus", 400);
    else expect(result).not.toHaveProperty("httpStatus");
    expect(JSON.stringify(record)).not.toContain("raw-private-history");
  },
);
