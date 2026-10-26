/**
 * The object list (04-PLANNER-AND-WORKSPACE-UX §14–§15, §31).
 *
 * The list is the accessible form of every map operation, so these tests are
 * about *honesty* rather than layout: the rows are the objects in the order the
 * ride travels them, the actions say what they do, the ends of the list are the
 * only places reorder is disabled, one button press is one callback (which the
 * workspace turns into exactly one command), and the numeric editor refuses a
 * coordinate outside WGS84 instead of dispatching a command the reducer would
 * reject.
 *
 * The component is presentational: it never touches a store, so a spy is the
 * complete record of what it asked for.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPlannerViewModel } from "@/application/planner/planner-view-model";
import { emptyPlanningSession } from "@/application/planner/planning-session";
import { haversine } from "@/domain/geometry/analysis";
import { defaultRideIntent } from "@/domain/ride/create";
import { newRideId, type RideId, type ShapingId, type StopId } from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RideIntent,
  type StopPoint,
} from "@/domain/ride/types";
import { StopsPanel } from "@/ui/planner/StopsPanel";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID: RideId = newRideId();
const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

const STOP_A: StopPoint = {
  id: "stop_a" as StopId,
  kind: "stop",
  coordinate: { lon: -75.1, lat: 39.98 },
  label: "Coffee",
  arrivalIntent: "food",
  provenance: { type: "map", selectedAt: FIXED },
};
const STOP_B: StopPoint = {
  id: "stop_b" as StopId,
  kind: "stop",
  coordinate: { lon: -75.0, lat: 40.0 },
  provenance: { type: "map", selectedAt: FIXED },
};
const ANCHOR = {
  id: "shape_a" as ShapingId,
  kind: "shape" as const,
  coordinate: { lon: -75.05, lat: 39.99 },
  source: "map-drag" as const,
};

function documentWith(overrides: Partial<RideIntent> = {}): RideDocument {
  const intent: RideIntent = { ...defaultRideIntent(), ...overrides };
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 4,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

const FULL_DOCUMENT = documentWith({
  start: {
    id: "pt_start" as never,
    kind: "start",
    coordinate: ORIGIN,
    provenance: { type: "map", selectedAt: FIXED },
  },
  finish: {
    id: "pt_finish" as never,
    kind: "finish",
    coordinate: DESTINATION,
    provenance: { type: "map", selectedAt: FIXED },
  },
  stops: [STOP_A, STOP_B],
  shaping: [ANCHOR],
});

type Handlers = ReturnType<typeof spyHandlers>;

function spyHandlers() {
  return {
    onSelect: vi.fn(),
    onZoomTo: vi.fn(),
    onReplacePlace: vi.fn(),
    onMoveStop: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    onConvert: vi.fn(),
    onAddStop: vi.fn(),
    onEditCoordinate: vi.fn(),
    onSetArrivalIntent: vi.fn(),
  };
}

function renderPanel(
  options: {
    readonly document?: RideDocument;
    readonly selectedRef?: Parameters<typeof StopsPanel>[0]["selectedRef"];
    readonly armedTool?: Parameters<typeof StopsPanel>[0]["armedTool"];
    readonly armedStopId?: StopId | null;
    readonly routeLine?: Parameters<typeof buildPlannerViewModel>[0]["routeLine"];
  } = {},
): Handlers {
  const document = options.document ?? FULL_DOCUMENT;
  const viewModel = buildPlannerViewModel({
    document,
    session: emptyPlanningSession(RIDE_ID),
    routeLine: options.routeLine ?? null,
  });
  const handlers = spyHandlers();
  render(
    <StopsPanel
      viewModel={viewModel}
      selectedRef={options.selectedRef ?? null}
      armedTool={options.armedTool ?? "idle"}
      armedStopId={options.armedStopId ?? null}
      {...handlers}
    />,
  );
  return handlers;
}

/** Opens one row's action sheet, which owns every per-row action. */
function openMenu(key: string): void {
  fireEvent.click(screen.getByTestId(`more-${key}`));
}

function closeMenu(): void {
  fireEvent.keyDown(window, { key: "Escape" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StopsPanel — the ordered list (04 §15)", () => {
  it("lists start, the stops in order, then the finish", () => {
    renderPanel();

    const rows = within(screen.getByTestId("stops-list")).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset["testid"])).toEqual([
      "point-row-start",
      "point-row-stop-1",
      "point-row-stop-2",
      "point-row-finish",
    ]);
    expect(screen.getByTestId("label-stop-1")).toHaveTextContent("Coffee");
    // A named stop reads as its name; only a dropped pin repeats a coordinate.
    expect(screen.queryByTestId("coordinate-stop-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("intent-stop-1")).toHaveAccessibleName("Food");
    // A stop with no name of its own is a dropped pin, and the coordinate is its
    // secondary value — the raw number is never the point's name (defect: raw
    // coordinates shown as the place value).
    expect(screen.getByTestId("label-stop-2")).toHaveTextContent("Dropped pin");
    expect(screen.getByTestId("coordinate-stop-2")).toHaveTextContent("40.0000, -75.0000");
    expect(screen.getByTestId("label-stop-2")).toHaveAttribute(
      "data-coordinate",
      "40.0000, -75.0000",
    );
    // A stop with no authored intent shows no chip at all — no default is
    // invented for it.
    expect(screen.queryByTestId("intent-stop-2")).not.toBeInTheDocument();
  });

  it("keeps shaping anchors in their own section", () => {
    renderPanel();

    expect(within(screen.getByTestId("shaping-list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByTestId("point-row-shape-1")).toBeInTheDocument();
    const itinerary = screen.getByTestId("stops-list");
    expect(within(itinerary).queryByTestId("point-row-shape-1")).not.toBeInTheDocument();
  });

  it("renders no list and no second emptiness line when the ride is empty", () => {
    // One primary empty state (defect: duplicate emptiness): the sheet's status
    // line says "No plan yet." and the composer says which point is missing, so
    // the object list must not restate it a third time.
    renderPanel({ document: documentWith() });

    expect(screen.queryByTestId("stops-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stops-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("stops-panel")).not.toHaveTextContent(/Nothing placed yet/i);
  });

  it("opens the stop placement from Add stop", () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByTestId("add-stop"));

    expect(handlers.onAddStop).toHaveBeenCalledTimes(1);
    expect(handlers.onEditCoordinate).not.toHaveBeenCalled();
  });

  it("marks the row whose place the next tap replaces", () => {
    renderPanel({ armedTool: "place-stop", armedStopId: STOP_B.id });

    expect(screen.getByTestId("point-row-stop-2")).toHaveAttribute("data-armed", "true");
    expect(screen.getByTestId("point-row-stop-1")).toHaveAttribute("data-armed", "false");
    openMenu("stop-2");
    expect(screen.getByTestId("replace-stop-2")).toHaveAttribute("data-armed", "true");
  });
});

describe("StopsPanel — one press, one intent (03 §27)", () => {
  it("reorders up and down with the row's own direction", () => {
    const handlers = renderPanel();

    openMenu("stop-2");
    fireEvent.click(screen.getByTestId("move-up-stop-2"));
    openMenu("stop-1");
    fireEvent.click(screen.getByTestId("move-down-stop-1"));

    expect(handlers.onMoveStop).toHaveBeenCalledTimes(2);
    expect(handlers.onMoveStop).toHaveBeenNthCalledWith(1, STOP_B.id, "up");
    expect(handlers.onMoveStop).toHaveBeenNthCalledWith(2, STOP_A.id, "down");
  });

  it("disables reorder at the ends of the list and nowhere else", () => {
    renderPanel();

    openMenu("stop-1");
    expect(screen.getByTestId("move-up-stop-1")).toBeDisabled();
    expect(screen.getByTestId("move-down-stop-1")).toBeEnabled();
    closeMenu();
    openMenu("stop-2");
    expect(screen.getByTestId("move-up-stop-2")).toBeEnabled();
    expect(screen.getByTestId("move-down-stop-2")).toBeDisabled();
  });

  it("emits one reorder command per drag, and nothing below the threshold", () => {
    const handlers = renderPanel();
    const grab = screen.getByTestId("grab-stop-2");

    // A press that barely moves is a press, not a reorder.
    fireEvent.pointerDown(grab, { pointerId: 7, button: 0, clientY: 200 });
    fireEvent.pointerMove(grab, { pointerId: 7, clientY: 194 });
    fireEvent.pointerUp(grab, { pointerId: 7, clientY: 194 });
    expect(handlers.onReorder).not.toHaveBeenCalled();

    // One row up lands in front of Stop 1, and the drag is one command.
    fireEvent.pointerDown(grab, { pointerId: 8, button: 0, clientY: 200 });
    fireEvent.pointerMove(grab, { pointerId: 8, clientY: 130 });
    fireEvent.pointerUp(grab, { pointerId: 8, clientY: 130 });

    expect(handlers.onReorder).toHaveBeenCalledTimes(1);
    expect(handlers.onReorder).toHaveBeenCalledWith(STOP_B.id, STOP_A.id);
    expect(handlers.onMoveStop).not.toHaveBeenCalled();
  });

  it("gives every stop row its own grab handle", () => {
    renderPanel();

    expect(screen.getByTestId("grab-stop-1")).toHaveAccessibleName("Reorder Stop 1");
    expect(screen.getByTestId("grab-stop-1").closest("li")).toBe(
      screen.getByTestId("point-row-stop-1"),
    );
    // The endpoints are not stops, so they have nothing to drag.
    expect(screen.queryByTestId("grab-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("grab-finish")).not.toBeInTheDocument();
  });

  it("offers the endpoints no convert action, because they have none", () => {
    renderPanel();

    openMenu("start");

    expect(screen.queryByTestId("convert-start")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-start")).toBeInTheDocument();
  });

  it("converts a stop in the direction the button names", () => {
    const handlers = renderPanel();

    openMenu("stop-1");
    expect(screen.getByTestId("convert-stop-1")).toHaveTextContent("Just pass through");
    fireEvent.click(screen.getByTestId("convert-stop-1"));

    expect(handlers.onConvert).toHaveBeenCalledTimes(1);
    expect(handlers.onConvert).toHaveBeenCalledWith({ kind: "stop", stopId: STOP_A.id });
  });

  it("converts an anchor back into a stop", () => {
    const handlers = renderPanel();

    openMenu("shape-1");
    expect(screen.getByTestId("convert-shape-1")).toHaveTextContent("Make a stop");
    fireEvent.click(screen.getByTestId("convert-shape-1"));

    expect(handlers.onConvert).toHaveBeenCalledTimes(1);
    expect(handlers.onConvert).toHaveBeenCalledWith({
      kind: "shaping",
      shapingId: ANCHOR.id,
    });
  });

  it("removes, zooms, selects and replaces with the row's identity", () => {
    const handlers = renderPanel();

    openMenu("stop-2");
    fireEvent.click(screen.getByTestId("remove-stop-2"));
    openMenu("finish");
    fireEvent.click(screen.getByTestId("zoom-finish"));
    fireEvent.click(screen.getByTestId("select-start"));
    openMenu("stop-1");
    fireEvent.click(screen.getByTestId("replace-stop-1"));

    expect(handlers.onRemove).toHaveBeenCalledWith({ kind: "stop", stopId: STOP_B.id });
    expect(handlers.onZoomTo).toHaveBeenCalledWith({ kind: "finish" });
    expect(handlers.onSelect).toHaveBeenCalledWith({ kind: "start" });
    expect(handlers.onReplacePlace).toHaveBeenCalledWith({
      kind: "stop",
      stopId: STOP_A.id,
    });
  });

  it("keeps Remove in the danger colour and closes the sheet after an action", () => {
    const handlers = renderPanel();

    openMenu("stop-1");
    expect(screen.getByTestId("remove-stop-1")).toHaveAttribute("data-danger", "true");
    fireEvent.click(screen.getByTestId("remove-stop-1"));

    expect(handlers.onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("point-menu")).not.toBeInTheDocument();
  });

  it("reports the selected row on the control itself", () => {
    renderPanel({ selectedRef: { kind: "stop", stopId: STOP_B.id } });

    expect(screen.getByTestId("select-stop-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("point-row-stop-2")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("select-stop-1")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("StopsPanel — the numeric inspector (04 §31)", () => {
  it("edits the selected point's position in one callback", () => {
    const handlers = renderPanel({ selectedRef: { kind: "stop", stopId: STOP_A.id } });

    expect(screen.getByTestId("inspector-title")).toHaveTextContent("Edit Stop 1");
    expect(screen.getByTestId("point-lat")).toHaveValue("39.980000");
    expect(screen.getByTestId("point-lon")).toHaveValue("-75.100000");

    fireEvent.change(screen.getByTestId("point-lat"), { target: { value: "40.5" } });
    fireEvent.change(screen.getByTestId("point-lon"), { target: { value: "-75.5" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));

    expect(handlers.onEditCoordinate).toHaveBeenCalledTimes(1);
    expect(handlers.onEditCoordinate).toHaveBeenCalledWith(
      { kind: "stop", stopId: STOP_A.id },
      { lat: 40.5, lon: -75.5 },
    );
  });

  it("refuses an out-of-range latitude inline and dispatches nothing", () => {
    const handlers = renderPanel({ selectedRef: { kind: "start" } });

    fireEvent.change(screen.getByTestId("point-lat"), { target: { value: "91" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));

    const error = screen.getByTestId("inspector-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Latitude must be a number between -90 and 90.");
    expect(handlers.onEditCoordinate).not.toHaveBeenCalled();
  });

  it("refuses an out-of-range longitude and a non-numeric field", () => {
    const handlers = renderPanel({ selectedRef: { kind: "start" } });

    fireEvent.change(screen.getByTestId("point-lon"), { target: { value: "181" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));
    expect(screen.getByTestId("inspector-error")).toHaveTextContent(
      "Longitude must be a number between -180 and 180.",
    );

    fireEvent.change(screen.getByTestId("point-lon"), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByTestId("apply-coordinate"));
    expect(screen.getByTestId("inspector-error")).toHaveTextContent(
      "Longitude must be a number between -180 and 180.",
    );
    expect(handlers.onEditCoordinate).not.toHaveBeenCalled();
  });

  it("shows the arrival-intent selector for a stop only", () => {
    renderPanel({ selectedRef: { kind: "stop", stopId: STOP_A.id } });

    expect(screen.getByTestId("arrival-intent")).toHaveValue("food");
  });

  it("dispatches the intent change and the cleared intent", () => {
    const handlers = renderPanel({ selectedRef: { kind: "stop", stopId: STOP_A.id } });

    fireEvent.change(screen.getByTestId("arrival-intent"), { target: { value: "scenic" } });
    fireEvent.change(screen.getByTestId("arrival-intent"), { target: { value: "" } });

    expect(handlers.onSetArrivalIntent).toHaveBeenNthCalledWith(1, STOP_A.id, "scenic");
    expect(handlers.onSetArrivalIntent).toHaveBeenNthCalledWith(2, STOP_A.id, null);
  });

  it("has no intent selector for an endpoint or an anchor", () => {
    renderPanel({ selectedRef: { kind: "finish" } });
    expect(screen.queryByTestId("arrival-intent")).not.toBeInTheDocument();
  });

  it("shows no inspector until something is selected", () => {
    renderPanel();
    expect(screen.queryByTestId("point-inspector")).not.toBeInTheDocument();
  });
});

describe("StopsPanel — each row states its leg (04 §15)", () => {
  const LINE = [ORIGIN, STOP_A.coordinate, STOP_B.coordinate, DESTINATION];
  const ROUTE_LINE = {
    geometry: LINE,
    distanceMeters:
      haversine(ORIGIN, STOP_A.coordinate) +
      haversine(STOP_A.coordinate, STOP_B.coordinate) +
      haversine(STOP_B.coordinate, DESTINATION),
    durationSeconds: 3_600,
    rideRevision: FULL_DOCUMENT.revision,
  };

  it("prints the measured leg as miles and an estimated time", () => {
    renderPanel({ routeLine: ROUTE_LINE });

    expect(screen.getByTestId("leg-start")).toHaveTextContent("From your location");
    expect(screen.getByTestId("leg-stop-1")).toHaveAttribute("data-leg", "measured");
    expect(screen.getByTestId("leg-stop-1").textContent).toMatch(
      /^\d+(\.\d)? mi · ~\d+ min from previous$/,
    );
    expect(screen.getByTestId("leg-finish")).toHaveAttribute("data-leg", "measured");
  });

  it("says the distance is not known, and never prints a number, with no route", () => {
    renderPanel();

    const leg = screen.getByTestId("leg-stop-1");
    expect(leg).toHaveTextContent("distance not known");
    expect(leg).toHaveAttribute("data-leg", "unknown");
    expect(leg.textContent).not.toMatch(/\d/);
  });

  it("says the route does not cover a stop it does not pass", () => {
    renderPanel({ routeLine: { ...ROUTE_LINE, geometry: [ORIGIN, DESTINATION] } });

    expect(screen.getByTestId("leg-stop-1")).toHaveTextContent("Not on the selected route");
    expect(screen.getByTestId("leg-stop-1")).toHaveAttribute("data-leg", "off-route");
  });
});
