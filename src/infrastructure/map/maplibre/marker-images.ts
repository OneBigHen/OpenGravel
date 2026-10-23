/**
 * The ride's pins (owner review 2026-10-04: "I can't see where I draw the route
 * or modify the route plotted"). Start, finish and stops were 7–9 px circles
 * that read as decoration; these are 34 px handles a rider recognises and
 * grabs:
 *
 * - **Start** — a green disc with a white "go" arrow.
 * - **Finish** — a checkered disc, the one shape nobody mistakes.
 * - **Stop** — a white disc with a dark ring; the stop's number is drawn on it
 *   as map text, so it uses the basemap's glyphs.
 *
 * Each pin has a white ring and a soft dark rim, so it holds on the day map,
 * on Night contrast and over satellite imagery. Drawn as pixels (no canvas or
 * asset), like the rider's puck, so tests can build them too.
 *
 * The **route direction arrow** lives here as well (05 §11): a two-tone chevron
 * the line layers place along the selected route. It is an image rather than a
 * glyph because it must read on a satellite photograph, on Night contrast and on
 * the paper basemap, and a glyph's colour cannot be split into a fill and a halo.
 */

import type { PlaceImageData } from "./place-images";
import type { MapPalette } from "./style";

export const MARKER_IMAGE_IDS = {
  start: "ogv-pin-start",
  finish: "ogv-pin-finish",
  stop: "ogv-pin-stop",
} as const;

/** The direction arrow drawn along the selected route (05 §11). */
export const ROUTE_ARROW_IMAGE_ID = "ogv-route-arrow";

/**
 * Which of the two arrow treatments to draw.
 *
 * `day` is a Paper chevron inside an Ink halo; `night` is the same pair
 * reversed. The surface hues never change with the theme — a fact must not
 * change colour at dusk — but the arrow is an annotation, not a fact, and it has
 * to stay readable on whichever basemap is behind it.
 */
export type RouteArrowTone = "day" | "night";

export interface MarkerImage {
  readonly id: string;
  readonly data: PlaceImageData;
  readonly options: { readonly pixelRatio: number };
}

const PIXEL_RATIO = 2;
/** Image edge in device pixels: a 34 CSS px pin with room for its rim. */
const SIZE = 76;
const SUPERSAMPLE = 4;

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const RIM: Rgb = [10, 16, 14];
const GO: Rgb = [22, 138, 67];
const INK: Rgb = [22, 29, 28];

/** Radii in device pixels from the image centre. */
const R_RIM = 34;
const R_RING = 32;
const R_FACE = 26;

type Painter = (x: number, y: number) => Rgb;

/** Point-in-triangle, for the start arrow. */
function inTriangle(x: number, y: number, a: readonly number[], b: readonly number[], c: readonly number[]): boolean {
  const sign = (p: readonly number[], q: readonly number[], r: readonly number[]): number =>
    (p[0]! - r[0]!) * (q[1]! - r[1]!) - (q[0]! - r[0]!) * (p[1]! - r[1]!);
  const point = [x, y];
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

function render(id: string, face: Painter, ring: Rgb = WHITE): MarkerImage {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const centre = SIZE / 2;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          const py = y + (sy + 0.5) / SUPERSAMPLE;
          const distance = Math.hypot(px - centre, py - centre);
          let colour: Rgb | null = null;
          let opacity = 1;
          if (distance <= R_FACE) colour = face(px - centre, py - centre);
          else if (distance <= R_RING) colour = ring;
          else if (distance <= R_RIM) {
            colour = RIM;
            opacity = 0.55;
          }
          if (colour === null) continue;
          red += colour[0] * opacity;
          green += colour[1] * opacity;
          blue += colour[2] * opacity;
          alpha += opacity;
        }
      }
      if (alpha === 0) continue;
      const at = (y * SIZE + x) * 4;
      // Straight (un-premultiplied) RGBA, like the place pills.
      data[at] = Math.round(red / alpha);
      data[at + 1] = Math.round(green / alpha);
      data[at + 2] = Math.round(blue / alpha);
      data[at + 3] = Math.round((255 * alpha) / samples);
    }
  }
  return { id, data: { width: SIZE, height: SIZE, data }, options: { pixelRatio: PIXEL_RATIO } };
}

/** Green with a white "go" arrow, nudged right so it looks centred. */
function startFace(x: number, y: number): Rgb {
  return inTriangle(x, y, [-7, -12], [-7, 12], [13, 0]) ? WHITE : GO;
}

/** A 4×4 checker clipped by the disc. */
function finishFace(x: number, y: number): Rgb {
  const cell = 13;
  const column = Math.floor((x + R_FACE) / cell);
  const row = Math.floor((y + R_FACE) / cell);
  return (column + row) % 2 === 0 ? INK : WHITE;
}

/** White, with the number drawn over it as map text. */
function stopFace(): Rgb {
  return WHITE;
}

export function createMarkerImages(): readonly MarkerImage[] {
  return [
    render(MARKER_IMAGE_IDS.start, startFace),
    render(MARKER_IMAGE_IDS.finish, finishFace),
    render(MARKER_IMAGE_IDS.stop, stopFace, INK),
  ];
}

/** The route arrow's image edge in device pixels: 14 CSS px at 2×, halo included. */
const ARROW_SIZE = 28;

/** Pointing up: tip, right foot, the notch, left foot — the puck's own chevron. */
const ARROW: readonly (readonly [number, number])[] = [
  [0, -10.5],
  [7.5, 6.5],
  [0, 1.5],
  [-7.5, 6.5],
];

/** The same chevron, grown by ~3 px, drawn in the halo colour underneath. */
const ARROW_HALO: readonly (readonly [number, number])[] = [
  [0, -14],
  [11, 9.5],
  [0, 4.5],
  [-11, 9.5],
];

/** Even-odd point-in-polygon test. */
function inside(x: number, y: number, polygon: readonly (readonly [number, number])[]): boolean {
  let hit = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index]!;
    const [xj, yj] = polygon[previous]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** `#rrggbb` → bytes, with a fallback for a palette slot that is not a hex colour. */
function rgb(value: string, fallback: Rgb): Rgb {
  const hex = /^#([\da-f]{6})$/i.exec(value.trim());
  if (hex?.[1] === undefined) return fallback;
  const channel = (at: number): number => Number.parseInt(hex[1]!.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/**
 * The route's direction arrow (05 §11): a two-tone chevron, Paper on Ink by day
 * and Ink on Paper at night, so `icon-rotate: 0` line placement can turn it to
 * the direction of travel and it still reads on every basemap.
 */
export function createRouteArrowImage(palette: MapPalette, tone: RouteArrowTone): MarkerImage {
  const fill = tone === "night" ? rgb(palette.ink, INK) : rgb(palette.paper, WHITE);
  const halo = tone === "night" ? rgb(palette.paper, WHITE) : rgb(palette.ink, INK);
  const data = new Uint8Array(ARROW_SIZE * ARROW_SIZE * 4);
  const centre = ARROW_SIZE / 2;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < ARROW_SIZE; y += 1) {
    for (let x = 0; x < ARROW_SIZE; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLE - centre;
          const py = y + (sy + 0.5) / SUPERSAMPLE - centre;
          // The halo is the outer chevron; the fill sits on top of it, so only
          // one colour contributes per sample and the edge stays crisp.
          const colour = inside(px, py, ARROW) ? fill : inside(px, py, ARROW_HALO) ? halo : null;
          if (colour === null) continue;
          red += colour[0];
          green += colour[1];
          blue += colour[2];
          alpha += 1;
        }
      }
      if (alpha === 0) continue;
      const at = (y * ARROW_SIZE + x) * 4;
      data[at] = Math.round(red / alpha);
      data[at + 1] = Math.round(green / alpha);
      data[at + 2] = Math.round(blue / alpha);
      data[at + 3] = Math.round((255 * alpha) / samples);
    }
  }
  return {
    id: ROUTE_ARROW_IMAGE_ID,
    data: { width: ARROW_SIZE, height: ARROW_SIZE, data },
    options: { pixelRatio: PIXEL_RATIO },
  };
}
