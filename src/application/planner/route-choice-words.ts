/**
 * The one-word character of each route option (small-screen design system v2 §3).
 *
 * A phone row has room for one word beside the numbers, and it has to be true:
 * a word is a comparison, so it may only be said about the option that is
 * measurably the best **of the options on screen**, only when every one of them
 * measured that trait, and only when the winner is clear of the others. An
 * unmeasured trait is not a low value, so a mix of measured and unmeasured
 * options says nothing at all — the same rule that keeps an unknown surface out
 * of "Paved".
 *
 * A word that repeats the option's own role name ("Fastest" · "Quickest") adds
 * nothing to a row that already says the role, so that option gets no word.
 *
 * This is a selector over the cards the panel was given, not a second view
 * model: it reads only the measured quantities the card already carries
 * (`RouteCardMeasurements`).
 */

import type { RouteCardVm } from "./planner-view-model";

export type RouteChoiceWord = "Twistiest" | "Quickest" | "Most dirt" | "Fewest busy roads";

interface Trait {
  readonly word: RouteChoiceWord;
  /** The card's own quantity for this trait, or `null` when unmeasured. */
  readonly value: (card: RouteCardVm) => number | null;
  /** Which end wins: more curves, less time, more dirt, less busy road. */
  readonly best: "high" | "low";
  /**
   * The winner must be strictly beyond this value to say anything: a set of
   * routes with no bend at all has no twistiest one, and 0.8 mi of dirt is a
   * driveway rather than the reason to pick a ride.
   */
  readonly beyond?: number;
  /**
   * How far clear of the next option the winner must be. Used where a tiny
   * difference is noise rather than a reason: 10 percentage points of busy road
   * is the margin the rider-mode search itself treats as a quieter ride.
   */
  readonly clearBy?: number;
}

/**
 * In the order a rider reads them: shape of the road first, then time, then
 * surface, then what the road is like to ride. One option can hold one word, so
 * this order also decides which claim a many-sided option gets.
 */
const TRAITS: readonly Trait[] = [
  { word: "Twistiest", value: (card) => card.measurements?.curvyMi ?? null, best: "high", beyond: 0 },
  { word: "Quickest", value: (card) => card.addedMinutes ?? null, best: "low" },
  // The word is "dirt" the way a rider says it: gravel and dirt are both the
  // unpaved miles that make a route worth choosing, and under a mile of either
  // is not the reason.
  { word: "Most dirt", value: (card) => card.measurements?.unpavedMi ?? null, best: "high", beyond: 1 },
  { word: "Fewest busy roads", value: (card) => card.measurements?.busyShare ?? null, best: "low", clearBy: 0.1 },
];

/** The roles whose own label already says the word. */
const ROLE_SAYS: Readonly<Partial<Record<RouteCardVm["roleKey"], RouteChoiceWord>>> = {
  fastest: "Quickest",
  "more-twisties": "Twistiest",
  "more-dirt": "Most dirt",
};

/** True when `gap` is enough for the trait to be worth saying. */
function clearEnough(gap: number, trait: Trait): boolean {
  return trait.clearBy === undefined ? gap > 0 : gap >= trait.clearBy;
}

/**
 * The card that is the best at this trait, or `null` when one of the options did
 * not measure it, nobody is beyond the trait's floor, or two options are too
 * close to call.
 */
function strictWinner(
  cards: readonly RouteCardVm[],
  trait: Trait,
): RouteCardVm | null {
  const measured: { card: RouteCardVm; value: number }[] = [];
  for (const card of cards) {
    const value = trait.value(card);
    // An option that did not measure this trait is not the least of them.
    if (value === null) return null;
    measured.push({ card, value });
  }
  let winner: { card: RouteCardVm; value: number } | null = null;
  for (const entry of measured) {
    if (winner === null) {
      winner = entry;
      continue;
    }
    if (trait.best === "high" ? entry.value > winner.value : entry.value < winner.value) {
      winner = entry;
    }
  }
  if (winner === null) return null;
  if (trait.beyond !== undefined && !(winner.value > trait.beyond)) return null;
  // Every other option has to be beaten by the trait's margin, so a tie (or a
  // difference too small to mean anything) names nobody.
  for (const entry of measured) {
    if (entry.card === winner.card) continue;
    const gap = trait.best === "high" ? winner.value - entry.value : entry.value - winner.value;
    if (!clearEnough(gap, trait)) return null;
  }
  return winner.card;
}

/**
 * One character word per option, keyed by route id. Options with nothing true
 * and distinguishing to say are absent rather than given fill-in copy.
 */
export function routeChoiceWords(
  cards: readonly RouteCardVm[],
): Readonly<Record<string, RouteChoiceWord>> {
  const words: Record<string, RouteChoiceWord> = {};
  // A word is a comparison; with one option on screen there is nothing to compare.
  if (cards.length < 2) return words;
  for (const trait of TRAITS) {
    // Each trait names at most one option, so a word never repeats a row.
    const winner = strictWinner(cards, trait);
    if (winner === null) continue;
    if (words[winner.routeId] !== undefined) continue;
    if (ROLE_SAYS[winner.roleKey] === trait.word) continue;
    words[winner.routeId] = trait.word;
  }
  return words;
}
