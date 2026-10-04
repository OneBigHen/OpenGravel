import { describe, expect, it } from "vitest";

import { anchorsAlong, isRoutable } from "../../../scripts/validate-gravel-atlas";

describe("Gravel Atlas graph validation", () => {
  it("samples at most six anchors including both ends", () => {
    const line = Array.from({ length: 40 }, (_, index) => [-77 + index * 0.001, 40] as const);
    const anchors = anchorsAlong(line);
    expect(anchors).toHaveLength(6);
    expect(anchors[0]).toEqual(line[0]);
    expect(anchors.at(-1)).toEqual(line.at(-1));
    expect(anchorsAlong(line.slice(0, 3))).toHaveLength(3);
  });

  it("calls a corridor routable only when the router rides it at about its own length", () => {
    expect(isRoutable(2_100, 2_000)).toBe(true);
    expect(isRoutable(38_896, 6_010)).toBe(false);
    expect(isRoutable(400, 300)).toBe(true);
  });
});
