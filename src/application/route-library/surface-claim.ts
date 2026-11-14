import { SURFACE_PHRASES, type SurfaceClaimValue } from "./surface-phrases";
import type { RideFact, SurfaceCode } from "./types";

export type { SurfaceClaimValue } from "./surface-phrases";

function normalize(phrase: string): string {
  return phrase.trim().replace(/\s+/g, " ").toLowerCase();
}

/** What a source's surface wording claims. Anything not in the table is unknown (`null`). */
export function surfaceClaim(phrase: string | null | undefined): SurfaceClaimValue | null {
  if (typeof phrase !== "string") return null;
  const row = Object.hasOwn(SURFACE_PHRASES, normalize(phrase)) ? SURFACE_PHRASES[normalize(phrase)] : null;
  return row ?? null;
}

export function surfaceCode(claim: SurfaceClaimValue | null): SurfaceCode {
  return claim === "paved" ? "p" : claim === "unpaved" ? "u" : claim === "mixed" ? "m" : null;
}

/** True when the phrase has a row in the table (even a `null` row). */
export function hasSurfaceRow(phrase: string): boolean {
  return Object.hasOwn(SURFACE_PHRASES, normalize(phrase));
}

const UNKNOWN_WORDS: ReadonlySet<string> = new Set(["", "unknown", "none stated", "not stated", "n/a"]);

/** A quoted source fact: the words and where they came from, or all `null`. */
export function quotedFact(
  text: string | null | undefined,
  source: string | null | undefined,
  value: (clean: string) => string | null = (clean) => clean,
): RideFact<string> {
  const clean = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  if (UNKNOWN_WORDS.has(clean.toLowerCase())) return { value: null, quote: null, source: null };
  const parsed = value(clean);
  return { value: parsed, quote: clean, source: typeof source === "string" && source.trim() !== "" ? source.trim() : null };
}

export function surfaceFact(
  phrase: string | null | undefined,
  source: string | null | undefined,
): RideFact<SurfaceClaimValue> {
  const claim = surfaceClaim(phrase);
  const clean = typeof phrase === "string" ? phrase.trim().replace(/\s+/g, " ") : "";
  if (UNKNOWN_WORDS.has(clean.toLowerCase())) return { value: null, quote: null, source: null };
  return { value: claim, quote: clean, source: typeof source === "string" && source.trim() !== "" ? source.trim() : null };
}
