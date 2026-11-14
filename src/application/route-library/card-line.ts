import type { Coordinate } from "@/domain/ride/types";

/**
 * The index's card line (`c`): the SHAPE of a ride, for a list thumbnail.
 *
 * A polyline would add 300 KB gzipped to an index that has to stay under 400,
 * and a thumbnail does not need geography, so a card line is `CARD_LINE_POINTS`
 * points drawn on a 64 x 64 grid, two characters per point (x then y), each
 * character one base64url symbol (value 0 to 63). The grid is scaled once to
 * the line's longer side, so the shape keeps its true proportions.
 * x: 0 is the west edge, 63 the east. y: 0 is the north edge, 63 the south
 * (screen direction). The rest of the 64 x 64 square is empty.
 */
export const CARD_LINE_POINTS = 16;
export const CARD_GRID = 63;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface CardPoint {
  readonly x: number;
  readonly y: number;
}

export function encodeCardLine(points: readonly Coordinate[]): string {
  if (points.length < 2) return "";
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const lonScale = Math.cos(((south + north) / 2) * Math.PI / 180);
  const width = (east - west) * lonScale;
  const height = north - south;
  const span = Math.max(width, height);
  if (span === 0) return "";
  let encoded = "";
  for (const point of points) {
    const x = Math.round(((point.lon - west) * lonScale / span) * CARD_GRID);
    const y = Math.round(((north - point.lat) / span) * CARD_GRID);
    encoded += ALPHABET[x] ?? "A";
    encoded += ALPHABET[y] ?? "A";
  }
  return encoded;
}

/** Points of a card line on its 0 to 63 grid; `[]` for an empty or malformed string. */
export function decodeCardLine(encoded: string | null): readonly CardPoint[] {
  if (encoded === null || encoded.length < 4 || encoded.length % 2 !== 0) return [];
  const points: CardPoint[] = [];
  for (let index = 0; index < encoded.length; index += 2) {
    const x = ALPHABET.indexOf(encoded.charAt(index));
    const y = ALPHABET.indexOf(encoded.charAt(index + 1));
    if (x < 0 || y < 0) return [];
    points.push({ x, y });
  }
  return points;
}
