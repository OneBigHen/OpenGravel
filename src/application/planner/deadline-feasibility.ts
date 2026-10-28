import type { DepartureIntent, TimeIntent } from "@/domain/ride/types";
import { arrivalInstant } from "./arrive-by";

export interface DeadlineFeasibility {
  readonly status: "met" | "missed";
  readonly deadline: Date;
  readonly estimatedArrival: Date;
  /** For arrive-by rides, the departure the selected route needs. */
  readonly scheduledDeparture: Date | null;
}

/** Checks a real selected route against a rider's deadline; it never guesses route time. */
export function deadlineFeasibility(
  time: TimeIntent,
  departure: DepartureIntent,
  durationSeconds: number,
  now = new Date(),
): DeadlineFeasibility | null {
  if ((time.kind !== "returnBy" && time.kind !== "arriveBy") || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  const deadline = arrivalInstant({ date: time.date, localTime: time.localTime });
  if (deadline === null) return null;

  if (time.kind === "arriveBy") {
    const needed = new Date(deadline.getTime() - durationSeconds * 1000);
    if (needed.getTime() > now.getTime()) {
      return { status: "met", deadline, estimatedArrival: deadline, scheduledDeparture: needed };
    }
    const estimatedArrival = new Date(now.getTime() + durationSeconds * 1000);
    return {
      status: estimatedArrival.getTime() <= deadline.getTime() ? "met" : "missed",
      deadline,
      estimatedArrival,
      scheduledDeparture: null,
    };
  }

  const requestedDeparture = departure.kind === "future" ? Date.parse(departure.at) : Number.NaN;
  const startsAt = Number.isFinite(requestedDeparture) && requestedDeparture > now.getTime() ? requestedDeparture : now.getTime();
  const estimatedArrival = new Date(startsAt + durationSeconds * 1000);
  return {
    status: estimatedArrival.getTime() <= deadline.getTime() ? "met" : "missed",
    deadline,
    estimatedArrival,
    scheduledDeparture: null,
  };
}
