import { describe, expect, it } from "vitest";

import { autoPeekDetent } from "@/ui/planner/auto-peek";

const base = { detent: "half", compact: true, hasRide: true, panning: true, typing: false, placeOpen: false } as const;

describe("auto-peek (PF-2: a map drag at half hands the map back)", () => {
  it("drops half and the ride's resting half to peek", () => {
    expect(autoPeekDetent(base)).toBe("peek");
    expect(autoPeekDetent({ ...base, detent: "ride" })).toBe("peek");
  });

  it("never moves the full sheet, a peek, or a folded sheet", () => {
    expect(autoPeekDetent({ ...base, detent: "expanded" })).toBeNull();
    expect(autoPeekDetent({ ...base, detent: "peek" })).toBeNull();
    expect(autoPeekDetent({ ...base, detent: "mini" })).toBeNull();
  });

  it("waits while typing, without a ride, under a pen tool, over a place card, or on a wide screen", () => {
    expect(autoPeekDetent({ ...base, typing: true })).toBeNull();
    expect(autoPeekDetent({ ...base, hasRide: false })).toBeNull();
    expect(autoPeekDetent({ ...base, panning: false })).toBeNull();
    expect(autoPeekDetent({ ...base, placeOpen: true })).toBeNull();
    expect(autoPeekDetent({ ...base, compact: false })).toBeNull();
  });
});
