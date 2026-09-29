/**
 * Approximate bounding boxes of US states (plus DC), for deciding which state
 * feeds a corridor touches. Coarse on purpose: a box that overshoots a border
 * only asks one extra feed; coverage honesty comes from what each feed answers.
 */

import type { BoundingBox } from "@/application/route-intelligence/types";

export const US_STATE_BOXES: Readonly<Record<string, BoundingBox>> = {
  alabama: { west: -88.47, south: 30.14, east: -84.89, north: 35.01 },
  alaska: { west: -179.15, south: 51.21, east: -129.98, north: 71.39 },
  arizona: { west: -114.82, south: 31.33, east: -109.04, north: 37.0 },
  arkansas: { west: -94.62, south: 33.0, east: -89.64, north: 36.5 },
  california: { west: -124.41, south: 32.53, east: -114.13, north: 42.01 },
  colorado: { west: -109.06, south: 36.99, east: -102.04, north: 41.0 },
  connecticut: { west: -73.73, south: 40.98, east: -71.79, north: 42.05 },
  delaware: { west: -75.79, south: 38.45, east: -75.05, north: 39.84 },
  "district of columbia": { west: -77.12, south: 38.79, east: -76.91, north: 38.99 },
  florida: { west: -87.63, south: 24.52, east: -80.03, north: 31.0 },
  georgia: { west: -85.61, south: 30.36, east: -80.84, north: 35.0 },
  hawaii: { west: -160.25, south: 18.91, east: -154.81, north: 22.24 },
  idaho: { west: -117.24, south: 41.99, east: -111.04, north: 49.0 },
  illinois: { west: -91.51, south: 36.97, east: -87.49, north: 42.51 },
  indiana: { west: -88.1, south: 37.77, east: -84.78, north: 41.76 },
  iowa: { west: -96.64, south: 40.38, east: -90.14, north: 43.5 },
  kansas: { west: -102.05, south: 36.99, east: -94.59, north: 40.0 },
  kentucky: { west: -89.57, south: 36.5, east: -81.96, north: 39.15 },
  louisiana: { west: -94.04, south: 28.93, east: -88.82, north: 33.02 },
  maine: { west: -71.08, south: 42.98, east: -66.95, north: 47.46 },
  maryland: { west: -79.49, south: 37.91, east: -75.05, north: 39.72 },
  massachusetts: { west: -73.51, south: 41.24, east: -69.93, north: 42.89 },
  michigan: { west: -90.42, south: 41.7, east: -82.41, north: 48.31 },
  minnesota: { west: -97.24, south: 43.5, east: -89.49, north: 49.38 },
  mississippi: { west: -91.66, south: 30.17, east: -88.1, north: 35.0 },
  missouri: { west: -95.77, south: 35.99, east: -89.1, north: 40.61 },
  montana: { west: -116.05, south: 44.36, east: -104.04, north: 49.0 },
  nebraska: { west: -104.05, south: 40.0, east: -95.31, north: 43.0 },
  nevada: { west: -120.01, south: 35.0, east: -114.04, north: 42.0 },
  "new hampshire": { west: -72.56, south: 42.7, east: -70.61, north: 45.31 },
  "new jersey": { west: -75.56, south: 38.93, east: -73.89, north: 41.36 },
  "new mexico": { west: -109.05, south: 31.33, east: -103.0, north: 37.0 },
  "new york": { west: -79.76, south: 40.5, east: -71.86, north: 45.02 },
  "north carolina": { west: -84.32, south: 33.84, east: -75.46, north: 36.59 },
  "north dakota": { west: -104.05, south: 45.94, east: -96.55, north: 49.0 },
  ohio: { west: -84.82, south: 38.4, east: -80.52, north: 41.98 },
  oklahoma: { west: -103.0, south: 33.62, east: -94.43, north: 37.0 },
  oregon: { west: -124.57, south: 41.99, east: -116.46, north: 46.29 },
  pennsylvania: { west: -80.52, south: 39.72, east: -74.69, north: 42.27 },
  "rhode island": { west: -71.86, south: 41.15, east: -71.12, north: 42.02 },
  "south carolina": { west: -83.35, south: 32.03, east: -78.54, north: 35.22 },
  "south dakota": { west: -104.06, south: 42.48, east: -96.44, north: 45.95 },
  tennessee: { west: -90.31, south: 34.98, east: -81.65, north: 36.68 },
  texas: { west: -106.65, south: 25.84, east: -93.51, north: 36.5 },
  utah: { west: -114.05, south: 37.0, east: -109.04, north: 42.0 },
  vermont: { west: -73.44, south: 42.73, east: -71.46, north: 45.02 },
  virginia: { west: -83.68, south: 36.54, east: -75.24, north: 39.47 },
  washington: { west: -124.85, south: 45.54, east: -116.92, north: 49.0 },
  "west virginia": { west: -82.64, south: 37.2, east: -77.72, north: 40.64 },
  wisconsin: { west: -92.89, south: 42.49, east: -86.25, north: 47.31 },
  wyoming: { west: -111.06, south: 40.99, east: -104.05, north: 45.01 },
};

/** "New Hampshire, Vermont, Maine" → its boxes; unknown names give none. */
export function stateBoxes(names: string): readonly BoundingBox[] {
  return names
    .split(/[,/;]|\band\b/i)
    .map((name) => US_STATE_BOXES[name.trim().toLowerCase()])
    .filter((box): box is BoundingBox => box !== undefined);
}

const CENTRAL = new Set(["alabama", "arkansas", "illinois", "iowa", "kansas", "louisiana", "minnesota", "mississippi", "missouri", "nebraska", "north dakota", "oklahoma", "south dakota", "tennessee", "texas", "wisconsin"]);
const MOUNTAIN = new Set(["colorado", "idaho", "montana", "new mexico", "utah", "wyoming"]);
const PACIFIC = new Set(["california", "nevada", "oregon", "washington"]);

/**
 * The time zone most of a state keeps, for schedules a feed states only as
 * local wall-clock text. Split states take their majority zone.
 */
export function stateTimeZone(names: string): string {
  const first = names.split(/[,/;]/)[0]?.trim().toLowerCase() ?? "";
  if (first === "arizona") return "America/Phoenix";
  if (first === "hawaii") return "Pacific/Honolulu";
  if (first === "alaska") return "America/Anchorage";
  if (CENTRAL.has(first)) return "America/Chicago";
  if (MOUNTAIN.has(first)) return "America/Denver";
  if (PACIFIC.has(first)) return "America/Los_Angeles";
  return "America/New_York";
}
