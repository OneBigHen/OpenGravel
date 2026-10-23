import { describe, expect, it } from "vitest";

import { waypointNotches } from "@/application/elevation/waypoints";

/** A straight west→east line: shares read as plain longitude fractions. */
const LINE = [
  { lon: -75.7, lat: 40.8 },
  { lon: -75.5, lat: 40.8 },
];

describe("waypointNotches", () => {
  it("places each authored point at its share of the ride, in authored order", () => {
    const notches = waypointNotches(LINE, [
      { coordinate: { lon: -75.7, lat: 40.8 }, label: "Start" },
      { coordinate: { lon: -75.6, lat: 40.8 }, label: "Stop 1" },
      { coordinate: { lon: -75.5, lat: 40.8 }, label: "Finish" },
    ]);
    expect(notches.map((notch) => notch.position)).toEqual([1, 2, 3]);
    expect(notches[0]?.share).toBeCloseTo(0, 6);
    expect(notches[1]?.share).toBeCloseTo(0.5, 3);
    expect(notches[2]?.share).toBeCloseTo(1, 6);
    expect(notches.map((notch) => notch.label)).toEqual(["Start", "Stop 1", "Finish"]);
  });

  it("keeps the authored order even when the points are not in route order", () => {
    const notches = waypointNotches(LINE, [
      { coordinate: { lon: -75.55, lat: 40.8 }, label: "Stop 1" },
      { coordinate: { lon: -75.7, lat: 40.8 }, label: "Start" },
    ]);
    expect(notches.map((notch) => notch.position)).toEqual([1, 2]);
    expect(notches[0]?.share).toBeGreaterThan(notches[1]!.share);
  });

  it("projects a point that is off the line onto the nearest stretch", () => {
    const notches = waypointNotches(LINE, [{ coordinate: { lon: -75.6, lat: 40.81 }, label: "Stop 1" }]);
    expect(notches[0]?.share).toBeCloseTo(0.5, 2);
  });

  it("puts a loop's start at the beginning and its finish at the end", () => {
    // A loop closes where it opens: both points are the same coordinate.
    const loop = [
      { lon: -75.7, lat: 40.8 },
      { lon: -75.5, lat: 40.8 },
      { lon: -75.5, lat: 40.9 },
      { lon: -75.7, lat: 40.8 },
    ];
    const notches = waypointNotches(loop, [
      { coordinate: { lon: -75.7, lat: 40.8 }, label: "Start" },
      { coordinate: { lon: -75.5, lat: 40.85 }, label: "Stop 1" },
      { coordinate: { lon: -75.7, lat: 40.8 }, label: "Finish" },
    ]);
    expect(notches[0]?.share).toBeCloseTo(0, 6);
    expect(notches[2]?.share).toBeCloseTo(1, 6);
    expect(notches[1]!.share).toBeGreaterThan(0);
    expect(notches[1]!.share).toBeLessThan(1);
  });

  it("refuses a line or a list it cannot place", () => {
    expect(waypointNotches([LINE[0]!], [{ coordinate: LINE[0]!, label: "Start" }])).toEqual([]);
    expect(waypointNotches(LINE, [])).toEqual([]);
    expect(waypointNotches([LINE[0]!, LINE[0]!], [{ coordinate: LINE[0]!, label: "Start" }])).toEqual([]);
  });
});
