/**
 * The surface strip speaks one language (QA-10).
 *
 * A rider read a route's surface bar and its legend and could not tell paved
 * from unknown: both were the same grey, and the legend had no unknown dot at
 * all. This test reads the shipped stylesheets and the shipped tokens, so the
 * bar, the legend and the "not measured" dot cannot drift apart again: paved is
 * one solid colour, unknown is a hatch in a different one, and both are the same
 * pair everywhere they are drawn.
 */

import { describe, expect, it } from "vitest";

import { appCss, tokensCss } from "../../helpers/app-css";
import { contrastRatio } from "../../helpers/contrast";

const CSS = appCss();
const TOKENS = tokensCss();

/** Every rule body whose selector names `fragment`, in file order. */
function rulesFor(fragment: string): string[] {
  const bodies: string[] = [];
  for (const match of CSS.matchAll(/(^|\n)([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
    if ((match[2] as string).includes(fragment)) bodies.push(match[3] as string);
  }
  expect(bodies.length, `expected a rule naming ${fragment}`).toBeGreaterThan(0);
  return bodies;
}

function themeTokens(name: "day" | "night"): Map<string, string> {
  const selector = name === "day" ? /:root,\s*:root\[data-theme="day"\]\s*\{([^}]*)\}/ : /:root\[data-theme="night"\]\s*\{([^}]*)\}/;
  const body = selector.exec(TOKENS)?.[1] ?? "";
  const values = new Map<string, string>();
  for (const match of body.matchAll(/(--og-[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) values.set(match[1] as string, (match[2] as string).toLowerCase());
  return values;
}

const THEMES = { day: themeTokens("day"), night: themeTokens("night") } as const;

describe.each(["day", "night"] as const)("surface strip colours — %s", (name) => {
  const tokens = THEMES[name];
  const token = (tokenName: string): string => {
    const value = tokens.get(tokenName);
    expect(value, `${tokenName} must be a hex token in the ${name} block`).toBeDefined();
    return value as string;
  };

  it("gives paved and unknown two different colours", () => {
    const paved = token("--og-surface-paved");
    const unknown = token("--og-surface-unknown");
    expect(paved).not.toBe(unknown);
    // Different enough to tell apart at a glance, not a shade of the same grey.
    expect(contrastRatio(paved, unknown)).toBeGreaterThanOrEqual(1.4);
  });

  it("draws each surface as a graphic that holds on the strip's track", () => {
    for (const surface of ["--og-surface-paved", "--og-surface-unknown"]) {
      expect(contrastRatio(token(surface), token("--og-surface-2")), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses those two colours in the bar and in the legend", () => {
    const paved = rulesFor('[data-surface="paved"]').join("\n");
    const unknown = rulesFor('[data-surface="unknown"]').join("\n");
    expect(paved).toContain("var(--og-surface-paved)");
    expect(unknown).toContain("var(--og-surface-unknown)");
    expect(rulesFor('.og-elevation__legend > [data-surface="paved"]::before').join("\n")).toContain("var(--og-surface-paved)");
    expect(rulesFor('.og-elevation__legend > [data-surface="unknown"]::before').join("\n")).toContain("var(--og-surface-unknown)");
  });

  it("keeps unknown a hatch everywhere, never a solid swatch", () => {
    const places = [
      '.og-route-card__strip > [data-surface="unknown"]',
      '.og-elevation__surface > [data-surface="unknown"]',
      '.og-elevation__legend > [data-surface="unknown"]::before',
      '.og-truth__dot[data-tone="unknown"]',
    ];
    for (const selector of places) {
      const body = rulesFor(selector).join("\n");
      expect(body, selector).toContain("repeating-linear-gradient");
      expect(body, selector).toContain("var(--og-surface-unknown)");
    }
  });
});
