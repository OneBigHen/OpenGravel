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

/**
 * The mileage pace a catalog route with no stored ride time is estimated at.
 * `application/explore/ride-this.ts` rounds the planner's card with the same
 * pace, so one route does not read two different times on two screens.
 */
export const RIDE_TIME_PACE_MPH = 28;

/** The estimate is stated to the quarter hour, never to the minute. */
const RIDE_TIME_STEP_MINUTES = 15;

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
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The ride time a distance implies at the stated pace, to the quarter hour.
 * A distance nobody measured has no estimate rather than a made-up number.
 */
export function estimatedRideMinutes(distanceKm: number | null | undefined): number | null {
  if (distanceKm === undefined || distanceKm === null || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  const minutes = ((distanceKm / 1.609344) / RIDE_TIME_PACE_MPH) * 60;
  return Math.max(RIDE_TIME_STEP_MINUTES, Math.round(minutes / RIDE_TIME_STEP_MINUTES) * RIDE_TIME_STEP_MINUTES);
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
