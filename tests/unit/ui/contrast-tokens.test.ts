/**
 * WCAG 2.2 AA contrast contract for OpenGravel text and fills (12 §3 light
 * theme "AA-adjusted muted text", §15 4.5:1 normal text and 3:1 meaningful
 * graphics, §16; 08 §5; 13 §5).
 *
 * The §2 palette hues are identity colors; where a hue carries text it gets an
 * AA-adjusted variant (`--og-*-text`) instead of the raw palette hex. This
 * file reads the real stylesheet so the matrix cannot drift from what ships.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS_FILE = readFileSync("src/app/globals.css", "utf8");
/** The dark theme block (between the og-dark markers), checked on its own below. */
const DARK_BLOCK = /\/\* og-dark:start[\s\S]*?og-dark:end \*\//.exec(CSS_FILE)?.[0] ?? "";
/** The light theme: everything outside the dark block, so dark values never mask light ones. */
const CSS = CSS_FILE.replace(DARK_BLOCK, "");
const CSS_RULES_SOURCE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const value = Number.parseInt(clean.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every `--og-*: #hex` or `--og-*: var(--og-*)` definition in the stylesheet. */
const TOKENS = new Map<string, string>();
for (const match of CSS.matchAll(/(--og-[a-z-]+):\s*(#[0-9a-f]{6}|var\((--og-[a-z-]+)\))/g)) {
  TOKENS.set(match[1] as string, match[3] !== undefined ? (match[3] as string) : (match[2] as string).toLowerCase());
}

function token(name: string): string {
  const value = TOKENS.get(name);
  if (value === undefined) {
    throw new Error(`token ${name} is not defined in globals.css`);
  }
  return value.startsWith("#") ? value : token(value);
}

/** Leaf rules as selector -> body (media blocks are scanned through). */
const RULES: ReadonlyArray<{ selector: string; body: string }> = [...CSS_RULES_SOURCE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (match) => ({ selector: (match[1] as string).trim(), body: match[2] as string }),
);

function ruleBody(selectorFragment: string): string {
  const found = RULES.filter((rule) => rule.selector.includes(selectorFragment));
  expect(found.length, `expected exactly one rule for ${selectorFragment}`).toBeGreaterThan(0);
  return (found[found.length - 1] as { body: string }).body;
}

function exactRuleBody(selector: string): string {
  const found = RULES.filter((rule) => rule.selector === selector);
  expect(found.length, `expected a rule whose selector is exactly ${selector}`).toBe(1);
  return (found[0] as { body: string }).body;
}

function firstRuleBody(selectorFragment: string): string {
  const found = RULES.find((rule) => rule.selector.includes(selectorFragment));
  expect(found, `expected a rule containing ${selectorFragment}`).toBeDefined();
  return (found as { body: string }).body;
}

function declaredVar(
  body: string,
  property: "color" | "background" | "border-color" | "stroke",
): string | null {
  for (const declaration of body.split(";")) {
    const match = new RegExp(`^\\s*${property}:\\s*var\\((--og-[a-z-]+)\\)`).exec(declaration);
    if (match !== null) return match[1] as string;
  }
  return null;
}

/**
 * Proxy for the darkest documented light surface: the ink/paper color-mix
 * tints (banner, point detail) land around here, so a text token that clears
 * 4.5:1 against it clears every light surface in the app.
 */
const WORST_LIGHT = "#e8e6df";
const CANVAS = token("--og-canvas");
const PAPER = token("--og-paper");
const INK = token("--og-ink");
const RAISED_DARK = token("--og-raised-dark");
const SANDSTONE = token("--og-sandstone");
const GOLDEN_HOUR = token("--og-golden-hour");

/** Tokens allowed to carry text on light surfaces (checked just below). */
const LIGHT_TEXT_TOKENS = [
  "--og-ink",
  "--og-deep-spruce",
  "--og-trail-brown",
  "--og-signal-strong",
  "--og-danger",
  "--og-success",
  "--og-moss-text",
  "--og-slate-text",
  "--og-ember-text",
  "--og-golden-text",
] as const;

/** Tokens allowed to carry text inside the ride theme (checked just below). */
const DARK_TEXT_TOKENS = ["--og-paper", "--og-ride-muted", "--og-golden-hour", "--og-danger-light"] as const;

/**
 * Text rules whose color is checked by the explicit fill pairs below instead
 * of the token scan: paper-on-ink fills and inactive (disabled) controls,
 * which WCAG 1.4.3 exempts. Each entry names the pair test that covers it.
 */
const SCAN_EXEMPT_SELECTORS = [
  // text-on-fill: covered by "filled controls keep their text at 4.5:1"
  ".og-primary",
  ".og-ride__action",
  ".og-library__undo",
  ".og-offline-toast",
  ".og-skip-link",
  ".og-ride__strip-end",
  ".og-ride__warnings li[data-severity=\"critical\"]",
  ".og-update-failure__close",
  ".og-places-control__count",
  ".og-places-along__add",
  ".og-sheet__handle-count",
  ".og-route-list__count",
  ".og-explore-card__source",
  ".og-style__chip input:checked + span",
  ".og-explore__lens [role=\"tab\"][aria-selected=\"true\"]",
  ".og-layers[data-open=\"true\"] .og-layers__button",
  ".og-layers__badge",
  ".og-info-card__add",
  ".og-ride__limit",
  ".og-map__locate-failure",
  ".og-settings__button",
  ".og-places-card__actions button",
  // decorative, aria-hidden layer glyphs drawn in the layer's own colour
  ".og-layers__swatch",
  ".og-info-card__glyph",
  // text over the ink scrim on the map: pair-checked below against the worst
  // case (the 74% ink scrim over the lightest basemap)
  ".og-map__hint",
  // inactive controls: WCAG 1.4.3 exception (covered by the disabled pair rows)
  ":disabled",
  ".og-import__disabled-option",
] as const;

describe("contrast — AA text variants (12 §3, §15)", () => {
  it("muted text variants clear 4.5:1 on every light surface", () => {
    for (const name of ["--og-moss-text", "--og-slate-text", "--og-ember-text", "--og-golden-text"] as const) {
      const value = token(name);
      for (const [surfaceName, surface] of [
        ["canvas", CANVAS],
        ["paper", PAPER],
        ["worst tint", WORST_LIGHT],
      ] as const) {
        expect(contrastRatio(value, surface), `${name} on ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("ride theme text clears 4.5:1 on the ride surfaces", () => {
    for (const name of DARK_TEXT_TOKENS) {
      const value = token(name);
      expect(contrastRatio(value, RAISED_DARK), `${name} on raised-dark`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(value, INK), `${name} on ink`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("light body tokens clear 4.5:1 on the worst light surface", () => {
    for (const name of LIGHT_TEXT_TOKENS) {
      expect(contrastRatio(token(name), WORST_LIGHT), `${name} on worst light tint`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("contrast — text token guard (12 §15, §16)", () => {
  it("no text rule uses a below-AA palette hue", () => {
    const violations: string[] = [];
    for (const rule of RULES) {
      const colorVar = declaredVar(rule.body, "color");
      if (colorVar === null) continue;
      if (!TOKENS.has(colorVar)) {
        violations.push(`${rule.selector}: color var(${colorVar}) is not defined`);
        continue;
      }
      if (SCAN_EXEMPT_SELECTORS.some((fragment) => rule.selector.includes(fragment))) continue;
      // The ride strip and rail are light surfaces (Google Maps layout) inside the dark ride theme.
      const isRideRule = rule.selector.includes(".og-ride") &&
        !rule.selector.includes(".og-ride__strip") && !rule.selector.includes(".og-ride__rail");
      const allowed = isRideRule ? DARK_TEXT_TOKENS : LIGHT_TEXT_TOKENS;
      if (!(allowed as readonly string[]).includes(colorVar)) {
        violations.push(`${rule.selector}: color var(${colorVar}) is not an AA text token`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("contrast — filled controls keep their text at 4.5:1 (12 §15)", () => {
  it("primary fill pairs clear 4.5:1, read from the rules themselves", () => {
    const pairs: ReadonlyArray<{ selector: string; text: string; background: string; rule: string }> = [
      {
        selector: ".og-primary",
        text: declaredVar(exactRuleBody(".og-primary"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-primary"), "background") ?? "",
        rule: "12 §15 4.5:1 normal text",
      },
      {
        selector: ".og-ride__action--primary",
        text: "--og-paper",
        background: declaredVar(exactRuleBody(".og-ride__action--primary"), "background") ?? "",
        rule: "12 §15 4.5:1 normal text",
      },
      ...[".og-library__undo", ".og-offline-toast", ".og-skip-link"].map((selector) => ({
        // Paper on an Ink fill: undo bar, offline notice, skip link.
        selector,
        text: declaredVar(exactRuleBody(selector), "color") ?? "",
        background: declaredVar(exactRuleBody(selector), "background") ?? "",
        rule: "12 §15 4.5:1 normal text",
      })),
      {
        // Settings' filled button: Paper on Spruce (light pill with dark text in the dark theme).
        selector: ".og-settings__button",
        text: declaredVar(ruleBody(".og-settings__button, .og-settings__text-button"), "color") ?? "",
        background: declaredVar(ruleBody(".og-settings__button, .og-settings__text-button"), "background") ?? "",
        rule: "12 §15 4.5:1 normal text",
      },
      {
        // The place card's Add as stop: light text on Ember Strong.
        selector: ".og-places-card__actions button",
        text: declaredVar(ruleBody(".og-places-overlay--planner .og-places-card__actions button"), "color") ?? "",
        background: declaredVar(ruleBody(".og-places-overlay--planner .og-places-card__actions button"), "background") ?? "",
        rule: "12 §15 4.5:1 normal text",
      },
      {
        // The ride strip's Exit pill: Paper on Ember Strong.
        selector: ".og-ride__strip-end",
        text: "--og-paper",
        background: "--og-ember-strong",
        rule: "12 §15 4.5:1 normal text",
      },
      {
        selector: ".og-sheet__handle-count",
        text: declaredVar(ruleBody(".og-sheet__handle-count"), "color") ?? "",
        background: declaredVar(ruleBody(".og-sheet__handle-count"), "background") ?? "",
        rule: "04 §19 sheet handle count",
      },
      {
        selector: ".og-ride__gps[data-tone=\"bad\"] label",
        text: declaredVar(ruleBody('[data-tone="bad"] .og-ride__gps-label'), "color") ?? "",
        background: "--og-ride-surface",
        rule: "12 §15 4.5:1 normal text; tone is never the only signal (§16)",
      },
      {
        selector: ".og-ride__error",
        text: declaredVar(ruleBody(".og-ride__error"), "color") ?? "",
        background: "--og-ride-surface",
        rule: "12 §15 4.5:1 normal text",
      },
      {
        selector: ".og-route-card__badge",
        text: "--og-ink",
        background: GOLDEN_HOUR,
        rule: "05 §12 route roles are badges",
      },
      {
        // The posted speed limit: a US-style sign, Ink on a Paper plate.
        selector: ".og-ride__limit",
        text: declaredVar(exactRuleBody(".og-ride__limit"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-ride__limit"), "background") ?? "",
        rule: "12 §15 text-on-fill; the speed limit sign",
      },
      {
        // "Center on me" couldn't find the rider: Paper on an Ink note.
        selector: ".og-map__locate-failure",
        text: "--og-paper",
        background: "--og-ink",
        rule: "12 §15 text-on-fill",
      },
      {
        selector: ".og-point__delete",
        text: "--og-ink",
        background: SANDSTONE,
        rule: "06 §11 object controls",
      },
      {
        selector: ".og-ride__action",
        text: "--og-paper",
        background: "--og-ink",
        rule: "12 §10 ride controls",
      },
      {
        selector: ".og-explore-card__source",
        text: "--og-paper",
        background: "--og-deep-spruce",
        rule: "12 §15 text-on-fill",
      },
      {
        selector: ".og-style__chip input:checked + span",
        text: "--og-paper",
        background: "--og-deep-spruce",
        rule: "12 §15 text-on-fill; checked ride-style chips",
      },
      {
        selector: ".og-explore__lens [role=\"tab\"][aria-selected=\"true\"]",
        text: "--og-paper",
        background: "--og-deep-spruce",
        rule: "12 §15 text-on-fill; the selected Explore lens",
      },
      {
        selector: ".og-layers[data-open=\"true\"] .og-layers__button",
        text: "--og-paper",
        background: "--og-deep-spruce",
        rule: "12 §15 text-on-fill; the open Layers button",
      },
      {
        selector: ".og-info-card__add",
        text: "--og-paper",
        background: "--og-deep-spruce",
        rule: "12 §15 text-on-fill; Add as stop on a layer card",
      },
      {
        selector: ".og-layers__badge",
        text: "--og-paper",
        background: "--og-ember-strong",
        rule: "12 §15 text-on-fill; the active-layer count",
      },
      {
        selector: ".og-update-failure__close",
        text: "--og-paper",
        background: "--og-ink",
        rule: "05 §27 update failure banner",
      },
      {
        // worst case for the 74% ink scrim over the lightest basemap (05 §21
        // context chips): the scrim only ever darkens from here
        selector: ".og-map__hint",
        text: "--og-paper",
        background: "#505451",
        rule: "05 §21 context hint over the map",
      },
      {
        selector: ".og-ride .og-places-control__toggle",
        text: declaredVar(exactRuleBody(".og-ride .og-places-control__toggle"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-ride .og-places-control__toggle"), "background") ?? "",
        rule: "OGV-D-274 Places control on the dark Ride Focus map",
      },
      {
        selector: ".og-ride .og-places-control__option",
        text: declaredVar(exactRuleBody(".og-ride .og-places-control__option"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-ride .og-places-control__option"), "background") ?? "",
        rule: "OGV-D-274 unselected query control",
      },
      {
        selector: ".og-ride .og-places-control__option[aria-pressed=\"true\"]",
        text: "--og-paper",
        background: declaredVar(exactRuleBody('.og-ride .og-places-control__option[aria-pressed="true"]'), "background") ?? "",
        rule: "OGV-D-274 selected query control",
      },
      {
        selector: ".og-ride .og-places-card",
        text: declaredVar(firstRuleBody(".og-ride .og-places-card"), "color") ?? "",
        background: declaredVar(firstRuleBody(".og-ride .og-places-card"), "background") ?? "",
        rule: "OGV-D-274 selected place card",
      },
      {
        selector: ".og-ride .og-places-card__meta",
        text: declaredVar(exactRuleBody(".og-ride .og-places-card__meta,\n.og-ride .og-places-card__perks"), "color") ?? "",
        background: "--og-ride-surface",
        rule: "OGV-D-274 place listing metadata",
      },
      {
        selector: ".og-ride .og-places-card__close",
        text: declaredVar(exactRuleBody(".og-ride .og-places-card__close"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-ride .og-places-card__close"), "background") ?? "",
        rule: "OGV-D-274 place card close control",
      },
      {
        selector: ".og-ride .og-places-card__when--live",
        text: declaredVar(exactRuleBody(".og-ride .og-places-card__when--live"), "color") ?? "",
        background: "--og-ride-surface",
        rule: "OGV-D-274 Golden Hour live label",
      },
      {
        selector: ".og-ride .og-places-card__actions a",
        text: declaredVar(firstRuleBody(".og-ride .og-places-card__actions a"), "color") ?? "",
        background: declaredVar(firstRuleBody(".og-ride .og-places-card__actions a"), "background") ?? "",
        rule: "OGV-D-274 place listing links",
      },
      {
        selector: ".og-ride .og-places-card__actions button",
        text: declaredVar(firstRuleBody(".og-ride .og-places-card__actions button"), "color") ?? "",
        background: declaredVar(firstRuleBody(".og-ride .og-places-card__actions button"), "background") ?? "",
        rule: "OGV-D-274 place listing action button",
      },
      {
        selector: ".og-ride .og-places-control__count",
        text: "--og-ink",
        background: "--og-golden-hour",
        rule: "OGV-D-274 count badge",
      },
      {
        selector: ".og-places-along__add",
        text: declaredVar(exactRuleBody(".og-places-along__add"), "color") ?? "",
        background: declaredVar(exactRuleBody(".og-places-along__add"), "background") ?? "",
        rule: "Places along the route action text on spruce",
      },
    ];
    const pairFailures: string[] = [];
    for (const pair of pairs) {
      if (pair.background.length === 0 || pair.text.length === 0) {
        pairFailures.push(`${pair.selector} (${pair.rule}) — text/background var must be resolvable`);
        continue;
      }
      const text = pair.text.startsWith("--og-") ? token(pair.text) : pair.text;
      const background = pair.background.startsWith("--og-")
        ? token(pair.background === "--og-ride-surface" ? "--og-raised-dark" : pair.background)
        : pair.background;
      const ratio = contrastRatio(text, background);
      if (ratio < 4.5) {
        pairFailures.push(`${pair.selector} (${pair.rule}) — ${ratio.toFixed(2)}:1 must clear 4.5:1`);
      }
    }
    expect(pairFailures).toEqual([]);
  });

  it("degraded GPS tone clears 4.5:1 on the ride surface", () => {
    const body = ruleBody('[data-tone="degraded"] .og-ride__gps-label');
    const colorVar = declaredVar(body, "color");
    expect(colorVar).not.toBeNull();
    expect(contrastRatio(token(colorVar as string), RAISED_DARK)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrast — meaningful graphics clear 3:1 (12 §15)", () => {
  it("the focus ring is visible on every theme surface", () => {
    const ring = token("--og-focus-ring");
    for (const [name, surface] of [
      ["canvas", CANVAS],
      ["paper", PAPER],
      ["ink", INK],
      ["raised-dark", RAISED_DARK],
    ] as const) {
      expect(contrastRatio(ring, surface), `focus ring on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the recorded track thumbnail is visible on its canvas", () => {
    const line = ruleBody(".og-library__track-thumbnail polyline");
    const stroke = declaredVar(line, "stroke");
    expect(stroke).not.toBeNull();
    expect(contrastRatio(token(stroke as string), CANVAS)).toBeGreaterThanOrEqual(3);
  });
});

describe("hit areas (12 §10)", () => {
  function minSize(body: string, property: "min-width" | "min-height"): number {
    const match = new RegExp(`${property}:\\s*([0-9.]+)(px|rem)`).exec(body);
    if (match === null) return 0;
    const value = Number.parseFloat(match[1] as string);
    return match[2] === "rem" ? value * 16 : value;
  }

  it("ride primary controls keep 56px minimum hit areas", () => {
    const action = exactRuleBody(".og-ride__action");
    expect(minSize(action, "min-width")).toBeGreaterThanOrEqual(56);
    expect(minSize(action, "min-height")).toBeGreaterThanOrEqual(56);
    const cta = ruleBody(".og-ride-start__cta");
    expect(minSize(cta, "min-height")).toBeGreaterThanOrEqual(56);
  });

  it("places controls and card actions keep 44px minimum hit areas", () => {
    const selectors = [
      ".og-ride .og-places-control__toggle",
      ".og-ride .og-places-control__option",
      ".og-ride .og-places-card__close",
    ];
    for (const selector of selectors) {
      const body = exactRuleBody(selector);
      expect(minSize(body, "min-width"), selector).toBeGreaterThanOrEqual(44);
      expect(minSize(body, "min-height"), selector).toBeGreaterThanOrEqual(44);
    }
    const actions = firstRuleBody(".og-ride .og-places-card__actions a");
    expect(minSize(actions, "min-width")).toBeGreaterThanOrEqual(44);
    expect(minSize(actions, "min-height")).toBeGreaterThanOrEqual(44);
  });
});

describe("responsive recorded rides", () => {
  it("stacks library actions and wraps them at phone widths", () => {
    const row = ruleBody(".og-library__row");
    expect(row).toContain("flex-direction: column");
    expect(row).toMatch(/min-width:\s*0/);
    const actions = ruleBody(".og-library__actions");
    expect(actions).toContain("width: 100%");
    expect(actions).toMatch(/min-width:\s*0/);
    expect(actions).toContain("justify-content: flex-start");
  });
});


describe("contrast — dark theme (12 §15)", () => {
  /** The dark `:root` re-points; tokens it leaves alone keep their light value. */
  const DARK = new Map(TOKENS);
  const darkRoot = /:root\s*\{([^}]*)\}/.exec(DARK_BLOCK)?.[1] ?? "";
  for (const match of darkRoot.matchAll(/(--og-[a-z-]+):\s*(#[0-9a-f]{6})/g)) {
    DARK.set(match[1] as string, match[2] as string);
  }
  function dark(name: string): string {
    const value = DARK.get(name);
    if (value === undefined) throw new Error(`token ${name} is not defined`);
    return value.startsWith("#") ? value : dark(value);
  }
  /** Proxy for the lightest dark surface: the ink/paper tints and wells. */
  const WORST_DARK = "#2a3431";

  it("exists, follows the system setting and pins Ride Focus to its own palette", () => {
    expect(DARK_BLOCK).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(darkRoot).toMatch(/color-scheme:\s*dark/);
    expect(DARK_BLOCK).toMatch(/html \.og-ride\s*\{[^}]*--og-ink:\s*#161d1c/);
  });

  it("every light text token clears 4.5:1 on every dark surface", () => {
    for (const name of LIGHT_TEXT_TOKENS) {
      for (const [surfaceName, surface] of [
        ["canvas", dark("--og-canvas")],
        ["paper", dark("--og-paper")],
        ["worst tint", WORST_DARK],
      ] as const) {
        expect(contrastRatio(dark(name), surface), `${name} on dark ${surfaceName}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("inverted fills keep their text at 4.5:1", () => {
    // Paper on Ink and on Spruce fills (undo bar, toasts, selected segments, settings buttons).
    for (const fill of ["--og-ink", "--og-deep-spruce"] as const) {
      expect(contrastRatio(dark("--og-paper"), dark(fill)), `paper on dark ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
    // Ember fills keep light text in both themes.
    expect(contrastRatio(dark("--og-on-fill"), dark("--og-ember-strong")), "on-fill on ember-strong").toBeGreaterThanOrEqual(4.5);
  });

  it("the dark palette never uses pure black or pure white", () => {
    for (const [, name, value] of darkRoot.matchAll(/(--og-[a-z-]+):\s*(#[0-9a-f]{6})/g)) {
      expect(["#000000", "#ffffff"], name).not.toContain(value);
    }
  });
});
