import { describe, expect, it } from "vitest";

import {
  createRiderPreferenceModel,
  emptyPreferenceVector,
  observePairwisePreference,
  predictPairPreference,
  selectPreferenceQuestion,
  type RiderPreferenceVector,
} from "@/domain/personalization/rider-preference";

function vector(
  values: Partial<Record<keyof RiderPreferenceVector, number>>,
): RiderPreferenceVector {
  return { ...emptyPreferenceVector(), ...values };
}

describe("rider preference learning", () => {
  it("learns a strong axis from a handful of explicit comparisons", () => {
    const twisty = vector({ curvature: 0.95, timeEfficiency: 0.45 });
    const straight = vector({ curvature: 0.15, timeEfficiency: 0.75 });
    let model = createRiderPreferenceModel();

    for (let index = 0; index < 8; index += 1) {
      model = observePairwisePreference(model, {
        left: twisty,
        right: straight,
        preferred: "left",
        source: "explicit-pair",
      });
    }

    expect(model.mean.curvature).toBeGreaterThan(0);
    expect(model.mean.timeEfficiency).toBeLessThan(0);
    expect(model.explicitComparisons).toBe(8);
    expect(predictPairPreference(model, twisty, straight).leftProbability).toBeGreaterThan(0.75);
  });

  it("weights route-selection behavior below explicit rider input", () => {
    const left = vector({ backroad: 0.9 });
    const right = vector({ backroad: 0.1 });
    const explicit = observePairwisePreference(createRiderPreferenceModel(), {
      left,
      right,
      preferred: "left",
      source: "explicit-pair",
    });
    const behavioral = observePairwisePreference(createRiderPreferenceModel(), {
      left,
      right,
      preferred: "left",
      source: "route-selected",
    });

    expect(explicit.mean.backroad).toBeGreaterThan(behavioral.mean.backroad);
    expect(explicit.explicitComparisons).toBe(1);
    expect(behavioral.implicitComparisons).toBe(1);
  });

  it("does not turn missing road evidence into a learned preference", () => {
    const known = vector({ curvature: 0.9 });
    const unknown = emptyPreferenceVector();
    const before = createRiderPreferenceModel();
    const after = observePairwisePreference(before, {
      left: known,
      right: unknown,
      preferred: "left",
      source: "explicit-pair",
    });

    expect(after).toBe(before);
  });

  it("actively asks about uncertain, differentiating pairs instead of obvious duplicates", () => {
    const model = createRiderPreferenceModel({
      curvature: { mean: 2.5, precision: 8 },
    });
    const question = selectPreferenceQuestion(model, [
      { id: "known-a", item: "known-a", features: vector({ curvature: 0.9, backroad: 0.5 }) },
      { id: "known-b", item: "known-b", features: vector({ curvature: 0.1, backroad: 0.5 }) },
      { id: "learn-a", item: "learn-a", features: vector({ curvature: 0.5, backroad: 0.95 }) },
      { id: "learn-b", item: "learn-b", features: vector({ curvature: 0.5, backroad: 0.05 }) },
    ]);

    expect(question).not.toBeNull();
    expect(new Set([question!.left, question!.right])).toEqual(new Set(["learn-a", "learn-b"]));
    expect(question!.informationValue).toBeGreaterThan(0);
  });

  it("keeps a fresh model calibrated near 50/50 rather than faking confidence", () => {
    const prediction = predictPairPreference(
      createRiderPreferenceModel(),
      vector({ novelty: 1, junctionFlow: 0.8 }),
      vector({ novelty: 0, junctionFlow: 0.2 }),
    );

    expect(prediction.leftProbability).toBeCloseTo(0.5, 6);
    expect(prediction.confidence).toBeCloseTo(0, 6);
    expect(prediction.uncertainty).toBeGreaterThan(0);
  });
});
