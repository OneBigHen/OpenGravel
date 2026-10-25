/**
 * The one thing a briefing says about the sun, in the words a rider uses.
 *
 * A count of "minutes of daylight remaining" is arithmetic the rider cannot
 * check and does not need: what matters is whether the ride is in the dark, and
 * when the light comes or goes. Comfortable daylight says nothing at all.
 */

/** A clock time as a rider says it, without a zone label on a one-line brief. */
export function riderClock(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(value)).replace(/\s?(AM|PM)$/i, (suffix) => suffix.toLowerCase());
}

function instant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface DaylightLineContext {
  readonly departure?: string | null;
  readonly tripWindow?: { readonly start: string; readonly end?: string | undefined } | null;
  readonly sunrise?: string | null;
  readonly sunset?: string | null;
  readonly riderTimeZone?: string;
}

/**
 * `Dark until 7:21 am` when the ride leaves before sunrise, `Dark by 6:12 pm`
 * when it finishes after sunset, `Riding in the dark` when the sun is already
 * down, and `null` when the ride sits inside daylight.
 *
 * The solar crossing is a calculation for the start of the route, not a promise
 * that a road or a rider is safe at night; the line only says when the light
 * is there. Each branch needs both ends of the comparison, so an unknown
 * sunrise or sunset leaves the line out rather than guessing.
 */
export function daylightLine(context: DaylightLineContext): string | null {
  const timeZone = context.riderTimeZone ?? "UTC";
  const sunrise = instant(context.sunrise);
  const sunset = instant(context.sunset);
  const start = instant(context.tripWindow?.start) ?? instant(context.departure);
  const end = instant(context.tripWindow?.end);
  if (start !== null && sunrise !== null && start < sunrise) {
    return `Dark until ${riderClock(new Date(sunrise).toISOString(), timeZone)}`;
  }
  if (start !== null && sunset !== null && start >= sunset) {
    return "Riding in the dark";
  }
  if (end !== null && sunset !== null && end > sunset) {
    return `Dark by ${riderClock(new Date(sunset).toISOString(), timeZone)}`;
  }
  return null;
}
