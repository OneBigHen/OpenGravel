import { describe, expect, it } from "vitest";

import { createFunJudge, evidenceFingerprint, FUN_JUDGE_POLICY_V1 } from "@/application/planner/fun-judge";
import type {
  FunJudgeAnswer,
  FunJudgeCandidateEvidence,
  FunJudgePort,
  FunJudgeRequest,
} from "@/application/planner/ports/fun-judge";

function evidence(key: string, overrides: Partial<FunJudgeCandidateEvidence> = {}): FunJudgeCandidateEvidence {
  return {
    key,
    durationMinutes: 60,
    distanceMiles: 45,
    addedTimePct: 0,
    curvature: 0.3,
    curvatureContinuity: null,
    backroadShare: 0.3,
    surfaceFit: 0.9,
    elevation: 0.4,
    trafficFlow: 0.6,
    junctionFlow: 0.6,
    novelty: null,
    mappedGravelAffinity: null,
    maneuversPer10Miles: 4,
    rideArc: null,
    evidenceCoverage: 0.8,
    ...overrides,
  };
}

const REQUEST: FunJudgeRequest = {
  intent: { roadCharacter: "curvy", surfacePreference: "pavement", avoidHighways: false },
  candidates: [
    evidence("fast"),
    evidence("twisty", { durationMinutes: 70, addedTimePct: 0.167, curvature: 0.7, backroadShare: 0.8 }),
  ],
};
const FALLBACK = ["fast", "twisty"] as const;

/** A port that prefers the candidate with the highest curvature, regardless of position. */
function curvaturePort(options: {
  readonly confidence?: number;
  readonly none?: number;
  readonly positional?: boolean;
  readonly answer?: (request: FunJudgeRequest) => FunJudgeAnswer | Promise<FunJudgeAnswer>;
} = {}): FunJudgePort & { calls: FunJudgeRequest[] } {
  const calls: FunJudgeRequest[] = [];
  return {
    modelId: "jev-1.13.0",
    calls,
    async rank(request) {
      calls.push(request);
      if (options.answer !== undefined) return options.answer(request);
      const none = options.none ?? 0.05;
      const top = options.positional === true
        ? request.candidates[0]!
        : [...request.candidates].sort((a, b) => (b.curvature ?? 0) - (a.curvature ?? 0))[0]!;
      const share = options.confidence ?? 0.85;
      const rest = (1 - share - none) / (request.candidates.length - 1);
      return {
        status: "ok",
        probabilities: Object.fromEntries(
          request.candidates.map((candidate) => [candidate.key, candidate === top ? share : rest]),
        ),
        noneProbability: none,
        choiceKey: top.key,
        confidence: share,
        model: "jev-1.13.0",
        latencyMs: 5,
      };
    },
  };
}

const signal = () => new AbortController().signal;

describe("FUN JUDGE service", () => {
  it("returns Jev's preference when both orders agree and confidence clears the floor", async () => {
    const port = curvaturePort();
    const verdict = await createFunJudge(port).judge(REQUEST, FALLBACK, signal());
    expect(verdict).toMatchObject({
      source: "jev",
      outcome: "preferred",
      preferredKey: "twisty",
      ranking: ["twisty", "fast"],
      orderAgreement: true,
      calls: 2,
      cached: false,
      model: "jev-1.13.0",
    });
    expect(verdict.confidence).toBeCloseTo(0.85);
    // The second call presents the candidates in reversed order.
    expect(port.calls.map((call) => call.candidates.map((c) => c.key))).toEqual([
      ["fast", "twisty"],
      ["twisty", "fast"],
    ]);
  });

  it("falls back to the deterministic ranking when the judge just follows position", async () => {
    const verdict = await createFunJudge(curvaturePort({ positional: true })).judge(REQUEST, FALLBACK, signal());
    expect(verdict).toMatchObject({
      source: "fallback",
      outcome: "order-disagreement",
      preferredKey: null,
      ranking: ["fast", "twisty"],
      orderAgreement: false,
    });
  });

  it.each([
    { confidence: 0.5, none: 0.05, outcome: "low-confidence" },
    { confidence: 0.55, none: 0.4, outcome: "low-confidence" },
  ])("abstains below the policy floor: %j", async ({ confidence, none, outcome }) => {
    const verdict = await createFunJudge(curvaturePort({ confidence, none })).judge(REQUEST, FALLBACK, signal());
    expect(verdict.source).toBe("fallback");
    expect(verdict.outcome).toBe(outcome);
    expect(verdict.ranking).toEqual(FALLBACK);
  });

  it("treats a NONE choice as no preference", async () => {
    const port = curvaturePort({
      answer: (request) => ({
        status: "ok",
        probabilities: Object.fromEntries(request.candidates.map((c) => [c.key, 0.2])),
        noneProbability: 0.6,
        choiceKey: null,
        confidence: 0.6,
        model: "jev-1.13.0",
        latencyMs: 1,
      }),
    });
    const verdict = await createFunJudge(port).judge(REQUEST, FALLBACK, signal());
    expect(verdict).toMatchObject({ source: "fallback", outcome: "no-preference" });
  });

  it("reports an unavailable model with its sanitized status and does not cache the failure", async () => {
    let fail = true;
    const port = curvaturePort({
      answer: (request) =>
        fail
          ? { status: "unavailable", reason: "transport-error", latencyMs: 3, httpStatus: 400 }
          : curvaturePort().rank(request, signal()),
    });
    const judge = createFunJudge(port);
    const first = await judge.judge(REQUEST, FALLBACK, signal());
    expect(first).toMatchObject({
      source: "fallback",
      outcome: "unavailable",
      unavailableReason: "transport-error",
      httpStatus: 400,
    });
    await Promise.resolve();
    fail = false;
    const second = await judge.judge(REQUEST, FALLBACK, signal());
    expect(second).toMatchObject({ source: "jev", cached: false, calls: 2 });
  });

  it("serves an identical question from cache regardless of keys or order", async () => {
    const port = curvaturePort();
    const judge = createFunJudge(port);
    await judge.judge(REQUEST, FALLBACK, signal());
    const renamed: FunJudgeRequest = {
      intent: REQUEST.intent,
      candidates: [
        { ...REQUEST.candidates[1]!, key: "r1" },
        { ...REQUEST.candidates[0]!, key: "r0" },
      ],
    };
    const verdict = await judge.judge(renamed, ["r0", "r1"], signal());
    expect(verdict).toMatchObject({ source: "jev", preferredKey: "r1", cached: true, calls: 0 });
    expect(port.calls).toHaveLength(2);
  });

  it("answers with the fallback at the deadline and lets the late answer fill the cache", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = curvaturePort({
      answer: async (request) => {
        await gate;
        return curvaturePort().rank(request, signal());
      },
    });
    const judge = createFunJudge(port, { policy: { ...FUN_JUDGE_POLICY_V1, deadlineMs: 5 } });
    const late = await judge.judge(REQUEST, FALLBACK, signal());
    expect(late).toMatchObject({ source: "fallback", outcome: "timeout", calls: 2 });
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = await judge.judge(REQUEST, FALLBACK, signal());
    expect(next).toMatchObject({ source: "jev", cached: true, calls: 0 });
  });

  it("enforces the process-wide calls-per-minute budget", async () => {
    let time = 0;
    const port = curvaturePort();
    const judge = createFunJudge(port, {
      policy: { ...FUN_JUDGE_POLICY_V1, maxCallsPerMinute: 2 },
      now: () => time,
    });
    await judge.judge(REQUEST, FALLBACK, signal());
    const other: FunJudgeRequest = {
      intent: REQUEST.intent,
      candidates: [REQUEST.candidates[0]!, { ...REQUEST.candidates[1]!, curvature: 0.65 }],
    };
    expect(await judge.judge(other, FALLBACK, signal())).toMatchObject({
      source: "fallback",
      outcome: "budget-exhausted",
      calls: 0,
    });
    time = 60_001;
    expect(await judge.judge(other, FALLBACK, signal())).toMatchObject({ source: "jev", calls: 2 });
  });

  it("refuses malformed requests and evidence-identical candidates without calling the model", async () => {
    const port = curvaturePort();
    const judge = createFunJudge(port);
    expect((await judge.judge({ ...REQUEST, candidates: [REQUEST.candidates[0]!] }, ["fast"], signal())).outcome)
      .toBe("invalid-request");
    expect((await judge.judge(REQUEST, ["fast"], signal())).outcome).toBe("invalid-request");
    expect((await judge.judge({
      ...REQUEST,
      candidates: [REQUEST.candidates[0]!, { ...REQUEST.candidates[1]!, curvature: 1.5 }],
    }, FALLBACK, signal())).outcome).toBe("invalid-request");
    expect((await judge.judge({
      ...REQUEST,
      candidates: [REQUEST.candidates[0]!, { ...REQUEST.candidates[0]!, key: "copy" }],
    }, ["fast", "copy"], signal())).outcome).toBe("indistinguishable");
    expect(port.calls).toHaveLength(0);
  });

  it("fingerprints only what the model sees, never the opaque key", () => {
    const a = evidence("a");
    expect(evidenceFingerprint(a)).toBe(evidenceFingerprint({ ...a, key: "b" }));
    expect(evidenceFingerprint(a)).toBe(evidenceFingerprint({ ...a, curvature: 0.30004 }));
    expect(evidenceFingerprint(a)).not.toBe(evidenceFingerprint({ ...a, curvature: 0.31 }));
  });

  it("returns the fallback immediately for an already-aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const port = curvaturePort();
    const verdict = await createFunJudge(port).judge(REQUEST, FALLBACK, controller.signal);
    expect(verdict).toMatchObject({ source: "fallback", outcome: "unavailable", unavailableReason: "aborted" });
    expect(port.calls).toHaveLength(0);
  });
});
