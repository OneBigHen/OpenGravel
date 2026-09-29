/**
 * Camera-fit insets (05-MAP-INTERACTION-AND-CARTOGRAPHY §9, 04 §2).
 *
 * The map must fit a route inside the rectangle the rider can actually see, and
 * the model is geometric: the renderer's own rectangle, plus the rectangles of the
 * surfaces the composition puts over it. What that buys, and what these tests pin:
 *
 * - **The compact sheet is avoided by its measured height**, and the detent
 *   changes it — no hard-coded reservation.
 * - **A rail beside the map contributes nothing.** On the wide tier the planning
 *   panel is a sibling column, and reserving its width would fit the ride into
 *   half the canvas for no reason.
 * - **A degenerate composition never produces an invisible map.** A sheet taller
 *   than the viewport is clamped so a bounded slice of geography stays visible.
 * - **Absent measurements read as zero.** A composition that has not measured its
 *   dock yet insets by the gutter only, instead of inventing a size.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GUTTER,
  MIN_VISIBLE_MAP_PX,
  clampInsetsToViewport,
  computeInsets,
  insetVisibleRect,
  toRect,
  type InsetsInput,
} from "@/application/map/insets";

const NO_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

/** The phone tier of 12 §12: 390×844, a full-bleed map, a sheet over its bottom. */
const PHONE = { width: 390, height: 844 };
const PHONE_MAP = { top: 0, left: 0, width: 390, height: 844 };
const PHONE_HEADER = { top: 0, left: 0, width: 390, height: 52 };

function phoneInput(overrides: Partial<InsetsInput> = {}): InsetsInput {
  return {
    viewport: PHONE,
    map: PHONE_MAP,
    dock: { top: 612, left: 0, width: 390, height: 232 },
    header: PHONE_HEADER,
    safeArea: NO_SAFE_AREA,
    ...overrides,
  };
}

describe("computeInsets", () => {
  it("insets the compact map by the measured sheet height and the header", () => {
    const insets = computeInsets(phoneInput());

    // The sheet covers y 612→844, so the bottom inset is that 232px plus the
    // gutter; the header covers the top 52px.
    expect(insets.bottom).toBe(232 + DEFAULT_GUTTER);
    expect(insets.top).toBe(52 + DEFAULT_GUTTER);
    expect(insets.left).toBe(DEFAULT_GUTTER);
    expect(insets.right).toBe(DEFAULT_GUTTER);
  });

  it("follows the sheet detent, not a hard-coded reservation", () => {
    const peek = computeInsets(phoneInput());
    const expanded = computeInsets(
      phoneInput({ dock: { top: 374, left: 0, width: 390, height: 470 } }),
    );

    expect(expanded.bottom).toBeGreaterThan(peek.bottom);
    expect(expanded.bottom - peek.bottom).toBe(470 - 232);
  });

  it("caps the compact sheet inset so the map keeps a visible slice", () => {
    // 04 §2 allows the sheet to take 58dvh of a phone; a measured sheet that
    // leaves almost nothing must not be able to push the fit off screen.
    const insets = computeInsets(
      phoneInput({ dock: { top: 40, left: 0, width: 390, height: 804 } }),
    );

    expect(insets.bottom).toBeLessThan(804);
    expect(insetVisibleRect(insets, PHONE).height).toBeGreaterThanOrEqual(
      MIN_VISIBLE_MAP_PX,
    );
  });

  it("gives a rail beside the map no inset at all", () => {
    // The wide tier (04 §2): the planning panel is its own grid column, so it
    // covers no pixel of the map. Its width must not become padding.
    const insets = computeInsets({
      viewport: { width: 1440, height: 900 },
      map: { top: 0, left: 396, width: 1044, height: 900 },
      dock: { top: 0, left: 16, width: 380, height: 700 },
      header: { top: 0, left: 16, width: 380, height: 72 },
      safeArea: NO_SAFE_AREA,
    });

    expect(insets).toEqual({
      top: DEFAULT_GUTTER,
      right: DEFAULT_GUTTER,
      bottom: DEFAULT_GUTTER,
      left: DEFAULT_GUTTER,
    });
  });

  it("insets the edge a rail actually overlays", () => {
    // The medium tier with an overlay panel (a future composition): the panel
    // covers the map's left edge, so that is the edge the fit avoids.
    const insets = computeInsets({
      viewport: { width: 900, height: 800 },
      map: { top: 0, left: 0, width: 900, height: 800 },
      dock: { top: 0, left: 0, width: 340, height: 800 },
      header: null,
      safeArea: NO_SAFE_AREA,
    });

    expect(insets.left).toBe(340 + DEFAULT_GUTTER);
    expect(insets.right).toBe(DEFAULT_GUTTER);
  });

  it("keeps the primary action visible in short landscape", () => {
    // 12 §12's landscape phone at 844×390, where a tall sheet would leave an
    // unusable map.
    const insets = computeInsets({
      viewport: { width: 844, height: 390 },
      map: { top: 0, left: 0, width: 844, height: 390 },
      dock: { top: 190, left: 0, width: 844, height: 200 },
      header: { top: 0, left: 44, width: 756, height: 44 },
      safeArea: { top: 0, right: 44, bottom: 21, left: 44 },
    });

    expect(insetVisibleRect(insets, { width: 844, height: 390 }).height).toBeGreaterThanOrEqual(
      MIN_VISIBLE_MAP_PX,
    );
    // The notch sides are respected.
    expect(insets.left).toBeGreaterThanOrEqual(44);
    expect(insets.right).toBeGreaterThanOrEqual(44);
  });

  it("adds the safe area to every edge the composition does not cover", () => {
    const insets = computeInsets(
      phoneInput({
        dock: null,
        header: null,
        safeArea: { top: 47, right: 4, bottom: 34, left: 4 },
      }),
    );

    expect(insets).toEqual({
      top: DEFAULT_GUTTER + 47,
      right: DEFAULT_GUTTER + 4,
      bottom: DEFAULT_GUTTER + 34,
      left: DEFAULT_GUTTER + 4,
    });
  });

  it("counts an extra overlay the caller declares", () => {
    const insets = computeInsets(
      phoneInput({
        dock: null,
        header: null,
        overlays: [{ top: 700, left: 0, width: 390, height: 144 }],
      }),
    );

    expect(insets.bottom).toBe(144 + DEFAULT_GUTTER);
  });

  it("fits beside cards that float over a full-bleed wide map, not under them", () => {
    // Map-first desktop (UX rework phase 7): the rail floats over the map's left
    // side and the ride inspector over its top right. Each hides one side.
    const insets = computeInsets({
      viewport: { width: 1440, height: 900 },
      map: { top: 56, left: 0, width: 1440, height: 844 },
      dock: { top: 72, left: 16, width: 384, height: 812 },
      header: null,
      overlays: [{ top: 72, left: 1064, width: 360, height: 520 }],
      safeArea: NO_SAFE_AREA,
    });

    expect(insets.left).toBe(400 + DEFAULT_GUTTER);
    expect(insets.right).toBe(360 + DEFAULT_GUTTER);
    expect(insets.top).toBe(DEFAULT_GUTTER);
    expect(insets.bottom).toBe(DEFAULT_GUTTER);
  });

  it("reads absent measurements as zero instead of inventing a size", () => {
    const unmeasured = computeInsets(
      phoneInput({ dock: null, header: null }),
    );

    expect(unmeasured).toEqual({
      top: DEFAULT_GUTTER,
      right: DEFAULT_GUTTER,
      bottom: DEFAULT_GUTTER,
      left: DEFAULT_GUTTER,
    });
  });

  it("treats a non-finite or zero-sized measurement as absent", () => {
    const broken = computeInsets(
      phoneInput({
        dock: { top: 612, left: 0, width: 390, height: Number.NaN },
        header: { top: 0, left: 0, width: 390, height: 0 },
      }),
    );

    expect(broken.top).toBe(DEFAULT_GUTTER);
    expect(broken.bottom).toBe(DEFAULT_GUTTER);
  });

  it("accepts an explicit gutter", () => {
    const insets = computeInsets(phoneInput({ gutter: 24 }));
    expect(insets.left).toBe(24);
    expect(insets.bottom).toBe(232 + 24);
  });

  it("measures a DOMRect without losing the origin", () => {
    const measured = toRect({ top: 612.5, left: 0, width: 390, height: 231.5 });
    expect(measured).toEqual({ top: 612.5, left: 0, width: 390, height: 231.5 });
  });
});

describe("the visible rectangle", () => {
  it("is the viewport minus the insets", () => {
    const rect = insetVisibleRect(
      { top: 52, right: 16, bottom: 248, left: 396 },
      { width: 1440, height: 900 },
    );

    expect(rect).toEqual({ width: 1028, height: 600 });
  });

  it("never reports a negative size", () => {
    const rect = insetVisibleRect(
      { top: 900, right: 0, bottom: 900, left: 0 },
      { width: 400, height: 800 },
    );

    expect(rect.height).toBe(0);
    expect(rect.width).toBe(400);
  });
});

describe("clampInsetsToViewport", () => {
  it("leaves a sane composition untouched", () => {
    const insets = { top: 52, right: 16, bottom: 248, left: 16 };
    expect(clampInsetsToViewport(insets, { width: 390, height: 844 })).toEqual(
      insets,
    );
  });

  it("shrinks the covering edge until the minimum visible map remains", () => {
    const clamped = clampInsetsToViewport(
      { top: 0, right: 0, bottom: 800, left: 0 },
      { width: 390, height: 844 },
    );

    expect(insetVisibleRect(clamped, { width: 390, height: 844 }).height).toBe(
      MIN_VISIBLE_MAP_PX,
    );
  });

  it("takes a zero-sized viewport down to zero insets", () => {
    expect(
      clampInsetsToViewport(
        { top: 40, right: 40, bottom: 40, left: 40 },
        { width: 0, height: 0 },
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
