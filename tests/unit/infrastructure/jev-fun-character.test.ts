import { afterEach, describe, expect, it, vi } from "vitest";

import type { FunAssessment } from "@/domain/route/fun";
import {
  budgetedCharacterClassifier,
  jevCharacterClassifierFromEnv,
  type JevCharacterClassifier,
  type JevCharacterReading,
} from "@/infrastructure/routing/jev-fun-character";

const ASSESSMENT: FunAssessment = {
  policyVersion: "PA_NJ_FUN_POLICY_VNEXT_1",
  score: 0.78,
  rawScore: 0.8,
  coverage: 0.82,
  classification: "fun",
  features: {
    curvature: 0.9,
    backroad: 0.7,
    surfaceFit: 0.8,
    elevation: null,
    trafficFlow: 0.8,
    junctionFlow: 0.7,
    novelty: null,
    speedCharacterFit: null,
    signalFlow: null,
    mappedGravelAffinity: 0.4,
  },
  reasons: [{ key: "fun.curvature", impact: "positive", magnitude: 0.27 }],
};

function apiAnswer(
  choice: string,
  confidence: number,
  model = "jev-1.13.0",
): Response {
  return Response.json({
    answers: {
      character: {
        type: "choice",
        choice,
        confidence,
        probabilities: { TWISTY: confidence, UNKNOWN: 1 - confidence },
      },
    },
    model,
    usage: { input_tokens: 40, output_tokens: 8 },
  });
}

describe("Jev fun-character adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays disabled without a server key", () => {
    expect(jevCharacterClassifierFromEnv({})).toBeNull();
  });

  it("does not ask the model to classify sparse evidence", async () => {
    vi.stubGlobal("window", undefined);
    let calls = 0;
    const classifier = jevCharacterClassifierFromEnv(
      { JEV_API_KEY: "apikey_test" },
      { fetcher: async () => { calls += 1; return apiAnswer("TWISTY", 0.96); } },
    );
    const result = await classifier?.classify(
      { ...ASSESSMENT, classification: "unknown", coverage: 0.3 },
      new AbortController().signal,
    );

    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it("sends only aggregate fun features and returns a typed character", async () => {
    vi.stubGlobal("window", undefined);
    let requestBody: unknown;
    let requestUrl = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as unknown;
      return apiAnswer("TWISTY", 0.91);
    };
    const classifier = jevCharacterClassifierFromEnv(
      { JEV_API_KEY: "apikey_test" },
      { fetcher },
    );
    expect(classifier).not.toBeNull();
    const result = await classifier?.classify(ASSESSMENT, new AbortController().signal);

    expect(requestUrl).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requestBody).toMatchObject({
      model: "jev-1.13.0",
      state: {
        policyVersion: ASSESSMENT.policyVersion,
        features: { curvature: 0.9, mappedGravelAffinity: 0.4 },
      },
      questions: { character: { type: "choice" } },
    });
    expect(JSON.stringify(requestBody)).not.toMatch(/coordinates|geometry|fingerprint|apikey_test/);
    expect(result).toEqual({
      label: "TWISTY",
      confidence: 0.91,
      model: "jev-1.13.0",
    });
  });

  it("withholds low-confidence or invalid model labels", async () => {
    vi.stubGlobal("window", undefined);
    const low = jevCharacterClassifierFromEnv(
      { JEV_API_KEY: "apikey_test" },
      { fetcher: async () => apiAnswer("TWISTY", 0.42) },
    );
    const invalid = jevCharacterClassifierFromEnv(
      { JEV_API_KEY: "apikey_test" },
      { fetcher: async () => apiAnswer("MOTORWAY", 0.99) },
    );
    expect((await low?.classify(ASSESSMENT, new AbortController().signal))?.label).toBe("UNKNOWN");
    expect(await invalid?.classify(ASSESSMENT, new AbortController().signal)).toBeNull();

    const drifted = jevCharacterClassifierFromEnv(
      { JEV_API_KEY: "apikey_test" },
      { fetcher: async () => apiAnswer("TWISTY", 0.99, "jev-latest") },
    );
    expect(await drifted?.classify(ASSESSMENT, new AbortController().signal)).toBeNull();
  });
});

describe("budgetedCharacterClassifier", () => {
  const READING: JevCharacterReading = {
    label: "TWISTY",
    confidence: 0.9,
    model: "typesafe/jev-1.13-20260917",
  };

  function deferredClassifier(): { classifier: JevCharacterClassifier; calls: () => number; resolve: (r: JevCharacterReading | null) => void; reject: (e: Error) => void } {
    let calls = 0;
    let resolve: (r: JevCharacterReading | null) => void = () => undefined;
    let reject: (e: Error) => void = () => undefined;
    return {
      classifier: {
        classify: () => {
          calls += 1;
          return new Promise((res, rej) => { resolve = res; reject = rej; });
        },
      },
      calls: () => calls,
      resolve: (r) => resolve(r),
      reject: (e) => reject(e),
    };
  }

  it("answers without a reading when the model is slower than the budget, then reuses the late reading", async () => {
    const inner = deferredClassifier();
    const budgeted = budgetedCharacterClassifier(inner.classifier, { budgetMs: 5 });

    await expect(budgeted.classify(ASSESSMENT, new AbortController().signal)).resolves.toBeNull();
    inner.resolve(READING);
    await expect(budgeted.classify(ASSESSMENT, new AbortController().signal)).resolves.toEqual(READING);
    expect(inner.calls()).toBe(1);
  });

  it("shares one model call between concurrent plans of the same route character", async () => {
    const inner = deferredClassifier();
    const budgeted = budgetedCharacterClassifier(inner.classifier, { budgetMs: 1_000 });

    const first = budgeted.classify(ASSESSMENT, new AbortController().signal);
    const second = budgeted.classify({ ...ASSESSMENT }, new AbortController().signal);
    inner.resolve(READING);

    await expect(Promise.all([first, second])).resolves.toEqual([READING, READING]);
    expect(inner.calls()).toBe(1);
  });

  it("does not cache a failed call", async () => {
    const inner = deferredClassifier();
    const budgeted = budgetedCharacterClassifier(inner.classifier, { budgetMs: 1_000 });

    const failed = budgeted.classify(ASSESSMENT, new AbortController().signal);
    inner.reject(new Error("upstream"));
    await expect(failed).resolves.toBeNull();

    const retried = budgeted.classify(ASSESSMENT, new AbortController().signal);
    inner.resolve(READING);
    await expect(retried).resolves.toEqual(READING);
    expect(inner.calls()).toBe(2);
  });

  it("skips the model for unknown assessments and aborted plans", async () => {
    const inner = deferredClassifier();
    const budgeted = budgetedCharacterClassifier(inner.classifier);
    const aborted = new AbortController();
    aborted.abort();

    await expect(budgeted.classify({ ...ASSESSMENT, classification: "unknown" }, new AbortController().signal)).resolves.toBeNull();
    await expect(budgeted.classify(ASSESSMENT, aborted.signal)).resolves.toBeNull();
    expect(inner.calls()).toBe(0);
  });
});
