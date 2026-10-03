import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FunJudgeCandidateEvidence, FunJudgeRequest } from "@/application/planner/ports/fun-judge";
import {
  buildJevFunJudgeRequest,
  decodeJevFunJudgeAnswer,
  jevFunJudgeFromEnv,
} from "@/infrastructure/routing/jev-fun-judge";

function evidence(key: string, overrides: Partial<FunJudgeCandidateEvidence> = {}): FunJudgeCandidateEvidence {
  return {
    key,
    durationMinutes: 61.234,
    distanceMiles: 45.67,
    addedTimePct: 0,
    curvature: 0.31234,
    curvatureContinuity: null,
    backroadShare: 0.3,
    surfaceFit: 0.9,
    elevation: null,
    trafficFlow: 0.6,
    junctionFlow: 0.6,
    novelty: null,
    mappedGravelAffinity: null,
    maneuversPer10Miles: 4.25,
    rideArc: null,
    evidenceCoverage: 0.8,
    ...overrides,
  };
}

const REQUEST: FunJudgeRequest = {
  intent: { roadCharacter: "curvy", surfacePreference: "pavement", avoidHighways: true },
  candidates: [evidence("secret_key_a"), evidence("secret_key_b", { curvature: 0.7, addedTimePct: 0.18 })],
};

function apiAnswer(
  probabilities: Record<string, number>,
  choice: string,
  model = "jev-1.13.0",
): Response {
  return Response.json({
    answers: { fun: { type: "choice", choice, confidence: Math.max(...Object.values(probabilities)), probabilities } },
    model,
    usage: { input_tokens: 90, output_tokens: 4 },
  });
}

const signal = () => new AbortController().signal;

describe("Jev FUN JUDGE adapter", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => vi.unstubAllGlobals());

  it("is absent without a server key", () => {
    expect(jevFunJudgeFromEnv({})).toBeNull();
    expect(jevFunJudgeFromEnv({ JEV_API_KEY: "  " })).toBeNull();
  });

  it("sends anonymous slots with rounded aggregates only, pinned to jev-1.13.0", () => {
    const wire = buildJevFunJudgeRequest(REQUEST);
    expect(wire).not.toBeNull();
    const text = JSON.stringify(wire);
    expect(text).not.toMatch(/secret_key|geometry|coordinates|fingerprint|score|canonical/i);
    expect(wire).toMatchObject({
      model: "jev-1.13.0",
      state: {
        intent: { roadCharacter: "curvy", surfacePreference: "pavement", avoidHighways: true },
        candidates: [
          { slot: "A", durationMinutes: 61.2, distanceMiles: 45.7, curvature: 0.312, maneuversPer10Miles: 4.3 },
          { slot: "B", curvature: 0.7, addedTimePct: 0.18 },
        ],
      },
      questions: { fun: { type: "choice", criteria: { A: expect.any(String), B: expect.any(String), NONE: expect.any(String) } } },
    });
    expect(buildJevFunJudgeRequest({ ...REQUEST, candidates: [REQUEST.candidates[0]!] })).toBeNull();
  });

  it("maps slot probabilities back to the request keys", async () => {
    let url = "";
    let body: unknown;
    const port = jevFunJudgeFromEnv({ JEV_API_KEY: "apikey_test" }, {
      fetcher: async (input, init) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return apiAnswer({ A: 0.1, B: 0.85, NONE: 0.05 }, "B");
      },
    });
    const answer = await port!.rank(REQUEST, signal());
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.stringify(body)).not.toContain("apikey_test");
    expect(answer).toMatchObject({
      status: "ok",
      choiceKey: "secret_key_b",
      model: "jev-1.13.0",
    });
    if (answer.status !== "ok") throw new Error("expected ok");
    expect(answer.probabilities.secret_key_b).toBeCloseTo(0.85);
    expect(answer.noneProbability).toBeCloseTo(0.05);
  });

  it.each([
    ["moving alias", { model: "jev-latest" }],
    ["OpenRouter spelling on the direct pin", { model: "typesafe/jev-1.13" }],
    ["unknown slot", { probabilities: { A: 0.5, B: 0.3, C: 0.1, NONE: 0.1 } }],
    ["missing NONE", { probabilities: { A: 0.5, B: 0.5 } }],
    ["probabilities not summing to one", { probabilities: { A: 0.5, B: 0.5, NONE: 0.5 } }],
    ["choice outside the slots", { choice: "C" }],
  ])("rejects a %s answer", (_, change) => {
    const raw = {
      model: "jev-1.13.0",
      answers: {
        fun: {
          type: "choice",
          choice: "A",
          confidence: 0.8,
          probabilities: { A: 0.8, B: 0.15, NONE: 0.05 },
          ...("probabilities" in change || "choice" in change ? change : {}),
        },
      },
      ...("model" in change ? change : {}),
    };
    expect(decodeJevFunJudgeAnswer(REQUEST, raw, 3)).toEqual({
      status: "unavailable",
      reason: "invalid-response",
      latencyMs: 3,
    });
  });

  it("reports HTTP failures with a numeric status only", async () => {
    const port = jevFunJudgeFromEnv({ JEV_API_KEY: "apikey_test" }, {
      fetcher: async () => Response.json({ error: { message: "Unknown model: secret detail" } }, { status: 400 }),
    });
    const answer = await port!.rank(REQUEST, signal());
    expect(answer).toMatchObject({ status: "unavailable", reason: "transport-error", httpStatus: 400 });
    expect(JSON.stringify(answer)).not.toContain("secret detail");
  });

  it("times out on its own deadline and honours an aborted caller", async () => {
    const hanging = jevFunJudgeFromEnv({ JEV_API_KEY: "apikey_test" }, {
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });
    const controller = new AbortController();
    const pending = hanging!.rank(REQUEST, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ status: "unavailable", reason: "aborted" });
  });
});
