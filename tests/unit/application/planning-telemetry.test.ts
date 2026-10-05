import { describe, expect, it, vi } from "vitest";
import { createPlanningTelemetryObserver } from "@/application/telemetry/planning-telemetry";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";

const snapshot = (phase: PlanningSessionSnapshot["phase"], generation = 1): PlanningSessionSnapshot => ({ ...emptyPlanningSession(), identity: { rideId: null, rideRevision: 1, planningGeneration: generation }, phase });
describe("planning telemetry observer", () => {
  it("records each attempt and normalized failure once without leaking diagnostic text", () => {
    const track = vi.fn();
    const observe = createPlanningTelemetryObserver({ track, recordWorkflowSpan: vi.fn() });
    observe(snapshot("idle", 0));
    observe(snapshot("validating"));
    observe(snapshot("routing-primary"));
    const failed = { ...snapshot("failed"), error: { code: "no-route" as const, message: "private coordinates", recoverable: false } };
    observe(failed);
    observe(failed);
    expect(track.mock.calls).toEqual([["route_plan_requested"], ["route_plan_failed", { errorClass: "no-result" }]]);
    observe(snapshot("validating", 2));
    expect(track).toHaveBeenCalledTimes(3);
  });
  it("does not invent a failure for cancelled planning", () => {
    const track = vi.fn();
    const observe = createPlanningTelemetryObserver({ track, recordWorkflowSpan: vi.fn() });
    observe(snapshot("validating"));
    observe(snapshot("cancelled"));
    expect(track).toHaveBeenCalledTimes(1);
  });
  it("does not count an already finished attempt on initial subscription", () => {
    const track = vi.fn();
    const observe = createPlanningTelemetryObserver({ track, recordWorkflowSpan: vi.fn() });
    observe(snapshot("ready"));
    expect(track).not.toHaveBeenCalled();
  });
});

it("does not count a retained rider selection again when replanning", () => {
 const track = vi.fn();
 const observe = createPlanningTelemetryObserver({ track, recordWorkflowSpan: vi.fn() });
 const selected = "retained-route" as PlanningSessionSnapshot["selectedRouteId"];
 observe({ ...snapshot("validating"), selectionSource: "rider", selectedRouteId: selected });
 observe({ ...snapshot("validating", 2), selectionSource: "rider", selectedRouteId: selected });
 expect(track.mock.calls.filter(([name]) => name === "route_selected")).toHaveLength(1);
});
