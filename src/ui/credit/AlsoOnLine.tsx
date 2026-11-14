import "./ride-credit.css";
import { creditText, type RideCredit } from "@/domain/ride/credit";

/**
 * "Also on: MotorcycleRoads.com, BestBikingRoads": the other sites that list the
 * same road, each linked to its own page and each crediting its own author. Shown
 * only on a card that was merged from several listings (L2a).
 */
export function AlsoOnLine({
  primary,
  alsoOn,
}: {
  readonly primary: RideCredit | undefined;
  readonly alsoOn: readonly RideCredit[] | undefined;
}) {
  if (alsoOn === undefined || alsoOn.length === 0) return null;
  // Two listings on one site still each get their link; the label says which is which.
  const seen = new Map<string, number>([[primary?.sourceName ?? "", 1]]);
  const labelled = alsoOn.map((credit) => {
    const count = (seen.get(credit.sourceName) ?? 0) + 1;
    seen.set(credit.sourceName, count);
    return { credit, label: count > 1 ? `${credit.sourceName} (another listing)` : credit.sourceName };
  });
  return (
    <p className="og-ride-credit" data-testid="also-on">
      Also on:{" "}
      {labelled.map(({ credit, label }, index) => (
        <span key={`${credit.sourceUrl ?? credit.sourceName}-${index}`} data-testid="also-on-site" title={creditText(credit)}>
          {index === 0 ? "" : ", "}
          {credit.sourceUrl === undefined ? (
            label
          ) : (
            <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
              {label}
              <span className="sr-only"> (opens the original in a new tab)</span>
            </a>
          )}
          {credit.author === null ? "" : ` (${credit.author})`}
        </span>
      ))}
    </p>
  );
}
