/**
 * The phone sheet's "where this ride goes" line.
 *
 * It names the ride when the endpoint has no name a rider could recognise: a
 * ride opened from Explore or My rides carries its own title, and "To Dropped
 * pin" would claim the rider placed a pin they never touched. A real place name
 * still wins, because that is what the rider sees on the map. A loop names its
 * start, not its destination.
 */
import {
  DROPPED_PIN_LABEL,
  NO_FINISH_LABEL,
  NO_START_LABEL,
} from "@/application/planner/planner-view-model";

export function destinationLineFor(input: {
  readonly placeLabel: string;
  readonly loopRide: boolean;
  readonly rideTitle: string | null | undefined;
}): string | null {
  const { placeLabel, loopRide, rideTitle } = input;
  const unnamed =
    placeLabel === NO_FINISH_LABEL ||
    placeLabel === NO_START_LABEL ||
    placeLabel === DROPPED_PIN_LABEL ||
    placeLabel === "From your sketch" ||
    placeLabel === "";
  const title = rideTitle?.trim() ?? "";
  if (unnamed) return title.length > 0 ? title : null;
  const short = placeLabel.split(",")[0]?.trim() || placeLabel;
  return `${loopRide ? "Loop from" : "To"} ${short}`;
}
