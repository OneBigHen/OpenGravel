import { appCss } from "../helpers/app-css";
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


interface Rule {
  readonly selector: string;
  readonly body: string;
  /** The enclosing `@media` condition, or null at the root. */
  readonly media: string | null;
}

/** The stylesheet with comments removed, so prose cannot satisfy a selector. */
function sourceOf(): string {
  return appCss().replace(/\/\*[\s\S]*?\*\//g, "");
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
  return rulesOf(sourceOf());
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
    // The chip row is not a phone-only extra: it is the browse row.
    const chips = rulesFor(".og-explore__quick");
    expect(chips.some((rule) => rule.media === null && declaration(rule.body, "display") === "flex")).toBe(true);

    // Nothing hides the chip row or the button that opens the rest.
    for (const rule of allRules()) {
      if (declaration(rule.body, "display") !== "none") continue;
      const targets = selectorsOf(rule).filter((selector) => !selector.includes("::"));
      expect(targets.filter((selector) => selector.includes(".og-explore__quick"))).toEqual([]);
      expect(targets.filter((selector) => selector.includes(".og-explore__filters-toggle"))).toEqual([]);
    }

    // Filters is the last chip: 40px to the eye, a 48px hit area.
    const chip = rulesFor(".og-explore__quick-chip").filter((rule) => rule.media === null);
    expect(chip.some((rule) => declaration(rule.body, "display") === "inline-flex")).toBe(true);
    expect(chip.some((rule) => declaration(rule.body, "min-height") === "40px")).toBe(true);
    const hit = rulesFor(".og-explore__quick-chip::before");
    expect(hit.some((rule) => declaration(rule.body, "inset") === "-4px 0")).toBe(true);
  });

  it("puts search on its own row, with the chips — Filters last — under it", () => {
    // At 320px search and Filters once shared a row and left the field about
    // 130px wide. The toolbar is one column; search, then the chip row.
    const toolbar = allRules().filter((rule) => rule.media === null
      && selectorsOf(rule).includes(".og-explore__toolbar"));
    expect(toolbar).toHaveLength(1);
    expect(declaration(toolbar[0]!.body, "grid-template-columns")).toBe("minmax(0, 1fr)");
  });

  it("puts search, the chips and Filters on one line once the screen is wide enough", () => {
    const oneLine = allRules().filter((rule) =>
      rule.media !== null
      && rule.media.includes("min-width: 1181px")
      && selectorsOf(rule).includes(".og-explore__toolbar"));
    expect(oneLine).toHaveLength(1);
    expect(declaration(oneLine[0]!.body, "grid-template-columns")).toBe("minmax(0, 420px) minmax(0, 1fr)");
  });

  it("opens the remaining filters as a popover that is not there while closed", () => {
    const panel = allRules().filter((rule) => wide(rule)
      && selectorsOf(rule).includes('.og-explore__toolbar > .og-explore__controls[data-open="true"]'));
    expect(panel).toHaveLength(1);
    // Beside the toolbar, over the list: no second and third row of controls.
    expect(declaration(panel[0]!.body, "position")).toBe("absolute");
    expect(declaration(panel[0]!.body, "right")).toBe("0");
    expect(declaration(panel[0]!.body, "box-shadow")).toBe("var(--og-shadow-float)");
    const open = allRules().filter((rule) => rule.media === null
      && selectorsOf(rule).includes('.og-explore__controls[data-open="true"]'));
    expect(declaration(open[0]!.body, "grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))");

    // Shut, it renders nothing at all.
    const closed = allRules().filter((rule) => rule.media === null
      && selectorsOf(rule).includes('.og-explore__controls[data-open="false"]'));
    expect(closed).toHaveLength(1);
    expect(declaration(closed[0]!.body, "display")).toBe("none");
  });

  it("keeps every field's caption inside the popover instead of trusting the option", () => {
    const labels = allRules().filter((rule) => rule.media === null
      && selectorsOf(rule).includes(".og-explore__controls label"));
    expect(labels).toHaveLength(1);
    // A caption is only useful if it is painted.
    expect(declaration(labels[0]!.body, "display")).toBe("grid");
    expect(declaration(labels[0]!.body, "position")).not.toBe("absolute");
  });
});
