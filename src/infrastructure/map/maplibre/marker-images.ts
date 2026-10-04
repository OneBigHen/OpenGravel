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
 */

import type { PlaceImageData } from "./place-images";

export const MARKER_IMAGE_IDS = {
  start: "ogv-pin-start",
  finish: "ogv-pin-finish",
  stop: "ogv-pin-stop",
} as const;

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
