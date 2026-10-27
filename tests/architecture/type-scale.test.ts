/**
 * The type scale is five sizes (small-screen design system v2 §1): title 28,
 * headline 20, body 16, meta 14, caption 12, all on `--og-text-*` tokens.
 * Before the sweep the stylesheet carried 27 raw sizes from 9px to 34px, and
 * every new feature added a few more. This reads the real stylesheets, so a
 * `font-size: 13px` typed into a component fails here instead of joining them.
 *
 * Allowed, and deliberately not counted as raw sizes:
 *  - `var(...)`, the tokens themselves (including the ride screen's own scale);
 *  - `inherit`, and `0` where a glyph is hidden but still announced;
 *  - `clamp(...)`, which is a responsive page title (or the full-screen crash
 *    check) whose bounds are the design decision, not a fixed size.
 */

import { readdirSync, readFileSync } from "node:fs";
import { tokensCss } from "../helpers/app-css";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

type Declaration = { selector: string; value: string; line: number };

/**
 * Every `font-size` declaration with the selector it belongs to. Blocks are
 * tracked with a brace stack so at-rule bodies read as "media >> selector".
 */
function fontSizes(source: string): Declaration[] {
  const found: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  for (const character of source) {
    if (character === "\n") line += 1;
    if (character === "{") {
      stack.push(buffer.replace(/\/\*[\s\S]*?\*\//g, "").trim());
      buffer = "";
    } else if (character === "}") {
      stack.pop();
      buffer = "";
    } else if (character === ";") {
      const match = /^font-size\s*:\s*(.+)$/.exec(buffer.trim());
      if (match !== null) {
        found.push({
          selector: stack.join(" >> "),
          value: (match[1] as string).trim(),
          line: startLine,
        });
      }
      buffer = "";
    } else {
      if (buffer.trim() === "") startLine = line;
      buffer += character;
    }
  }
  return found;
}

const RAW_LENGTH = /^[0-9]*\.?[0-9]+(px|rem|em)$/;

describe("type scale (small-screen design system v2 §1)", () => {
  it("uses no raw px/rem/em font size anywhere in src", () => {
    const violations: string[] = [];
    for (const file of cssFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const declaration of fontSizes(source)) {
        if (!RAW_LENGTH.test(declaration.value)) continue;
        // `0` removes a glyph's text from flow without inventing a size.
        if (Number.parseFloat(declaration.value) === 0) continue;
        violations.push(
          `${relative(SRC, file)}:${declaration.line} ${declaration.selector} — font-size: ${declaration.value}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("still lets the five sizes be declared once, as tokens", () => {
    // Design v3: the five sizes live once, in tokens.css; the old aliases are gone.
    const tokens = tokensCss();
    const declared = new Map<string, string>();
    for (const match of tokens.matchAll(/(--og-text-[a-z]+):\s*([0-9]+px|var\(--og-text-[a-z]+\))/g)) {
      declared.set(match[1] as string, match[2] as string);
    }
    expect(declared.get("--og-text-title")).toBe("28px");
    expect(declared.get("--og-text-headline")).toBe("20px");
    expect(declared.get("--og-text-body")).toBe("16px");
    expect(declared.get("--og-text-meta")).toBe("14px");
    expect(declared.get("--og-text-caption")).toBe("12px");
    expect(declared.size).toBe(5);
  });
});
