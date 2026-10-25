import { describe, expect, it } from "vitest";

const url = process.env.OGV_CURVE_ENGINE_URL;
const live = url ? describe : describe.skip;
const pairs = [
  [[-75.7387, 40.8636], [-75.9832, 40.6364]],
  [[-75.4714, 40.6023], [-75.1946, 40.9868]],
  [[-75.1299, 40.3101], [-74.9513, 40.3643]],
];

live("og_curve baked landmarks and request penalties", () => {
  for (const profile of ["motorcycle_twisty", "motorcycle_scenic"]) {
    for (const [index, points] of pairs.entries()) {
      it(`${profile} pair ${index}: LM equals flexible`, { timeout: 60_000 }, async () => {
        const answers = [];
        for (const disableLm of [false, true]) {
          const response = await fetch(`${url}/route`, {
            method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({ profile, points, points_encoded: false, instructions: false, "ch.disable": true, "lm.disable": disableLm,
              custom_model: { priority: [{ if: "og_curve < 0.15", multiply_by: "0.8" }] }, details: ["og_curve"] }),
          });
          const body = await response.json();
          expect(response.ok, JSON.stringify(body)).toBe(true);
          expect(body.paths).toHaveLength(1);
          expect(body.paths[0].details.og_curve.length).toBeGreaterThan(0);
          for (const detail of body.paths[0].details.og_curve) {
            expect(detail[2]).toBeGreaterThanOrEqual(0);
            expect(detail[2]).toBeLessThanOrEqual(1);
          }
          answers.push(body.paths[0]);
        }
        expect(answers[0].weight).toBeCloseTo(answers[1].weight, 4);
        expect(answers[0].time).toBeCloseTo(answers[1].time, 0);
      });
    }
  }
});
