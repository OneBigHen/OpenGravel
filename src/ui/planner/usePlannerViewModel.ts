import { useMemo, useState } from "react";

import { buildPlannerViewModel } from "@/application/planner/planner-view-model";
import type { RouteTrafficLabel } from "@/ui/planner/PlannerPreparation";

type PlannerProjectionInput = Omit<Parameters<typeof buildPlannerViewModel>[0], "routeTraffic">;

/** Keeps preparation feedback beside the projection it enriches. */
export function usePlannerViewModel(input: PlannerProjectionInput) {
  const { document, session, sketchDerivedEndpoints, placeNameFor, routeLine } = input;
  const [routeTraffic, setRouteTraffic] = useState<RouteTrafficLabel | null>(null);
  const viewModel = useMemo(
    () =>
      buildPlannerViewModel({
        document,
        session,
        sketchDerivedEndpoints,
        placeNameFor,
        routeLine,
        routeTraffic,
      }),
    [document, session, sketchDerivedEndpoints, placeNameFor, routeLine, routeTraffic],
  );
  return { viewModel, setRouteTraffic };
}
