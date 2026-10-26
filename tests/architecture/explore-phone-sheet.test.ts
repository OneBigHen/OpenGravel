import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Explore's filters sheet on a 320 × 640 phone.
 *
 * A component test cannot see which stylesheet rule wins, so these read the
 * rules that actually ship. The three defects they lock down were all rendered
 * ones: the four date choices were `width: 100%` inside their row, which stacked
 * them as full-width buttons; the sheet had no scrim of its own; and the
 * Ride / Things tabs could wrap inside the header.
 */

const FILES = {
  feature: "src/ui/explore/explore-rides.css",
  theme: "src/app/theme-glass.css",
} as const;

interface Rule {
  readonly selector: string;
  readonly body: string;
  /** The enclosing `@media` conditions, outermost first. */
  readonly media: readonly string[];
}

/** A stylesheet with comments removed, so prose cannot satisfy a selector. */
function rulesOf(source: string): Rule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const frames: { readonly head: string; readonly media: readonly string[]; readonly at: boolean }[] = [];
  let pending = "";
  for (const character of clean) {
    if (character === "{") {
      const head = pending.trim();
      pending = "";
      if (head.startsWith("@")) {
        const inherited = frames.at(-1)?.media ?? [];
        frames.push({
          head,
          media: head.startsWith("@media") ? [...inherited, head.slice("@media".length).trim()] : inherited,
          at: true,
        });
      } else {
        frames.push({ head, media: frames.at(-1)?.media ?? [], at: false });
      }
      continue;
    }
    if (character === "}") {
      const closed = frames.pop();
      if (closed !== undefined && !closed.at && closed.head !== "") {
        rules.push({ selector: closed.head, body: pending, media: closed.media });
      }
      pending = "";
      continue;
    }
    pending += character;
  }
  return rules;
}

const featureRules = (): Rule[] => rulesOf(readFileSync(resolve(__dirname, "../..", FILES.feature), "utf8"));
const themeRules = (): Rule[] => rulesOf(readFileSync(resolve(__dirname, "../..", FILES.theme), "utf8"));

function selectorsOf(rule: Rule): string[] {
  return rule.selector.split(",").map((part) => part.trim());
}

function declarations(rule: Rule): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of rule.body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    found[part.slice(0, colon).trim()] = part.slice(colon + 1).trim().replace(/\s+/g, " ");
  }
  return found;
}

/** The declarations one exact selector receives, in the order the rules ship. */
function declarationsFor(selector: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of [...themeRules(), ...featureRules()]) {
    if (!selectorsOf(rule).includes(selector)) continue;
    Object.assign(merged, declarations(rule));
  }
  return merged;
}

function phone(rule: Rule): boolean {
  return rule.media.some((condition) => condition.includes("max-width: 760px"));
}

describe("Explore's filters sheet on a phone", () => {
  it("lays the date choices out as a row of chips, not four full-width buttons", () => {
    // The sheet gives every button `width: 100%`; inside the When row that is
    // what stacked them. The feature rule has to win for both children.
    const chips = featureRules().filter((rule) =>
      selectorsOf(rule).includes('.og-explore .og-explore__controls[data-open="true"] > .og-explore__row > *'));
    expect(chips).toHaveLength(1);
    expect(declarations(chips[0]!)["width"]).toBe("auto");

    // Every chip is a 48px target at every width, and the row wraps.
    expect(declarationsFor(".og-explore__quick-chip")["min-height"]).toBe("48px");
    const row = declarationsFor(".og-explore .og-explore__row--when");
    expect(row["row-gap"]).toBe("8px");
    expect(row["column-gap"]).toBe("8px");
  });

  it("gives the When row a visible caption that is not one of its chips", () => {
    const caption = declarationsFor(".og-explore .og-explore__row-label");
    expect(caption["flex"]).toBe("1 1 100%");
    expect(caption["text-transform"]).toBe("uppercase");
    expect(caption["font-size"]).toBe("var(--og-text-caption)");
  });

  it("dims the page behind the sheet with a scrim under it and over the page", () => {
    const scrim = featureRules().filter((rule) =>
      phone(rule)
      && !rule.media.some((condition) => condition.includes("prefers-reduced-motion"))
      && selectorsOf(rule).includes(".og-explore .og-explore__toolbar > .og-explore__backdrop"));
    expect(scrim).toHaveLength(1);
    const body = declarations(scrim[0]!);
    expect(body["position"]).toBe("fixed");
    expect(body["inset"]).toBe("0");
    // Painted, not merely present: the base rule of the stylesheet hides it.
    expect(body["display"]).toBe("block");
    expect(body["background"]).toMatch(/^rgb\(0 0 0 \/ \d+%\)$/);
    // Under the sheet (z-index 70) and over the page and its bars.
    expect(Number.parseInt(body["z-index"] ?? "0", 10)).toBeLessThan(70);
    expect(Number.parseInt(body["z-index"] ?? "0", 10)).toBeGreaterThan(20);
  });

  it("keeps the scrim still for a rider who asked for less motion", () => {
    const still = featureRules().filter((rule) =>
      rule.media.some((condition) => condition.includes("prefers-reduced-motion: reduce"))
      && selectorsOf(rule).includes(".og-explore .og-explore__toolbar > .og-explore__backdrop"));
    expect(still).toHaveLength(1);
    expect(declarations(still[0]!)["animation"]).toBe("none");
  });

  it("never wraps the Ride / Things switch at 320px", () => {
    const tabs = featureRules().filter((rule) =>
      selectorsOf(rule).includes('.og-explore .og-explore__header .og-explore__lens > [role="tab"]'));
    expect(tabs).toHaveLength(1);
    expect(declarations(tabs[0]!)["white-space"]).toBe("nowrap");

    // Search above the chips at every width below the one-line desktop tier.
    const toolbar = themeRules().filter((rule) =>
      rule.media.length === 0 && selectorsOf(rule).includes(".og-explore__toolbar"));
    expect(toolbar).toHaveLength(1);
    expect(declarations(toolbar[0]!)["grid-template-areas"]).toBe('"search" "quick"');
  });
});
