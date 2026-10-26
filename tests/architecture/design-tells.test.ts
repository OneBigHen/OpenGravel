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

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string): string => readFileSync(path.join(process.cwd(), "src", "app", file), "utf8");
const GLOBALS = read("globals.css");
const GLASS = read("theme-glass.css");
const CSS = `${GLOBALS}\n${GLASS}`;

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

/** The one rule body for a selector that has exactly one. */
function ruleFor(selector: string): string {
  const bodies = rulesFor(selector);
  expect(bodies, `expected exactly one rule for ${selector}`).toHaveLength(1);
  return bodies[0] as string;
}

/** A border on one side, 3px or thicker: the accent stripe shape. */
const ACCENT_STRIPE = /border-(left|right|top|bottom):\s*(?:[3-9]|[1-9]\d)px/;

/** Panels that used to carry a stripe, and what carries their meaning instead. */
const PANELS: ReadonlyArray<{ selector: string; instead: string }> = [
  // Explore notes and empty states: a Golden Hour tint says "read this".
  {
    selector: ".og-explore__note,\n.og-explore__empty,\n.og-explore-status",
    instead: "background: color-mix(in srgb, var(--og-paper) 82%, var(--og-golden-hour))",
  },
  // Other versions of a ride: the heading and the paper block group them.
  { selector: ".og-route-detail__variants", instead: "background: var(--og-paper)" },
  // Long-trip considerations: severity is a leading dot.
  { selector: ".og-preparation__consideration", instead: "--og-consideration-tone: var(--og-slate)" },
  // An avoid-area contradiction: the Ember tint and the badge say so.
  {
    selector: ".og-avoid-conflict",
    instead: "background: color-mix(in srgb, var(--og-ember) 8%, var(--og-paper))",
  },
  // The ride sheet's status line: its tone tints the pill.
  {
    selector: ".og-ride__detour-status",
    instead: "background: color-mix(in srgb, var(--og-signal-blue) 18%, var(--og-ride-surface))",
  },
  // A place card: the live dot and the "when" line carry the state.
  { selector: ".og-places-overlay--planner .og-places-card", instead: "background: var(--og-paper)" },
  // A layer card: the layer's glyph carries its colour.
  { selector: ".og-info-card", instead: "background: var(--og-paper)" },
  // My rides' notice, and Explore's empty list: a hairline and a shadow.
  { selector: ".og-library__state--notice", instead: "box-shadow: var(--og-shadow-2)" },
  { selector: ".og-explore__empty:not(.og-empty-state)", instead: "box-shadow: var(--og-shadow-1)" },
  // File-marked hazards: a Danger tint plus a Danger-coloured lead-in.
  {
    selector: ".og-route-story__hazards",
    instead: "background: color-mix(in srgb, var(--og-danger) 10%, var(--og-paper))",
  },
];

describe("design tells — no accent stripe down the side of a card", () => {
  it.each(PANELS)("$selector keeps its meaning without a stripe", ({ selector, instead }) => {
    const bodies = rulesFor(selector);
    for (const body of bodies) expect(body).not.toMatch(ACCENT_STRIPE);
    expect(bodies.some((body) => body.includes(instead))).toBe(true);
  });

  it("keeps the severity of a long-trip consideration on its dot", () => {
    expect(ruleFor(".og-preparation__consideration::before")).toMatch(
      /background:\s*var\(--og-consideration-tone\)/,
    );
    for (const [severity, tone] of [
      ["info", "--og-success"],
      ["watch", "--og-golden-text"],
      ["critical", "--og-ember-text"],
    ] as const) {
      const body = ruleFor(`.og-preparation__consideration[data-severity="${severity}"]`);
      expect(body, severity).toContain(`--og-consideration-tone: var(${tone})`);
      expect(body, severity).not.toMatch(/border-/);
    }
    // A tint is not the only signal: the label and reason are text either way.
    expect(ruleFor(".og-preparation__consideration p")).toContain("color: var(--og-deep-spruce)");
  });

  it("keeps the ride sheet's tones as a tint, not a side stripe", () => {
    for (const tone of ["done", "error"] as const) {
      const body = ruleFor(`.og-ride__detour-status[data-tone="${tone}"]`);
      expect(body, tone).toContain("background: color-mix(");
      expect(body, tone).not.toMatch(ACCENT_STRIPE);
    }
  });

  it("draws the start pin's arrow as a shape, not a border trick", () => {
    const body = ruleFor(".og-point__pin--start::before");
    expect(body).toContain("clip-path: polygon(0 0, 100% 50%, 0 100%)");
    expect(body).not.toMatch(/border-/);
  });

  it("colours the hazards' lead-in in Danger", () => {
    expect(ruleFor(".og-route-story__hazards strong")).toContain("color: var(--og-danger)");
  });
});

describe("typography — no stragglers", () => {
  it("gives body copy a pretty last line and headings balanced lines", () => {
    expect(ruleFor("p")).toContain("text-wrap: pretty");
    const headings = rulesFor("h1,\nh2,\nh3");
    expect(headings.some((body) => body.includes("text-wrap: balance"))).toBe(true);
  });
});
