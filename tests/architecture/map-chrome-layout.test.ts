import { readFileSync } from "node:fs";
import { appCss } from "../helpers/app-css";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The map's compact chrome has two jobs that must not collide: the right edge is
 * the instrument column (compass, zoom, locate, show whole ride), and the
 * basemap and Layers controls sit together on the left, under the Along-ride
 * pill. A later compact rule that put Layers back on the right edge silently
 * covered a zoom button, so this asserts the effective compact placement rather
 * than any one declaration.
 */

const FILES = ["globals.css", "theme-glass.css"] as const;
const COMPACT =
  "(max-width: 1180px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))";
const SHORT_PHONE =
  "(max-width: 760px) and (max-height: 700px) and (orientation: portrait)";
const PHONE = "(max-width: 760px)";
const PHONE_ROWS = "(max-width: 479px)";
/** The desktop plan tier: rail, map and ride inspector as columns. */
const DESKTOP = "(min-width: 1181px)";

function sourceOf(file: (typeof FILES)[number]): string {
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

function compactBlocks(): string[] {
  return FILES.flatMap((file) => mediaBlocks(sourceOf(file), COMPACT));
}

describe("compact map chrome", () => {
  it("puts Layers and the basemap together on the left, under the Along-ride row", () => {
    const blocks = compactBlocks();
    const layers = declarationsFor(blocks, ".og-layers");
    const basemap = declarationsFor(blocks, ".og-map__layer-toggle");
    const hint = declarationsFor(blocks, ".og-map__hint");

    // Row one is Along ride + filters at 64px, 44px tall; row two starts at 116px.
    expect(basemap["top"]).toBe("calc(116px + var(--og-safe-top))");
    expect(basemap["left"]).toBe("12px");
    expect(layers["top"]).toBe("calc(116px + var(--og-safe-top))");
    expect(layers["left"]).toBe("calc(12px + 44px + 8px)");

    // No right-edge placement survives into the effective compact cascade.
    expect(layers["right"]).toBe("auto");
    expect(basemap["right"]).toBeUndefined();

    // The hint follows both rows instead of sitting on top of the second one.
    expect(hint["top"]).toBe("calc(168px + var(--og-safe-top))");
  });

  it("moves map style and places off the phone map, where the layers sheet owns them", () => {
    const blocks = FILES.flatMap((file) => mediaBlocks(sourceOf(file), PHONE));
    expect(declarationsFor(blocks, '[data-map-style-sheet="true"] .og-map__look')["display"]).toBe("none");
    expect(declarationsFor(blocks, '[data-places-sheet="true"] .og-places-overlay--planner .og-places-control')["display"]).toBe("none");
  });

  it("leaves the desktop map one top-left group and no second summary", () => {
    const blocks = FILES.flatMap((file) => mediaBlocks(sourceOf(file), DESKTOP));

    // Map style and Places are rows in the layers panel at this tier, exactly as
    // they are on a phone, so the globe and the pill leave the map.
    expect(declarationsFor(blocks, '[data-map-style-sheet="true"] .og-map__look')["display"]).toBe("none");
    expect(declarationsFor(blocks, '[data-places-sheet="true"] .og-places-overlay--planner .og-places-control')["display"]).toBe("none");
    expect(declarationsFor(blocks, ".og-layers__group--style")["display"]).toBe("block");
    expect(declarationsFor(blocks, ".og-layers__group--places")["display"]).toBe("block");

    // Layers takes the corner the style globe held, since it is the only control
    // left on that edge.
    expect(declarationsFor(blocks, ".og-planner__map-slot .og-layers")["left"]).toBe("var(--og-float-left, 12px)");

    // The selected route's card is on screen (inspector or rail list), so the
    // floating summary pill stated the same ride twice.
    expect(declarationsFor(blocks, ".og-glance--map")["display"]).toBe("none");

    // The route's edit tools sit in the panel beside undo/redo instead of a
    // floating bar over the map.
    expect(declarationsFor(blocks, ".og-planner__sheet .og-sheet__head > .og-sheet__tools")["display"]).toBe("flex");
    expect(declarationsFor(blocks, ".og-planner__sheet .og-sheet__head .og-editbar")["position"]).toBe("static");
  });

  it("gives a phone sheet 56 px rows with one icon in a 40 px tile", () => {
    const blocks = FILES.flatMap((file) => mediaBlocks(sourceOf(file), PHONE));
    expect(declarationsFor(blocks, ".og-layers__switch")["min-height"]).toBe("56px");
    expect(declarationsFor(blocks, ".og-layers__swatch")["width"]).toBe("40px");
    // The tile's glyph is a size on the type scale, not a raw value.
    expect(declarationsFor(blocks, ".og-layers__swatch")["font-size"]).toBe(
      "var(--og-text-title)",
    );
    expect(declarationsFor(blocks, ".og-layers__legend")["white-space"]).toBe("normal");
    expect(declarationsFor(blocks, ".og-layers__about")["display"]).toBe("none");

    const rowBlocks = FILES.flatMap((file) => mediaBlocks(sourceOf(file), PHONE_ROWS));
    expect(declarationsFor(rowBlocks, ".og-layers__lenses")["grid-template-columns"]).toBe("minmax(0, 1fr)");
    expect(declarationsFor(rowBlocks, ".og-layers__lens")["min-height"]).toBe("56px");
    // Tile, words, switch: the row keeps its own column for the control so the
    // switch can never float over the icon again.
    expect(declarationsFor(rowBlocks, ".og-layers__lens")["grid-template-columns"]).toBe("40px minmax(0, 1fr) 40px");
  });

  it("draws every sheet switch as a track with a knob that moves to the green", () => {
    const css = sourceOf("globals.css");
    const track = declarationsFor([css], ".og-switch");
    expect(track["width"]).toBe("40px");
    expect(track["height"]).toBe("24px");
    expect(track["border-radius"]).toBe("999px");

    // Off is neutral; on is the primary green, and the knob has to travel so the
    // state reads without relying on colour alone.
    expect(declarationsFor([css], '.og-switch[data-on="true"]')["background"]).toBe("var(--og-go)");
    expect(declarationsFor([css], '.og-switch[data-on="true"]::after')["transform"]).toBe("translateX(16px)");
    expect(declarationsFor([css], ".og-switch::after")["width"]).toBe("16px");

    // The old fake switch (a span with no knob of its own) must not come back.
    expect(css).not.toContain("og-layers__toggle");
    expect(css).not.toContain("og-layers__lens-glyph");
    expect(declarationsFor([css], ".og-layers__lens .og-switch")["grid-column"]).toBe("3");
    expect(declarationsFor([css], ".og-layers__lens .og-layers__swatch")["grid-row"]).toBe("1 / span 2");
  });

  it("leaves the short phone's right edge to the wrapped instrument column", () => {
    const blocks = FILES.flatMap((file) => mediaBlocks(sourceOf(file), SHORT_PHONE));
    const layers = declarationsFor(blocks, ".og-layers");
    const basemap = declarationsFor(blocks, ".og-map__layer-toggle");

    // A short-phone exception used to move Layers beside the column; it must not
    // come back as a right-edge override.
    expect(layers["right"]).toBeUndefined();
    expect(layers["left"]).toBeUndefined();
    expect(basemap["right"]).toBeUndefined();
  });
});
