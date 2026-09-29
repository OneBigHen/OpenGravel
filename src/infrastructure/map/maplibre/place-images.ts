/** Runtime-generated stretchable pill backgrounds for the places symbol layers (OGV-D-274). */

import type { MapPalette } from "./style";

export const PLACE_IMAGE_IDS = {
  live: "ogv-place-live",
  soon: "ogv-place-soon",
  quiet: "ogv-place-quiet",
  selected: "ogv-place-selected",
} as const;

/** Route-name pills, one per route colour slot, keyed by the route's `tint`. */
export const ROUTE_LABEL_IMAGE_IDS = [
  "ogv-route-label-0",
  "ogv-route-label-1",
  "ogv-route-label-2",
  "ogv-route-label-3",
] as const;

export interface PlaceImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface PlacePillImage {
  readonly id: string;
  readonly data: PlaceImageData;
  readonly options: {
    readonly pixelRatio: number;
    readonly stretchX: readonly (readonly [number, number])[];
    readonly stretchY: readonly (readonly [number, number])[];
    readonly content: readonly [number, number, number, number];
  };
}

const WIDTH = 72;
const HEIGHT = 40;
const PIXEL_RATIO = 2;
const BODY = { left: 2, top: 2, right: 70, bottom: 35, radius: 12 } as const;

type Rgb = readonly [number, number, number];

function parseColor(value: string, fallback: Rgb): Rgb {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb?.[1] !== undefined && rgb[2] !== undefined && rgb[3] !== undefined) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return fallback;
}

function tint(paper: Rgb, goldenHour: Rgb): Rgb {
  return [
    Math.round(paper[0] * 0.72 + goldenHour[0] * 0.28),
    Math.round(paper[1] * 0.72 + goldenHour[1] * 0.28),
    Math.round(paper[2] * 0.72 + goldenHour[2] * 0.28),
  ];
}

function insideRoundRect(x: number, y: number): boolean {
  const { left, top, right, bottom, radius } = BODY;
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function put(data: Uint8Array, x: number, y: number, color: Rgb, alpha = 255): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = alpha;
}

function image(fill: Rgb, dot: Rgb | null = null): PlaceImageData {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  const shadow: Rgb = [0, 0, 0];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      // Three soft, low-opacity offsets bake a subtle shadow without a canvas or
      // a renderer-specific image asset.
      if (insideRoundRect(x, y - 3)) put(data, x, y, shadow, 10);
      else if (insideRoundRect(x, y - 2)) put(data, x, y, shadow, 20);
      else if (insideRoundRect(x, y - 1)) put(data, x, y, shadow, 28);
      if (insideRoundRect(x, y)) put(data, x, y, fill);
    }
  }
  if (dot !== null) {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const dx = x - 12;
        const dy = y - 19;
        if (dx * dx + dy * dy <= 11) put(data, x, y, dot);
      }
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

/** Builds high-DPI rounded backgrounds, with stretch regions in their flat center. */
export function createPlacePillImages(palette: MapPalette): readonly PlacePillImage[] {
  const ink = parseColor(palette.ink, [22, 29, 28]);
  const paper = parseColor(palette.paper, [251, 249, 244]);
  const goldenHour = parseColor(palette.goldenHour, [201, 154, 70]);
  const liveFill = tint(paper, goldenHour);
  const options = {
    pixelRatio: PIXEL_RATIO,
    stretchX: [[24, 48]] as const,
    stretchY: [[12, 28]] as const,
    content: [23, 6, 67, 34] as const,
  };
  return [
    { id: PLACE_IMAGE_IDS.live, data: image(liveFill, goldenHour), options },
    { id: PLACE_IMAGE_IDS.soon, data: image(paper), options },
    { id: PLACE_IMAGE_IDS.quiet, data: image(paper), options },
    { id: PLACE_IMAGE_IDS.selected, data: image(ink), options },
    // Route names wear their line's colour as the dot, so the pill reads as the
    // line's own tag (same slots as `tintColor` in style.ts).
    ...[palette.ember, palette.routePlum, palette.deepSpruce, palette.slate].map((color, slot) => ({
      id: ROUTE_LABEL_IMAGE_IDS[slot]!,
      data: image(paper, parseColor(color, [22, 29, 28])),
      options,
    })),
  ];
}
