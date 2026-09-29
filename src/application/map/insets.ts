/**
 * Camera-fit insets (05-MAP-INTERACTION-AND-CARTOGRAPHY §9, 04 §2, 12 §12).
 *
 * 05 §9 is explicit: fit the route against the map rectangle the rider can
 * actually see — the side panel, the sheet's detent, the safe areas, the
 * navigation dock — and never against a hard-coded pixel reservation.
 *
 * The honest way to compute that is **geometrically, from measured rectangles**:
 * the model below takes the renderer's own rectangle and the rectangles of the
 * surfaces the composition puts on top of it, and turns their intersections into
 * the four padding numbers a camera fit uses.
 *
 * That is deliberately not a "reserve the panel width" rule. On this workspace's
 * wide and medium tiers the planning rail is a *sibling column*: it covers no
 * pixel of the map, so reserving its width would fit every route into half the
 * canvas for no reason at all. On the compact tier the sheet genuinely lies over
 * the map, and its measured height — which the detent and the route list change —
 * is what the fit must avoid. One model describes both, and the difference is a
 * measurement rather than a tier name.
 *
 * Everything here is a *measurement consumer*, not a layout authority: CSS decides
 * where the dock is, the component measures it, and this module turns the
 * measurements into padding. An absent measurement is zero, and a degenerate
 * composition is clamped so a bounded slice of geography always stays visible — a
 * half-open sheet must never produce an unfittable map.
 */

/** A rectangle in viewport coordinates, in CSS pixels. */
export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** The four padding numbers a camera fit uses, in CSS pixels. */
export interface MapInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Device safe-area insets (`env(safe-area-inset-*)`), read by the component. */
export interface EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** The composition tier, used only to describe the composition in tests/logs. */
export type WorkspaceLayout = "compact" | "compact-landscape" | "medium" | "wide";

export interface InsetsInput {
  /** The browser viewport; the clamp is against this, not against the map. */
  readonly viewport: ViewportSize;
  /** The renderer's rectangle (the canvas the fit must keep usable). */
  readonly map: Rect;
  /** The dock that may cover part of the map: sheet or rail. `null` if none. */
  readonly dock: Rect | null;
  /** Floating chrome over the map (the compact header). `null` if none. */
  readonly header: Rect | null;
  /** Additional surfaces that cover the map, e.g. a navigation dock. */
  readonly overlays?: readonly Rect[];
  readonly safeArea: EdgeInsets;
  /** Breathing room between the fitted content and the composition. */
  readonly gutter?: number;
}

/** The breathing room between fitted content and the composition edges. */
export const DEFAULT_GUTTER = 16;

/** The smallest visible map the clamp will leave, in CSS pixels. */
export const MIN_VISIBLE_MAP_PX = 120;

function sane(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function rect(value: Rect | null): Rect | null {
  if (value === null) return null;
  const width = sane(value.width);
  const height = sane(value.height);
  if (width === 0 || height === 0) return null;
  return { top: value.top, left: value.left, width, height };
}

function right(value: Rect): number {
  return value.left + value.width;
}

function bottom(value: Rect): number {
  return value.top + value.height;
}

/** The covered depth of `covering` on `covered`, or 0 when they do not overlap. */
function coveredDepth(
  covering: Rect,
  covered: Rect,
  axis: "horizontal" | "vertical",
): number {
  if (axis === "vertical") {
    return Math.max(0, Math.min(bottom(covering), bottom(covered)) - Math.max(covering.top, covered.top));
  }
  return Math.max(0, Math.min(right(covering), right(covered)) - Math.max(covering.left, covered.left));
}

function overlaps(covering: Rect, covered: Rect): boolean {
  return coveredDepth(covering, covered, "vertical") > 0 && coveredDepth(covering, covered, "horizontal") > 0;
}

/**
 * Which edges of the map a covering surface hides.
 *
 * The rule is anchoring, not geometry trivia: a surface hides the edge it
 * protrudes from. A bottom sheet spans the map's full width — it touches both
 * horizontal edges — so it hides only the bottom; a rail that overlays the map on
 * the left touches both vertical edges and hides only the left. A surface that
 * spans an axis hides nothing on that axis, and one that floats inside the map
 * hides the edge it sits nearest. A surface large enough to swallow the map is
 * reported on all four edges, and the clamp is what keeps a slice visible.
 */
function coveredEdges(covering: Rect, covered: Rect): readonly (keyof MapInsets)[] {
  if (!overlaps(covering, covered)) return [];

  const swallows =
    coveredDepth(covering, covered, "horizontal") >= covered.width - 1 &&
    coveredDepth(covering, covered, "vertical") >= covered.height - 1;
  if (swallows) return ["top", "right", "bottom", "left"];

  const edges: (keyof MapInsets)[] = [];
  const touchesTop = covering.top <= covered.top;
  const touchesBottom = bottom(covering) >= bottom(covered);
  const touchesLeft = covering.left <= covered.left;
  const touchesRight = right(covering) >= right(covered);

  if (touchesTop !== touchesBottom) {
    edges.push(touchesTop ? "top" : "bottom");
  } else if (!touchesTop) {
    // Floating on the vertical axis: it hides the edge it is nearest to.
    const fromTop = covering.top - covered.top;
    const fromBottom = bottom(covered) - bottom(covering);
    edges.push(fromTop <= fromBottom ? "top" : "bottom");
  }

  if (touchesLeft !== touchesRight) {
    edges.push(touchesLeft ? "left" : "right");
  } else if (!touchesLeft) {
    const fromLeft = covering.left - covered.left;
    const fromRight = right(covered) - right(covering);
    edges.push(fromLeft <= fromRight ? "left" : "right");
  }

  // A card floating over the map (the wide tier's rail and inspector) hides one
  // side, not a corner: fitting around both of its edges would throw away most
  // of the canvas. Keep the edge that costs the smaller share of the map.
  if (edges.length === 2) {
    const [vertical, horizontal] = edges as [keyof MapInsets, keyof MapInsets];
    const verticalShare = coveredExtent(covering, covered, vertical) / covered.height;
    const horizontalShare = coveredExtent(covering, covered, horizontal) / covered.width;
    return [verticalShare <= horizontalShare ? vertical : horizontal];
  }

  return edges;
}

/** The depth a covering surface hides on one edge of the map. */
function coveredExtent(
  covering: Rect,
  covered: Rect,
  edge: keyof MapInsets,
): number {
  switch (edge) {
    case "top":
      return Math.max(0, Math.min(bottom(covering), bottom(covered)) - covered.top);
    case "bottom":
      return Math.max(0, Math.min(bottom(covering), bottom(covered)) - covering.top);
    case "left":
      return Math.max(0, Math.min(right(covering), right(covered)) - covered.left);
    case "right":
      return Math.max(0, Math.min(right(covering), right(covered)) - covering.left);
  }
}

function edges(value: EdgeInsets): EdgeInsets {
  return {
    top: sane(value.top),
    right: sane(value.right),
    bottom: sane(value.bottom),
    left: sane(value.left),
  };
}

/** The insets for one measured composition. */
export function computeInsets(input: InsetsInput): MapInsets {
  const gutter = input.gutter === undefined ? DEFAULT_GUTTER : sane(input.gutter);
  const viewport = { width: sane(input.viewport.width), height: sane(input.viewport.height) };
  const safe = edges(input.safeArea);
  const map = rect(input.map);

  const result: Record<keyof MapInsets, number> = {
    top: gutter + safe.top,
    right: gutter + safe.right,
    bottom: gutter + safe.bottom,
    left: gutter + safe.left,
  };

  if (map !== null) {
    const coverings = [rect(input.dock), rect(input.header), ...(input.overlays ?? []).map(rect)].filter(
      (candidate): candidate is Rect => candidate !== null,
    );
    for (const covering of coverings) {
      for (const edge of coveredEdges(covering, map)) {
        result[edge] = Math.max(result[edge], coveredExtent(covering, map, edge) + gutter);
      }
    }
  }

  return clampInsetsToViewport(result, viewport);
}

/** The rectangle the rider can actually see, given the insets. */
export function insetVisibleRect(
  insets: MapInsets,
  viewport: ViewportSize,
): ViewportSize {
  return {
    width: Math.max(0, sane(viewport.width) - sane(insets.left) - sane(insets.right)),
    height: Math.max(0, sane(viewport.height) - sane(insets.top) - sane(insets.bottom)),
  };
}

/**
 * Shrinks the insets until at least {@link MIN_VISIBLE_MAP_PX} of map remains in
 * each axis. The deficit is taken from the larger of the two opposing insets,
 * which is the covering surface in every real composition, and never from the
 * gutter side.
 */
export function clampInsetsToViewport(
  insets: MapInsets,
  viewport: ViewportSize,
  minVisiblePx: number = MIN_VISIBLE_MAP_PX,
): MapInsets {
  const width = sane(viewport.width);
  const height = sane(viewport.height);
  if (width === 0 || height === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const minimum = Math.min(sane(minVisiblePx), width, height);
  const result = {
    top: sane(insets.top),
    right: sane(insets.right),
    bottom: sane(insets.bottom),
    left: sane(insets.left),
  };

  const horizontalDeficit = result.left + result.right - (width - minimum);
  if (horizontalDeficit > 0) {
    if (result.left >= result.right) {
      result.left = Math.max(0, result.left - horizontalDeficit);
    } else {
      result.right = Math.max(0, result.right - horizontalDeficit);
    }
  }

  const verticalDeficit = result.top + result.bottom - (height - minimum);
  if (verticalDeficit > 0) {
    if (result.bottom >= result.top) {
      result.bottom = Math.max(0, result.bottom - verticalDeficit);
    } else {
      result.top = Math.max(0, result.top - verticalDeficit);
    }
  }

  return result;
}

/** A `DOMRect`-shaped measurement as this module's plain rectangle. */
export function toRect(measured: {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}): Rect {
  return { top: measured.top, left: measured.left, width: measured.width, height: measured.height };
}
