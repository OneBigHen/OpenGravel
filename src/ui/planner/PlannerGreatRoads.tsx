"use client";

/**
 * The library's best rides near the route the rider is about to take (L6).
 *
 * This is the one place the planned line and the national catalogue meet: the
 * rows come from `ridesAlongRoute`, the words from the library's own vocabulary
 * (quality, type, length, credit). Nothing is added to the route and nothing is
 * claimed as on it; a ride is "8 mi off route" until the rider opens it.
 */

import Link from "next/link";

import { creditWord, qualityAndType } from "@/application/route-library/row-words";
import type { AlongRouteRide } from "@/application/route-library/along-route";
import { formatDistance } from "@/application/planner/measurements";
import { rowLengthText } from "@/ui/explore/RoutesMapCard";

export interface PlannerGreatRoadsProps {
  readonly rides: readonly AlongRouteRide[];
  readonly sources: readonly string[];
}

/** `On route` for a start on the line, else `8 mi off`. */
export function offRouteLabel(meters: number): string {
  return meters <= 350 ? "On route" : `${formatDistance(meters)} off`;
}

export function PlannerGreatRoads({ rides, sources }: PlannerGreatRoadsProps) {
  if (rides.length === 0) return null;
  return (
    <section className="og-along" aria-labelledby="great-roads-near-route" data-testid="great-roads-along">
      <div className="og-road-discovery__slice-head">
        <h2 id="great-roads-near-route" className="og-along__title">Great roads near your route</h2>
        <span>{rides.length} {rides.length === 1 ? "ride" : "rides"}</span>
      </div>
      <ul className="og-along__list" aria-label="Great roads near your route">
        {rides.map(({ row, offRouteMeters }) => {
          const length = rowLengthText(row);
          const credit = creditWord(row, sources);
          return (
            <li key={row.id} className="og-along__stop" data-testid="great-road-row">
              <span className="og-along__stop-mile">{offRouteLabel(offRouteMeters)}</span>
              <span className="og-along__stop-place">
                <span>{row.n}</span>
                <small>{[qualityAndType(row), length].filter((part): part is string => part !== null).join(" · ")}</small>
                {credit === null ? null : <small>{credit}</small>}
              </span>
              <Link className="og-opp__link" href={`/explore/${encodeURIComponent(row.id)}`}>
                Open
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
