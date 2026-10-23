/**
 * US state names and their two-letter codes.
 *
 * Both geocoders build rider-facing labels ("Jim Thorpe, PA") and both need to
 * recognize a state the rider typed at the end of a query ("Denver, CO").
 * Keeping the table in one place means a label and a query agree about what
 * "Pennsylvania" is; it is presentation vocabulary, not provider data.
 */

export const US_STATES: Readonly<Record<string, string>> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "Puerto Rico": "PR",
};

/** Lower-case state name → code, longest name first so "West Virginia" wins. */
export const US_STATE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(US_STATES)
    .sort(([left], [right]) => right.length - left.length)
    .map(([name, code]) => [name.toLowerCase(), code]),
);

export const US_STATE_CODES: ReadonlySet<string> = new Set(Object.values(US_STATES));

/** The two-letter code for a state name, or the name itself when it is not one. */
export function usStateCode(state: string): string {
  return US_STATES[state] ?? state;
}

/**
 * `text` without a trailing US state name or code ("Jim Thorpe, PA" → "Jim
 * Thorpe"). Used to tell whether a geocoded name is the place the rider typed;
 * "Tampa" keeps its last two letters because they are not a state code.
 */
export function withoutTrailingUsState(text: string): string {
  let value = text.trim().replace(/[.,\s]+$/, "");
  const code = /(?:^|[\s,])([A-Za-z]{2})$/.exec(value);
  if (code !== null && value.length > 2 && US_STATE_CODES.has((code[1] ?? "").toUpperCase())) {
    value = value.slice(0, value.length - 2).replace(/[.,\s]+$/, "");
  }
  const lower = value.toLowerCase();
  for (const name of US_STATE_NAMES.keys()) {
    if (!lower.endsWith(name)) continue;
    const before = value.slice(0, value.length - name.length);
    if (before !== "" && /[\s,]$/.test(before)) {
      value = before.replace(/[.,\s]+$/, "");
    }
    break;
  }
  return value;
}
