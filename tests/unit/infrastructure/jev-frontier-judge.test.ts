import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { jevFrontierJudgeFromEnv } from "@/infrastructure/routing/jev-frontier-judge";
import { buildBalancedJevFrontierPermutations } from "@/application/planner/jev-frontier-shadow";
import { frontierState, remoteAnswer } from "../../helpers/jev-frontier";

function input(count = 3) {
  const state = frontierState(count);
  return {
    state,
    permutation: buildBalancedJevFrontierPermutations(state, "case-1")[0]!,
    variant: "B" as const,
  };
}
const env = {
  OGV_JEV_FRONTIER_SHADOW: "1",
  OPENROUTER_API_KEY: "test-never-log-this",
};
const signal = () => new AbortController().signal;

describe("server-only frontier adapter", () => {
  beforeEach(() => vi.stubGlobal("window", undefined));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("makes no call without both opt-in and OpenRouter key", async () => {
    const fetcher = vi.fn();
    for (const e of [
      {},
      { OPENROUTER_API_KEY: "test" },
      { OGV_JEV_FRONTIER_SHADOW: "1" },
    ]) {
      expect(
        await jevFrontierJudgeFromEnv(e, { fetcher }).judge(input(), signal()),
      ).toMatchObject({ status: "skipped", reason: "disabled" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses a direct TypeSafe key only with explicit provider selection", async () => {
    const i = input(2);
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer direct-test-key",
        );
        expect(JSON.parse(String(init?.body)).model).toBe("jev-1.13");
        return Response.json(
          remoteAnswer(i.permutation.slots.map((s) => s.slot)),
        );
      },
    );
    const direct = {
      OGV_JEV_FRONTIER_SHADOW: "1",
      JEV_API_KEY: "direct-test-key",
    };
    expect(
      await jevFrontierJudgeFromEnv(direct, { fetcher }).judge(i, signal()),
    ).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(
      await jevFrontierJudgeFromEnv(
        {
          ...direct,
          OGV_JEV_FRONTIER_PROVIDER: "typesafe",
          OPENROUTER_API_KEY: "wrong-provider-key",
          TYPESAFE_BASE_URL: "https://untrusted.invalid",
        },
        { fetcher },
      ).judge(i, signal()),
    ).toMatchObject({ status: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not fall back across credential providers or accept an unknown provider", async () => {
    const fetcher = vi.fn();
    for (const e of [
      { ...env, OGV_JEV_FRONTIER_PROVIDER: "typesafe" },
      { ...env, OGV_JEV_FRONTIER_PROVIDER: "unknown", JEV_API_KEY: "test" },
      {
        OGV_JEV_FRONTIER_SHADOW: "1",
        OGV_JEV_FRONTIER_PROVIDER: "openrouter",
        JEV_API_KEY: "test",
      },
    ])
      expect(
        await jevFrontierJudgeFromEnv(e, { fetcher }).judge(input(), signal()),
      ).toMatchObject({ status: "skipped", reason: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([2, 3])(
    "batches all questions for %s candidates and maps slots locally",
    async (count) => {
      let body: Record<string, unknown> = {};
      let url = "";
      const i = input(count);
      const fetcher: typeof fetch = async (u, init) => {
        url = String(u);
        body = JSON.parse(String(init?.body));
        return Response.json(
          remoteAnswer(i.permutation.slots.map((s) => s.slot)),
        );
      };
      const result = await jevFrontierJudgeFromEnv(env, { fetcher }).judge(
        i,
        signal(),
      );
      expect(url).toBe("https://openrouter.ai/api/v1/systemone");
      expect(body.model).toBe("jev-1.13");
      expect(JSON.stringify(body.state)).not.toMatch(
        /route-|deterministicBaselineId|canonicalScore|"geometry"|history|test-never/,
      );
      const questions = body.questions as Record<
        string,
        { instructions: string; criteria: unknown }
      >;
      expect(Object.keys(questions)).toHaveLength(count + 2);
      expect(JSON.stringify(questions.choose)).not.toMatch(/baseline|route-/);
      expect(questions.improvement!.instructions).toContain(
        `baseline slot ${i.permutation.slots.find((s) => s.candidateId === i.state.deterministicBaselineId)!.slot}`,
      );
      expect(questions.fit_A!.criteria).toHaveLength(4);
      const first = i.state.candidates.find(
        (c) => c.id === i.permutation.slots[0]!.candidateId,
      )!;
      expect(JSON.stringify(questions.choose!.criteria)).toContain(
        "candidates[slot=A]",
      );
      expect(JSON.stringify(questions.choose!.criteria)).toContain(
        "durationSeconds",
      );
      expect(JSON.stringify(questions.choose!.criteria)).not.toContain(
        String(first.durationSeconds),
      );
      expect(result).toMatchObject({
        status: "ok",
        judgment: {
          choice: { choice: i.permutation.slots[0]!.candidateId },
          meaningfulImprovement: { noul: 0.72 },
        },
        usage: { inputTokens: 41, outputTokens: 9, cost: 0.0001 },
      });
    },
  );
  it("skips malformed states and permutations before transport", async () => {
    const fetcher = vi.fn();
    const judge = jevFrontierJudgeFromEnv(env, { fetcher });
    for (const i of [
      { ...input(), state: null },
      { ...input(), permutation: null },
      { ...input(), permutation: { id: "p", slots: [null] } },
    ]) {
      expect(await judge.judge(i as never, signal())).toMatchObject({
        status: "skipped",
        reason: "invalid-state",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    null,
    "bad JSON",
    {},
    { answers: null },
    { model: "jev-latest", answers: remoteAnswer().answers },
  ])("guards remote JSON %j", async (raw) => {
    const result = await jevFrontierJudgeFromEnv(env, {
      fetcher: async () => Response.json(raw),
    }).judge(input(), signal());
    expect(result.status).toBe("invalid");
  });
  it.each(["choice", "pmf", "score", "missing", "noul", "extra-slot"])(
    "rejects inconsistent remote %s",
    async (kind) => {
      const raw = remoteAnswer();
      if (kind === "choice") raw.answers.choose.choice = "B";
      if (kind === "pmf") raw.answers.choose.probabilities.A = 2;
      if (kind === "score")
        (raw.answers as unknown as Record<string, { score: number }>)[
          "fit_A"
        ]!.score = 3;
      if (kind === "missing")
        delete (raw.answers as unknown as Record<string, unknown>)["fit_B"];
      if (kind === "noul") raw.answers.improvement.noul = -1;
      if (kind === "extra-slot")
        raw.answers.choose.probabilities["invented-slot"] = 0;
      expect(
        (
          await jevFrontierJudgeFromEnv(env, {
            fetcher: async () => Response.json(raw),
          }).judge(input(), signal())
        ).status,
      ).toBe("invalid");
    },
  );
  it.each([400, 401, 429, 500, 503])(
    "never retries HTTP %s",
    async (status) => {
      const fetcher = vi.fn(async () =>
        Response.json({ error: "private provider error" }, { status }),
      );
      const result = await jevFrontierJudgeFromEnv(env, { fetcher }).judge(
        input(),
        signal(),
      );
      expect(result).toMatchObject({
        status: "failed",
        reason: "transport-error",
        httpStatus: status,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("private provider");
    },
  );
  it("bounds a fetch that ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const pending = jevFrontierJudgeFromEnv(env, { fetcher }).judge(
      input(),
      signal(),
    );
    await vi.advanceTimersByTimeAsync(1501);
    expect(await pending).toMatchObject({
      status: "failed",
      reason: "timeout",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("skips pre-cancellation and respects in-flight abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const judge = jevFrontierJudgeFromEnv(env, { fetcher });
    expect(await judge.judge(input(), controller.signal)).toMatchObject({
      status: "skipped",
      reason: "cancelled",
    });
    const active = new AbortController();
    const pending = judge.judge(input(), active.signal);
    active.abort();
    expect(await pending).toMatchObject({
      status: "failed",
      reason: "aborted",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("validates against a frozen request even if its caller mutates internal state during fetch", async () => {
  vi.stubGlobal("window", undefined);
  const i = input();
  const original = i.permutation.slots[0]!.candidateId;
  const fetcher: typeof fetch = async () => {
    (i.state.candidates[0] as { id: string }).id = "changed-by-caller";
    return Response.json(remoteAnswer());
  };
  try {
    const result = await jevFrontierJudgeFromEnv(env, { fetcher }).judge(
      i,
      signal(),
    );
    expect(result).toMatchObject({
      status: "ok",
      judgment: { choice: { choice: original } },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
