"use client";
import { useEffect } from "react";
import { createPlanningTelemetryObserver } from "@/application/telemetry/planning-telemetry";
import { durationBand } from "@/application/telemetry/vocabulary";
import { publishTelemetryIntent } from "@/infrastructure/telemetry/browser-event-bridge";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";

/** Observe the exact store passed to the workspace, never a parallel singleton. */
export function usePlanningTelemetry(store: PlanningSessionStore): void {
  useEffect(() => {
    const observe = createPlanningTelemetryObserver({
      track: publishTelemetryIntent,
      recordWorkflowSpan: (workflow, milliseconds) => {
        const band = durationBand(milliseconds);
        if (band !== null) publishTelemetryIntent("workflow_span_recorded", { workflow, durationBand: band });
      },
    });
    return store.subscribe(state => observe(state.snapshot));
  }, [store]);
}
