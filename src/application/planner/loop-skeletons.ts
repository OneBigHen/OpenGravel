/**
 * Loop rings: a loop built from known good roads instead of a random far point.
 *
 * Pure and deterministic. Given the start, the ride time and a list of anchors
 * (good dirt or good twisty roads the router agreed it can ride through), it
 * draws up to three circles through the start, each pointing a different way,
 * and picks two or three anchors near each circle. The caller routes
 * start -> anchors -> start as one request per ring.
 */

import type { Coordinate } from "@/domain/ride/types";

/** Metres of road per metre of circle: roads wiggle. */
export const ROAD_WIGGLE = 1.5;
/** The ring radius may be re-scaled by a correction pass inside this range. */
export const RING_SCALE_MIN = 0.6;
export const RING_SCALE_MAX = 1.6;
const MIN_DIRECTION_GAP_DEGREES = 60;
const DIRECTION_STEP_DEGREES = 15;
/** Points on the circle, as a share of the way round from the start. */
const CIRCLE_STOPS = [0.25, 0.5, 0.75] as const;
/** How far from the circle an anchor may sit, as a share of the radius; tried in order. */
const REACH_SHARES = [0.4, 0.65, 0.9] as const;
const EARTH_RADIUS_M = 6_371_000;

/** The slice of an anchor this module needs. */
export interface RingAnchor {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly quality: number;
  readonly lengthMeters: number;
  /** Direction of travel along the checked stretch, degrees clockwise of north. */
  readonly heading?: number;
}

export interface LoopRing {
  /** Which direction slot this ring is (0 to 2); a correction keeps it. */
  readonly slot: number;
  /** Bearing of the ring's centre from the start, degrees clockwise of north. */
  readonly bearing: number;
  /** Radius scale used to place this ring's anchors. */
  readonly scale: number;
  readonly anchors: readonly (Coordinate & { readonly heading?: number })[];
  readonly anchorIds: readonly string[];
}

export interface RingInput {
  readonly start: Coordinate;
  /** Length of the whole loop on the road, metres (time times the profile's speed). */
  readonly loopMeters: number;
  /** The rider's "which way" heading, degrees; fixes the first ring. */
  readonly heading?: number;
  /** Stable text from the ask; picks the circle's turning side and breaks ties. */
  readonly seedKey: string;
  /** Anchors in a box around the start, best first is not required. */
  readonly anchors: readonly RingAnchor[];
}

function toRad(degrees: number): number { return (degrees * Math.PI) / 180; }
function toDeg(radians: number): number { return (radians * 180) / Math.PI; }

export function destinationPoint(from: Coordinate, bearingDegrees: number, meters: number): Coordinate {
  const d = meters / EARTH_RADIUS_M;
  const b = toRad(bearingDegrees);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

/** The three or four circle points a ring aims anchors at, for a centre bearing and scale. */
function circleStops(start: Coordinate, bearing: number, radius: number, clockwise: boolean): Coordinate[] {
  const centre = destinationPoint(start, bearing, radius);
  // Angle of the start as seen from the centre.
  const fromCentre = (bearing + 180) % 360;
  return CIRCLE_STOPS.map((share) => {
    const turn = (clockwise ? 1 : -1) * share * 360;
    return destinationPoint(centre, (fromCentre + turn + 360) % 360, radius);
  });
}

/** Best anchor within reach of a point, never reusing a corridor. */
function nearestGood(
  point: Coordinate,
  anchors: readonly RingAnchor[],
  reach: number,
  used: ReadonlySet<string>,
  skip = 0,
): RingAnchor | null {
  const scored: { anchor: RingAnchor; score: number }[] = [];
  for (const anchor of anchors) {
    if (used.has(anchor.id)) continue;
    const gap = distanceMeters(point, anchor);
    if (gap > reach) continue;
    // Quality first; distance to the circle breaks near-ties.
    scored.push({ anchor, score: anchor.quality - (gap / reach) * 0.25 });
  }
  scored.sort((a, b) => b.score - a.score || (a.anchor.id < b.anchor.id ? -1 : 1));
  return (scored[skip] ?? scored[0])?.anchor ?? null;
}

/** Anchors per direction as a measure of how well the country supports a ring that way. */
function directionSupport(input: RingInput, bearing: number, radius: number, clockwise: boolean): number {
  const reach = Math.max(1_500, radius * 0.65);
  const used = new Set<string>();
  let support = 0;
  for (const stop of circleStops(input.start, bearing, radius, clockwise)) {
    const found = nearestGood(stop, input.anchors, reach, used);
    if (found !== null) { support += found.quality; used.add(found.id); }
  }
  return support;
}

/** Builds up to three rings at least 60 degrees apart. Empty when fewer than two anchors fit anywhere. */
export function planLoopRings(input: RingInput, scales: readonly number[] = []): readonly LoopRing[] {
  if (input.anchors.length < 2) return [];
  const circumference = input.loopMeters / ROAD_WIGGLE;
  const baseRadius = circumference / (2 * Math.PI);
  if (!(baseRadius > 500)) return [];
  const firstClockwise = hashText(input.seedKey) % 2 === 0;

  // Choose directions at scale 1 so a correction never moves a ring to another way.
  const candidates: { bearing: number; support: number }[] = [];
  for (let bearing = 0; bearing < 360; bearing += DIRECTION_STEP_DEGREES) {
    candidates.push({ bearing, support: directionSupport(input, bearing, baseRadius, firstClockwise) });
  }
  const chosen: number[] = [];
  if (input.heading !== undefined && Number.isFinite(input.heading)) {
    // The rider's heading is the way they leave; the centre sits that way.
    chosen.push(((input.heading % 360) + 360) % 360);
  }
  const ranked = [...candidates].sort((a, b) => b.support - a.support || a.bearing - b.bearing);
  for (const candidate of ranked) {
    if (chosen.length >= 3) break;
    if (candidate.support <= 0) break;
    if (chosen.every((bearing) => angleGap(bearing, candidate.bearing) >= MIN_DIRECTION_GAP_DEGREES)) chosen.push(candidate.bearing);
  }

  const rings: LoopRing[] = [];
  // Each direction gets two rings: one on the best anchors, one on the
  // runners-up, so a ring that has to double back has a different sibling.
  chosen.forEach((bearing, direction) => {
    for (const turn of [0, 1]) {
      const slot = direction * 2 + turn;
      const clockwise = firstClockwise;
      const scale = Math.min(RING_SCALE_MAX, Math.max(RING_SCALE_MIN, scales[slot] ?? 1));
      const radius = baseRadius * scale;
      // Look near the circle first, then wider, so a corrected ring rarely vanishes.
      let picked: RingAnchor[] = [];
      for (const share of REACH_SHARES) {
        const reach = Math.max(1_500, radius * share);
        const used = new Set<string>();
        picked = [];
        for (const stop of circleStops(input.start, bearing, radius, clockwise)) {
          const found = nearestGood(stop, input.anchors, reach, used, turn);
          if (found !== null) { picked.push(found); used.add(found.id); }
        }
        if (picked.length >= 2) break;
      }
      if (picked.length < 2) continue;
      rings.push({
        slot, bearing, scale,
        anchors: picked.map((anchor) => ({ lat: anchor.lat, lon: anchor.lon, ...(anchor.heading === undefined ? {} : { heading: anchor.heading }) })),
        anchorIds: picked.map((anchor) => anchor.id),
      });
    }
  });
  return rings;
}
