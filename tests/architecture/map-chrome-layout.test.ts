import { readFileSync } from "node:fs";
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
