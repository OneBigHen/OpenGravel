/**
 * How a ride's arrival reads, once, for every surface: the clock time first,
 * then the daylight fact if there is one. `Back 12:50 AM · before sunrise`.
 * The floating pill carries only distance and duration; the arrival lives in
 * the ride sheet and the conditions sheet, in these exact words.
 */

export function arrivalClock(instantMs: number): string {
  return new Date(instantMs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** `Back 12:04 PM` for a loop, `Arrive 12:04 PM` for a destination. */
export function arrivalLabel(clockText: string, loop: boolean): string {
  return `${loop ? "Back" : "Arrive"} ${clockText}`;
}

/**
 * The arrival a plan states, read from the plan's own timestamp rather than
 * from the clock at render time.
 *
 * A refresh with no new input used to re-add the ride time to "now", so the
 * arrival moved by a minute (or more) every time the page was reopened. The
 * answer already has a creation instant; the arrival is that plus the ride
 * time, and it stays put until the rider changes the ride.
 */
export function plannedArrivalClock(
  plannedAt: string | undefined,
  durationSeconds: number,
): string | null {
  if (plannedAt === undefined || !Number.isFinite(durationSeconds)) return null;
  const planned = Date.parse(plannedAt);
  if (!Number.isFinite(planned)) return null;
  return arrivalClock(planned + durationSeconds * 1000);
}

/** The arrival with its daylight fact: `Arrive 6:10 PM · 20 min after dark`. */
export function arrivalWithLight(clockText: string, loop: boolean, light: string | null): string {
  return light === null ? arrivalLabel(clockText, loop) : `${arrivalLabel(clockText, loop)} · ${light}`;
}
