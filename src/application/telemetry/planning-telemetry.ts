import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { TelemetryService } from "@/application/telemetry/telemetry-service";
import { latencyBand } from "@/application/telemetry/vocabulary";

/** Read-only observer: internal generation/route IDs are never emitted. */
export function createPlanningTelemetryObserver(telemetry: Pick<TelemetryService, "track" | "recordWorkflowSpan">): (snapshot: PlanningSessionSnapshot) => void {
  let generation = -1;
  let requested = false;
  let primary = false;
  let settled = false;
  let firstRouteAt = 0;
  let previousSelection: PlanningSessionSnapshot["selectedRouteId"] = null;
  return (snapshot) => {
    const nextGeneration = snapshot.identity.planningGeneration;
    if (nextGeneration !== generation) {
      generation = nextGeneration;
      requested = primary = settled = false;
    }
    if (!requested && ["validating", "routing-primary"].includes(snapshot.phase)) {
      requested = true;
      telemetry.track("route_plan_requested");
    }
    if (!requested) return;
    const elapsed = Date.now() - Date.parse(snapshot.startedAt);
    const latency = latencyBand(elapsed);
    if (!primary && snapshot.committedBundle !== null) {
      primary = true;
      firstRouteAt = Date.now();
      telemetry.track("route_primary_ready", latency === null ? {} : { latencyBand: latency });
      telemetry.recordWorkflowSpan("plan-click-to-first-route", elapsed);
    }
    if (!settled && snapshot.phase === "ready") {
      settled = true;
      const count = snapshot.committedBundle?.candidates.length ?? 0;
      telemetry.track("route_alternatives_ready", { candidateCount: count === 0 ? "0" : count <= 2 ? "1-2" : count <= 5 ? "3-5" : "6-plus", ...(latency === null ? {} : { latencyBand: latency }) });
      if (primary) telemetry.recordWorkflowSpan("first-route-to-alternatives-settled", Date.now() - firstRouteAt);
    }
    if (!settled && snapshot.phase === "failed") {
      settled = true;
      telemetry.track("route_plan_failed", { errorClass: snapshot.error?.code === "no-route" ? "no-result" : snapshot.error?.code === "constraint-conflict" ? "guard-rejected" : "unavailable" });
    }
    if (snapshot.selectedRouteId !== previousSelection && snapshot.selectionSource === "rider") {
      telemetry.track("route_selected", { source: "rider" });
    }
    previousSelection = snapshot.selectedRouteId;
  };
}
