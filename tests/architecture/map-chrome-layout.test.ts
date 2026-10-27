import { appCss } from "../helpers/app-css";
import { describe, expect, it } from "vitest";

/**
 * The map's compact chrome has two jobs that must not collide: the right edge is
 * the instrument column (compass, zoom, locate, show whole ride), and the
 * basemap and Layers controls sit together on the left, under the Along-ride
 * pill. A later compact rule that put Layers back on the right edge silently
 * covered a zoom button, so this asserts the effective compact placement rather
 * than any one declaration.
 */

const COMPACT = "(max-width: 1180px) and (min-height: 501px)";
const SHORT_PHONE =
  "(max-width: 760px) and (max-height: 700px) and (orientation: portrait)";
const PHONE = "(max-width: 760px)";
/** The desktop plan tier: rail, map and ride inspector as columns. */
const DESKTOP = "(min-width: 1181px)";

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

function compactBlocks(): string[] {
  return mediaBlocks(sourceOf(), COMPACT);
}

describe("compact map chrome", () => {
  it("keeps the phone map's two controls in one right-hand column under the search", () => {
    // small-screen-v2 §3 (v3): Layers, then Locate, 16px from the right edge,
    // below the search bar and its chip row; nothing on the left edge.
    const blocks = compactBlocks();
    const layers = declarationsFor(blocks, ".og-layers");
    expect(layers["top"]).toBe("calc(var(--og-safe-top) + 128px)");
    expect(layers["right"]).toBe("calc(var(--og-safe-right) + var(--og-space-4))");
    expect(layers["left"]).toBe("auto");
    expect(declarationsFor(blocks, ".og-planner:has(.og-top-search) .og-planner__map-slot .og-map__cluster")["top"]).toBe(
      "calc(var(--og-safe-top) + 184px)",
    );
  });

  it("moves map style and places off the phone map, where the layers sheet owns them", () => {
    const blocks = mediaBlocks(sourceOf(), PHONE);
    expect(declarationsFor(blocks, '[data-map-style-sheet="true"] .og-map__look')["display"]).toBe("none");
    expect(declarationsFor(blocks, '[data-places-sheet="true"] .og-places-overlay--planner .og-places-control')["display"]).toBe("none");
  });

  it("leaves the desktop map one top-left group and no second summary", () => {
    const blocks = mediaBlocks(sourceOf(), DESKTOP);

    // Map style and Places are rows in the layers panel at this tier, exactly as
    // they are on a phone, so the globe and the pill leave the map.
    expect(declarationsFor(blocks, '[data-map-style-sheet="true"] .og-map__look')["display"]).toBe("none");
    expect(declarationsFor(blocks, '[data-places-sheet="true"] .og-places-overlay--planner .og-places-control')["display"]).toBe("none");
    // Both groups are rows of the layers panel on every tier.
    const base = [sourceOf()];
    expect(declarationsFor(base, ".og-layers__group--style")["display"]).toBeUndefined();
    expect(declarationsFor(base, ".og-layers__group--places")["display"]).toBeUndefined();

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

  it("gives the layers sheet 56 px rows with one icon in a 40 px tile", () => {
    const base = [sourceOf()];
    expect(declarationsFor(base, ".og-layers__switch")["min-height"]).toBe("56px");
    expect(declarationsFor(base, ".og-layers__swatch")["width"]).toBe("40px");
    // The tile's glyph is a size on the type scale, not a raw value.
    expect(declarationsFor(base, ".og-layers__swatch")["font-size"]).toBe("var(--og-text-headline)");
    // The meta line wraps rather than truncating (small-screen-v2 §6).
    expect(declarationsFor(base, ".og-layers__legend")["white-space"]).toBeUndefined();
    const phone = mediaBlocks(sourceOf(), COMPACT);
    expect(declarationsFor(phone, ".og-layers__about")["display"]).toBe("none");
    // Tile, words, switch: the switch keeps its own column, never over the icon.
    expect(declarationsFor(base, ".og-layers__lens")["min-height"]).toBe("56px");
  });

  it("draws every sheet switch as a track with a knob that moves to the green", () => {
    const css = sourceOf();
    const track = declarationsFor([css], ".og-switch");
    expect(track["width"]).toBe("40px");
    expect(track["height"]).toBe("24px");
    expect(track["border-radius"]).toBe("var(--og-radius-pill)");

    // Off is neutral; on is the primary green, and the knob has to travel so the
    // state reads without relying on colour alone.
    expect(declarationsFor([css], '.og-switch[data-on="true"]')["background"]).toBe("var(--og-primary)");
    expect(declarationsFor([css], '.og-switch[data-on="true"]::after')["transform"]).toBe("translateX(16px)");
    expect(declarationsFor([css], ".og-switch::after")["width"]).toBe("16px");

    // The old fake switch (a span with no knob of its own) must not come back.
    expect(css).not.toContain("og-layers__toggle");
    expect(css).not.toContain("og-layers__lens-glyph");
    expect(declarationsFor([css], ".og-layers__lens .og-switch")["grid-column"]).toBe("3");
    expect(declarationsFor([css], ".og-layers__lens .og-layers__swatch")["grid-row"]).toBe("1 / span 2");
  });

  it("leaves the short phone's right edge to the wrapped instrument column", () => {
    const blocks = mediaBlocks(sourceOf(), SHORT_PHONE);
    const layers = declarationsFor(blocks, ".og-layers");
    const basemap = declarationsFor(blocks, ".og-map__layer-toggle");

    // A short-phone exception used to move Layers beside the column; it must not
    // come back as a right-edge override.
    expect(layers["right"]).toBeUndefined();
    expect(layers["left"]).toBeUndefined();
    expect(basemap["right"]).toBeUndefined();
  });
});
