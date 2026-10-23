/**
 * One box for "where to" and "describe a ride" (UX rework 2, #7/#13).
 *
 * The planner's search field offers the ride advisor when what the rider typed
 * reads like a ride rather than a place: "2 hours of twisty backroads, no
 * highways" is a ride; "Hawk Mountain" is a place. The test is deliberately
 * cheap and local, so it runs on every keystroke and never spends a request.
 * Place results still show under the advisor row, and a query that is only
 * *possibly* a ride keeps its place search — a false positive costs one row,
 * never a lost search.
 *
 * The two readings are not symmetric, so the tests are not either: calling a
 * ride a place costs a geocoder round-trip and one extra row, while calling a
 * place a ride hides the search the rider actually wanted. Long text therefore
 * only reads as a ride when it carries a ride word or an amount, and an
 * address-shaped query ("1234 Old Mill Gap Road", "…, Jim Thorpe, PA 18229")
 * reads as a place however many words it has.
 */

/**
 * How much text a ride description may carry. The one box accepts this much when
 * it can also describe a ride, the advisor request boundary enforces the same
 * number, and the geocoder only ever sees `PLACE_QUERY_MAX_LENGTH` of it.
 */
export const RIDE_DESCRIPTION_MAX_LENGTH = 600;

/**
 * Words that describe riding, not a destination. Shape words ("twisty",
 * "gravel") and time/distance words are strong signals; words that are just as
 * common in a business name — `loop`, `coffee`, `lunch`, `breakfast` — are not
 * listed here, because "Loop Road" and "coffee shop, Jim Thorpe PA" are places
 * a rider searches for.
 */
const RIDE_WORDS =
  /\b(round ?trip|twist(y|ies)|curv(y|es)|windy|backroads?|back roads?|gravel|dirt|unpaved|paved|scenic|highways?|interstates?|tolls?|avoid|hours?|hrs?|minutes?|mins?|miles?|mi|km|ride|riding|cruise|rip|spirited|dual ?sport|adv|new roads?|unridden|familiar|haven'?t ridden|never ridden|not ridden|return(ing)?|home by|back by)\b/i;

/** "2h", "90 min", "1.5 hours", "60mi": a duration or a distance. */
const AMOUNT = /\b\d+(\.\d+)?\s?(h|hr|hrs|hours?|m|min|mins|minutes?|mi|miles?|km)\b/i;

/** US state codes: "Jim Thorpe, PA" is a qualified place name, not a sentence. */
const STATE_CODE =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

/** A trailing region qualifier: "…, PA", "…, PA 18229", "…, 18229". */
const TRAILING_REGION = new RegExp(
  `,\\s*(?:(?:${STATE_CODE})\\b\\s*(?:\\d{5}(?:-\\d{4})?)?|\\d{5}(?:-\\d{4})?)\\s*\\.?$`,
  "i",
);

/** "1234 Old Mill Gap Road": a house number, which a ride description does not start with. */
const LEADING_HOUSE_NUMBER = /^\d{1,6}\s+\S/;

/** The words that make a house number + name an address ("… Road", "… St"). */
const STREET_TYPE =
  /\b(street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|highway|hwy|route|rt|way|court|ct|place|pl|terrace|ter|circle|cir|parkway|pkwy|pike|turnpike|trail|alley|square|sq)\b/i;

/** An address, however many words it has: a house number and a street. */
function readsLikeAnAddress(text: string): boolean {
  return LEADING_HOUSE_NUMBER.test(text) && STREET_TYPE.test(text);
}

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
  // A duration or a distance is a ride ask, whatever else the text says.
  if (AMOUNT.test(trimmed)) return "ride";
  // "1234 Old Mill Gap Road, Stroudsburg, PA 18360" is a place search even when
  // it is long enough to read like a sentence: the geocoder is what the rider
  // wants here.
  if (readsLikeAnAddress(trimmed)) return "place";
  const rideWords = RIDE_WORDS.test(trimmed);
  // "…, PA" or "…, 18229" qualifies the name before it, so the default is a
  // place search — but keep the advisor row when the words also say "twisty".
  if (TRAILING_REGION.test(trimmed)) return rideWords ? "maybe" : "place";
  if (rideWords && words.length >= 3) return "ride";
  // Length alone is not a ride signal: a long query with neither a ride word
  // nor an address shape keeps its place search and offers the advisor after.
  if (rideWords || words.length >= 3) return "maybe";
  return "place";
}
