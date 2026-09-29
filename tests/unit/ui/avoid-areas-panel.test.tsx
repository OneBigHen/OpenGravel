import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AvoidAreaConflict } from "@/application/planner/avoid-area-conflicts";
import {
  AvoidAreaConflictPanel,
  AvoidAreasPanel,
  MAX_AVOID_AREA_NAME_LENGTH,
  avoidAreaRowName,
  validateAvoidAreaNameInput,
  type AvoidAreaRowVm,
} from "@/ui/planner/AvoidAreasPanel";
import type { AvoidAreaId } from "@/domain/ride/ids";

/**
 * The avoid-area list, its rename field and the conflict panel (04 §18, §31;
 * 05 §21).
 *
 * Every assertion is about the keyboard/list path 04 §31 requires: the component
 * renders and calls back, and it never dispatches — so an action's *intent* is
 * what is checked here, and that the intent becomes exactly one command is the
 * workspace's own test.
 */

const AREA_A = "avoid_a" as AvoidAreaId;
const AREA_B = "avoid_b" as AvoidAreaId;

function row(overrides: Partial<AvoidAreaRowVm> = {}): AvoidAreaRowVm {
  return {
    id: AREA_A,
    name: null,
    enabled: true,
    vertexCount: 4,
    geometryResolved: true,
    conflictCount: 0,
    ...overrides,
  };
}

function panelProps(rows: readonly AvoidAreaRowVm[]) {
  return {
    rows,
    selectedAreaId: null,
    tool: "idle" as const,
    draftVertexCount: 0,
    error: null,
    onSelect: vi.fn(),
    onZoomTo: vi.fn(),
    onStartTool: vi.fn(),
    onCloseDraft: vi.fn(),
    onRemoveLastVertex: vi.fn(),
    onCancelDraft: vi.fn(),
    onRename: vi.fn(),
    onSetEnabled: vi.fn(),
    onRemove: vi.fn(),
  };
}

afterEach(cleanup);

describe("validateAvoidAreaNameInput", () => {
  it("trims a usable name", () => {
    expect(validateAvoidAreaNameInput("  Route 206  ")).toEqual({
      name: "Route 206",
      error: null,
    });
  });

  it("clears the name for an empty field: removing a name is an action, not a refusal", () => {
    expect(validateAvoidAreaNameInput("   ")).toEqual({ name: null, error: null });
  });

  it("refuses a name longer than the cap, with the cap in the message", () => {
    const validation = validateAvoidAreaNameInput("x".repeat(MAX_AVOID_AREA_NAME_LENGTH + 1));
    expect(validation.name).toBeNull();
    expect(validation.error).toContain(String(MAX_AVOID_AREA_NAME_LENGTH));
  });

  it("accepts a name exactly at the cap", () => {
    const value = "x".repeat(MAX_AVOID_AREA_NAME_LENGTH);
    expect(validateAvoidAreaNameInput(value)).toEqual({ name: value, error: null });
  });
});

describe("avoidAreaRowName", () => {
  it("falls back to the row's position for an unnamed area", () => {
    expect(avoidAreaRowName(row(), 0)).toBe("Avoid area 1");
    expect(avoidAreaRowName(row(), 2)).toBe("Avoid area 3");
  });

  it("prefers the rider's name", () => {
    expect(avoidAreaRowName(row({ name: "Route 206" }), 0)).toBe("Route 206");
  });
});

describe("AvoidAreasPanel", () => {
  it("shows the empty state when there are no areas", () => {
    render(<AvoidAreasPanel {...panelProps([])} />);
    expect(screen.getByTestId("avoid-areas-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("avoid-areas-list")).not.toBeInTheDocument();
  });

  it("lists every area with its corner count and enables all its actions", () => {
    const props = panelProps([row(), row({ id: AREA_B, name: "Route 206" })]);
    render(<AvoidAreasPanel {...props} />);

    expect(screen.getByTestId("avoid-area-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("corners-avoid-area-1")).toHaveTextContent("4 corners");
    expect(screen.getByTestId("select-avoid-area-1")).toHaveTextContent("Avoid area 1");
    expect(screen.getByTestId("select-avoid-area-2")).toHaveTextContent("Route 206");

    fireEvent.click(screen.getByTestId("select-avoid-area-1"));
    expect(props.onSelect).toHaveBeenCalledWith(AREA_A);
    fireEvent.click(screen.getByTestId("zoom-avoid-area-1"));
    expect(props.onZoomTo).toHaveBeenCalledWith(AREA_A);
    fireEvent.click(screen.getByTestId("move-avoid-area-1"));
    expect(props.onStartTool).toHaveBeenCalledWith("move", AREA_A);
    fireEvent.click(screen.getByTestId("vertices-avoid-area-1"));
    expect(props.onStartTool).toHaveBeenCalledWith("vertices", AREA_A);
    fireEvent.click(screen.getByTestId("remove-avoid-area-1"));
    expect(props.onRemove).toHaveBeenCalledWith(AREA_A);
  });

  it("says so when an area's geometry did not resolve, instead of showing zero corners", () => {
    render(<AvoidAreasPanel {...panelProps([row({ geometryResolved: false, vertexCount: 0 })])} />);
    expect(screen.getByTestId("corners-avoid-area-1")).toHaveTextContent("Geometry unavailable");
  });

  it("toggles enablement in one press and says which way it went", () => {
    const props = panelProps([row({ enabled: true })]);
    const { unmount } = render(<AvoidAreasPanel {...props} />);
    const toggle = screen.getByTestId("toggle-avoid-area-1");
    expect(toggle).toHaveTextContent("Disable");
    fireEvent.click(toggle);
    expect(props.onSetEnabled).toHaveBeenCalledWith(AREA_A, false);
    unmount();

    const second = panelProps([row({ enabled: false })]);
    render(<AvoidAreasPanel {...second} />);
    expect(screen.getByTestId("toggle-avoid-area-1")).toHaveTextContent("Enable");
    fireEvent.click(screen.getByTestId("toggle-avoid-area-1"));
    expect(second.onSetEnabled).toHaveBeenCalledWith(AREA_A, true);
  });

  it("arms the two authoring tools", () => {
    const props = panelProps([]);
    render(<AvoidAreasPanel {...props} />);
    fireEvent.click(screen.getByTestId("draw-rectangle"));
    expect(props.onStartTool).toHaveBeenCalledWith("rectangle");
    fireEvent.click(screen.getByTestId("draw-polygon"));
    expect(props.onStartTool).toHaveBeenCalledWith("polygon");
  });

  it("submits a rename through its inline field", () => {
    const props = panelProps([row()]);
    render(<AvoidAreasPanel {...props} />);
    const field = screen.getByTestId("rename-avoid-area-1");
    fireEvent.change(field, { target: { value: " Route 206 " } });
    fireEvent.click(screen.getByTestId("apply-rename-avoid-area-1"));
    expect(props.onRename).toHaveBeenCalledWith(AREA_A, "Route 206");
  });

  it("clears a name with an empty field rather than refusing it", () => {
    const props = panelProps([row({ name: "Route 206" })]);
    render(<AvoidAreasPanel {...props} />);
    fireEvent.change(screen.getByTestId("rename-avoid-area-1"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("apply-rename-avoid-area-1"));
    expect(props.onRename).toHaveBeenCalledWith(AREA_A, null);
  });

  it("refuses an over-long name inline and dispatches nothing", () => {
    const props = panelProps([row()]);
    render(<AvoidAreasPanel {...props} />);
    fireEvent.change(screen.getByTestId("rename-avoid-area-1"), {
      target: { value: "x".repeat(MAX_AVOID_AREA_NAME_LENGTH + 1) },
    });
    fireEvent.click(screen.getByTestId("apply-rename-avoid-area-1"));

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId("rename-error-avoid-area-1")).toHaveTextContent(
      String(MAX_AVOID_AREA_NAME_LENGTH),
    );
    // The rider's text is still there to fix.
    expect(screen.getByTestId("rename-avoid-area-1")).toHaveValue(
      "x".repeat(MAX_AVOID_AREA_NAME_LENGTH + 1),
    );
  });

  it("retires a rename draft when the underlying name changes under it", () => {
    const props = panelProps([row({ name: "Route 206" })]);
    const { rerender } = render(<AvoidAreasPanel {...props} />);
    fireEvent.change(screen.getByTestId("rename-avoid-area-1"), {
      target: { value: "half-typed" },
    });

    // An undo (or another tab) changes the name: the field shows the new truth
    // instead of letting the rider overwrite an edit they did not make.
    rerender(<AvoidAreasPanel {...props} rows={[row({ name: "Route 202" })]} />);
    expect(screen.getByTestId("rename-avoid-area-1")).toHaveValue("Route 202");
  });

  it("shows the polygon draft's controls, with Close disabled below three corners", () => {
    const props = { ...panelProps([]), tool: "polygon" as const, draftVertexCount: 2 };
    render(<AvoidAreasPanel {...props} />);

    expect(screen.getByTestId("close-avoid-polygon")).toBeDisabled();
    expect(screen.getByTestId("avoid-polygon-draft")).toHaveTextContent("2 placed");
    fireEvent.click(screen.getByTestId("remove-avoid-vertex"));
    expect(props.onRemoveLastVertex).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("cancel-avoid-polygon"));
    expect(props.onCancelDraft).toHaveBeenCalled();
  });

  it("enables Close at three corners and closes on it", () => {
    const props = { ...panelProps([]), tool: "polygon" as const, draftVertexCount: 3 };
    render(<AvoidAreasPanel {...props} />);
    const close = screen.getByTestId("close-avoid-polygon");
    expect(close).not.toBeDisabled();
    fireEvent.click(close);
    expect(props.onCloseDraft).toHaveBeenCalled();
  });

  it("says what the rectangle tool expects of the next gesture", () => {
    render(<AvoidAreasPanel {...panelProps([])} tool="rectangle" />);
    expect(screen.getByTestId("avoid-rectangle-hint")).toHaveTextContent("Drag on the map");
  });

  it("announces a refused shape from the workspace", () => {
    render(<AvoidAreasPanel {...panelProps([])} error="The outline crosses itself." />);
    expect(screen.getByTestId("avoid-area-error")).toHaveTextContent("crosses itself");
  });

  it("marks the selected area and arms the editing tools it is in", () => {
    render(
      <AvoidAreasPanel
        {...panelProps([row()])}
        selectedAreaId={AREA_A}
        tool="vertices"
      />,
    );
    expect(screen.getByTestId("avoid-area-row-0")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("vertices-avoid-area-1")).toHaveAttribute("data-armed", "true");
    expect(screen.getByTestId("move-avoid-area-1")).toHaveAttribute("data-armed", "false");
  });

  it("badges an area that contains a required point", () => {
    render(<AvoidAreasPanel {...panelProps([row({ conflictCount: 2 })])} />);
    expect(screen.getByTestId("conflict-badge-avoid-area-1")).toHaveTextContent("2 inside");
  });
});

describe("AvoidAreaConflictPanel", () => {
  const conflicts: readonly AvoidAreaConflict[] = [
    { areaId: AREA_A, endpoint: { kind: "start", id: "pt_start" as never } },
    { areaId: AREA_B, endpoint: { kind: "stop", id: "stop_1" as never } },
  ];

  function conflictProps() {
    return {
      conflicts,
      areaNames: new Map([
        [AREA_A, "Route 206"],
        [AREA_B, "Avoid area 2"],
      ]),
      onMoveEndpoint: vi.fn(),
      onEditArea: vi.fn(),
      onRemoveArea: vi.fn(),
    };
  }

  it("renders nothing when there is no conflict", () => {
    const { container } = render(
      <AvoidAreaConflictPanel {...conflictProps()} conflicts={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("states the consequence in one non-blocking line and names the point", () => {
    render(<AvoidAreaConflictPanel {...conflictProps()} />);
    expect(screen.getByTestId("avoid-conflict-panel")).toBeInTheDocument();
    expect(screen.getByText("Route cannot pass through this area")).toBeInTheDocument();
    expect(screen.getByTestId("avoid-conflict-0")).toHaveTextContent(
      "Route 206 contains your start.",
    );
    expect(screen.getByTestId("avoid-conflict-1")).toHaveTextContent(
      "Avoid area 2 contains a stop.",
    );
  });

  it("offers exactly the three explicit actions 04 §18 names", () => {
    const props = conflictProps();
    render(<AvoidAreaConflictPanel {...props} />);

    fireEvent.click(screen.getByTestId("conflict-move-0"));
    expect(props.onMoveEndpoint).toHaveBeenCalledWith(conflicts[0]);
    fireEvent.click(screen.getByTestId("conflict-edit-1"));
    expect(props.onEditArea).toHaveBeenCalledWith(AREA_B);
    fireEvent.click(screen.getByTestId("conflict-remove-1"));
    expect(props.onRemoveArea).toHaveBeenCalledWith(AREA_B);
    // There is deliberately no fourth "fix it for me" action.
    expect(
      screen.queryByTestId("conflict-resolve"),
    ).not.toBeInTheDocument();
  });
});
