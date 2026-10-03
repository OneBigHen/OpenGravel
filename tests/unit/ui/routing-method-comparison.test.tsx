import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import { RoutingMethodComparison } from "@/ui/planner/RoutingMethodComparison";

const CLASSIC = asRouteCandidateId("route_classic");
const FRONTIER = asRouteCandidateId("route_frontier");
const CURVES = asRouteCandidateId("route_curves");

type MethodId = "classic" | "frontier" | "sustained-curves";

interface TestMethod {
  readonly id: MethodId;
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
  readonly routeId: RouteCandidateId | null;
  readonly routeLabel: string | null;
  readonly addedMinutes: number | null;
  readonly addedTimeReference: "fastest-shown" | "loop-comparison";
  readonly caveat: string | null;
}

interface TestModel {
  readonly methods: readonly TestMethod[];
  readonly jev: {
    readonly state: "available" | "unavailable";
    readonly routeId: RouteCandidateId | null;
    readonly label: string | null;
    readonly confidence: number | null;
    readonly model: string | null;
  };
  readonly selectedRouteId: RouteCandidateId | null;
  readonly stale: boolean;
}

function method(overrides: Partial<TestMethod> = {}): TestMethod {
  const id = overrides.id ?? "classic";
  const defaults: Record<MethodId, Pick<TestMethod, "label" | "summary" | "detail" | "routeId" | "routeLabel" | "addedMinutes">> = {
    classic: {
      label: "Classic route",
      summary: "A dependable baseline.",
      detail: "Balances the usual ride preferences.",
      routeId: CLASSIC,
      routeLabel: "Classic route",
      addedMinutes: 0,
    },
    frontier: {
      label: "Frontier search",
      summary: "Looks for a less familiar line.",
      detail: "Explores eligible route candidates from the same search.",
      routeId: FRONTIER,
      routeLabel: "Frontier route",
      addedMinutes: 8,
    },
    "sustained-curves": {
      label: "Sustained curves",
      summary: "Favors a longer run of bends.",
      detail: "Uses ordered curve evidence when it is available.",
      routeId: CURVES,
      routeLabel: "Curvy route",
      addedMinutes: 14,
    },
  };
  return {
    id,
    ...defaults[id],
    caveat: null,
    addedTimeReference: "fastest-shown",
    ...overrides,
  };
}

function model(overrides: Partial<TestModel> = {}): TestModel {
  return {
    methods: [
      method({ id: "classic" }),
      method({
        id: "frontier",
        label: "Frontier search",
        summary: "Looks for a less familiar line.",
        detail: "Explores eligible route candidates from the same search.",
        routeId: FRONTIER,
        routeLabel: "Frontier route",
        addedMinutes: 8,
      }),
      method({
        id: "sustained-curves",
        label: "Sustained curves",
        summary: "Favors a longer run of bends.",
        detail: "Uses ordered curve evidence when it is available.",
        routeId: CURVES,
        routeLabel: "Curvy route",
        addedMinutes: 14,
      }),
    ],
    jev: {
      state: "unavailable",
      routeId: null,
      label: null,
      confidence: null,
      model: null,
    },
    selectedRouteId: CLASSIC,
    stale: false,
    ...overrides,
  };
}

function renderComparison(overrides: Partial<TestModel> = {}) {
  const onSelect = vi.fn();
  render(<RoutingMethodComparison model={model(overrides)} onSelect={onSelect} />);
  return onSelect;
}

afterEach(cleanup);

describe("RoutingMethodComparison", () => {
  it("does not render an empty comparison panel", () => {
    renderComparison({ methods: [] });

    expect(screen.queryByTestId("routing-method-comparison")).not.toBeInTheDocument();
  });

  it("opens as an opt-in disclosure and keeps the methods in rider-facing order", () => {
    renderComparison({ methods: [
      method({ id: "sustained-curves" }),
      method({ id: "classic" }),
      method({ id: "frontier" }),
    ] });

    const panel = screen.getByTestId("routing-method-comparison");
    expect(screen.getByText("Compare routing methods", { exact: true })).toBeInTheDocument();
    expect(within(panel).queryByText("Experimental")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));

    expect(within(panel).getByText("Experimental")).toBeInTheDocument();
    expect(within(panel).getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual([
      "classic",
      "frontier",
      "sustained-curves",
    ]);
    expect(within(panel).getByText(/These methods compare the valid routes from the same search/)).toBeInTheDocument();
  });

  it("changes the active explanation without selecting a route automatically", () => {
    const onSelect = renderComparison();

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));
    fireEvent.click(screen.getByRole("radio", { name: /Frontier search/ }));

    expect(screen.getByText("Looks for a less familiar line.")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show this route" })).toBeEnabled();
  });

  it("selects only the route explicitly requested by its action", () => {
    const onSelect = renderComparison();

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));
    fireEvent.click(screen.getByRole("radio", { name: /Frontier search/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show this route" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(FRONTIER);
  });

  it("shows the candidate and added time before a closed method explanation", () => {
    const onSelect = renderComparison();
    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));
    fireEvent.click(screen.getByRole("radio", { name: /Frontier search/ }));

    const option = within(screen.getByTestId("routing-method-frontier"));
    const explanation = option.getByText("Explores eligible route candidates from the same search.");
    const disclosure = explanation.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(explanation).not.toBeVisible();
    const action = option.getByRole("button", { name: "Show this route" });
    for (const first of [option.getByText("Candidate: Frontier route"), option.getByText("+8 min vs fastest shown"), action]) {
      expect(first).toBeVisible();
      expect(first.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(option.getByText("Why this route?", { exact: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables the current route and explains unavailable or stale routes", () => {
    const onSelect = renderComparison({
      stale: true,
      methods: [
        method({ id: "classic", routeId: CLASSIC }),
        method({
          id: "frontier",
          routeId: null,
          routeLabel: null,
          caveat: "This method needs a verified connector for this plan.",
        }),
      ],
    });

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));

    const current = screen.getByRole("button", { name: "Already selected" });
    expect(current).toBeDisabled();
    expect(screen.getByText("Showing the previous ride while this plan updates. Replan before comparing.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Frontier/ }));
    expect(screen.getByText("This method needs a verified connector for this plan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unavailable while plan updates" })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps an unavailable method's reason visible with a short disabled action", () => {
    const onSelect = renderComparison({ methods: [method({
      id: "sustained-curves", routeId: null, routeLabel: null,
      caveat: "This method needs mapped bend measurements for this plan.",
    })] });
    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));
    const option = within(screen.getByTestId("routing-method-sustained-curves"));
    expect(option.getByText("This method needs mapped bend measurements for this plan.", { selector: "p" })).toBeVisible();
    expect(option.getByRole("button", { name: "Unavailable for this plan" })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Jev advisory and manual, with truthful availability and confidence language", () => {
    const onSelect = renderComparison({
      jev: {
        state: "available",
        routeId: FRONTIER,
        label: "Jev prefers the frontier line",
        confidence: 0.72,
        model: "jev-1.13.0",
      },
    });

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));

    expect(screen.getByText("Jev's read is advisory only.")).toBeInTheDocument();
    expect(screen.getByText("Jev prefers the frontier line")).toBeInTheDocument();
    expect(screen.getByText("Model confidence (uncalibrated): 72%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show assessed route" })).toBeEnabled();
    expect(screen.getByText("No road facts or safety claims are added by this reading.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show assessed route" }));
    expect(onSelect).toHaveBeenCalledWith(FRONTIER);
  });

  it("states the unavailable Jev reason without inventing a reading", () => {
    renderComparison();

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));

    expect(screen.getByText("No Jev reading for this plan. Routing still works.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show assessed route" })).not.toBeInTheDocument();
  });

  it("exposes the nuance guidance in a native details disclosure", () => {
    renderComparison();

    fireEvent.click(screen.getByText("Compare routing methods", { exact: true }));
    fireEvent.click(screen.getByText("How these options work", { exact: true }));

    expect(screen.getByText(/Maps estimate bends, not safety/)).toBeInTheDocument();
    expect(screen.getByText(/licensed contiguous road data and verified connectors/)).toBeInTheDocument();
    expect(screen.getByText(/cannot yet claim good-road minutes/)).toBeInTheDocument();
    expect(screen.getByText(/Check the existing route warnings/)).toBeInTheDocument();
  });
});

it("explains the scoped time reference for loop comparisons", () => {
  render(<RoutingMethodComparison model={model({ methods: [method({ id: "sustained-curves", addedMinutes: 15, addedTimeReference: "loop-comparison" })] })} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByText("Compare routing methods"));
  expect(screen.getByText("+15 min vs fastest loop comparison")).toBeInTheDocument();
});
