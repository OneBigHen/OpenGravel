import { describe, expect, it } from "vitest";

import { headBackDirection } from "@/application/ride-session/head-back";

/** A road running due north along lon -75.0; the rider sits 150 m east of it. */
const LINE = [
  { lon: -75.0, lat: 40.0 },
  { lon: -75.0, lat: 40.1 },
];
const EAST_OF_ROAD = { lon: -75.0 + 150 / (111_320 * Math.cos((40.05 * Math.PI) / 180)), lat: 40.05 };

describe("headBackDirection", () => {
  it("says turn around when the route is behind the rider", () => {
    // Riding east, away from the road to the west.
    expect(headBackDirection(LINE, EAST_OF_ROAD, 90)?.glyph).toBe("uturn");
  });

  it("says left or right from the direction of travel", () => {
    // Riding north with the road to the west: the road is on the left.
    expect(headBackDirection(LINE, EAST_OF_ROAD, 0)?.glyph).toBe("left");
    // Riding south with the road to the west: on the right.
    expect(headBackDirection(LINE, EAST_OF_ROAD, 180)?.glyph).toBe("right");
  });

  it("says straight when the route is ahead", () => {
    expect(headBackDirection(LINE, EAST_OF_ROAD, 270)?.glyph).toBe("straight");
  });

  it("measures the way to the nearest point and never guesses a side without a heading", () => {
    const result = headBackDirection(LINE, EAST_OF_ROAD, null);
    expect(result?.glyph).toBe("straight");
    expect(result?.meters).toBeGreaterThan(145);
    expect(result?.meters).toBeLessThan(155);
  });

  it("has nothing to say without a line", () => {
    expect(headBackDirection([], EAST_OF_ROAD, 0)).toBeNull();
  });
});
