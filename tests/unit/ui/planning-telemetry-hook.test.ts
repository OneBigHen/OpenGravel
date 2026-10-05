import { expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlanningTelemetry } from "@/app/use-planning-telemetry";
import { emptyPlanningSession, type PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
it("observes the supplied planner instance and detaches on unmount", () => {
 let listener: ((state: { snapshot: PlanningSessionSnapshot }) => void) | null = null;
 const store = { subscribe: (next: typeof listener) => { listener = next; return () => { listener = null; }; } } as unknown as PlanningSessionStore;
 const events: unknown[] = [];
 const receive = (event: Event) => events.push((event as CustomEvent).detail);
 window.addEventListener("opengravel:telemetry-intent", receive);
 try {
  const hook = renderHook(() => usePlanningTelemetry(store));
  const emit = listener as unknown as (state: { snapshot: PlanningSessionSnapshot }) => void;
  emit({ snapshot: { ...emptyPlanningSession(), phase: "validating", identity: { rideId: null, rideRevision: 1, planningGeneration: 1 } } });
  expect(events).toEqual([{ name: "route_plan_requested", properties: undefined }]);
  hook.unmount();
  expect(listener).toBeNull();
 } finally { window.removeEventListener("opengravel:telemetry-intent", receive); }
});
