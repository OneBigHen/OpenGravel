/**
 * The one-word character of each route option (small-screen design system v2 §3).
 *
 * A phone row has room for one word beside the numbers, and it has to be true:
 * "Twistiest" is a comparison, so it may only be said about the option that is
 * measurably the twistiest **of the options on screen**, only when every one of
 * them measured that trait, and only when nobody ties it. An unmeasured trait is
 * not a low value, so a mix of measured and unmeasured options says nothing at
 * all — the same rule that keeps an unknown surface out of "Paved".
 *
 * A word that repeats the option's own role name ("Fastest" · "Quickest") adds
 * nothing to a row that already says the role, so that option gets no word.
 *
 * This is a selector over the cards the panel was given, not a second view
 * model: it reads only quantities the card already carries.
 */

import type { RouteCardVm } from "./planner-view-model";

export type RouteChoiceWord = "Twistiest" | "Quickest" | "Most dirt";

interface Trait {
  readonly word: RouteChoiceWord;
  /** The card's own quantity for this trait, or `null` when unmeasured. */
  readonly value: (card: RouteCardVm) => number | null;
  /** Which end wins: more curves, less time, more dirt. */
  readonly best: "high" | "low";
  /** True when the winning value has to be above zero to say anything. */
  readonly aboveZero?: boolean;
}

/**
 * In the order a rider reads them: shape of the road first, then time, then
 * surface. One option can hold one word, so this order also decides which claim
 * a many-sided option gets.
 */
const TRAITS: readonly Trait[] = [
  { word: "Twistiest", value: (card) => card.curviness?.level ?? null, best: "high" },
  { word: "Quickest", value: (card) => card.addedMinutes ?? null, best: "low" },
  { word: "Most dirt", value: (card) => card.surfaceStrip?.dirt ?? null, best: "high", aboveZero: true },
];

/** The roles whose own label already says the word. */
const ROLE_SAYS: Readonly<Partial<Record<RouteCardVm["roleKey"], RouteChoiceWord>>> = {
  fastest: "Quickest",
  "more-twisties": "Twistiest",
  "more-dirt": "Most dirt",
};

/**
 * The card that is strictly the best at this trait, or `null` when one of the
 * options did not measure it or two of them measure it equally.
 */
function strictWinner(
  cards: readonly RouteCardVm[],
  trait: Trait,
): { readonly card: RouteCardVm; readonly value: number } | null {
  const measured: { card: RouteCardVm; value: number }[] = [];
  for (const card of cards) {
    const value = trait.value(card);
    // An option that did not measure this trait is not the least of them.
    if (value === null) return null;
    measured.push({ card, value });
  }
  let winner: { card: RouteCardVm; value: number } | null = null;
  let tied = false;
  for (const entry of measured) {
    if (winner === null) {
      winner = entry;
      continue;
    }
    if (entry.value === winner.value) tied = true;
    else if (trait.best === "high" ? entry.value > winner.value : entry.value < winner.value) {
      winner = entry;
      tied = false;
    }
  }
  if (winner === null) return null;
  // Every option having no dirt at all is not something to say about one of them.
  if (trait.aboveZero === true && winner.value <= 0) return null;
  return tied ? null : winner;
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
    const winner = strictWinner(cards, trait);
    if (winner === null) continue;
    if (words[winner.card.routeId] !== undefined) continue;
    if (ROLE_SAYS[winner.card.roleKey] === trait.word) continue;
    words[winner.card.routeId] = trait.word;
  }
  return words;
}
