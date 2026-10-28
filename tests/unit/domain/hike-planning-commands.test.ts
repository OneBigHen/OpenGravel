import { describe, expect, it } from "vitest";
import { createRideDocument } from "@/domain/ride/create";
import { applyRideCommand } from "@/domain/ride/reducer";
import { newCommandId } from "@/domain/ride/ids";
import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import { undoRide } from "@/domain/ride/history";
import { intentIdentity } from "@/application/planner/build-plan-request";

const now = "2026-10-28T12:00:00Z";
describe("hike planning commands", () => {
  it("hands breadcrumb waypoints to planning in order as one undoable edit", () => {
    const doc = createRideDocument();
    const route = straightBreadcrumb([0, 1, 2].map(i => ({ id: `p${i}`, name: `Point ${i}`, coordinate: { lon: -75 + i / 100, lat: 40 } })));
    const placed = applyRideCommand(doc, { type: "breadcrumb.set", breadcrumb: route, commandId: newCommandId(), rideId: doc.rideId, baseRevision: doc.revision, source: "map", label: "Breadcrumb" });
    if (placed.outcome !== "applied") throw new Error(placed.outcome);
    const withBreadcrumb = placed.document;
    const result = applyRideCommand(withBreadcrumb, { type: "breadcrumb.plan", selectedAt: now, commandId: newCommandId(), rideId: doc.rideId, baseRevision: withBreadcrumb.revision, source: "rider", label: "Plan on trails" });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;
    expect(result.document.intent.start?.coordinate).toEqual(route.waypoints[0]?.coordinate);
    expect(result.document.intent.stops.map(s => s.coordinate)).toEqual([route.waypoints[1]?.coordinate]);
    expect(result.document.intent.finish?.coordinate).toEqual(route.waypoints[2]?.coordinate);
    expect(result.document.intent.breadcrumb).toBeNull();
    const undone = undoRide(result.document);
    expect(undone).toMatchObject({ document: { intent: { breadcrumb: route } } });
  });
  it("there and back changes planning identity and remains undoable", () => {
    const doc = createRideDocument();
    const result = applyRideCommand(doc, { type: "hike.returnToStart.set", enabled: true, commandId: newCommandId(), rideId: doc.rideId, baseRevision: doc.revision, source: "rider", label: "There and back" });
    if (result.outcome !== "applied") throw new Error(result.outcome);
    const versions = { graph: "test", routePolicy: "hike", evidence: "test" };
    expect(intentIdentity(result.document.intent, versions)).not.toBe(intentIdentity(doc.intent, versions));
    expect(result.document.intent.hikeReturnToStart).toBe(true);
    expect(undoRide(result.document)).toMatchObject({ document: { intent: doc.intent } });
  });
});
