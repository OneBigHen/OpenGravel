/**
 * The rider's heading arrow (Google Maps parity): a Signal Blue navigation
 * chevron with a Paper outline, drawn once as pixels so it needs no asset or
 * canvas. The map rotates it to the heading and lays it on the tilted ground.
 */

import type { MapPalette } from "./style";
import type { PlaceImageData } from "./place-images";

export const PUCK_IMAGE_ID = "ogv-rider-puck";

const SIZE = 72;
const PIXEL_RATIO = 2;
/** Samples per pixel edge, for smooth edges without a canvas. */
const SUPERSAMPLE = 4;

type Point = readonly [number, number];

/** Pointing up: tip, right foot, the notch, left foot. */
const ARROW: readonly Point[] = [[36, 8], [60, 62], [36, 50], [12, 62]];

function inside(x: number, y: number, polygon: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function scaled(polygon: readonly Point[], factor: number): readonly Point[] {
  const cx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
  const cy = polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length;
  return polygon.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as const);
}

function rgb(value: string, fallback: readonly [number, number, number]): readonly [number, number, number] {
  const hex = /^#([\da-f]{6})$/i.exec(value);
  if (hex?.[1] === undefined) return fallback;
  return [0, 2, 4].map((at) => Number.parseInt(hex[1]!.slice(at, at + 2), 16)) as unknown as readonly [number, number, number];
}

export function createPuckImage(palette: MapPalette): {
  readonly id: string;
  readonly data: PlaceImageData;
  readonly options: { readonly pixelRatio: number };
} {
  const blue = rgb(palette.signalBlue, [26, 115, 232]);
  const paper = rgb(palette.paper, [251, 249, 244]);
  const outline = scaled(ARROW, 1.2);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let fill = 0;
      let edge = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLE;
          const py = y + (sy + 0.5) / SUPERSAMPLE;
          if (inside(px, py, ARROW)) fill += 1;
          else if (inside(px, py, outline)) edge += 1;
        }
      }
      const cover = (fill + edge) / samples;
      if (cover === 0) continue;
      const blueShare = fill / (fill + edge);
      const at = (y * SIZE + x) * 4;
      // Straight RGBA, like the place pills.
      for (let channel = 0; channel < 3; channel += 1) {
        data[at + channel] = Math.round(blue[channel]! * blueShare + paper[channel]! * (1 - blueShare));
      }
      data[at + 3] = Math.round(255 * cover);
    }
  }
  return { id: PUCK_IMAGE_ID, data: { width: SIZE, height: SIZE, data }, options: { pixelRatio: PIXEL_RATIO } };
}
