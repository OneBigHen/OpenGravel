/**
 * Who made a route we did not make ourselves.
 *
 * Imported and curated rides (the PA Adventure Bike Rides library, the Roost
 * GPX locker, files a rider imported) are other people's work. The credit is
 * data, not decoration: it rides on the ride's provenance, so saving, copying,
 * forking, sharing and exporting a ride all carry it. A ride the rider made
 * themselves has no credit.
 *
 * `author` is `null` when the source never named a person. That is stated as
 * "author not named", never guessed.
 */
export interface RideCredit {
  readonly author: string | null;
  readonly sourceName: string;
  readonly sourceUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Strict reader for stored/untrusted data; `undefined` means absent, `null` means malformed. */
export function parseRideCredit(value: unknown): RideCredit | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const { author, sourceName, sourceUrl } = value;
  if (author !== null && (typeof author !== "string" || author.trim() === "" || author.length > 120)) return null;
  if (typeof sourceName !== "string" || sourceName.trim() === "" || sourceName.length > 160) return null;
  if (sourceUrl !== undefined && !httpUrl(sourceUrl)) return null;
  return {
    author,
    sourceName,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

export function isRideCredit(value: unknown): value is RideCredit {
  const parsed = parseRideCredit(value);
  return parsed !== undefined && parsed !== null;
}

/** The plain credit sentence: "Route by Jane Doe · PA Adventure Bike Rides". */
export function creditText(credit: RideCredit): string {
  return credit.author === null
    ? `Route from ${credit.sourceName} · author not named`
    : `Route by ${credit.author} · ${credit.sourceName}`;
}

/** The same facts for a GPX `<desc>`. */
export function creditDescription(credit: RideCredit): string {
  const base = creditText(credit);
  return credit.sourceUrl === undefined ? base : `${base} (${credit.sourceUrl})`;
}
