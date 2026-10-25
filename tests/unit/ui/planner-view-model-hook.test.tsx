/**
 * The planner projection hook (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * `usePlannerViewModel` is the seam between the workspace's authorities and the
 * pure projection: it memoises the view model and enriches it with the traffic
 * label the briefing resolves. Because it destructures its input, a field it does
 * not forward is silently dropped — the projection still compiles, and the
 * itinerary simply never states a leg. These tests pin the forwarding of the
 * route line, which is the only thing the itinerary measures from.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildPlannerViewModel,
  type SelectedRouteLine,
} from "@/application/planner/planner-view-model";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import { haversine } from "@/domain/geometry/analysis";
import { defaultRideIntent } from "@/domain/ride/create";
import { newRideId, type PointId } from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RidePoint,
} from "@/domain/ride/types";
import { usePlannerViewModel } from "@/ui/planner/usePlannerViewModel";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID = newRideId();
const START: Coordinate = { lon: -75.2, lat: 40 };
const FINISH: Coordinate = { lon: -75.0, lat: 40 };

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return {
    id: id as PointId,
    kind,
    coordinate,
    provenance: { type: "map", selectedAt: FIXED },
  };
}

function document(): RideDocument {
  const intent = {
    ...defaultRideIntent(),
    start: endpoint("pt_start", "start", START),
    finish: endpoint("pt_finish", "finish", FINISH),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 3,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

const SESSION = emptyPlanningSession(RIDE_ID);
const ROUTE_LINE: SelectedRouteLine = {
  geometry: [START, FINISH],
  distanceMeters: haversine(START, FINISH),
  durationSeconds: 3_600,
  rideRevision: 3,
};

interface LineProps {
  readonly routeLine: SelectedRouteLine | null;
}

describe("usePlannerViewModel", () => {
  it("forwards the selected route line, so the rows can state their legs", () => {
    const { result } = renderHook(() =>
      usePlannerViewModel({ document: document(), session: SESSION, routeLine: ROUTE_LINE }),
    );

    const itinerary = result.current.viewModel.itinerary;
    expect(itinerary.map((row) => row.leg?.state)).toEqual(["start", "measured"]);
    expect(result.current.viewModel.itinerary).toEqual(
      buildPlannerViewModel({
        document: document(),
        session: SESSION,
        routeLine: ROUTE_LINE,
        routeTraffic: null,
      }).itinerary,
    );
  });

  it("re-projects when there is no longer a line to measure", () => {
    const initialProps: LineProps = { routeLine: ROUTE_LINE };
    const { result, rerender } = renderHook(
      (props: LineProps) =>
        usePlannerViewModel({ document: document(), session: SESSION, routeLine: props.routeLine }),
      { initialProps },
    );
    expect(result.current.viewModel.itinerary[1]?.leg?.state).toBe("measured");

    rerender({ routeLine: null });

    expect(result.current.viewModel.itinerary[1]?.leg?.state).toBe("unknown");
  });
});
