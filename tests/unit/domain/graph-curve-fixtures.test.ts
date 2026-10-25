import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeFrancoCurvature } from "@/domain/geometry/franco-curvature";
import type { Coordinate } from "@/domain/ride/types";

const fixtures = JSON.parse(readFileSync("infra/graphhopper/ext/fixtures/franco.json", "utf8")) as { id: string; line: Coordinate[]; weightedMeters: number }[];
describe("shared app/import Franco primitive", () => {
  for (const fixture of fixtures) {
    it(fixture.id, () => expect(analyzeFrancoCurvature(fixture.line).totalCurvature).toBeCloseTo(fixture.weightedMeters, 5));
  }
});
