import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const FILES = ["globals.css", "theme-glass.css"] as const;
const PHONE =
  "(max-width: 760px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))";
const PHONE_ONLY = "(max-width: 760px)";
/** The phone-and-tablet tier that owns the page/dock offsets. */
const COMPACT =
  "(max-width: 1180px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))";

function sourceOf(file: (typeof FILES)[number]): string {
  return readFileSync(resolve(__dirname, "../../src/app", file), "utf8").replace(
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
  return FILES.flatMap((file) => mediaBlocks(sourceOf(file), PHONE));
}

function phoneOnlyBlocks(): string[] {
  return FILES.flatMap((file) => mediaBlocks(sourceOf(file), PHONE_ONLY));
}

function compactBlocks(): string[] {
  return FILES.flatMap((file) => mediaBlocks(sourceOf(file), COMPACT));
}

/**
 * A rule whose selector list carries commas inside a function — a plain
 * `:is(…) h1` cannot be looked up by splitting on every comma.
 */
function declarationsForSelector(
  blocks: readonly string[],
  selector: string,
): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const block of blocks) {
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (let match = rule.exec(block); match !== null; match = rule.exec(block)) {
      if ((match[1] ?? "").trim().replace(/\s+/g, " ") !== selector) continue;
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

describe("phone tab bar", () => {
  it("is docked to the bottom edge on a solid paper surface with a top hairline", () => {
    const shell = declarationsFor(phoneBlocks(), ".og-planner__nav-shell");

    // Full width, flush with the bottom, and 56px plus the home indicator.
    expect(shell["position"]).toBe("fixed");
    expect(shell["left"]).toBe("0");
    expect(shell["right"]).toBe("0");
    expect(shell["bottom"]).toBe("0");
    expect(shell["min-height"]).toBe("calc(56px + var(--og-safe-bottom))");
    expect(shell["border-radius"]).toBe("0");

    // Solid paper, not frosted glass: a hairline separates it from the page.
    expect(shell["background"]).toBe("var(--og-paper)");
    expect(shell["border-top"]).toBe("1px solid var(--og-hairline)");
    expect(shell["backdrop-filter"]).toBe("none");
    expect(shell["box-shadow"]).toBe("none");
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
        "calc(var(--og-tabbar-h) + 16px)",
      );
    }
    expect(declarationsFor(compactBlocks(), ".og-planner__dock")["bottom"]).toBe(
      "calc(var(--og-tabbar-h) + 6px)",
    );
  });

  it("draws 24px icons and 12px labels in targets at least 48px tall", () => {
    const shell = declarationsFor(phoneBlocks(), ".og-planner__nav-shell");
    expect(shell["font-size"]).toBe("var(--og-text-caption)");

    const tab = declarationsFor(phoneBlocks(), ".og-planner__nav a");
    expect(tab["min-height"]).toBe("48px");
    expect(tab["font-size"]).toBe("inherit");

    const icon = declarationsFor(phoneBlocks(), ".og-nav__icon");
    expect(icon["width"]).toBe("24px");
    expect(icon["height"]).toBe("24px");

    const settings = declarationsFor(phoneBlocks(), ".og-planner__settings-link");
    expect(settings["min-height"]).toBe("48px");
  });

  it("never hides itself while the map moves", () => {
    // The bar is always there on the pages that have one; a running ride has no
    // app bar at all, so there is nothing to slide away.
    for (const file of FILES) {
      expect(sourceOf(file)).not.toContain('data-chrome="away"');
      expect(sourceOf(file)).not.toContain("--og-tabbar-glass");
    }
  });
});

describe("phone page headers", () => {
  it("left-aligns Explore, My rides and Settings titles at the title size", () => {
    const title = declarationsForSelector(
      phoneOnlyBlocks(),
      ":is(.og-explore__heading, .og-library__header, .og-settings__header) h1",
    );
    expect(title["font-size"]).toBe("var(--og-text-title)");
    expect(title["font-weight"]).toBe("700");
    expect(title["line-height"]).toBe("1.15");
    expect(title["letter-spacing"]).toBe("0");
    expect(title["text-align"]).toBe("left");
  });

  it("puts those pages on the 16px screen gutter", () => {
    for (const selector of [".og-explore", ".og-library", ".og-settings"]) {
      expect(declarationsFor(phoneOnlyBlocks(), selector)["padding-inline"]).toBe(
        "var(--og-space-4)",
      );
    }
    // My rides centres its own column instead of padding the page.
    expect(
      declarationsFor(phoneOnlyBlocks(), ".og-library.og-library > :not(.og-appbar)")["width"],
    ).toBe("calc(100% - 2 * var(--og-space-4))");
  });
});

describe("design system tokens", () => {
  it("defines the five type sizes and the spacing scale in globals.css", () => {
    const root = /:root\s*\{([\s\S]*?)\}/.exec(sourceOf("globals.css"))?.[1] ?? "";
    const tokens: Record<string, string> = {};
    for (const declaration of root.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      const property = declaration.slice(0, colon).trim();
      if (property.startsWith("--og-text-") || property.startsWith("--og-space-")) {
        tokens[property] = declaration.slice(colon + 1).trim();
      }
    }
    expect(tokens["--og-text-title"]).toBe("28px");
    expect(tokens["--og-text-headline"]).toBe("20px");
    expect(tokens["--og-text-body"]).toBe("16px");
    expect(tokens["--og-text-meta"]).toBe("14px");
    expect(tokens["--og-text-caption"]).toBe("12px");
    expect(tokens["--og-space-1"]).toBe("4px");
    expect(tokens["--og-space-2"]).toBe("8px");
    expect(tokens["--og-space-3"]).toBe("12px");
    expect(tokens["--og-space-4"]).toBe("16px");
    expect(tokens["--og-space-5"]).toBe("24px");
    expect(tokens["--og-space-6"]).toBe("32px");
  });
});
