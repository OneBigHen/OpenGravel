/**
 * Design-tell guard for the panels the rider reads in a list or on the map.
 *
 * A thick coloured border down one side of a card (or across its top) is the
 * most recognisable "generated UI" tell, and it clashes with the rounded
 * panels the rest of the app draws. Where the stripe carried meaning — a note,
 * a severity, a tone, a hazard — the meaning moved to a tinted background, a
 * leading dot or the heading colour, and this file holds that in place.
 * Read from the shipped stylesheets so it cannot drift from what renders.
 */

import { appCss } from "../helpers/app-css";
import { describe, expect, it } from "vitest";

const CSS = appCss();

/** Every rule body whose selector is exactly `selector`, in file order. */
function rulesFor(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)${escaped} \\{`, "g");
  const bodies: string[] = [];
  for (const match of CSS.matchAll(pattern)) {
    const start = (match.index as number) + match[0].length;
    bodies.push(CSS.slice(start, CSS.indexOf("}", start)));
  }
  expect(bodies.length, `expected a rule for ${selector}`).toBeGreaterThan(0);
  return bodies;
}


/** A border on one side, 3px or thicker: the accent stripe shape. */
const ACCENT_STRIPE = /border-(left|right|top|bottom):\s*(?:[3-9]|[1-9]\d)px/;

/**
 * The only one-sided rules allowed are the route-colour markers: a planned
 * point's and a route card's left edge carry that route's own line colour.
 */
const ROUTE_MARKERS = new Set([".og-point", ".og-route-card__button", ".og-refine .og-point"]);

describe("design tells — no accent stripe down the side of a card", () => {
  it("draws no accent stripe anywhere but on a route's own colour marker", () => {
    const offenders: string[] = [];
    for (const match of CSS.matchAll(/(^|\n)([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
      const selector = (match[2] as string).trim();
      if (ACCENT_STRIPE.test(match[3] as string) && !ROUTE_MARKERS.has(selector)) offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the severity of a long-trip consideration on its dot", () => {
    expect(rulesFor(".og-preparation__consideration::before").join("\n")).toMatch(
      /background:\s*var\(--og-consideration-tone\)/,
    );
    for (const [severity, tone] of [
      ["info", "--og-primary"],
      ["watch", "--og-warn"],
      ["critical", "--og-danger"],
    ] as const) {
      const body = rulesFor(`.og-preparation__consideration[data-severity="${severity}"]`).join("\n");
      expect(body, severity).toContain(`--og-consideration-tone: var(${tone})`);
      expect(body, severity).not.toMatch(/border-/);
    }
    // A tint is not the only signal: the label and reason are text either way.
    expect(rulesFor(".og-preparation__consideration p").join("\n")).toContain("color: var(--og-ink)");
  });

  it("keeps the ride sheet's tones as a tint, not a side stripe", () => {
    for (const tone of ["done", "error"] as const) {
      const body = rulesFor(`.og-ride__detour-status[data-tone="${tone}"]`).join("\n");
      expect(body, tone).toContain("background: color-mix(");
      expect(body, tone).not.toMatch(ACCENT_STRIPE);
    }
  });

  it("draws the start pin's arrow as a shape, not a border trick", () => {
    const body = rulesFor(".og-point__pin--start::before").join("\n");
    expect(body).toContain("clip-path: polygon(0 0, 100% 50%, 0 100%)");
    expect(body).not.toMatch(/border-/);
  });

  it("colours the hazards' lead-in in Danger", () => {
    expect(rulesFor(".og-route-story__hazards strong").join("\n")).toContain("color: var(--og-danger)");
  });
});

describe("typography — no stragglers", () => {
  it("gives body copy a pretty last line and headings balanced lines", () => {
    expect(rulesFor("p").join("\n")).toContain("text-wrap: pretty");
    const headings = rulesFor("h1,\nh2,\nh3");
    expect(headings.some((body) => body.includes("text-wrap: balance"))).toBe(true);
  });
});
