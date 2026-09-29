/**
 * The road-span list and inspector (04 §17, §31; 05 §20).
 *
 * The panel renders and calls back; it owns no authority. What matters here is
 * that the four verdicts read as themselves, that a failing required span carries
 * the 04 §17 copy and warning state, that `Avoid` cannot be silently softened, and
 * that the whole three-action flow is reachable from real buttons.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoadSpanStatusRow } from "@/application/planner/road-span-status";
import { asRoadSpanId } from "@/domain/ride/ids";
import { RoadSpansPanel } from "@/ui/planner/RoadSpansPanel";

function row(overrides: Partial<RoadSpanStatusRow> = {}): RoadSpanStatusRow {
  return {
    id: asRoadSpanId("span_1"),
    mode: "must",
    direction: "forward",
    status: "satisfied",
    geometryResolved: true,
    coveredMeters: 200,
    totalMeters: 200,
    note: null,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof RoadSpansPanel>[0]> = {}): {
  readonly onCommit: ReturnType<typeof vi.fn>;
  readonly onFlipMode: ReturnType<typeof vi.fn>;
  readonly onRemove: ReturnType<typeof vi.fn>;
  readonly onZoomTo: ReturnType<typeof vi.fn>;
  readonly onSelectWholeRoute: ReturnType<typeof vi.fn>;
  readonly onStartSelecting: ReturnType<typeof vi.fn>;
  readonly onCancelDraft: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onSelect: vi.fn(),
    onZoomTo: vi.fn(),
    onStartSelecting: vi.fn(),
    onSelectWholeRoute: vi.fn(),
    onCancelDraft: vi.fn(),
    onCommit: vi.fn(),
    onFlipMode: vi.fn(),
    onRemove: vi.fn(),
  };
  render(
    <RoadSpansPanel
      rows={[row()]}
      selectedSpanId={null}
      selecting={false}
      draft={null}
      draftVertexCount={0}
      draftDirection={null}
      error={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the status rows", () => {
  it("shows the mode, the direction and the measured verdict", () => {
    renderPanel({ rows: [row()] });
    expect(screen.getByTestId("span-mode-0")).toHaveTextContent("Keep");
    expect(screen.getByTestId("span-status-0")).toHaveTextContent("Satisfied");
    expect(screen.getByTestId("span-direction-0")).toHaveTextContent("Forward");
  });

  it("warns, with the 04 §17 copy, when a required span is not satisfied", () => {
    renderPanel({ rows: [row({ status: "conflict" })] });
    expect(screen.getByTestId("road-span-row-0")).toHaveAttribute("data-warning", "true");
    expect(screen.getByTestId("span-warning-0")).toHaveTextContent(
      "Route does not satisfy this road",
    );
  });

  it("says Unavailable — never Conflict — for a span it could not check", () => {
    renderPanel({ rows: [row({ status: "unavailable", geometryResolved: false })] });
    expect(screen.getByTestId("span-status-0")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("span-warning-0")).toHaveTextContent(
      "could not be checked",
    );
  });

  it("never warns for a preferred span: prefer shapes ranking, not legality", () => {
    renderPanel({ rows: [row({ mode: "prefer", status: "partially-satisfied" })] });
    expect(screen.getByTestId("road-span-row-0")).toHaveAttribute("data-warning", "false");
    expect(screen.queryByTestId("span-warning-0")).toBeNull();
    expect(screen.getByTestId("span-status-0")).toHaveTextContent("Partially satisfied");
  });

  it("warns when the route enters an avoided span", () => {
    renderPanel({ rows: [row({ mode: "avoid", status: "conflict" })] });
    expect(screen.getByTestId("span-warning-0")).toHaveTextContent("Route enters this road");
  });

  it("renders every row in author order", () => {
    renderPanel({
      rows: [
        row({ id: asRoadSpanId("span_a") }),
        row({ id: asRoadSpanId("span_b"), mode: "prefer" }),
      ],
    });
    expect(screen.getByTestId("span-mode-0")).toHaveTextContent("Keep");
    expect(screen.getByTestId("span-mode-1")).toHaveTextContent("Prefer");
  });
});

describe("the row actions", () => {
  it("offers a Keep↔Prefer flip for a kept span", () => {
    const handlers = renderPanel({ rows: [row({ mode: "must" })] });
    fireEvent.click(screen.getByTestId("flip-road-span-1"));
    expect(handlers.onFlipMode).toHaveBeenCalledWith("span_1");
    expect(screen.getByTestId("flip-road-span-1")).toHaveTextContent("Prefer instead");
  });

  it("offers no flip for an avoided span: Avoid is not a softer Keep", () => {
    renderPanel({ rows: [row({ mode: "avoid" })] });
    expect(screen.queryByTestId("flip-road-span-1")).toBeNull();
  });

  it("removes and zooms by identity", () => {
    const handlers = renderPanel({ rows: [row()] });
    fireEvent.click(screen.getByTestId("remove-road-span-1"));
    fireEvent.click(screen.getByTestId("zoom-road-span-1"));
    expect(handlers.onRemove).toHaveBeenCalledWith("span_1");
    expect(handlers.onZoomTo).toHaveBeenCalledWith("span_1");
  });
});

describe("the selection draft", () => {
  it("offers the keyboard path without arming the map", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByTestId("select-whole-route"));
    expect(handlers.onSelectWholeRoute).toHaveBeenCalledTimes(1);
  });

  it("arms the map tool and reports it as pressed", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByTestId("select-road-span"));
    expect(handlers.onStartSelecting).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("select-road-span")).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses every commit until the draft covers two points", () => {
    renderPanel({
      selecting: true,
      draft: { routeId: "route_a", startIndex: 1, endIndex: 1 },
      draftVertexCount: 1,
      draftDirection: "forward",
    });
    expect(screen.getByTestId("commit-keep")).toBeDisabled();
    expect(screen.getByTestId("commit-prefer")).toBeDisabled();
    expect(screen.getByTestId("commit-avoid")).toBeDisabled();
  });

  it("commits each of the three modes from its own button", () => {
    const handlers = renderPanel({
      selecting: true,
      draft: { routeId: "route_a", startIndex: 1, endIndex: 3 },
      draftVertexCount: 3,
      draftDirection: "reverse",
    });
    expect(screen.getByTestId("span-draft")).toHaveTextContent("Reverse");
    fireEvent.click(screen.getByTestId("commit-keep"));
    fireEvent.click(screen.getByTestId("commit-prefer"));
    fireEvent.click(screen.getByTestId("commit-avoid"));
    expect(handlers.onCommit.mock.calls).toEqual([["must"], ["prefer"], ["avoid"]]);
  });

  it("cancels the draft", () => {
    const handlers = renderPanel({
      selecting: true,
      draft: { routeId: "route_a", startIndex: 1, endIndex: 3 },
      draftVertexCount: 3,
    });
    fireEvent.click(screen.getByTestId("cancel-span-draft"));
    expect(handlers.onCancelDraft).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal as an alert", () => {
    renderPanel({ error: "A road span needs a line with at least two points." });
    expect(screen.getByTestId("span-error")).toHaveTextContent(
      "A road span needs a line with at least two points.",
    );
  });
});
