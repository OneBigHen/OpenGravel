import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Explore's toolbar at every width.
 *
 * On a wide screen the first two rows used to be six selects, an unlabelled
 * checkbox and the date chips, which pushed the rides down the page. The
 * toolbar is now the phone's row — search, the distance chips and one Filters
 * button — and the rest is a popover that only exists while it is open. These
 * assertions read the stylesheets that actually ship, because a component test
 * cannot see which rule wins.
 */

const FILES = ["globals.css", "theme-glass.css"] as const;

interface Rule {
  readonly selector: string;
  readonly body: string;
  /** The enclosing `@media` condition, or null at the root. */
  readonly media: string | null;
}

/** The stylesheet with comments removed, so prose cannot satisfy a selector. */
function sourceOf(file: (typeof FILES)[number]): string {
  return readFileSync(resolve(__dirname, "../../src/app", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Rules with the media query they sit in, so a wide-screen rule is provable. */
function rulesOf(source: string): Rule[] {
  const rules: Rule[] = [];
  const frames: { readonly head: string; readonly media: string | null; readonly at: boolean }[] = [];
  let pending = "";

  for (const char of source) {
    if (char === "{") {
      const head = pending.trim();
      pending = "";
      if (head.startsWith("@")) {
        const inherited = frames.at(-1)?.media ?? null;
        frames.push({ head, media: head.startsWith("@media") ? head.slice("@media".length).trim() : inherited, at: true });
      } else {
        frames.push({ head, media: frames.at(-1)?.media ?? null, at: false });
      }
      continue;
    }
    if (char === "}") {
      const closed = frames.pop();
      if (closed !== undefined && !closed.at && closed.head !== "") {
        rules.push({ selector: closed.head, body: pending, media: closed.media });
      }
      pending = "";
      continue;
    }
    pending += char;
  }
  return rules;
}

function allRules(): Rule[] {
  return FILES.flatMap((file) => rulesOf(sourceOf(file)));
}

function declaration(body: string, property: string): string | null {
  let value: string | null = null;
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    if (part.slice(0, colon).trim() !== property) continue;
    value = part.slice(colon + 1).trim().replace(/\s+/g, " ");
  }
  return value;
}

function selectorsOf(rule: Rule): string[] {
  return rule.selector.split(",").map((part) => part.trim());
}

/** Every rule that styles one exact selector, in file order. */
function rulesFor(selector: string): Rule[] {
  return allRules().filter((rule) => selectorsOf(rule).includes(selector));
}

function wide(rule: Rule): boolean {
  return rule.media !== null && rule.media.includes("min-width: 761px");
}

describe("Explore's filter toolbar", () => {
  it("shows the chips and the Filters button at every width, on 48px targets", () => {
    // The chip row is not a phone-only extra any more: it is the browse row.
    const chips = rulesFor(".og-explore__toolbar > .og-explore__quick");
    expect(chips.some((rule) => rule.media === null && declaration(rule.body, "display") === "flex")).toBe(true);

    // Nothing hides the chip row or the button that opens the rest.
    for (const rule of allRules()) {
      const hides = declaration(rule.body, "display") === "none";
      if (!hides) continue;
      const targets = selectorsOf(rule).filter((selector) => !selector.includes("::"));
      expect(targets.filter((selector) => selector.includes(".og-explore__quick"))).toEqual([]);
      expect(targets.filter((selector) => selector.includes(".og-explore__filters-toggle"))).toEqual([]);
    }

    const toggle = rulesFor(".og-explore .og-explore__filters-toggle.og-explore__filters-toggle")
      .filter((rule) => rule.media === null);
    expect(toggle).toHaveLength(1);
    expect(declaration(toggle[0]!.body, "display")).toBe("inline-flex");
    expect(Number.parseInt(declaration(toggle[0]!.body, "min-height") ?? "0", 10)).toBeGreaterThanOrEqual(48);
  });

  it("puts search on its own row, with the chips — Filters last — under it", () => {
    // At 320px search and the Filters button shared one grid row, which left
    // the field about 130px wide ("Search re…"). Search spans the toolbar and
    // the chips, Filters included, are the row below it.
    const toolbar = allRules().filter((rule) => rule.media === null
      && selectorsOf(rule).includes(".og-explore__toolbar"));
    expect(toolbar).toHaveLength(1);
    expect(declaration(toolbar[0]!.body, "grid-template-areas")).toBe('"search" "quick"');
    expect(declaration(toolbar[0]!.body, "grid-template-columns")).toBe("minmax(0, 1fr)");
  });

  it("puts search, the chips and Filters on one line once the screen is wide enough", () => {
    const oneLine = allRules().filter((rule) =>
      rule.media !== null
      && rule.media.includes("min-width: 1181px")
      && selectorsOf(rule).includes(".og-explore .og-explore__toolbar"));
    expect(oneLine).toHaveLength(1);
    expect(declaration(oneLine[0]!.body, "grid-template-areas")).toBe('"search quick"');
  });

  it("opens the remaining filters as a popover that is not there while closed", () => {
    const panel = allRules().filter((rule) => wide(rule)
      && selectorsOf(rule).includes(".og-explore .og-explore__toolbar > .og-explore__controls"));
    expect(panel).toHaveLength(1);
    // Beside the toolbar, over the list: no second and third row of controls.
    expect(declaration(panel[0]!.body, "position")).toBe("absolute");
    expect(declaration(panel[0]!.body, "right")).toBe("0");
    expect(declaration(panel[0]!.body, "grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))");
    expect(declaration(panel[0]!.body, "box-shadow")).toBe("var(--og-shadow-2)");

    // Shut, it renders nothing at all.
    const closed = allRules().filter((rule) => wide(rule)
      && selectorsOf(rule).includes('.og-explore .og-explore__toolbar > .og-explore__controls[data-open="false"]'));
    expect(closed).toHaveLength(1);
    expect(declaration(closed[0]!.body, "display")).toBe("none");
  });

  it("keeps every field's caption inside the popover instead of trusting the option", () => {
    const labels = allRules().filter((rule) => wide(rule)
      && selectorsOf(rule).includes(".og-explore .og-explore__toolbar > .og-explore__controls label"));
    expect(labels).toHaveLength(1);
    // A caption is only useful if it is painted.
    expect(declaration(labels[0]!.body, "display")).toBe("grid");
    expect(declaration(labels[0]!.body, "position")).not.toBe("absolute");
  });
});
