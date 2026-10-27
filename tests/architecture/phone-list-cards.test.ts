import { appCss } from "../helpers/app-css";
import { describe, expect, it } from "vitest";

/**
 * Lists on a phone (design system v2 §4).
 *
 * The card that clipped at 320px read "Est. Mostly paved · 4.7 mi gra": pill
 * badges in a row that could not wrap. This asserts the shape that replaced it,
 * from the stylesheet that actually ships. Glass v4 (owner 2026-10-27, "not
 * space efficient") made the card a compact row: a square 96px map thumbnail
 * beside the words, the name clamps to two lines, the facts clamp to two lines
 * instead of being cut mid-word, and the chip row scrolls sideways instead of
 * shrinking its targets.
 */


/** The stylesheet with comments removed, so prose cannot satisfy a selector. */
function sourceOf(): string {
  return appCss().replace(/\/\*[\s\S]*?\*\//g, "");
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
  return rulesOf(sourceOf());
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
  it("puts a square map thumbnail beside the words", () => {
    const preview = declarationsFor(".og-explore-card__preview");
    expect(preview["aspect-ratio"]).toBe("1");
  });

  it("keeps the name to two lines at body size", () => {
    const title = declarationsFor(".og-explore-card__title");
    expect(title["-webkit-line-clamp"]).toBe("2");
    expect(title["font-size"]).toBe("var(--og-text-body)");
    expect(title["font-weight"]).toBe("600");
  });

  it("lets the facts run to a second line instead of cutting them on the first", () => {
    // The bug: a nowrap, overflow-hidden row of pills cut "Est. Mostly paved ·
    // 4.7 mi gra" at 320px. The facts get two lines; the single facts are never
    // clipped on their own.
    const facts = declarationsFor(".og-explore-card__facts");
    expect(facts["-webkit-line-clamp"]).toBe("2");
    expect(facts["white-space"]).toBeUndefined();
    for (const selector of [".og-explore-card__fact"]) {
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
    expect(declaration(row!.body, "scroll-padding-inline")).toBe("var(--og-space-4)");
    // 40px to the eye, with a hit area 4px taller on each side: 48px to the thumb.
    expect(declarationsFor(".og-explore__quick-chip")["min-height"]).toBe("40px");
    expect(declarationsFor(".og-explore__quick-chip::before")["inset"]).toBe("-4px 0");
  });
});

/**
 * My rides reads as the same list as Explore (§4): a saved ride was a framed
 * row with a headline-sized rename field and five compact buttons, which at
 * 320px left the name and the buttons fighting for the same line.
 */
describe("saved rides on a phone", () => {
  const PHONE = "(max-width: 760px)";
  const phone = (selector: string): Record<string, string> => {
    const source = sourceOf();
    const out: Record<string, string> = {};
    let from = 0;
    for (;;) {
      const start = source.indexOf(`@media ${PHONE} {`, from);
      if (start === -1) return out;
      let depth = 0;
      let end = start;
      for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        if (source[end] === "}") { depth -= 1; if (depth === 0) break; }
      }
      for (const rule of rulesOf(source.slice(source.indexOf("{", start) + 1, end))) {
        if (!rule.selector.split(",").map((part) => part.trim()).includes(selector)) continue;
        for (const part of rule.body.split(";")) {
          const colon = part.indexOf(":");
          if (colon !== -1) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim().replace(/\s+/g, " ");
        }
      }
      from = end;
    }
  };

  it("leads with the ride's own map, in the same 16:9 slot Explore uses", () => {
    const thumb = phone(".og-rides__thumb");
    expect(thumb["aspect-ratio"]).toBe("16 / 9");
    expect(thumb["width"]).toBe("100%");
    expect(thumb["border-radius"]).toBe("var(--og-radius-card)");
    expect(phone(".og-rides__row-open")["flex-direction"]).toBe("column");
  });

  it("puts the words on the page instead of in a second box", () => {
    expect(phone(".og-library__list")["background"]).toBe("transparent");
    expect(phone(".og-library__row")["padding"]).toBe("0");
  });

  it("keeps the name at body size and every action at 48px", () => {
    expect(declarationsFor(".og-rides__row-title")["font-size"]).toBe("var(--og-text-body)");
    expect(declarationsFor(".og-rides__row-title")["font-weight"]).toBe("600");
    // Below 16px iOS zooms the page when the name is tapped to rename it.
    expect(declarationsFor(".og-rides__rename-field input")["font-size"] ?? "var(--og-text-body)").toBe("var(--og-text-body)");
    expect(declarationsFor(".og-rides__more")["width"]).toBe("var(--og-touch)");
    expect(declarationsFor(".og-rides__more")["height"]).toBe("var(--og-touch)");
  });
});

