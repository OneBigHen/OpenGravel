/** Rider-sized category pins and selected names. No MapLibre glyph service required. */
import type { PlaceGlyph } from "@/application/geocoding/place-glyph";
import type { MarkerImage } from "./marker-images";

const GLYPHS: readonly PlaceGlyph[] = ["gas", "food", "coffee", "lodging", "moto", "place"];
const SIZE = 96;
const RATIO = 2;
const SAMPLES = 3;
type Point = readonly [number, number];
type Segment = readonly [Point, Point];
type Color = readonly [number, number, number];
const INK: Color = [22, 29, 28];
const PAPER: Color = [255, 253, 247];
const GOLD: Color = [224, 174, 77];

export function searchPinImageId(glyph: PlaceGlyph): string { return `ogv-search-pin-${glyph}`; }
/** The exact name keys the image; no hash collision can leave another place's name. */
export function searchLabelImageId(name: string): string { return `ogv-search-name:${name}`; }

function stroke(x: number, y: number, segments: readonly Segment[], width = 1.5): boolean {
  return segments.some(([[ax, ay], [bx, by]]) => {
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= width / 2;
  });
}

const PATHS: Record<Exclude<PlaceGlyph, "place">, readonly Segment[]> = {
  gas: [
    [[-6, 7], [3, 7]], [[-5, 7], [-5, -7]], [[-5, -7], [2, -7]], [[2, -7], [2, 7]],
    [[-5, -1], [2, -1]], [[-3, -5], [0, -5]], [[4, -6], [7, -3]], [[7, -3], [7, 4]],
    [[7, 4], [5, 5]], [[5, 5], [4, 3]], [[4, 3], [4, 0]], [[4, 0], [2, 0]],
  ],
  food: [
    [[-5, -7], [-5, 7]], [[-8, -7], [-8, -2]], [[-2, -7], [-2, -2]],
    [[-8, -2], [-2, -2]], [[6, -7], [6, 7]], [[6, -7], [3, -2]], [[3, -2], [3, 1]], [[3, 1], [6, 1]],
  ],
  coffee: [
    [[-7, -4], [4, -4]], [[-7, -4], [-6, 5]], [[-6, 5], [3, 5]], [[3, 5], [4, -4]],
    [[4, -3], [7, -3]], [[7, -3], [7, 1]], [[7, 1], [4, 2]], [[-8, 8], [5, 8]],
    [[-3, -9], [-3, -7]], [[1, -9], [1, -7]],
  ],
  lodging: [
    [[-8, -6], [-8, 8]], [[8, 0], [8, 8]], [[-8, 4], [8, 4]],
    [[-8, 0], [8, 0]], [[-5, -3], [-2, -3]], [[-5, -3], [-5, 0]], [[-2, -3], [-2, 0]],
    [[0, -3], [7, -3]], [[7, -3], [8, 0]], [[0, -3], [0, 0]],
  ],
  moto: [
    [[-7, 7], [2, -2]], [[-5, 9], [4, 0]], [[-7, 7], [-5, 9]],
    [[2, -2], [1, -6]], [[1, -6], [4, -9]], [[4, -9], [4, -5]],
    [[4, -5], [7, -4]], [[7, -4], [9, -7]], [[9, -7], [9, -2]], [[9, -2], [6, 0]], [[6, 0], [4, 0]],
  ],
};

function glyphAt(glyph: PlaceGlyph, x: number, y: number): boolean {
  if (glyph === "place") return Math.abs(Math.hypot(x, y + 2) - 4) < 1 || stroke(x, y, [[[0, 3], [0, 8]]], 2);
  return stroke(x, y, PATHS[glyph]);
}

let pinImages: readonly MarkerImage[] | null = null;

/** 32px visible disc, padded to a 48px symbol hit box. High-contrast rim holds in Night. */
export function createSearchPinImages(): readonly MarkerImage[] {
  if (pinImages !== null) return pinImages;
  pinImages = GLYPHS.map((glyph) => {
    const data = new Uint8Array(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) {
        const px = (x + (sx + .5) / SAMPLES) / RATIO - SIZE / RATIO / 2;
        const py = (y + (sy + .5) / SAMPLES) / RATIO - SIZE / RATIO / 2;
        const radius = Math.hypot(px, py);
        if (radius > 16) continue;
        const color = radius > 15 ? INK : radius > 13 ? PAPER : glyphAt(glyph, px, py) ? INK : GOLD;
        red += color[0]; green += color[1]; blue += color[2]; alpha++;
      }
      if (alpha === 0) continue;
      const at = (y * SIZE + x) * 4;
      data[at] = Math.round(red / alpha); data[at + 1] = Math.round(green / alpha); data[at + 2] = Math.round(blue / alpha);
      data[at + 3] = Math.round(255 * alpha / SAMPLES ** 2);
    }
    return { id: searchPinImageId(glyph), data: { width: SIZE, height: SIZE, data }, options: { pixelRatio: RATIO } };
  });
  return pinImages;
}

/** Browser text is rasterized into one image; the map never requests a font range. */
export function createSelectedPlaceLabel(name: string): MarkerImage | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) return null;
  const font = "600 13px sans-serif";
  context.font = font;
  const width = Math.min(220, Math.ceil(context.measureText(name).width) + 20);
  canvas.width = width * RATIO;
  canvas.height = 30 * RATIO;
  context.scale(RATIO, RATIO);
  context.font = font;
  context.fillStyle = "#fffdf7";
  context.strokeStyle = "#161d1c";
  context.lineWidth = 1;
  context.beginPath(); context.roundRect(.5, .5, width - 1, 29, 8); context.fill(); context.stroke();
  context.fillStyle = "#161d1c";
  context.textAlign = "center";
  context.textBaseline = "middle";
  let shown = name;
  while (context.measureText(shown).width > width - 20 && shown.length > 1) shown = shown.slice(0, -1);
  if (shown !== name) shown = `${shown.slice(0, -1)}…`;
  context.fillText(shown, width / 2, 15);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { id: searchLabelImageId(name), data: { width: canvas.width, height: canvas.height, data: new Uint8Array(pixels.data) }, options: { pixelRatio: RATIO } };
}
