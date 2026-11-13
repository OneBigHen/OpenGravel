import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALTERNATIVE_COLORS } from "@/infrastructure/map/maplibre/place-images";

const tokens = readFileSync(join(process.cwd(), "src/app/tokens.css"), "utf8");
const token = (name: string): string | undefined => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1]?.toLowerCase();

describe("Compare rows wear their line's colour", () => {
  it("the sheet's choice tokens equal the colours the map paints (choice n = tint % 3)", () => {
    // style.ts: tint % 3 === 1 → ALTERNATIVE_COLORS[0], 2 → [1], 0 → [2].
    expect(token("--og-map-choice-1")).toBe(ALTERNATIVE_COLORS[0]);
    expect(token("--og-map-choice-2")).toBe(ALTERNATIVE_COLORS[1]);
    expect(token("--og-map-choice-0")).toBe(ALTERNATIVE_COLORS[2]);
  });
});
