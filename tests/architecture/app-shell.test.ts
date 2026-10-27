import { appCss, tokensCss } from "../helpers/app-css";
import { describe, expect, it } from "vitest";

/**
 * The phone app shell (small-screen design system v2 §1–§2).
 *
 * On a phone the tab bar is docked to the bottom edge — full width, solid paper,
 * a top hairline, 56px plus the home indicator's inset, 24px icons and 12px
 * labels — instead of the frosted capsule that floated over the map. It is
 * always visible on the pages that show it: only a running ride (which renders
 * no app bar at all) is without one, so the old "hide while the map moves"
 * behaviour must not come back. Page titles are left-aligned at the one title
 * size, on the 16px screen gutter.
 *
 * These are stylesheet contracts, so they are asserted on the effective cascade
 * of the phone media queries rather than on a rendered screenshot.
 */

/** Design v3: phones and tablets share the docked tab bar (DESIGN.md §4 breakpoints). */
const PHONE = "(max-width: 1180px) and (min-height: 501px)";
const PHONE_ONLY = "(max-width: 760px)";
/** The phone-and-tablet tier that owns the page/dock offsets. */
const COMPACT = "(max-width: 1180px) and (min-height: 501px)";

function sourceOf(): string {
  return appCss().replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

/** The contents of every exact `@media <query>` block, with nested braces kept. */
function mediaBlocks(source: string, query: string): string[] {
  const blocks: string[] = [];
  const needle = `@media ${query}`;
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return blocks;
    const open = source.indexOf("{", start);
    if (open === -1) return blocks;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    blocks.push(source.slice(open + 1, end - 1));
    from = end;
  }
}

/** The cascade a selector receives across the supplied blocks, in source order. */
function declarationsFor(blocks: readonly string[], selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const block of blocks) {
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (let match = rule.exec(block); match !== null; match = rule.exec(block)) {
      const selectors = (match[1] ?? "").split(",").map((part) => part.trim());
      if (!selectors.includes(selector)) continue;
      for (const declaration of (match[2] ?? "").split(";")) {
        const colon = declaration.indexOf(":");
        if (colon === -1) continue;
        const property = declaration.slice(0, colon).trim();
        if (property === "") continue;
        declarations[property] = declaration.slice(colon + 1).trim().replace(/\s+/g, " ");
      }
    }
  }
  return declarations;
}

function phoneBlocks(): string[] {
  return mediaBlocks(sourceOf(), PHONE);
}

function phoneOnlyBlocks(): string[] {
  return mediaBlocks(sourceOf(), PHONE_ONLY);
}

function compactBlocks(): string[] {
  return mediaBlocks(sourceOf(), COMPACT);
}


describe("phone tab bar", () => {
  it("is docked to the bottom edge on a glass surface with a top hairline", () => {
    const shell = declarationsFor(phoneBlocks(), ".og-planner__nav-shell");

    // Full width, flush with the bottom, and 56px plus the home indicator.
    expect(shell["position"]).toBe("fixed");
    expect(shell["inset"]).toBe("auto 0 0");
    expect(shell["min-height"]).toBe("calc(56px + var(--og-safe-bottom))");

    // Glass over the map (DESIGN.md §2, v3.1); a hairline separates it from the page.
    expect(shell["background"]).toBe("var(--og-glass)");
    expect(shell["border-top"]).toBe("1px solid var(--og-line)");
    expect(shell["backdrop-filter"]).toBe("var(--og-glass-blur)");
    expect(shell["box-shadow"]).toBeUndefined();
  });

  it("spaces every page and the planner dock by the bar's measured height", () => {
    const root = declarationsFor(phoneBlocks(), ":root");
    // The fallback is the bar itself; the measurement (PrimaryNav) keeps a
    // label row that has wrapped to two lines from overlapping the page.
    expect(root["--og-tabbar-h"]).toBe(
      "var(--og-tabbar-measured-h, calc(56px + var(--og-safe-bottom)))",
    );
    for (const selector of [".og-explore", ".og-library", ".og-settings"]) {
      expect(declarationsFor(compactBlocks(), selector)["padding-bottom"]).toBe(
        "calc(var(--og-tabbar-h) + var(--og-space-5))",
      );
    }
    expect(declarationsFor(compactBlocks(), ".og-planner .og-planner__dock")["inset"]).toBe(
      "auto 0 var(--og-tabbar-h)",
    );
  });

  it("draws 24px icons and 12px labels in targets at least 48px tall", () => {
    const tab = declarationsFor(phoneBlocks(), ".og-planner__nav a");
    expect(tab["min-height"]).toBe("56px");
    expect(tab["font-size"]).toBe("var(--og-text-caption)");

    const icon = declarationsFor(phoneBlocks(), ".og-nav__icon");
    expect(icon["width"]).toBe("24px");
    expect(icon["height"]).toBe("24px");

    const settings = declarationsFor(phoneBlocks(), ".og-planner__settings-link");
    expect(settings["min-height"]).toBe("56px");
  });

  it("never hides itself while the map moves", () => {
    // The bar is always there on the pages that have one; a running ride has no
    // app bar at all, so there is nothing to slide away.
    expect(sourceOf()).not.toContain('data-chrome="away"');
    expect(sourceOf()).not.toContain("--og-tabbar-glass");
  });
});

describe("page headers", () => {
  it("left-aligns Explore, My rides and Settings titles at the title size", () => {
    for (const selector of [".og-explore h1", ".og-library h1", ".og-settings__header h1"]) {
      const title = declarationsFor([sourceOf()], selector);
      expect(title["font-size"], selector).toBe("var(--og-text-title)");
      expect(title["font-weight"], selector).toBe("700");
      expect(title["text-align"] ?? "left", selector).toBe("left");
    }
  });

  it("puts those pages on the 16px screen gutter on a phone", () => {
    for (const selector of [".og-explore > :not(.og-appbar)", ".og-settings > :not(.og-appbar)"]) {
      const width = declarationsFor(phoneOnlyBlocks(), selector)["width"]
        ?? declarationsFor([sourceOf()], selector)["width"];
      expect(width, selector).toContain("2 * var(--og-space-4)");
    }
  });
});

describe("design system tokens", () => {
  it("defines the five type sizes and the spacing scale once, in tokens.css", () => {
    const tokens = tokensCss();
    for (const [name, value] of [
      ["--og-text-title", "28px"], ["--og-text-headline", "20px"], ["--og-text-body", "16px"],
      ["--og-text-meta", "14px"], ["--og-text-caption", "12px"],
      ["--og-space-1", "4px"], ["--og-space-2", "8px"], ["--og-space-3", "12px"],
      ["--og-space-4", "16px"], ["--og-space-5", "24px"], ["--og-space-6", "32px"],
    ] as const) {
      expect(tokens, name).toMatch(new RegExp(`${name}:\\s*${value};`));
    }
  });
});
