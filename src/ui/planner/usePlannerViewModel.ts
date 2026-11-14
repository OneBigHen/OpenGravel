import { useMemo, useState } from "react";

import { firstLookSwapNote, type FirstLookFacts } from "@/application/planner/first-look";
import { buildPlannerViewModel, type RouteCardVm } from "@/application/planner/planner-view-model";
import type { RouteTrafficLabel } from "@/ui/planner/PlannerPreparation";

type PlannerProjectionInput = Omit<Parameters<typeof buildPlannerViewModel>[0], "routeTraffic" | "bikeName"> & {
  /** The rider's garage; the chosen bike's name goes on the route's bike line. */
  readonly bikes?: readonly { readonly id: string; readonly name: string }[];
};

function factsOf(card: RouteCardVm): FirstLookFacts {
  return {
    routeId: card.routeId,
    distanceMeters: card.distanceMeters ?? 0,
    unpavedMi: card.measurements?.unpavedMi ?? null,
    curvyMi: card.measurements?.curvyMi ?? null,
  };
}

/**
 * Keeps preparation feedback beside the projection it enriches, and remembers
 * the first look of each planning attempt so a settled swap can say once what
 * improved (next round N1).
 */
export function usePlannerViewModel(input: PlannerProjectionInput) {
  const { document, session, sketchDerivedEndpoints, sketchPreviewEndpoints = null, placeNameFor, routeLine, bikes } = input;
  const bikeName = bikes?.find((bike) => bike.id === document.intent.bike.bikeId)?.name;
  const [routeTraffic, setRouteTraffic] = useState<RouteTrafficLabel | null>(null);
  const [firstLook, setFirstLook] = useState<{ readonly generation: number; readonly facts: FirstLookFacts } | null>(null);
  const viewModel = useMemo(
    () =>
      buildPlannerViewModel({
        document,
        session,
        sketchDerivedEndpoints,
        sketchPreviewEndpoints,
        placeNameFor,
        routeLine,
        routeTraffic,
        ...(bikeName === undefined ? {} : { bikeName }),
      }),
    [document, session, sketchDerivedEndpoints, sketchPreviewEndpoints, placeNameFor, routeLine, routeTraffic, bikeName],
  );
  const generation = session.identity.planningGeneration;
  const lead = viewModel.routeCards[0];
  const provisional = lead?.provisional === true;
  // Adjusting state while rendering (React's documented pattern for state
  // derived from a previous render): the first provisional lead of each
  // attempt is remembered once, and the guard stops a render loop.
  if (provisional && lead !== undefined && firstLook?.generation !== generation) {
    setFirstLook({ generation, facts: factsOf(lead) });
  }
  const firstLookNote = useMemo(() => {
    if (firstLook === null || firstLook.generation !== generation) return null;
    if (provisional || lead === undefined || session.selectionSource !== "automatic") return null;
    return firstLookSwapNote(firstLook.facts, factsOf(lead));
  }, [firstLook, generation, provisional, lead, session.selectionSource]);
  return { viewModel, setRouteTraffic, firstLookNote };
}
