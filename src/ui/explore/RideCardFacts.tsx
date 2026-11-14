import type { CatalogEntry } from "@/application/explore/catalog";
import { formatDistance } from "@/application/planner/measurements";
import { routeFacts } from "@/ui/explore/route-facts";

/**
 * The numbers on a ride card, from one place.
 *
 * The top "this weekend" cards and the full list used to read different fields
 * (one said "1.6 mi dirt", its list card "2.1 mi of curves, Mostly paved, 1.6 mi
 * dirt"), so one ride seemed to have two sets of facts. Both now render this
 * line: how far, how long, how it turns, what it rides on. A fact the catalog
 * does not know is left out, and a ride that knows none gets no line at all.
 */
export interface CardFact {
  readonly text: string;
  readonly isTime: boolean;
  readonly note?: string;
}

export function cardFacts(entry: CatalogEntry): readonly CardFact[] {
  const facts = routeFacts({
    distanceKm: entry.distanceKm,
    estimatedTimeMinutes: entry.estimatedTimeMinutes,
    surfaceLabel: null,
    curvatureSummary: undefined,
    formatDistance,
  });
  const distance = facts.find((fact) => fact.key === "distance");
  const time = facts.find((fact) => fact.key === "time");
  // The surface evidence arrives as "Mostly paved · 2.1 mi gravel"; on a card the
  // middot is the line's own separator, so that fact keeps its halves as a comma.
  return [
    ...(distance === undefined ? [] : [{ text: distance.text, isTime: false }]),
    ...(time === undefined ? [] : [{ text: time.text, isTime: true, ...(time.note === undefined ? {} : { note: time.note }) }]),
    ...(entry.curvatureSummary === undefined || entry.curvatureSummary.trim() === "" ? [] : [{ text: entry.curvatureSummary, isTime: false }]),
    ...(entry.surfaceSummary === undefined || entry.surfaceSummary.trim() === ""
      ? []
      : [{ text: entry.surfaceSummary.split(" · ").join(", "), isTime: false }]),
  ];
}

export function RideCardFacts({ entry, className, factClassName, durationClassName }: {
  readonly entry: CatalogEntry;
  readonly className: string;
  readonly factClassName?: string;
  readonly durationClassName?: string;
}) {
  const facts = cardFacts(entry);
  if (facts.length === 0) return null;
  return (
    <span className={className} data-testid="ride-card-facts">
      {facts.map((fact, index) => (
        <span
          key={`${index}-${fact.text}`}
          {...(fact.isTime ? (durationClassName === undefined ? {} : { className: durationClassName }) : factClassName === undefined ? {} : { className: factClassName })}
          {...(fact.note === undefined ? {} : { title: fact.note })}
        >
          {fact.text}
        </span>
      ))}
    </span>
  );
}
