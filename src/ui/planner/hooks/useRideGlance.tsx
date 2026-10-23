"use client";

/**
 * The glance strip's controller: what the pill says, and the two places it can be.
 *
 * The summary is a projection, never a measurement of its own:
 *
 * - the selected route card supplies the time, the distance and the surface
 *   evidence (the card's own labels, so the pill and the card cannot disagree);
 * - the elevation profile supplies the climb, fetched by the same cached hook the
 *   elevation chart uses — one request answers both;
 * - nothing at all is invented. A route with no evidence says `surface unknown`
 *   and a climb nobody measured is omitted (CLAUDE.md).
 *
 * Two compositions exist, and CSS shows exactly one of them: the strip sits in the
 * map slot's top centre where the dock is a sibling column, and directly above the
 * sheet where the dock lies over the map. Both nodes are built here from the same
 * summary, so the two can never say different things.
 */

import { useCallback, useMemo, type ReactNode } from "react";

import type { ElevationSource } from "@/application/elevation/profile";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { Coordinate } from "@/domain/ride/types";
import {
  MapRideGlance,
  rideGlanceSummary,
  type RideGlancePlacement,
} from "@/ui/planner/MapRideGlance";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

/** The route the strip summarises: its identity and the line on screen. */
export interface RideGlanceRoute {
  readonly routeId: string;
  readonly geometry: readonly Coordinate[];
}

export interface RideGlanceInput {
  readonly cards: readonly RouteCardVm[];
  readonly route: RideGlanceRoute | null;
  readonly elevationSource?: ElevationSource | undefined;
  /** The last attempt failed (with no route on screen, the pill offers Retry). */
  readonly failed: boolean;
  /** A plan is in flight: the metrics read as "still measuring". */
  readonly planning: boolean;
  /** Ask again for this revision — the composer's own plan command. */
  readonly onRetry: () => void;
  readonly plannerUiStore: PlannerUiStore;
}

export interface RideGlanceController {
  /** The strip over the map slot (dock as a sibling column). */
  readonly map: ReactNode;
  /** The strip above the sheet (dock over the map). */
  readonly dock: ReactNode;
}

const NO_LINE: readonly Coordinate[] = [];

export function useRideGlance(input: RideGlanceInput): RideGlanceController {
  const { cards, route, elevationSource, failed, planning, onRetry, plannerUiStore } = input;
  /** The ride the rider is looking at: the selected card, never a guess at another. */
  const card = useMemo(
    () => cards.find((entry) => entry.isSelected) ?? cards[0] ?? null,
    [cards],
  );
  const elevation = useElevationProfile(
    elevationSource,
    route?.routeId ?? null,
    route?.geometry ?? NO_LINE,
  );
  const summary = useMemo(
    () =>
      card === null
        ? null
        : rideGlanceSummary(
            card,
            elevation?.status === "ready" ? elevation.profile.climbMeters : null,
          ),
    [card, elevation],
  );
  /** The trailing tap target opens the sheet at the ride detent, not the composer. */
  const onOpenRide = useCallback((): void => {
    plannerUiStore.getState().setSheetDetent("ride");
  }, [plannerUiStore]);

  const strip = (placement: RideGlancePlacement): ReactNode => (
    <MapRideGlance
      placement={placement}
      summary={summary}
      planning={planning}
      failed={failed}
      onOpenRide={onOpenRide}
      onRetry={onRetry}
    />
  );

  return { map: strip("map"), dock: strip("dock") };
}
