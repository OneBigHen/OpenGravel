export type RideTimeLens = "now" | "weekend" | "next-weekend" | "date";
export interface RideTimeWindow {
  readonly start: Date;
  readonly end: Date;
}

/** Local civil days avoid shifting a picked date at UTC midnight. */
export function rideTimeWindow(
  lens: RideTimeLens,
  pickedDate: string,
  now: Date,
): RideTimeWindow {
  const start =
    lens === "date" && /^\d{4}-\d{2}-\d{2}$/.test(pickedDate)
      ? new Date(`${pickedDate}T00:00:00`)
      : new Date(now);
  if (lens === "weekend" || lens === "next-weekend") {
    const day = start.getDay();
    start.setHours(18, 0, 0, 0);
    start.setDate(
      start.getDate() + (day === 6 ? -1 : day === 0 ? -2 : (5 - day + 7) % 7),
    );
    if (lens === "next-weekend") start.setDate(start.getDate() + 7);
  }
  const end = new Date(start);
  if (lens === "now") end.setTime(start.getTime() + 1);
  else {
    end.setDate(end.getDate() + (lens === "date" ? 1 : 3));
    end.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

export function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
