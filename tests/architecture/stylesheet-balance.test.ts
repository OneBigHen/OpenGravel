import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A merge of two milestones that both appended to `globals.css` once dropped
 * the closing braces of one block. Every rule after it silently nested inside
 * an unclosed at-rule, and a page far from either change (My rides) broke in
 * short landscape. Balanced braces are the cheapest guard against that.
 */
describe("globals.css", () => {
  it("has balanced braces outside comments", () => {
    const source = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    for (const character of source) {
      if (character === "\n") line += 1;
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      expect(depth, `closing brace without an opener near line ${line}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, "unclosed blocks at the end of the stylesheet").toBe(0);
  });
});
