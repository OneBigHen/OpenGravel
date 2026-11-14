/**
 * Rider wording for the facts a source claims (L2b, L7, L8), kept apart from
 * the phrase tables so a page that only words a fact does not carry the whole
 * surface catalogue into its bundle.
 */
import type { RideFact } from "./types";

export type SurfaceValue = "paved" | "unpaved" | "mixed";
export type LegalValue = "public-roads" | "designated-ohv" | "mixed";

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
