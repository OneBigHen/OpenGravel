import { creditText, type RideCredit } from "@/domain/ride/credit";

/**
 * "Route by Jane Doe · PA Adventure Bike Rides": the one quiet credit line for
 * a route someone else made. The source links to the original when we have a
 * URL. A ride the rider made themselves has no credit and renders nothing.
 */
export function RideCreditLine({
  credit,
  linked = true,
  className,
}: {
  readonly credit: RideCredit | undefined;
  /** False inside a card that is itself a link (no nested anchors). */
  readonly linked?: boolean;
  readonly className?: string;
}) {
  if (credit === undefined) return null;
  const classes = className === undefined ? "og-ride-credit" : `og-ride-credit ${className}`;
  if (!linked || credit.sourceUrl === undefined) {
    return <p className={classes} data-testid="ride-credit">{creditText(credit)}</p>;
  }
  const source = (
    <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
      {credit.sourceName}
      <span className="sr-only"> (opens the original in a new tab)</span>
    </a>
  );
  return (
    <p className={classes} data-testid="ride-credit">
      {credit.author === null ? <>Route from {source} · author not named</> : <>Route by {credit.author} · {source}</>}
    </p>
  );
}
