/**
 * The rider's style as Valhalla `motorcycle` costing options.
 *
 * Valhalla answers only where OpenGravel's own graph does not reach, so this is
 * a deliberately coarse translation of the same choices the rider made in Ride
 * style. It never claims more than it does: the answer is still labelled as a
 * basic route, and nothing here turns into surface, closure or access evidence.
 *
 * - Fast / balanced: Valhalla's defaults.
 * - Curvy / backroads: stay off highways and big roads (`use_highways` 0.1,
 *   `use_primary` 0.3).
 * - Gravel (some unpaved asked for): `use_trails` 0.6. Dirt (dirt preferred, or
 *   a dual-sport bike): `use_trails` 0.9. A bike set to avoid rough tracks is
 *   held at the gravel value; a bike set to avoid gravel gets no trails at all.
 * - Avoid highways and avoid tolls map onto their own switches.
 */

import type { ProviderRouteOptions } from "@/application/planner/route-provider";

export interface ValhallaMotorcycleCosting {
  readonly use_highways?: number;
  readonly use_primary?: number;
  readonly use_trails?: number;
  readonly use_tolls?: number;
}

export const CURVY_COSTING = { use_highways: 0.1, use_primary: 0.3 } as const;
export const GRAVEL_TRAILS = 0.6;
export const DIRT_TRAILS = 0.9;

/** How much dirt the rider's style asks for: none, some gravel, or dirt. */
export function unpavedAppetite(options: ProviderRouteOptions): "none" | "gravel" | "dirt" {
  if (options.bike?.maintainedGravel === "avoid") return "none";
  const wantsDirt = options.surfacePreference === "dirt-preferred" || options.bike?.category === "dual-sport";
  if (wantsDirt) return options.bike?.roughTracks === "avoid" ? "gravel" : "dirt";
  if ((options.targetUnpavedShare ?? 0) > 0) return "gravel";
  return "none";
}

export function valhallaCostingOptions(options: ProviderRouteOptions): ValhallaMotorcycleCosting {
  const costing: { -readonly [K in keyof ValhallaMotorcycleCosting]: number } = {};
  if (options.roadCharacter === "curvy" || options.roadCharacter === "backroads") {
    costing.use_highways = CURVY_COSTING.use_highways;
    costing.use_primary = CURVY_COSTING.use_primary;
  }
  const appetite = unpavedAppetite(options);
  if (appetite === "gravel") costing.use_trails = GRAVEL_TRAILS;
  if (appetite === "dirt") costing.use_trails = DIRT_TRAILS;
  if (options.avoidHighways) costing.use_highways = 0;
  if (options.tollPolicy === "avoid") costing.use_tolls = 0;
  return costing;
}
