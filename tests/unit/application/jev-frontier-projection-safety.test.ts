import { expect, it } from "vitest";
import { projectJevFrontierTransportState } from "@/application/planner/jev-frontier-shadow";
import { frontierState } from "../../helpers/jev-frontier";
it.each([
  null,
  {},
  { id: "p", slots: [null] },
  {
    id: "p",
    slots: [
      { slot: "A", candidateId: "route-1" },
      { slot: "C", candidateId: "route-2" },
    ],
  },
])("guards malformed or unbalanced runtime permutation %j", (permutation) => {
  expect(
    projectJevFrontierTransportState(
      frontierState(2),
      permutation as never,
      "A",
    ),
  ).toBeNull();
});

it("keeps duration intrinsic and omits its derived time-efficiency ratio", () => {
  const s = frontierState(2);
  const p = {
    id: "p",
    slots: [
      { slot: "A" as const, candidateId: "route-1" },
      { slot: "B" as const, candidateId: "route-2" },
    ],
  };
  for (const variant of ["A", "B", "C"] as const) {
    const projected = projectJevFrontierTransportState(s, p, variant)!;
    expect(projected.candidates[0]!.durationSeconds).toBe(
      s.candidates[0]!.durationSeconds,
    );
    expect(projected.candidates[0]!.frontier).not.toHaveProperty(
      "timeEfficiency",
    );
  }
});
