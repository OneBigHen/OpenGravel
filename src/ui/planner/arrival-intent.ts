/**
 * The rider-facing arrival intents (03 §4), in menu order.
 *
 * They live outside the panel because two surfaces now read the same words: the
 * itinerary row's glyph and the inspector's selector. One owner means a renamed
 * intent cannot disagree with itself between the list and the editor.
 */

import type { StopArrivalIntent } from "@/domain/ride/types";

export const ARRIVAL_INTENT_LABELS: Readonly<Record<StopArrivalIntent, string>> = {
  visit: "Visit",
  fuel: "Fuel",
  food: "Food",
  lodging: "Lodging",
  scenic: "Scenic",
  other: "Other",
};

/** Declaration order for the selector; `""` is the cleared option. */
export const ARRIVAL_INTENTS: readonly StopArrivalIntent[] = [
  "visit",
  "fuel",
  "food",
  "lodging",
  "scenic",
  "other",
];
