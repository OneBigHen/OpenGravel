/**
 * The intent composer (04-PLANNER-AND-WORKSPACE-UX §4, §8).
 *
 * The composer is where a rider commits a plan, so the only thing worth pinning
 * is honesty: the commit button is disabled for exactly the three truthful
 * reasons, and the reason is always readable next to it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPlannerViewModel,
  type PlannerViewModel,
} from "@/application/planner/planner-view-model";
import {
  emptyPlanningSession,
  type PlanningPhase,
} from "@/application/planner/planning-session";
import { defaultRideIntent } from "@/domain/ride/create";
import { newRideId, type PointId, type RideId } from "@/domain/ride/ids";
import {
  SCHEMA_VERSION,
  type Coordinate,
  type RideDocument,
  type RideIntent,
  type RidePoint,
} from "@/domain/ride/types";
import { IntentComposer } from "@/ui/planner/IntentComposer";

const FIXED = "2026-09-17T00:00:00.000Z";
const RIDE_ID: RideId = newRideId();
const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return { id: id as PointId, kind, coordinate, provenance: { type: "map", selectedAt: FIXED } };
}

function documentWith(overrides: Partial<RideIntent> = {}): RideDocument {
  const intent: RideIntent = { ...defaultRideIntent(), ...overrides };
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 1,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

function viewModelFor(document: RideDocument, phase: PlanningPhase): PlannerViewModel {
  return buildPlannerViewModel({
    document,
    session: { ...emptyPlanningSession(RIDE_ID), phase },
  });
}

function renderComposer(
  viewModel: PlannerViewModel,
): { readonly onPlan: ReturnType<typeof vi.fn>; readonly onSetStart: ReturnType<typeof vi.fn>; readonly onSetFinish: ReturnType<typeof vi.fn> } {
  const onPlan = vi.fn();
  const onSetStart = vi.fn();
  const onSetFinish = vi.fn();
  render(
    <IntentComposer
      viewModel={viewModel}
      onPlan={onPlan}
      onSetStart={onSetStart}
      onSetFinish={onSetFinish}
    />,
  );
  return { onPlan, onSetStart, onSetFinish };
}

describe("IntentComposer", () => {
  it("disables the commit and explains the missing start", () => {
    const { onPlan } = renderComposer(
      viewModelFor(documentWith(), "idle"),
    );

    const plan = screen.getByRole("button", { name: "Create ride" });
    expect(plan).toBeDisabled();
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a start, or set it on the map.",
    );
    expect(screen.getByTestId("start-value")).toHaveTextContent("No start yet");
    expect(screen.getByTestId("finish-value")).toHaveTextContent("No destination yet");
    expect(screen.getByRole("button", { name: "Set start on map" })).toBeInTheDocument();
    fireEvent.click(plan);
    expect(onPlan).not.toHaveBeenCalled();
  });

  it("explains the missing destination once a start exists", () => {
    renderComposer(
      viewModelFor(
        documentWith({ start: endpoint("pt_start", "start", ORIGIN) }),
        "idle",
      ),
    );

    expect(screen.getByRole("button", { name: "Create ride" })).toBeDisabled();
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Search for a destination, or choose it on the map.",
    );
    expect(screen.getByTestId("start-value")).toHaveTextContent("39.9500, -75.2000");
  });

  it("explains that an attempt is already running", () => {
    renderComposer(
      viewModelFor(
        documentWith({
          start: endpoint("pt_start", "start", ORIGIN),
          finish: endpoint("pt_finish", "finish", DESTINATION),
        }),
        "routing-primary",
      ),
    );

    expect(screen.getByRole("button", { name: "Create ride" })).toBeDisabled();
    expect(screen.getByTestId("plan-disabled-reason")).toHaveTextContent(
      "Your ride is on its way — one moment.",
    );
  });

  it("commits when the intent is complete", () => {
    const { onPlan } = renderComposer(
      viewModelFor(
        documentWith({
          start: endpoint("pt_start", "start", ORIGIN),
          finish: endpoint("pt_finish", "finish", DESTINATION),
        }),
        "idle",
      ),
    );

    const plan = screen.getByRole("button", { name: "Create ride" });
    expect(plan).toBeEnabled();
    expect(screen.queryByTestId("plan-disabled-reason")).not.toBeInTheDocument();
    fireEvent.click(plan);
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  it("hands the two placement tools to the caller", () => {
    const { onSetStart, onSetFinish } = renderComposer(
      viewModelFor(documentWith(), "idle"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Set start on map" }));
    fireEvent.click(screen.getByRole("button", { name: "Set destination on map" }));

    expect(onSetStart).toHaveBeenCalledTimes(1);
    expect(onSetFinish).toHaveBeenCalledTimes(1);
  });

  it("says Change destination once a destination exists, matching Change start", () => {
    // Defect (owner review 2026-09-21): the destination chip read "Set
    // destination on map" while a destination was present — a label that
    // contradicted the value cell next to it (04 §4–§5).
    renderComposer(
      viewModelFor(
        documentWith({
          start: endpoint("pt_start", "start", ORIGIN),
          finish: endpoint("pt_finish", "finish", DESTINATION),
        }),
        "idle",
      ),
    );

    expect(screen.getByRole("button", { name: "Change start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change destination" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set destination on map" })).not.toBeInTheDocument();
  });

  it("does not offer two identically named controls when the attempt failed", () => {
    // The recovery action and the destination chip are the same action; with the
    // chip now reading "Change destination", the recovery control has to say
    // something else or the surface carries two identical buttons.
    render(
      <IntentComposer
        viewModel={viewModelFor(
          documentWith({
            start: endpoint("pt_start", "start", ORIGIN),
            finish: endpoint("pt_finish", "finish", DESTINATION),
          }),
          "failed",
        )}
        onPlan={vi.fn()}
        onSetStart={vi.fn()}
        onSetFinish={vi.fn()}
        onChangeDestination={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Change destination" })).toBe(screen.getByTestId("finish-chip"));
    expect(screen.getByTestId("plan-recovery").textContent).not.toBe("Change destination");
  });

  it("names a dropped pin and keeps its coordinate as the secondary value", () => {
    // Owner review 2026-09-17: the destination cell showed `40.0717, -…`, which
    // is not a coordinate. Owner review 2026-09-21: the cell showed the raw
    // coordinate as the *place value*, which is not a place name either. So the
    // cell carries two values — the name ("Dropped pin") and, beneath it, the
    // coordinate at four decimals with a space after the comma — and the
    // coordinate renders whole: nothing is shortened, and the component never
    // decides how much of a number to show.
    renderComposer(
      viewModelFor(
        documentWith({
          start: endpoint("pt_start", "start", { lon: -75.04219, lat: 40.07691 }),
        }),
        "idle",
      ),
    );

    const start = screen.getByTestId("start-value");
    expect(start).toHaveTextContent("Dropped pin");
    const coordinate = screen.getByTestId("start-coordinate");
    expect(coordinate).toHaveTextContent("40.0769, -75.0422");
    // The two halves are one string with a space separator, so a wrap can only
    // happen between them.
    expect((coordinate.textContent ?? "").split(",")).toHaveLength(2);
    expect(coordinate.textContent).toContain(", ");
    // The same number is machine-readable on the cell, which is what the browser
    // gate reads to prove the app recorded the point the rider placed.
    expect(start).toHaveAttribute("data-coordinate", "40.0769, -75.0422");
  });

  it("wears the rider's own name for a point and still exposes the coordinate", () => {
    renderComposer(
      viewModelFor(
        documentWith({
          start: { ...endpoint("pt_start", "start", ORIGIN), label: "Home" },
          finish: endpoint("pt_finish", "finish", DESTINATION),
        }),
        "idle",
      ),
    );

    expect(screen.getByTestId("start-value")).toHaveTextContent("Home");
    expect(screen.getByTestId("start-coordinate")).toHaveTextContent("39.9500, -75.2000");
    expect(screen.getByTestId("finish-value")).toHaveTextContent("Dropped pin");
    expect(screen.getByTestId("finish-coordinate")).toHaveTextContent("40.2000, -74.8000");
  });
});

/**
 * The truncation defect was a *stylesheet* rule (`white-space: nowrap` plus
 * `text-overflow: ellipsis`), and jsdom does not apply the app's stylesheet — so
 * the regression guard reads the rule the browser actually uses.
 */
describe("the composer value cell never truncates", () => {
  const css = readFileSync(
    path.join(process.cwd(), "src", "app", "globals.css"),
    "utf8",
  );
  const rule = /\.og-composer__value\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("has a value-cell rule to check", () => {
    expect(rule).not.toBe("");
  });

  it("does not clip the value with an ellipsis or forbid wrapping", () => {
    expect(rule).not.toContain("ellipsis");
    expect(rule).not.toContain("nowrap");
    expect(rule).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it("lets the value break between the two halves", () => {
    expect(rule).toContain("overflow-wrap");
    expect(rule).toMatch(/white-space\s*:\s*normal/);
  });
});

afterEach(() => {
  cleanup();
});

describe("saving a chosen place (NV-02)", () => {
  it("stars the destination, and shows no star for an empty slot", () => {
    const document = documentWith({ finish: endpoint("pt_finish", "finish", DESTINATION) });
    const saved = new Set<string>();
    const toggle = vi.fn((slot: "start" | "finish") => {
      if (saved.has(slot)) saved.delete(slot);
      else saved.add(slot);
    });
    const view = () => (
      <IntentComposer
        viewModel={viewModelFor(document, "idle")}
        onPlan={vi.fn()}
        onSetStart={vi.fn()}
        onSetFinish={vi.fn()}
        placeSearch={{
          port: { search: vi.fn(), reverse: async () => null },
          onPick: vi.fn(),
          saving: {
            isSaved: (slot) => (slot === "finish" ? saved.has(slot) : null),
            toggle,
          },
        }}
      />
    );
    const { rerender } = render(view());
    expect(screen.queryByTestId("start-save")).toBeNull();
    const star = screen.getByTestId("finish-save");
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(toggle).toHaveBeenCalledWith("finish");
    rerender(view());
    expect(screen.getByTestId("finish-save")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("finish-save")).toHaveAccessibleName("Remove the destination from saved places");
  });
});
