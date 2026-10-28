import { describe, expect, it } from "vitest";
import { bearingTo, breadcrumbIssues, lineDistance, measureLeg, reverseBreadcrumb, straightBreadcrumb, toblerSeconds } from "@/domain/breadcrumb/route";
import { createRideDocument } from "@/domain/ride/create";
import { newCommandId } from "@/domain/ride/ids";
import { applyRideCommand } from "@/domain/ride/reducer";
import { redoRide, undoRide } from "@/domain/ride/history";

const points = [
  { id: "a", coordinate: { lat: 40.6, lon: -75.9 }, name: "Start" },
  { id: "b", coordinate: { lat: 40.61, lon: -75.9 } },
  { id: "c", coordinate: { lat: 40.61, lon: -75.89 } },
];

describe("breadcrumb geometry", () => {
  it("builds and reverses independent straight legs", () => {
    const route = straightBreadcrumb(points);
    expect(route.legs).toHaveLength(2);
    expect(breadcrumbIssues(route)).toEqual([]);
    expect(reverseBreadcrumb(reverseBreadcrumb(route))).toEqual(route);
    expect(lineDistance(route.legs[0]!.geometry)).toBeGreaterThan(1100);
    expect(bearingTo(points[0]!.coordinate, points[1]!.coordinate)).toBeCloseTo(0);
  });
  it("preserves unknown elevation and flags steep ascent or descent", () => {
    const line = straightBreadcrumb(points).legs[0]!.geometry;
    expect(measureLeg(line, null, 100)).toMatchObject({ gradePercent: null, steep: null, timeSeconds: null });
    expect(measureLeg(line, 0, 400).steep).toBe(true);
    expect(measureLeg(line, 400, 0).steep).toBe(true);
    expect(toblerSeconds(1000, -0.05)).toBeCloseTo(600);
    expect(toblerSeconds(1000, 0)).toBeGreaterThan(600);
    expect(toblerSeconds(-1, 0)).toBeNull();
  });
  it("rejects malformed legs", () => {
    const route = straightBreadcrumb(points);
    expect(breadcrumbIssues({ ...route, legs: [] })).not.toEqual([]);
    expect(breadcrumbIssues(straightBreadcrumb([points[0]!, points[0]!]))).not.toEqual([]);
  });
});

describe("breadcrumb document command", () => {
  it("stores one undoable edit and redoes it", () => {
    const document = createRideDocument();
    const route = straightBreadcrumb(points);
    const result = applyRideCommand(document, { type: "breadcrumb.set", commandId: newCommandId(), rideId: document.rideId, baseRevision: document.revision, source: "map", label: "Added breadcrumb", breadcrumb: route });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;
    const undone = undoRide(result.document)!;
    expect(undone.document.intent.breadcrumb).toBeUndefined();
    expect(redoRide(undone.document)!.document.intent.breadcrumb).toEqual(route);
    const reverse = applyRideCommand(result.document, { type: "ride.reverse", commandId: newCommandId(), rideId: document.rideId, baseRevision: result.document.revision, source: "map", label: "Reverse" });
    expect(reverse.outcome === "applied" && reverse.document.intent.breadcrumb).toEqual(reverseBreadcrumb(route));
  });
});
