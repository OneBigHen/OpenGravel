/**
 * One box for "where to" and "describe a ride" (UX rework 2, #7/#13).
 *
 * The planner's search field offers the ride advisor when what the rider typed
 * reads like a ride rather than a place: "2 hours of twisty backroads, no
 * highways" is a ride; "Hawk Mountain" is a place. The test is deliberately
 * cheap and local, so it runs on every keystroke and never spends a request.
 * Place results still show under the advisor row, so a false positive costs
 * one row, never a lost search.
 */

/** Words that describe riding, not a destination. */
const RIDE_WORDS =
  /\b(loop|round ?trip|twist(y|ies)|curv(y|es)|windy|backroads?|back roads?|gravel|dirt|unpaved|paved|scenic|highways?|interstates?|tolls?|avoid|hours?|hrs?|minutes?|mins?|miles?|mi|km|ride|riding|cruise|rip|spirited|dual ?sport|adv|return(ing)?|home by|back by|lunch|coffee|breakfast)\b/i;

/** "2h", "90 min", "1.5 hours", "60mi": a duration or a distance. */
const AMOUNT = /\b\d+(\.\d+)?\s?(h|hr|hrs|hours?|m|min|mins|minutes?|mi|miles?|km)\b/i;

/**
 * - `ride`: offer the advisor first, and Enter asks it ("2h twisty loop").
 * - `maybe`: offer the advisor after the place results ("Loop Road" is a
 *   street, "twisty loop" is a ride; the rider picks).
 * - `place`: a place search only.
 */
export type QueryReading = "ride" | "maybe" | "place";

export function readQuery(text: string): QueryReading {
  const trimmed = text.trim();
  if (trimmed.length < 4) return "place";
  const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
  if (AMOUNT.test(trimmed)) return "ride";
  const rideWords = RIDE_WORDS.test(trimmed);
  if (rideWords && words.length >= 3) return "ride";
  // A sentence, not a place name: places are rarely more than five words.
  if (words.length >= 6) return "ride";
  if (rideWords || words.length >= 3) return "maybe";
  return "place";
}
