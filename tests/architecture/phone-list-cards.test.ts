import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lists on a phone (design system v2 §4).
 *
 * The card that clipped at 320px read "Est. Mostly paved · 4.7 mi gra": pill
 * badges in a row that could not wrap. This asserts the shape that replaced it,
 * from the stylesheet that actually ships — the map image is 16:9 full width,
 * the name clamps to two lines, the facts are one wrapping line, and the chip
 * row scrolls sideways instead of shrinking its targets.
 */

const FILES = ["globals.css", "theme-glass.css"] as const;

/** The stylesheet with comments removed, so prose cannot satisfy a selector. */
function sourceOf(file: (typeof FILES)[number]): string {
  return readFileSync(resolve(__dirname, "../../src/app", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

interface Rule {
  readonly selector: string;
  readonly body: string;
}

function rulesOf(source: string): Rule[] {
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    rules.push({ selector: (match[1] ?? "").trim(), body: match[2] ?? "" });
  }
  return rules;
}

function allRules(): Rule[] {
  return FILES.flatMap((file) => rulesOf(sourceOf(file)));
}

function declaration(body: string, property: string): string | null {
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    if (part.slice(0, colon).trim() !== property) continue;
    return part.slice(colon + 1).trim().replace(/\s+/g, " ");
  }
  return null;
}

/** Every declaration any rule gives one exact selector, as later rules would. */
function declarationsFor(selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const rule of allRules()) {
    if (!rule.selector.split(",").map((part) => part.trim()).includes(selector)) continue;
    for (const part of rule.body.split(";")) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      const property = part.slice(0, colon).trim();
      if (property !== "") declarations[property] = part.slice(colon + 1).trim().replace(/\s+/g, " ");
    }
  }
  return declarations;
}

describe("ride cards on a phone", () => {
  it("frames the route's map 16:9 at full width, with square text under it", () => {
    const preview = declarationsFor(".og-explore-card--ride .og-explore-card__preview");
    expect(preview["aspect-ratio"]).toBe("16 / 9");
    expect(preview["border-radius"]).toBe("var(--og-radius-object)");
    // The words sit on the page, not in a second box inside the card.
    expect(declarationsFor(".og-explore-card--ride .og-explore-card__body")["padding"]).toBe("var(--og-space-2) 0 0");
  });

  it("keeps the name to two lines at body size", () => {
    expect(declarationsFor(".og-explore-card__title")["-webkit-line-clamp"]).toBe("2");
    const title = declarationsFor(".og-explore-card--ride .og-explore-card__title");
    expect(title["font-size"]).toBe("var(--og-text-body)");
    expect(title["font-weight"]).toBe("600");
  });

  it("wraps the facts instead of clipping them", () => {
    // The bug: a nowrap, overflow-hidden row of pills cut "Est. Mostly paved ·
    // 4.7 mi gra" at 320px. Neither the facts line nor the credit may nowrap.
    const facts = declarationsFor(".og-explore-card__facts");
    expect(facts["flex-wrap"]).toBe("wrap");
    for (const selector of [".og-explore-card__facts", ".og-explore-card__fact", ".og-explore-card__credit"]) {
      for (const rule of allRules()) {
        if (!rule.selector.split(",").map((part) => part.trim()).includes(selector)) continue;
        expect(declaration(rule.body, "white-space"), selector).not.toBe("nowrap");
        expect(declaration(rule.body, "text-overflow"), selector).not.toBe("ellipsis");
        expect(declaration(rule.body, "overflow"), selector).not.toBe("hidden");
      }
    }
  });

  it("scrolls the chip row sideways with a 48px target on every chip", () => {
    const row = allRules().find((rule) => rule.selector === ".og-explore__quick");
    expect(row).toBeDefined();
    expect(declaration(row!.body, "overflow-x")).toBe("auto");
    expect(declaration(row!.body, "flex-wrap")).toBeNull();
    const chip = declarationsFor(".og-explore__quick-chip");
    expect(Number.parseInt(chip["min-height"] ?? "0", 10)).toBeGreaterThanOrEqual(48);
    expect(declaration(row!.body, "scroll-padding-inline")).toBe("14px");
  });
});
