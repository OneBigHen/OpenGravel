/**
 * The wind layer's arrow images (MAP-EXPERIENCE-NEXT Wave 3, item 13).
 *
 * One image per strength band, drawn as pixels like the pins and the route
 * arrow, so a band's colour is a fact of the image rather than a glyph tint the
 * renderer may or may not support. The arrow points up; the map layer rotates it
 * with `icon-rotate` to point downwind.
 *
 * The rim is the map's own ink, which is dark by day and light at night, so a
 * saturated arrow holds on the paper map, over satellite imagery and on Night
 * contrast. The filled colour is the band's — the size and the colour say the
 * same thing, because a rider should not have to compare two arrow sizes to see
 * that a gust front is coming.
 */

import {
  WIND_BANDS,
  windArrowImageId,
  type WindBandDefinition,
  type WindTone,
} from "@/application/map-layers/wind";

import type { PlaceImageData } from "./place-images";
import type { MapPalette } from "./style";

export interface WindArrowImage {
  readonly id: string;
  readonly data: PlaceImageData;
  readonly options: { readonly pixelRatio: number };
}

/** Image edge in device pixels: an 18 CSS px arrow with a rim, at pixelRatio 2. */
const SIZE = 36;
const PIXEL_RATIO = 2;
const SUPERSAMPLE = 4;
const CENTRE = SIZE / 2;
/** Baked shape scale: a ~15 CSS px arrow at icon-size 1, before the band's factor. */
const SHAPE_SCALE = 2.2;

type Rgb = readonly [number, number, number];

/** The band's colour, as the palette slot it names. */
const TONE_SLOT: Readonly<Record<WindTone, keyof MapPalette>> = {
  sage: "topoSage",
  signal: "signalBlue",
  gold: "goldenHour",
  ember: "emberStrong",
};

/**
 * The arrow outline, pointing up: a slim tail with a broad head. Coordinates are
 * in device pixels from the image centre. The shape is drawn at one size for
 * every band; the map layer scales it with the band's size factor, so the image
 * only ever carries the band's colour.
 */
function arrowShape(scale: number, grow: number): readonly (readonly [number, number])[] {
  const unit: readonly (readonly [number, number])[] = [
    [0, -7.2],
    [4.4, -1.2],
    [1.5, -1.2],
    [1.5, 6.2],
    [-1.5, 6.2],
    [-1.5, -1.2],
    [-4.4, -1.2],
  ];
  return unit.map(([x, y]) => [x * scale + Math.sign(x) * grow, y * scale + (y < 0 ? -grow : y > 0 ? grow : 0)] as const);
}

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

function rgb(value: string, fallback: Rgb): Rgb {
  const hex = /^#([\da-f]{6})$/i.exec(value.trim());
  if (hex?.[1] === undefined) return fallback;
  const channel = (at: number): number => Number.parseInt(hex[1]!.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/** Draws one band's arrow: the band colour inside an ink rim, supersampled. */
function arrowImage(definition: WindBandDefinition, palette: MapPalette): WindArrowImage {
  const fill = rgb(palette[TONE_SLOT[definition.tone]], [57, 124, 150]);
  const rim = rgb(palette.ink, [22, 29, 28]);
  const shape = arrowShape(SHAPE_SCALE, 0);
  const rimShape = arrowShape(SHAPE_SCALE, 0.9);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x + (sx + 0.5) / SUPERSAMPLE - CENTRE;
          const py = y + (sy + 0.5) / SUPERSAMPLE - CENTRE;
          const colour = inside(px, py, shape) ? fill : inside(px, py, rimShape) ? rim : null;
          if (colour === null) continue;
          red += colour[0];
          green += colour[1];
          blue += colour[2];
          alpha += 1;
        }
      }
      if (alpha === 0) continue;
      const at = (y * SIZE + x) * 4;
      data[at] = Math.round(red / alpha);
      data[at + 1] = Math.round(green / alpha);
      data[at + 2] = Math.round(blue / alpha);
      data[at + 3] = Math.round((255 * alpha) / samples);
    }
  }
  return {
    id: windArrowImageId(definition.band),
    data: { width: SIZE, height: SIZE, data },
    options: { pixelRatio: PIXEL_RATIO },
  };
}

/** One image per strength band, in band order (lightest first). */
export function createWindArrowImages(palette: MapPalette): readonly WindArrowImage[] {
  return WIND_BANDS.map((definition) => arrowImage(definition, palette));
}
