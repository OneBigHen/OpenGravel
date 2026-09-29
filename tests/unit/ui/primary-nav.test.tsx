/**
 * The primary navigation's labels (12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §9,
 * §20).
 *
 * The owner review of 2026-09-21 found the planner's header reading
 * `ExploreRides library` and Explore's reading `PlannerRides`: two adjacent
 * inline links with no separator between them are one run of text in the DOM, so
 * the labels concatenate however the parent lays them out. This pins the fix —
 * the separation is markup, and every link keeps its own accessible name.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PrimaryNav } from "@/ui/nav/PrimaryNav";

/** The planner header's nav, exactly as the workspace renders it. */
const PLANNER_ITEMS = [
  { href: "/explore", label: "Explore" },
  { href: "/rides", label: "Rides library" },
] as const;

/** The Explore header's nav, exactly as the panel renders it. */
const EXPLORE_ITEMS = [
  { href: "/", label: "Planner" },
  { href: "/rides", label: "Rides" },
] as const;

afterEach(() => cleanup());

describe("PrimaryNav label separation", () => {
  it("renders the planner labels as two separate links, never concatenated", () => {
    render(<PrimaryNav items={PLANNER_ITEMS} />);

    // `getByRole` with a string name is an exact accessible-name match, so each
    // label is asserted whole and none of them absorbs the other.
    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/explore");
    expect(screen.getByRole("link", { name: "Rides library" })).toHaveAttribute(
      "href",
      "/rides",
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.querySelectorAll("a")).toHaveLength(2);
    expect(nav.textContent).not.toBe("ExploreRides library");
    // The separator is real content between them, so the run cannot fuse.
    expect(nav.textContent).toMatch(/Explore\s*·\s*Rides library/);
    expect(nav.textContent).not.toContain("ExploreRides");
  });

  it("renders Explore's labels as two separate links, never concatenated", () => {
    render(<PrimaryNav items={EXPLORE_ITEMS} />);

    expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Rides" })).toHaveAttribute("href", "/rides");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.querySelectorAll("a")).toHaveLength(2);
    expect(nav.textContent).not.toBe("PlannerRides");
    expect(nav.textContent).toMatch(/Planner\s*·\s*Rides/);
    expect(nav.textContent).not.toContain("PlannerRides");
  });

  it("keeps the divider out of the accessible names", () => {
    render(<PrimaryNav items={PLANNER_ITEMS} />);

    const divider = screen.getByText("·");
    expect(divider).toHaveAttribute("aria-hidden", "true");
    // Decoration only: no link's name contains it.
    for (const link of screen.getByRole("navigation", { name: "Primary" }).querySelectorAll("a")) {
      expect(link).not.toHaveAccessibleName(/·/);
    }
  });

  it("separates the labels by markup, not by a parent gap", () => {
    // The defect was stylesheet-independent: two links with no separator are one
    // text run whatever the layout does. So the divider must be an element in the
    // nav, and there must be exactly one fewer divider than there are links.
    render(<PrimaryNav items={PLANNER_ITEMS} />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.querySelectorAll(".og-nav__sep")).toHaveLength(PLANNER_ITEMS.length - 1);
  });
});
