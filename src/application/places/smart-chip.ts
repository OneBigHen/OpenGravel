/**
 * The one contextual chip after Gas (MAP-EXPERIENCE-NEXT Wave 2 item 9): what
 * this hour and this route make worth reaching for, worded as a suggestion.
 *
 * Gas stays first and never moves; the chip that follows it is chosen here, in
 * one pure place, from the rider's own clock, whether the sun is up, and the
 * fuel the open route can actually promise. Nothing is invented: a route whose
 * fuel facts are unknown never raises the fuel chip, and every label is a
 * suggestion ("Coffee nearby", "Fuel before the gap"), never an instruction.
 *
 * A route with a dry stretch longer than {@link FUEL_GAP_SUGGESTION_MILES}
 * outranks the hour's own wish, because running dry is the worse outcome.
 */

import { METERS_PER_MILE, gapSummary, type AlongStop } from "@/application/map-layers/along";
import type { SunState } from "@/application/long-trip/daylight";

/** A stretch of route with no fuel longer than this is worth topping up first. */
export const FUEL_GAP_SUGGESTION_MILES = 60;

/** The search chip a suggestion taps through to. */
export type SmartChipId = "coffee" | "gas" | "lodging";

/** Why this chip is in the row, so a surface can word it and a test can prove it. */
export type SmartChipReason = "fuel-gap" | "morning" | "late";

export interface SmartChipSuggestion {
  readonly id: SmartChipId;
  /** The words in the row: a suggestion, not an order. */
  readonly label: string;
  readonly reason: SmartChipReason;
}

/** What the open route can say about fuel; `null` facts offer no chip. */
export interface SmartChipRoute {
  /** The longest stretch of the route with no fuel stop, in miles. */
  readonly fuelGapMiles: number | null;
}

export interface SmartChipInput {
  /** Epoch milliseconds, read on the rider's own clock like the chip row is. */
  readonly now: number;
  /** Whether the sun is up at the rider, or unknown. */
  readonly sunState: SunState | null;
  /** The route on screen, when one is open. */
  readonly route?: SmartChipRoute | null | undefined;
}

/** Coffee is a morning thing; by 11:00 it is lunchtime. */
const COFFEE_FROM_HOUR = 5;
const COFFEE_UNTIL_HOUR = 11;
/** Lodging starts in the evening and runs past midnight. */
const LODGING_FROM_HOUR = 20;
/** Dark at 6 PM (a winter ride) ends the day even before 8 PM. */
const DARK_EVENING_HOUR = 18;

/** The rider's wall-clock hour for `nowMs`, or `null` when the instant is not real. */
function localHour(nowMs: number): number | null {
  if (!Number.isFinite(nowMs)) return null;
  const hour = new Date(nowMs).getHours();
  return Number.isFinite(hour) ? hour : null;
}

/**
 * The chip worth offering after Gas, or `null` when the hour asks for nothing
 * special and the row should keep its normal next chip.
 */
export function smartChip({ now, sunState, route }: SmartChipInput): SmartChipSuggestion | null {
  const hour = localHour(now);
  if (hour === null) return null;
  const gap = route?.fuelGapMiles ?? null;
  // An unknown gap is not a gap: it never turns into a warning.
  if (gap !== null && Number.isFinite(gap) && gap > FUEL_GAP_SUGGESTION_MILES) {
    return { id: "gas", label: "Fuel before the gap", reason: "fuel-gap" };
  }
  if (hour >= COFFEE_FROM_HOUR && hour < COFFEE_UNTIL_HOUR) {
    return { id: "coffee", label: "Coffee nearby", reason: "morning" };
  }
  const evening = hour >= LODGING_FROM_HOUR || hour < COFFEE_FROM_HOUR;
  if (evening || (sunState === "night" && hour >= DARK_EVENING_HOUR)) {
    return { id: "lodging", label: "Lodging", reason: "late" };
  }
  return null;
}

/**
 * The longest stretch of a route with no fuel stop, in miles, from stops the
 * along-route search already placed on its line. `null` when the route has no
 * measurable length, so an unknown route never reads as a known gap.
 */
export function fuelGapMiles(stops: readonly AlongStop[], routeMeters: number): number | null {
  if (!Number.isFinite(routeMeters) || routeMeters <= 0) return null;
  return gapSummary(stops, routeMeters, null).longestGapMeters / METERS_PER_MILE;
}
