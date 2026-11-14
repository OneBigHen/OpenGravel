/**
 * The route page's one line of facts: how far, how long, what is under the
 * wheels and how much it turns.
 *
 * Each fact is one unbreakable unit on that line. The time figure used to
 * carry its pace inside the same item ("~2 h 15 min" / "at 28 mph"), so at
 * 320 px it split and the stylesheet's trailing middot stood alone on a line
 * of its own. So a fact here is one string with no separator inside it, the
 * assumptions behind a figure travel as a `note` (a pointer or screen-reader
 * hint) rather than as words on the line, and the stylesheet draws the
 * separators.
 *
 * A fact this route cannot state is left out. Unknown is never printed as a
 * value, and a line of four absences is not a fact a rider can use.
 */

import { formatWholeMinutes } from "@/domain/format/duration";
import {
  estimatedRideMinutes,
  RIDE_TIME_PACE_MPH,
} from "@/application/explore/ride-time-estimate";

/**
 * The pace and the estimate live in `application/explore/ride-time-estimate.ts`
 * so the ride page, the planner's card and the weekend cards cannot state three
 * different times for the same ride. Re-exported here because this is the page's
 * fact vocabulary.
 */
export { estimatedRideMinutes, RIDE_TIME_PACE_MPH };

export type RideFactKey = "distance" | "time" | "surface" | "curvature";

export interface RideFact {
  readonly key: RideFactKey;
  /** The words a rider reads on the line. */
  readonly text: string;
  /** What the figure assumes (an estimate's pace); never on the line itself. */
  readonly note?: string;
}

/** `95` → `1 h 35 min`, `120` → `2 h`; a ride under a minute is a minute. */
export function formatRideMinutes(minutes: number): string {
  return formatWholeMinutes(Math.max(1, minutes));
}

export interface RideFactsInput {
  readonly distanceKm: number | null | undefined;
  /** The route record's own ride time, when the record carries one. */
  readonly estimatedTimeMinutes: number | undefined;
  /** The ride's surface, already named the way this page names it. */
  readonly surfaceLabel: string | null;
  readonly curvatureSummary: string | undefined;
  /** How this page writes a distance; the facts own no units. */
  readonly formatDistance: (metres: number) => string;
}

/**
 * One fact's own middot ("Mostly paved · 2.1 mi gravel") would read as the
 * line's separator, so inside a fact it becomes a comma.
 */
function oneFact(text: string): string {
  return text.split(" · ").join(", ");
}

export function routeFacts(input: RideFactsInput): readonly RideFact[] {
  const facts: RideFact[] = [];
  if (input.distanceKm !== null && input.distanceKm !== undefined && Number.isFinite(input.distanceKm)) {
    facts.push({ key: "distance", text: input.formatDistance(input.distanceKm * 1000) });
  }
  const stated = input.estimatedTimeMinutes;
  if (stated !== undefined && Number.isFinite(stated)) {
    facts.push({ key: "time", text: formatRideMinutes(stated) });
  } else {
    const estimate = estimatedRideMinutes(input.distanceKm);
    if (estimate !== null) {
      facts.push({
        key: "time",
        text: `~${formatRideMinutes(estimate)}`,
        note: `Estimated at ${RIDE_TIME_PACE_MPH} mph`,
      });
    }
  }
  if (input.surfaceLabel !== null && input.surfaceLabel !== "") {
    facts.push({ key: "surface", text: oneFact(input.surfaceLabel) });
  }
  if (input.curvatureSummary !== undefined && input.curvatureSummary !== "") {
    facts.push({ key: "curvature", text: oneFact(input.curvatureSummary) });
  }
  return facts;
}
