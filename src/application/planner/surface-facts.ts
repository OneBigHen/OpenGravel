/**
 * The one honest surface sentence on a route preview: how much of the ride is
 * dirt or gravel, and how much nobody knows. Unknown is never rounded away
 * (CLAUDE.md core invariant): a ride with any unknown stretch says so, even
 * when it is under a mile.
 */

const METERS_PER_MILE = 1609.344;

export interface SurfaceShares {
  readonly paved: number;
  readonly gravel: number;
  readonly dirt: number;
  readonly unknown: number;
}

export interface SurfaceFacts {
  /** Dirt plus gravel, 0–1. */
  readonly unpavedShare: number;
  /** Miles of unknown surface; `null` when the ride length is not known. */
  readonly unknownMiles: number | null;
  /** e.g. `41% gravel · 3 mi surface unknown`, `all paved`, `surface unknown`. */
  readonly line: string;
}

function unknownPart(share: number, distanceMeters: number | undefined): string {
  if (distanceMeters === undefined || !(distanceMeters > 0)) return `${Math.max(1, Math.round(share * 100))}% surface unknown`;
  const miles = (share * distanceMeters) / METERS_PER_MILE;
  return miles < 0.5 ? "<1 mi surface unknown" : `${Math.round(miles)} mi surface unknown`;
}

export function surfaceFacts(strip: SurfaceShares | undefined, distanceMeters?: number): SurfaceFacts {
  if (strip === undefined) return { unpavedShare: 0, unknownMiles: null, line: "surface unknown" };
  const total = strip.paved + strip.gravel + strip.dirt + strip.unknown;
  if (!(total > 0)) return { unpavedShare: 0, unknownMiles: null, line: "surface unknown" };
  const share = (value: number): number => value / total;
  const unpaved = share(strip.gravel + strip.dirt);
  const unknown = share(strip.unknown);
  const unknownMiles = distanceMeters !== undefined && distanceMeters > 0 ? (unknown * distanceMeters) / METERS_PER_MILE : null;
  if (unknown >= 0.999) return { unpavedShare: 0, unknownMiles, line: "surface unknown" };
  const parts: string[] = [];
  if (unpaved > 0) {
    const word = strip.dirt > 0 && strip.gravel > 0 ? "dirt & gravel" : strip.dirt > 0 ? "dirt" : "gravel";
    parts.push(`${Math.max(1, Math.round(unpaved * 100))}% ${word}`);
  } else if (unknown === 0) {
    parts.push("all paved");
  } else {
    // Never "no gravel found" beside an unknown stretch: what is known is paved.
    parts.push("paved where known");
  }
  if (unknown > 0) parts.push(unknownPart(unknown, distanceMeters));
  return { unpavedShare: unpaved, unknownMiles, line: parts.join(" · ") };
}
