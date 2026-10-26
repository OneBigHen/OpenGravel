/**
 * Contrast contract for the design v3 tokens (DESIGN.md §4): body text 4.5:1,
 * ride numbers 7:1, meaningful graphics 3:1, in Day and in Night. Reads the
 * real tokens.css so the matrix cannot drift from what ships.
 */

import { describe, expect, it } from "vitest";
import { tokensCss } from "../../helpers/app-css";

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

const CSS = tokensCss();

function theme(name: "day" | "night"): Map<string, string> {
  const selector = name === "day" ? /:root,\s*:root\[data-theme="day"\]\s*\{([^}]*)\}/ : /:root\[data-theme="night"\]\s*\{([^}]*)\}/;
  const body = selector.exec(CSS)?.[1] ?? "";
  const values = new Map<string, string>();
  for (const match of body.matchAll(/(--og-[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) values.set(match[1] as string, (match[2] as string).toLowerCase());
  return values;
}

const THEMES = { day: theme("day"), night: theme("night") } as const;

describe.each(["day", "night"] as const)("contrast — %s", (name) => {
  const t = THEMES[name];
  const get = (token: string): string => {
    const value = t.get(token);
    expect(value, `${token} must be a hex token in the ${name} block`).toBeDefined();
    return value as string;
  };
  const surfaces = ["--og-bg", "--og-surface", "--og-surface-2"];

  it("text tokens clear 4.5:1 on every surface", () => {
    for (const text of ["--og-ink", "--og-ink-2", "--og-primary-text", "--og-danger", "--og-warn"]) {
      for (const surface of surfaces) {
        expect(contrastRatio(get(text), get(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("ride numbers (ink) clear 7:1 on the surface", () => {
    expect(contrastRatio(get("--og-ink"), get("--og-surface"))).toBeGreaterThanOrEqual(7);
  });

  it("the label on a primary fill clears 4.5:1", () => {
    expect(contrastRatio(get("--og-on-primary"), get("--og-primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("the chosen route and the recording colour read as graphics (3:1)", () => {
    for (const graphic of ["--og-route", "--og-record", "--og-primary"]) {
      expect(contrastRatio(get(graphic), get("--og-surface")), graphic).toBeGreaterThanOrEqual(3);
    }
  });

  it("never uses pure black or pure white for a surface", () => {
    for (const surface of surfaces) expect(["#000000", "#ffffff"]).not.toContain(get(surface));
  });
});
