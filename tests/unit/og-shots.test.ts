import { describe, expect, it } from "vitest";
import { comparePixels, gallery, makeManifest } from "../../scripts/og-shots/report.mjs";

describe("og-shots reports", () => {
  it("compares the fraction of pixels that differ and rejects mismatched sizes", () => {
    expect(comparePixels(Buffer.from([0, 0, 0, 255, 1, 2, 3, 255]), Buffer.from([0, 0, 0, 255, 1, 2, 4, 255]), 2, 1)).toBe(50);
    expect(() => comparePixels(Buffer.alloc(4), Buffer.alloc(8), 1, 1)).toThrow();
  });
  it("preserves metadata and escapes errors in a self-contained gallery", () => {
    const report = makeManifest({ commit: "abc", branch: "main", target: "local", devices: ["desktop"], themes: ["light"], map: "fixture", repeat: 2, states: ["plan-idle"] });
    report.shots.push({ state: "plan-idle", device: "desktop", theme: "light", runs: [], error: '<bad & "unsafe">', maxDiffPercent: null });
    const html = gallery(report);
    expect(html).toContain("abc");
    expect(html).toContain("&lt;bad &amp; &quot;unsafe&quot;&gt;");
    expect(html).not.toContain('<bad & "unsafe">');
    expect(report.errors).toEqual([]);
  });
});
