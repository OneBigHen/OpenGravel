/**
 * The route-plan fixture seam (16-TEST-AND-RELEASE-GATES §7; Task 2.4b).
 *
 * The fixture exists so the critical browser gate can answer plans without a
 * router. These tests are about the two ways that could go wrong: the gate
 * leaking into a deployment that did not ask for it, and an unmarked or broken
 * file being served as if it were an engine's answer. Both must fail closed.
 */

import { describe, expect, it } from "vitest";

import {
  FIXTURE_CANDIDATES_PATH,
  FIXTURE_NOTE,
  MAX_FIXTURE_DELAY_MS,
  fixturePlanModeFromEnv,
  loadFixtureCandidates,
  parseFixtureCandidates,
} from "@/server/planning/fixture-candidates";

/** A minimal, valid fixture document; tests break exactly one thing at a time. */
function document(overrides: Record<string, unknown> = {}): unknown {
  return {
    fixture: true,
    candidates: [
      {
        providerId: "fixture",
        profile: "motorcycle_twisty",
        geometry: [
          { lon: -75.44, lat: 40.14 },
          { lon: -75.43, lat: 40.13 },
        ],
        distanceMeters: 1_400,
        durationSeconds: 240,
      },
    ],
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = document() as { candidates: readonly Record<string, unknown>[] };
  const first = base.candidates[0];
  if (first === undefined) throw new Error("the test's document has no candidate");
  return { ...first, ...overrides };
}

describe("fixturePlanModeFromEnv", () => {
  it("stays off unless the environment asks for exactly \"1\"", () => {
    expect(fixturePlanModeFromEnv({})).toBeNull();
    expect(fixturePlanModeFromEnv({ OGV_ROUTE_PLAN_FIXTURE: "" })).toBeNull();
    expect(fixturePlanModeFromEnv({ OGV_ROUTE_PLAN_FIXTURE: "0" })).toBeNull();
    expect(fixturePlanModeFromEnv({ OGV_ROUTE_PLAN_FIXTURE: "true" })).toBeNull();
    expect(fixturePlanModeFromEnv({ OGV_ROUTE_PLAN_FIXTURE: "yes" })).toBeNull();
  });

  it("names the marked fixture file once enabled", () => {
    expect(fixturePlanModeFromEnv({ OGV_ROUTE_PLAN_FIXTURE: "1" })).toEqual({
      candidatesPath: FIXTURE_CANDIDATES_PATH,
      delayMs: 0,
    });
  });

  it("treats an unusable delay as no delay and caps a hostile one", () => {
    const mode = (value: string): number | undefined =>
      fixturePlanModeFromEnv({
        OGV_ROUTE_PLAN_FIXTURE: "1",
        OGV_ROUTE_PLAN_FIXTURE_DELAY_MS: value,
      })?.delayMs;

    expect(mode("1200")).toBe(1_200);
    expect(mode("0")).toBe(0);
    expect(mode("-5")).toBe(0);
    expect(mode("later")).toBe(0);
    expect(mode("999999999")).toBe(MAX_FIXTURE_DELAY_MS);
  });
});

describe("parseFixtureCandidates", () => {
  it("accepts a marked document and keeps the provider's own fields", () => {
    const result = parseFixtureCandidates(document());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.providerId).toBe("fixture");
    expect(result.candidates[0]?.profile).toBe("motorcycle_twisty");
    expect(result.candidates[0]?.distanceMeters).toBe(1_400);
    // Absent optional fields become empty, never undefined-shaped holes.
    expect(result.candidates[0]?.instructions).toEqual([]);
    expect(result.candidates[0]?.providerMetadata).toEqual({});
  });

  it("keeps instructions and metadata when the file carries them", () => {
    const result = parseFixtureCandidates(
      document({
        candidates: [
          candidate({
            instructions: [
              {
                text: "Turn left onto Ridge Pike",
                distanceMeters: 400,
                durationSeconds: 60,
                type: "turn",
                maneuver: "left",
                roadName: "Ridge Pike",
                geometryIndex: 1,
              },
            ],
            providerMetadata: { fingerprint: "fixture:fp", graph: "fixture-graph" },
          }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.instructions).toHaveLength(1);
    expect(result.candidates[0]?.instructions?.[0]).toMatchObject({
      maneuver: "left",
      roadName: "Ridge Pike",
      geometryIndex: 1,
    });
    expect(result.candidates[0]?.providerMetadata?.["fingerprint"]).toBe("fixture:fp");
  });

  it("refuses a document that is not marked as a fixture", () => {
    expect(parseFixtureCandidates(document({ fixture: false }))).toEqual({
      ok: false,
      reason: "fixture-invalid",
    });
    expect(parseFixtureCandidates(document({ fixture: "true" }))).toEqual({
      ok: false,
      reason: "fixture-invalid",
    });
    const unmarked = document();
    delete (unmarked as { fixture?: unknown }).fixture;
    expect(parseFixtureCandidates(unmarked)).toEqual({ ok: false, reason: "fixture-invalid" });
  });

  it("refuses shapes the provider port cannot accept", () => {
    const cases: readonly unknown[] = [
      null,
      "candidates",
      document({ candidates: [] }),
      document({ candidates: "none" }),
      document({ candidates: [candidate({ geometry: [{ lon: -75.44, lat: 40.14 }] })] }),
      document({ candidates: [candidate({ geometry: [{ lon: "west", lat: 40.14 }] })] }),
      document({ candidates: [candidate({ geometry: [{ lon: 181, lat: 40.14 }] })] }),
      document({ candidates: [candidate({ distanceMeters: -1 })] }),
      document({ candidates: [candidate({ durationSeconds: Number.NaN })] }),
      document({ candidates: [candidate({ providerId: "" })] }),
      document({ candidates: [candidate({ profile: 42 })] }),
      document({ candidates: [candidate({ instructions: [{ text: "go" }] })] }),
      document({ candidates: [candidate({ providerMetadata: { nested: { deep: true } } })] }),
    ];

    for (const value of cases) {
      expect(parseFixtureCandidates(value)).toEqual({ ok: false, reason: "fixture-invalid" });
    }
  });
});

describe("loadFixtureCandidates", () => {
  it("reads the repository's marked fixture file from the working directory", async () => {
    const result = await loadFixtureCandidates(
      { candidatesPath: FIXTURE_CANDIDATES_PATH, delayMs: 0 },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(2);
    // The labelled two-candidate answer the critical gate asserts on: the
    // curvy/twisty recommendation first, the faster straighter line second.
    expect(result.candidates.map((entry) => entry.durationSeconds)).toEqual([245, 155]);
    expect(result.candidates.every((entry) => entry.providerId === "fixture")).toBe(true);
  });

  it("reports a missing file as unreadable, not as an empty answer", async () => {
    const result = await loadFixtureCandidates(
      { candidatesPath: "tests/fixtures/route-plan/does-not-exist.json", delayMs: 0 },
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: false, reason: "fixture-unreadable" });
  });

  it("reports a file that is not a marked fixture as invalid", async () => {
    const result = await loadFixtureCandidates(
      { candidatesPath: "tests/fixtures/route-plan/unmarked.json", delayMs: 0 },
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: false, reason: "fixture-invalid" });
  });

  it("refuses paths outside the fixed fixture directory", async () => {
    const result = await loadFixtureCandidates(
      { candidatesPath: "package.json", delayMs: 0 },
      new AbortController().signal,
    );

    expect(result).toEqual({ ok: false, reason: "fixture-unreadable" });
  });

  it("returns nothing for an attempt that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await loadFixtureCandidates(
      { candidatesPath: FIXTURE_CANDIDATES_PATH, delayMs: 0 },
      controller.signal,
    );

    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("stops waiting for the simulated latency when the attempt is cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(undefined), 10);
    const started = Date.now();

    const result = await loadFixtureCandidates(
      { candidatesPath: FIXTURE_CANDIDATES_PATH, delayMs: 5_000 },
      controller.signal,
    );

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });

  it("carries the label the deployment reports", () => {
    expect(FIXTURE_NOTE).toBe("FIXTURE — not a live router");
  });
});
