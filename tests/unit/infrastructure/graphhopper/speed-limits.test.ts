import { describe, expect, it } from "vitest";

import { speedLimitSpans } from "@/infrastructure/routing/graphhopper/road-details";
import { isSpeedLimitSpans, speedLimitAt, speedLimitMph } from "@/domain/route/types";

/** NV-04: posted limits over the returned line, never the engine's guesses. */
describe("speedLimitSpans", () => {
  // Six engine points; point 3 repeats point 2, so the returned line drops it.
  const INDEX_MAP = [0, 1, 2, 2, 3, 4];

  it("keeps tagged limits, drops estimates, and indexes the returned line", () => {
    const spans = speedLimitSpans(6, {
      max_speed: [[0, 2, 56], [2, 5, 40]],
      max_speed_estimated: [[0, 2, false], [2, 4, false], [4, 5, true]],
    }, INDEX_MAP);
    expect(spans).toEqual([
      { fromIndex: 0, toIndex: 2, kmh: 56 },
      { fromIndex: 2, toIndex: 3, kmh: 40 },
    ]);
    expect(isSpeedLimitSpans(spans)).toBe(true);
  });

  it("says nothing without the estimate flag (the hosted graph) or without limits", () => {
    expect(speedLimitSpans(6, { max_speed: [[0, 5, 56]] }, INDEX_MAP)).toEqual([]);
    expect(speedLimitSpans(6, { max_speed_estimated: [[0, 5, false]] }, INDEX_MAP)).toEqual([]);
    expect(speedLimitSpans(6, undefined, INDEX_MAP)).toEqual([]);
  });

  it("drops null and implausible values", () => {
    expect(speedLimitSpans(3, {
      max_speed: [[0, 1, null], [1, 2, 900]],
      max_speed_estimated: [[0, 2, false]],
    }, [0, 1, 2])).toEqual([]);
  });
});

describe("speed limit lookups", () => {
  const SPANS = [{ fromIndex: 0, toIndex: 4, kmh: 56 }, { fromIndex: 6, toIndex: 9, kmh: 88 }];

  it("finds the limit on a segment, and none in a gap", () => {
    expect(speedLimitAt(SPANS, 3)).toBe(56);
    expect(speedLimitAt(SPANS, 4)).toBeNull();
    expect(speedLimitAt(SPANS, 8)).toBe(88);
    expect(speedLimitAt(undefined, 0)).toBeNull();
  });

  it("reads km/h as the US sign it came from", () => {
    expect(speedLimitMph(56)).toBe(35);
    expect(speedLimitMph(40)).toBe(25);
    expect(speedLimitMph(88)).toBe(55);
    expect(speedLimitMph(105)).toBe(65);
  });

  it("refuses malformed spans at a boundary", () => {
    expect(isSpeedLimitSpans([{ fromIndex: 3, toIndex: 3, kmh: 56 }])).toBe(false);
    expect(isSpeedLimitSpans([{ fromIndex: 0, toIndex: 2, kmh: -1 }])).toBe(false);
    expect(isSpeedLimitSpans("x")).toBe(false);
  });
});
