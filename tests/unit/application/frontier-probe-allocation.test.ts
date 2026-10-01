import { describe, expect, it } from "vitest";
import type {
  FrontierCandidate,
  FrontierQualityVector,
} from "@/application/planner/frontier-routing";
import {
  selectNextFrontierProbe,
  type FrontierProbeForecast,
} from "@/application/planner/frontier-probe-allocation";

function candidate(
  id: string,
  overrides: Partial<FrontierQualityVector>,
): FrontierCandidate {
  return {
    id,
    quality: {
      timeEfficiency: null,
      curvature: null,
      flow: null,
      backroad: null,
      surfaceFit: null,
      gravelAffinity: null,
      trafficFlow: null,
      junctionFlow: null,
      novelty: null,
      ...overrides,
    },
  };
}
const profiles = [
  { id: "efficient", weights: { timeEfficiency: 1 } },
  { id: "twisty", weights: { curvature: 1 } },
  { id: "flowing", weights: { flow: 1 } },
];
const baseline = candidate("baseline", {
  timeEfficiency: 0.9,
  curvature: 0.1,
  flow: 0.3,
});
const curvy = candidate("curvy-outcome", {
  timeEfficiency: 0.5,
  curvature: 0.95,
  flow: 0.3,
});
const duplicate = candidate("duplicate-outcome", {
  timeEfficiency: 0.9,
  curvature: 0.11,
  flow: 0.3,
});
const forecasts: readonly FrontierProbeForecast[] = [
  {
    id: "a-generic",
    maximumProviderAttempts: 1,
    outcomes: [{ probability: 1, candidate: duplicate }],
  },
  {
    id: "z-curvy-corridor",
    maximumProviderAttempts: 1,
    outcomes: [{ probability: 0.8, candidate: curvy }],
  },
];
const budget = {
  maximumProviderAttempts: 3,
  providerAttemptsUsed: 1,
  attemptedProbeIds: [] as readonly string[],
};

describe("frontier probe allocation", () => {
  it("spends the next call on the missing curvy tradeoff rather than another efficient duplicate", () => {
    const result = selectNextFrontierProbe({
      candidates: [baseline],
      profiles,
      forecasts,
      maxResults: 2,
      budget,
    });
    expect(result).toMatchObject({
      status: "selected",
      probeId: "z-curvy-corridor",
      reservedProviderAttempts: 1,
    });
    if (result.status !== "selected") throw Error("No probe selected");
    // Current worst forecast regret is .95 - .10 = .85. With probability .8
    // the curved alternative closes it, with probability .2 it adds no route.
    expect(result.referenceMaximumRegret).toBeCloseTo(0.85);
    expect(result.expectedMaximumRegretReduction).toBeCloseTo(0.68);
    expect(result.expectedMeanRegretReduction).toBeCloseTo(0.2266666667);
  });
  it("reserves retry and connector attempts before admitting a probe", () => {
    const result = selectNextFrontierProbe({
      candidates: [baseline],
      profiles,
      maxResults: 2,
      forecasts: [
        forecasts[0]!,
        { ...forecasts[1]!, maximumProviderAttempts: 2 },
      ],
      budget: { ...budget, maximumProviderAttempts: 2 },
    });
    expect(result).toMatchObject({
      status: "selected",
      probeId: "a-generic",
      reservedProviderAttempts: 1,
    });
  });
  it.each([
    { maximumProviderAttempts: -1 },
    { maximumProviderAttempts: 1.5 },
    { maximumProviderAttempts: Number.POSITIVE_INFINITY },
    { maximumProviderAttempts: 33 },
    { providerAttemptsUsed: -1 },
    { providerAttemptsUsed: 0.5 },
    { providerAttemptsUsed: 4 },
    { attemptedProbeIds: ["z-curvy-corridor", "z-curvy-corridor"] },
    { attemptedProbeIds: ["x".repeat(129)] },
    { attemptedProbeIds: ["first", "second"] },
    { attemptedProbeIds: Array.from({ length: 33 }, (_, i) => `probe-${i}`) },
  ])("rejects an invalid attempt ledger %j", (invalid) => {
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts,
        maxResults: 2,
        budget: { ...budget, ...invalid },
      }),
    ).toEqual({ status: "invalid", reason: "invalid-budget" });
  });
  it.each([
    { maximumProviderAttempts: 0 },
    { maximumProviderAttempts: 1.5 },
    { outcomes: [{ probability: -0.1, candidate: curvy }] },
    { outcomes: [{ probability: Number.NaN, candidate: curvy }] },
    { outcomes: [{ probability: 1.1, candidate: curvy }] },
    {
      outcomes: [
        { probability: 0.6, candidate: curvy },
        { probability: 0.6, candidate: duplicate },
      ],
    },
    {
      outcomes: [
        { probability: 1, candidate: candidate("bad", { curvature: 1.01 }) },
      ],
    },
    { outcomes: [{ probability: 1, candidate: baseline }] },
  ])(
    "rejects a forecast that cannot represent a bounded outcome distribution %j",
    (invalid) => {
      expect(
        selectNextFrontierProbe({
          candidates: [baseline],
          profiles,
          forecasts: [{ ...forecasts[1]!, ...invalid }],
          maxResults: 2,
          budget,
        }),
      ).toEqual({ status: "invalid", reason: "invalid-forecast" });
    },
  );
  it.each([
    { profiles: [] },
    { profiles: [{ id: "bad", weights: {} }] },
    { profiles: [{ id: "bad", weights: { curvature: -1 } }] },
    { profiles: [{ id: "bad", weights: { curvature: Number.NaN } }] },
    { profiles: [{ id: "bad", weights: { curvature: 1e308, flow: 1e308 } }] },
    { profiles: [{ id: "bad", weights: { invented: 1 } }] },
    { profiles: [profiles[0], profiles[0]] },
  ])(
    "rejects profiles that cannot define the current positive-quality utility contract %j",
    (invalid) => {
      expect(
        selectNextFrontierProbe({
          candidates: [baseline],
          profiles: invalid.profiles as never,
          forecasts,
          maxResults: 2,
          budget,
        }),
      ).toEqual({ status: "invalid", reason: "invalid-profiles" });
    },
  );
  it.each([
    { candidates: [] },
    { candidates: [baseline, baseline] },
    { candidates: [null] },
    { candidates: [candidate("bad", { curvature: Number.NaN })] },
    {
      candidates: Array.from({ length: 7 }, (_, i) =>
        candidate(`route-${i}`, {}),
      ),
    },
    { maxResults: 0 },
    { maxResults: 4 },
    { maxResults: 1.5 },
  ])("rejects an invalid or unbounded measured pool %j", (invalid) => {
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts,
        maxResults: 2,
        budget,
        ...invalid,
      } as never),
    ).toEqual({ status: "invalid", reason: "invalid-candidates" });
  });
  it("keeps a cold-start forecast absence distinct from spent attempts", () => {
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts: [],
        maxResults: 2,
        budget,
      }),
    ).toEqual({ status: "exhausted", reason: "no-useful-probe" });
  });
  it("does not claim a gain against invented zero curve utility when observed evidence is unknown", () => {
    expect(
      selectNextFrontierProbe({
        candidates: [candidate("unknown-curves", { timeEfficiency: 0.9 })],
        profiles: [{ id: "twisty", weights: { curvature: 1 } }],
        forecasts: [forecasts[1]!],
        maxResults: 2,
        budget,
      }),
    ).toEqual({ status: "exhausted", reason: "no-comparable-evidence" });
  });
  it("moves exploration toward flow after an actual curvy candidate fills that tradeoff", () => {
    const withFlow: readonly FrontierProbeForecast[] = [
      ...forecasts,
      {
        id: "flow-corridor",
        maximumProviderAttempts: 1,
        outcomes: [
          {
            probability: 0.2,
            candidate: candidate("flow-outcome", {
              timeEfficiency: 0.6,
              curvature: 0.5,
              flow: 0.9,
            }),
          },
        ],
      },
    ];
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts: withFlow,
        maxResults: 2,
        budget,
      }),
    ).toMatchObject({ status: "selected", probeId: "z-curvy-corridor" });
    expect(
      selectNextFrontierProbe({
        candidates: [baseline, { ...curvy, id: "observed-curvy" }],
        profiles,
        forecasts: withFlow,
        maxResults: 2,
        budget: {
          ...budget,
          providerAttemptsUsed: 2,
          attemptedProbeIds: ["z-curvy-corridor"],
        },
      }),
    ).toMatchObject({ status: "selected", probeId: "flow-corridor" });
  });
  it("does not invent a discovery gain from unknown or zero-probability evidence", () => {
    for (const outcome of [
      { probability: 1, candidate: candidate("unknown", {}) },
      { probability: 0, candidate: curvy },
    ]) {
      expect(
        selectNextFrontierProbe({
          candidates: [baseline],
          profiles,
          forecasts: [
            {
              id: "unknown-probe",
              maximumProviderAttempts: 1,
              outcomes: [outcome],
            },
          ],
          maxResults: 2,
          budget,
        }),
      ).toEqual({ status: "exhausted", reason: "no-useful-probe" });
    }
  });
  it("retains deterministic ties and leaves all caller facts unchanged", () => {
    const tied = [
      {
        ...forecasts[1]!,
        id: "z",
        outcomes: [
          { probability: 0.8, candidate: { ...curvy, id: "z-outcome" } },
        ],
      },
      {
        ...forecasts[1]!,
        id: "a",
        outcomes: [
          { probability: 0.8, candidate: { ...curvy, id: "a-outcome" } },
        ],
      },
    ];
    const input = {
      candidates: [baseline],
      profiles,
      forecasts: tied,
      maxResults: 2,
      budget,
    };
    const before = JSON.stringify(input);
    expect(selectNextFrontierProbe(input)).toMatchObject({
      status: "selected",
      probeId: "a",
    });
    expect(
      selectNextFrontierProbe({
        ...input,
        profiles: [...profiles].reverse(),
        forecasts: [...tied].reverse(),
      }),
    ).toMatchObject({ status: "selected", probeId: "a" });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("charges attempted failures and stops when the actual attempt ledger is spent", () => {
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts,
        maxResults: 2,
        budget: { ...budget, attemptedProbeIds: ["z-curvy-corridor"] },
      }),
    ).toMatchObject({ status: "selected", probeId: "a-generic" });
    expect(
      selectNextFrontierProbe({
        candidates: [baseline],
        profiles,
        forecasts,
        maxResults: 2,
        budget: { ...budget, providerAttemptsUsed: 3 },
      }),
    ).toEqual({ status: "exhausted", reason: "attempt-budget" });
  });
});
