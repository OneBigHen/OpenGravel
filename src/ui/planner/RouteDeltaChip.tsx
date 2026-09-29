"use client";

/**
 * The route-delta chip (05-MAP-INTERACTION-AND-CARTOGRAPHY §12).
 *
 * 05 §12 asks the surface to "show distance/time delta in UI" after a successful
 * update, next to the changed-span emphasis on the map. This is that sentence, with
 * the two numbers the update changed and the reference it is measured against —
 * *vs previous*, never a bare "+3 min" that could be read as a total.
 *
 * The formatting is deliberately the product's existing copy for duration and
 * distance (`formatDuration`'s rules, `formatDistance`'s rounding), because a delta
 * a rider cannot compare with the route card's own numbers is a number they have to
 * re-derive by hand.
 */

import { formatDistance } from "@/application/planner/planner-view-model";
import type { RouteDelta } from "@/application/map/changed-span";

/** `{ addedMinutes: 3, addedMeters: 2897 }` → `"+3 min · +1.8 mi vs previous"`. */
export function routeDeltaText(delta: RouteDelta): string {
  const sign = (value: number): string => (value < 0 ? "-" : "+");
  const minutes = `${sign(delta.addedMinutes)}${Math.abs(delta.addedMinutes)} min`;
  const distance = `${sign(delta.addedMeters)}${formatDistance(Math.abs(delta.addedMeters))}`;
  return `${minutes} · ${distance} vs previous`;
}

export interface RouteDeltaChipProps {
  readonly delta: RouteDelta;
}

export function RouteDeltaChip({ delta }: RouteDeltaChipProps): React.ReactElement {
  return (
    <p className="og-route-delta" data-testid="route-delta-chip">
      {routeDeltaText(delta)}
    </p>
  );
}
