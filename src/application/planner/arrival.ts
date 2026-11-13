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

/** The arrival with its daylight fact: `Arrive 6:10 PM · 20 min after dark`. */
export function arrivalWithLight(clockText: string, loop: boolean, light: string | null): string {
  return light === null ? arrivalLabel(clockText, loop) : `${arrivalLabel(clockText, loop)} · ${light}`;
}
