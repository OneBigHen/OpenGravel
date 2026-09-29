/**
 * One route decision card (04-PLANNER-AND-WORKSPACE-UX §11–§12).
 *
 * A card is the keyboard-accessible form of "select this route", so it is a real
 * button whose pressed state, role label, metrics, added time and unknown-surface
 * badge are all asserted here.
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteExplanation } from "@/application/planner/route-explanation";
import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { asRouteCandidateId } from "@/domain/route/ids";
import { RouteChoices, RouteDecisionCard } from "@/ui/planner/RouteDecisionCard";

const BEST_ID = asRouteCandidateId("route_best");
const ALT_ID = asRouteCandidateId("route_alt");

function card(overrides: Partial<RouteCardVm> = {}): RouteCardVm {
  return {
    routeId: BEST_ID,
    roleKey: "best-ride",
    roleLabel: "Best Ride",
    durationLabel: "1 h 48 min",
    distanceLabel: "78 mi",
    addedTimeLabel: "+12 min vs Fastest",
    badges: ["Surface unknown"],
    confidenceLabel: "Unknown",
    unknownSurfaceMi: 78,
    whyKey: `why-${BEST_ID}`,
    isSelected: true,
    ...overrides,
  };
}

const EXPLANATION: RouteExplanation = {
  headline: "Adds 11 minutes for a curvier line.",
  bullets: [
    {
      key: "component.confidence",
      text: "No road-metric evidence is available for this route yet.",
      evidenceStatus: "unknown",
    },
    {
      key: "surface.coverage",
      text: "Surface is unverified on 78 mi of this route.",
      evidenceStatus: "unknown",
    },
    {
      key: "component.curvature",
      text: "Curvature is estimated from the returned route line, not from mapped road data.",
      evidenceStatus: "estimated",
    },
  ],
};

describe("RouteDecisionCard", () => {
  it("renders the decision fields and reports its selected state", () => {
    render(<RouteDecisionCard card={card()} onSelect={vi.fn()} />);

    const button = screen.getByRole("button", { name: /Best Ride/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("data-selected", "true");
    // The hook is keyed by the role, so a gate can name the decision a rider
    // makes instead of a per-attempt candidate id.
    expect(screen.getByTestId("route-card-best-ride")).toBe(button);
    expect(button).toHaveAttribute("data-role", "best-ride");
    expect(screen.getByTestId("route-duration")).toHaveTextContent("1 h 48 min");
    expect(screen.getByTestId("route-distance")).toHaveTextContent("78 mi");
    expect(screen.getByTestId("route-added-time")).toHaveTextContent(
      "+12 min vs Fastest",
    );
    // An unknown surface is stated once under the list, not on every card.
    expect(screen.queryByTestId("route-badge")).not.toBeInTheDocument();
  });

  it("shows a known surface badge on the card", () => {
    render(<RouteDecisionCard card={card({ badges: ["Paved"] })} onSelect={vi.fn()} />);

    expect(screen.getByTestId("route-badge")).toHaveTextContent("Paved");
  });

  it("omits the added time when there is no honest delta", () => {
    render(
      <RouteDecisionCard
        card={card({ roleLabel: "Fastest", addedTimeLabel: null, isSelected: false })}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("route-added-time")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fastest/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("omits the badge once the surface is verified", () => {
    render(
      <RouteDecisionCard card={card({ badges: [] })} onSelect={vi.fn()} />,
    );

    expect(screen.queryByTestId("route-badge")).not.toBeInTheDocument();
  });

  it("keys a roleless card as the alternative", () => {
    render(
      <RouteDecisionCard
        card={card({ roleKey: "alternative", roleLabel: "Alternative", isSelected: false })}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("route-card-alternative")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("states unknown surface and traffic once for the whole list", () => {
    render(
      <RouteChoices cards={[card(), card({ routeId: ALT_ID })]}>
        <RouteDecisionCard card={card()} onSelect={vi.fn()} />
      </RouteChoices>,
    );

    expect(screen.queryByTestId("route-traffic-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-unknowns-note")).toHaveTextContent(
      "Not yet known for these rides: surface and live traffic.",
    );
    expect(screen.queryByText("Traffic clear", { exact: true })).not.toBeInTheDocument();
  });

  it("does not call traffic unknown when the selected ride has it", () => {
    render(
      <RouteChoices cards={[card({ trafficLabel: "+5–8 min in traffic" }), card({ routeId: ALT_ID })]}>
        <RouteDecisionCard card={card()} onSelect={vi.fn()} />
      </RouteChoices>,
    );

    expect(screen.getByTestId("route-unknowns-note")).not.toHaveTextContent("live traffic");
    expect(screen.getByTestId("route-traffic-note")).toHaveTextContent("Live traffic is checked for the selected ride");
  });

  it("selects the route it names", () => {
    const onSelect = vi.fn();
    render(
      <RouteDecisionCard card={card({ isSelected: false })} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Best Ride/ }));

    expect(onSelect).toHaveBeenCalledWith(BEST_ID);
  });
});

afterEach(() => {
  cleanup();
});

describe("RouteDecisionCard — evidence and explanation (04 §11, §13)", () => {
  it("renders the surface confidence band beside the badge", () => {
    render(<RouteDecisionCard card={card({ confidenceLabel: "Surface mostly known" })} onSelect={vi.fn()} />);

    expect(screen.getByTestId("route-confidence")).toHaveTextContent("Surface mostly known");
  });

  it("makes no confidence claim when the route has no measurable metric", () => {
    render(<RouteDecisionCard card={card({ confidenceLabel: null })} onSelect={vi.fn()} />);

    expect(screen.queryByTestId("route-confidence")).not.toBeInTheDocument();
  });

  it("shows no Why control for a route without an explanation", () => {
    render(<RouteDecisionCard card={card()} onSelect={vi.fn()} />);

    expect(screen.queryByTestId("route-why-toggle")).not.toBeInTheDocument();
  });

  it("toggles the explanation region with aria-expanded", () => {
    render(
      <RouteDecisionCard card={card()} explanation={EXPLANATION} onSelect={vi.fn()} />,
    );

    const toggle = screen.getByTestId("route-why-toggle");
    expect(toggle).toHaveTextContent("Why this ride?");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("route-why-panel")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByTestId("route-why-panel");
    expect(panel).toHaveAttribute("id", `why-${BEST_ID}`);
    expect(toggle).toHaveAttribute("aria-controls", `why-${BEST_ID}`);
    expect(panel).toHaveTextContent("Adds 11 minutes for a curvier line.");

    const bullets = within(panel).getAllByTestId("route-why-bullet");
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toHaveTextContent("No road-metric evidence is available for this route yet.");
    expect(bullets[1]).toHaveTextContent("Surface is unverified on 78 mi of this route.");
    // The evidence status travels with the bullet, so a weak fact reads weak.
    expect(bullets[2]).toHaveTextContent("Estimated");
    expect(bullets[2]).toHaveTextContent(
      "Curvature is estimated from the returned route line, not from mapped road data.",
    );

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("route-why-panel")).not.toBeInTheDocument();
  });

  it("keeps the Why control out of the route selection button", () => {
    render(
      <RouteDecisionCard card={card()} explanation={EXPLANATION} onSelect={vi.fn()} />,
    );

    const select = screen.getByRole("button", { name: /Best Ride/ });
    const toggle = screen.getByTestId("route-why-toggle");
    expect(select.contains(toggle)).toBe(false);
    // Selecting the route never opens the explanation, and opening the
    // explanation never selects the route.
    const onSelect = vi.fn();
    render(<RouteDecisionCard card={card({ isSelected: false })} explanation={EXPLANATION} onSelect={onSelect} />);
    const secondToggle = screen.getAllByTestId("route-why-toggle")[1];
    if (secondToggle === undefined) throw new Error("expected a second card");
    fireEvent.click(secondToggle);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders no provider name anywhere a rider can read", () => {
    const { container } = render(
      <RouteDecisionCard card={card()} explanation={EXPLANATION} onSelect={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("route-why-toggle"));

    expect(container.textContent ?? "").not.toMatch(/graphhopper|valhalla|tomtom|router/i);
  });
});
