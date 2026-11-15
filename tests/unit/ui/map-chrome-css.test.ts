/**
 * The map chrome's OG-23 contract: the basemap's own place names are drawn by
 * the renderer, so the app cannot wrap them. What it can do is dissolve the
 * canvas at the screen edge and under the device's top inset, so a name is
 * either whole or gone instead of a sliced word ("arple wnship") or a label
 * under the notch.
 *
 * The critical browser gate runs with the `empty` basemap (no tiles, therefore
 * no basemap labels), so this rule is pinned here rather than in a spec; the
 * picture itself is checked on a device.
 */

import { describe, expect, it } from "vitest";

import { cssRuleRaw } from "../../helpers/app-css";

describe("map labels keep clear of the edge and the notch (OG-23)", () => {
  const canvas = (): string => cssRuleRaw(".og-map .maplibregl-canvas");

  it("fades the canvas at both side edges", () => {
    const rule = canvas();
    expect(rule).toMatch(/--og-map-edge-fade:\s*12px/);
    // A left and a right fade, both from the same 12 px token.
    expect(rule).toMatch(/mask-image:\s*linear-gradient\(to bottom[\s\S]*linear-gradient\(to right/);
    expect(rule.match(/var\(--og-map-edge-fade\)/g)).toHaveLength(4);
    expect(rule).toMatch(/transparent 100%/);
    // Safari reads the prefixed property; without it the fade is absent there.
    expect(rule).toMatch(/-webkit-mask-image:\s*linear-gradient\(to bottom/);
  });

  it("fades the top by the device's own safe-area inset, so no name sits under the notch", () => {
    const rule = canvas();
    expect(rule).toMatch(/linear-gradient\(to bottom, transparent 0, rgb\(0 0 0\) var\(--og-safe-top\), rgb\(0 0 0\) 100%\)/);
    // Two uniforms on one layer must intersect, or the second replaces the first.
    expect(rule).toMatch(/mask-composite:\s*intersect/);
    expect(rule).toMatch(/-webkit-mask-composite:\s*source-in/);
  });

  it("masks the canvas alone, never the box around it", () => {
    // A mask on the canvas container makes Chromium hit-test the wrapper instead
    // of the canvas, and the map stops accepting taps (proved on the browser
    // gate: the point menu never opened).
    expect(cssRuleRaw(".og-map .maplibregl-canvas-container")).not.toMatch(/mask-image/);
    // The controls over the map are siblings and are not faded either.
    expect(cssRuleRaw(".og-map__cluster")).not.toMatch(/mask-image/);
    expect(cssRuleRaw(".og-map__veil")).not.toMatch(/mask-image/);
  });
});
