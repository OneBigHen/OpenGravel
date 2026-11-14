/**
 * Every fact the ride page repeats, with the source's own words beside it
 * (plan sections 5.1 stage 6, 5.2 and 5.4). A fact is `{ value, quote, source }`:
 *
 * - `value` is only ever what a table row says the source meant, or `null`.
 * - `quote` is the source's words, unchanged (spaces collapsed).
 * - `source` is where the words came from, e.g. "BestBikingRoads route page".
 *
 * Nothing here may turn a silence into a claim. "unknown", "none stated", an
 * empty field and a phrase with no table row all keep `value: null`; the quote
 * is kept when the source did say something we could not classify, so the page
 * can repeat it without dressing it up.
 *
 * The surface phrase table (278 reviewed rows from the real library) lives in
 * `surface-phrases.ts` because it was built and tested with the first package;
 * it is re-exported here as `SURFACE_TABLE` so one module lists every table.
 */
import { SURFACE_PHRASES, type SurfaceClaimValue } from "./surface-phrases";
import { hasSurfaceRow, surfaceClaim } from "./surface-claim";
import type { LibraryRecord, RideFact, SourceRating } from "./types";

export type { SurfaceClaimValue } from "./surface-phrases";

/** What a surface phrase is allowed to mean. */
export type SurfaceValue = SurfaceClaimValue;
/** What a legal-status field is allowed to mean. */
export type LegalValue = "public-roads" | "designated-ohv" | "mixed";
/** The schema's difficulty words that say something; "unknown" is not one of them. */
export type DifficultyValue = "easy" | "moderate" | "difficult" | "expert";

export type FactName = "surface" | "legal" | "difficulty" | "permits" | "season";

/** Every fact the ride page can repeat, in the order the report and the snapshot list them. */
export const FACT_NAMES: readonly FactName[] = ["surface", "legal", "difficulty", "permits", "season"];

export interface RideFacts {
  readonly surface: RideFact<SurfaceValue>;
  readonly legal: RideFact<LegalValue>;
  readonly difficulty: RideFact<DifficultyValue>;
  readonly permits: RideFact<string>;
  readonly season: RideFact<string>;
}

/** Surface phrasings: `paved`, `unpaved`, `mixed`, or no row at all (unknown). */
export const SURFACE_TABLE: Readonly<Record<string, SurfaceValue | null>> = SURFACE_PHRASES;

/** Legal status: the source's three claims. Anything else, "unknown" included, has no value. */
export const LEGAL_TABLE: Readonly<Record<string, LegalValue>> = {
  "public-roads": "public-roads",
  "designated-ohv": "designated-ohv",
  mixed: "mixed",
};

/** Difficulty: the schema's five words. "unknown" is listed so a reviewer sees it is read and dropped. */
export const DIFFICULTY_TABLE: Readonly<Record<string, DifficultyValue | null>> = {
  easy: "easy",
  moderate: "moderate",
  difficult: "difficult",
  expert: "expert",
  unknown: null,
};

/**
 * Words that are a non-answer, not a fact. They never become a value. Matched
 * against the whole field, so "dirt/gravel OHV trails (mileage not stated)" is
 * still a surface claim: the source only declined to state the mileage.
 */
export const NON_ANSWER = /^(?:unknown|not stated|none stated|not sure|n\/a|na|varies|tbd|\?+|-{1,2}|—+)$/i;

export function normalizePhrase(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Wording in a provenance field that names no source: empty, a non-answer, or
 * an admission that the source did not state the thing. The question-mark rule
 * of `saysNothing` is deliberately absent: a source address may contain `?`.
 */
export const NO_SOURCE = /^(?:unknown|not stated\b.*|none stated|not sure|n\/a|na|varies|tbd|\?+|-{1,2}|—+)$/i;

/**
 * True when a provenance field names something a reviewer could check. A claim
 * whose provenance does not is not a claim about the source; it is dropped to
 * `null` (see `unsourcedClaims`) rather than credited to a neighbouring field.
 */
export function namesSource(text: string | null | undefined): boolean {
  const value = normalizePhrase(text ?? "");
  return value !== "" && !NO_SOURCE.test(value);
}

/** True when the field is empty, a non-answer, or a question rather than a claim. */
export function saysNothing(text: string | null | undefined): boolean {
  if (typeof text !== "string") return true;
  const clean = normalizePhrase(text);
  return clean === "" || NON_ANSWER.test(clean) || clean.includes("?");
}

function clean(text: string | null | undefined): string {
  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}

function sourceOf(text: string | null | undefined): string | null {
  const value = clean(text);
  return value === "" ? null : value;
}

/** A fact whose value has to come from a table: a row, or `null`. No named source, no value. */
function tableFact<T>(text: string | null | undefined, source: string | null | undefined, value: T | null): RideFact<T> {
  if (saysNothing(text)) return { value: null, quote: null, source: null };
  if (!namesSource(source)) return { value: null, quote: clean(text), source: null };
  return { value, quote: clean(text), source: sourceOf(source) };
}

/** A fact the source words in its own way (season, permits): the quote is the value, or nothing. */
function quotedFact(text: string | null | undefined, source: string | null | undefined): RideFact<string> {
  if (saysNothing(text)) return { value: null, quote: null, source: null };
  if (!namesSource(source)) return { value: null, quote: clean(text), source: null };
  return { value: clean(text), quote: clean(text), source: sourceOf(source) };
}

export function surfaceValue(phrase: string | null | undefined): SurfaceValue | null {
  if (typeof phrase !== "string" || saysNothing(phrase)) return null;
  return surfaceClaim(phrase);
}

export function legalValue(text: string | null | undefined): LegalValue | null {
  if (typeof text !== "string" || saysNothing(text)) return null;
  const key = normalizePhrase(text);
  return Object.hasOwn(LEGAL_TABLE, key) ? LEGAL_TABLE[key] ?? null : null;
}

export function difficultyValue(text: string | null | undefined): DifficultyValue | null {
  if (typeof text !== "string" || saysNothing(text)) return null;
  const key = normalizePhrase(text);
  return Object.hasOwn(DIFFICULTY_TABLE, key) ? DIFFICULTY_TABLE[key] ?? null : null;
}

export function surfaceFactOf(phrase: string | null | undefined, source: string | null | undefined): RideFact<SurfaceValue> {
  return tableFact(phrase, source, surfaceValue(phrase));
}

export function legalFactOf(text: string | null | undefined, source: string | null | undefined): RideFact<LegalValue> {
  return tableFact(text, source, legalValue(text));
}

export function difficultyFactOf(text: string | null | undefined, source: string | null | undefined): RideFact<DifficultyValue> {
  return tableFact(text, source, difficultyValue(text));
}

export function permitsFactOf(text: string | null | undefined, source: string | null | undefined): RideFact<string> {
  return quotedFact(text, source);
}

export function seasonFactOf(text: string | null | undefined, source: string | null | undefined): RideFact<string> {
  return quotedFact(text, source);
}

/**
 * The five facts of one library record. The page and the pack both read this.
 *
 * Each fact is credited only to the field that records where it came from: the
 * surface block's `surface_claim_source` for the four surface facts, and the
 * difficulty's own `difficulty_source` for difficulty. The surface claim's
 * source is never used as evidence for the difficulty: 33 real records omit
 * `difficulty_source`, and crediting their difficulty to the surface source
 * would put a claim in front of riders that the record cannot show was said.
 */
export function factsFor(record: LibraryRecord): RideFacts {
  const surface = record.surface;
  const claimSource = surface?.surface_claim_source;
  return {
    surface: surfaceFactOf(surface?.mix, claimSource),
    legal: legalFactOf(surface?.legal_status, claimSource),
    difficulty: difficultyFactOf(surface?.difficulty, surface?.difficulty_source),
    permits: permitsFactOf(surface?.permits, claimSource),
    season: seasonFactOf(surface?.seasonality, claimSource),
  };
}

/** The field that records where a fact came from. Difficulty has its own; the rest share the surface block's. */
export function provenanceFor(record: LibraryRecord, fact: FactName): string {
  return clean(fact === "difficulty" ? record.surface?.difficulty_source : record.surface?.surface_claim_source);
}

/** The value a fact's words would earn, ignoring provenance. */
function statedValueFor(fact: FactName, phrase: string): string | null {
  switch (fact) {
    case "surface":
      return surfaceValue(phrase);
    case "legal":
      return legalValue(phrase);
    case "difficulty":
      return difficultyValue(phrase);
    case "permits":
    case "season":
      return clean(phrase);
  }
}

/** A claim the record states, in words the tables understand, with no named source behind it. */
export interface UnsourcedClaim {
  readonly fact: FactName;
  readonly value: string;
  readonly quote: string | null;
}

/**
 * Every claim in a record whose provenance field is empty or names no source.
 * `factsFor` turns each of these into `value: null`; the builder lists them in
 * its report so a reviewer sees exactly what was withheld and can fix the
 * record. One rule, applied to every fact: no named source, no claim.
 */
export function unsourcedClaims(record: LibraryRecord): readonly UnsourcedClaim[] {
  const claims: UnsourcedClaim[] = [];
  for (const fact of FACT_NAMES) {
    if (namesSource(provenanceFor(record, fact))) continue;
    const phrase = phraseFor(record, fact) ?? "";
    if (saysNothing(phrase)) continue;
    const value = statedValueFor(fact, phrase);
    if (value === null || value === "") continue;
    claims.push({ fact, value, quote: clean(phrase) });
  }
  return claims;
}

/** The raw field behind each fact, for the phrase snapshot and the phrase gate. */
export function phraseFor(record: LibraryRecord, fact: FactName): string | null {
  const surface = record.surface;
  switch (fact) {
    case "surface":
      return surface?.mix ?? null;
    case "legal":
      return surface?.legal_status ?? null;
    case "difficulty":
      return surface?.difficulty ?? null;
    case "permits":
      return surface?.permits ?? null;
    case "season":
      return surface?.seasonality ?? null;
  }
}

/** True when a phrase is covered by a table row (a `null` row counts) or is a non-answer. */export function hasFactRow(fact: FactName, phrase: string): boolean {
  if (saysNothing(phrase)) return true;
  const key = normalizePhrase(phrase);
  switch (fact) {
    case "surface":
      return hasSurfaceRow(phrase);
    case "legal":
      return Object.hasOwn(LEGAL_TABLE, key);
    case "difficulty":
      return Object.hasOwn(DIFFICULTY_TABLE, key);
    case "permits":
    case "season":
      // Not normalised: the source's words are the value.
      return true;
  }
}

/* ------------------------------------------------------------------ wording */

/** How the card and the page word a surface claim. A silence is said out loud. */
export function surfaceWording(fact: RideFact<SurfaceValue>): string {
  switch (fact.value) {
    case "paved":
      return "Paved, the source says";
    case "unpaved":
      return "Unpaved, the source says";
    case "mixed":
      return "Mixed surface, the source says";
    default:
      return "Surface unknown";
  }
}

/**
 * How the page words legality. It is always the source's claim, never our
 * finding: no "legal" and no bare "open". A source that did not say gets
 * nothing at all.
 */
export function legalWording(fact: RideFact<LegalValue>): string | null {
  switch (fact.value) {
    case "public-roads":
      return "Public roads, the source says";
    case "designated-ohv":
      return "Open to motorcycles, the source says";
    case "mixed":
      return "Public roads and OHV sections, the source says";
    default:
      return null;
  }
}

/** "Permit: <quote> (the source says)", or nothing when the source did not say. */
export function permitWording(fact: RideFact<string>): string | null {
  const quote = fact.quote ?? fact.value;
  return quote === null || quote.trim() === "" ? null : `Permit: ${quote} (the source says)`;
}

/**
 * Season wording. A stated season reads "Season: <quote> (the source says)" on
 * the page and just the quote on a card; a silence is left off the card and
 * said as "Season not stated" on the page.
 */
export function seasonWording(fact: RideFact<string>, place: "card" | "page"): string | null {
  const quote = fact.quote ?? fact.value;
  if (quote === null || quote.trim() === "") return place === "page" ? "Season not stated" : null;
  return place === "page" ? `Season: ${quote} (the source says)` : `${quote} (the source says)`;
}

/* ------------------------------------------------------------------- rating */

/** The exact text a source's rider rating is stored as: "rider rating 4.6/5 (23 reviews)". */
export const RATING_PATTERN = /\brider rating (\d+(?:\.\d+)?)\/5 \((\d+) reviews?\)/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .join("\n");
  }
  return "";
}

/**
 * The rider rating a source published, or `null`.
 *
 * The structured `source_rating { value, scale, count }` field wins when the
 * record has one; a malformed structured field is `null` rather than a guess.
 * Otherwise only the exact `RATING_PATTERN` is read from `terms_provenance`
 * or `scraper.notes`. "4.0/5", "4.6 of 5 from 23 riders" and a rating with no
 * review count are not that pattern and stay unread.
 */
export function parseSourceRating(record: LibraryRecord): SourceRating | null {
  const structured: unknown = record.source_rating;
  if (typeof structured === "object" && structured !== null) {
    const { value, scale, count } = structured as { readonly value?: unknown; readonly scale?: unknown; readonly count?: unknown };
    if (!isFiniteNumber(value) || !isFiniteNumber(scale) || scale <= 0 || value < 0 || value > scale) return null;
    return { value, scale, count: isFiniteNumber(count) && count >= 0 ? Math.round(count) : null };
  }
  const haystack = [textOf(record.terms_provenance), typeof record.scraper?.notes === "string" ? record.scraper.notes : ""].join("\n");
  const match = RATING_PATTERN.exec(haystack);
  if (match === null) return null;
  const value = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isFinite(value) || value < 0 || value > 5 || !Number.isFinite(count)) return null;
  return { value, scale: 5, count };
}
