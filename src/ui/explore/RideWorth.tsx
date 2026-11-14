import "./ride-worth.css";
import Link from "next/link";

import type { RideDetail } from "@/application/route-library/types";
import { worthOf, type Worth, type WorthLine } from "@/application/route-library/worth";

/** "Standout · Twisty": the line above a library ride's name. */
export function worthEyebrow(worth: Worth): string {
  return [worth.quality, worth.type].filter((part): part is string => part !== null).join(" · ");
}

export function libraryWorth(detail: RideDetail | undefined): Worth | null {
  return detail === undefined ? null : worthOf(detail);
}

function Lines({ lines, testid }: { readonly lines: readonly WorthLine[]; readonly testid: string }) {
  if (lines.length === 0) return null;
  return (
    <dl className="og-worth__lines" data-testid={testid}>
      {lines.map((line) => (
        <div key={line.key} data-line={line.key}>
          <dt>{line.label}</dt>
          <dd>
            {line.text}
            {line.note === undefined ? null : <span className="og-worth__source">{line.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Is the ride worth the trip? The library's score in words, why it scored that,
 * and what a rider needs to know before going. Nothing
 * here is the app's own finding: the score is the library's, the claims are the
 * source's, and what is not known is said as not known.
 */
export function RideWorth({ worth }: { readonly worth: Worth }) {
  return (
    <section className="og-worth" aria-labelledby="worth-title" data-testid="worth-card">
      <h2 id="worth-title">Worth the trip?</h2>
      {worth.quality === null ? (
        <p className="og-worth__verdict" data-testid="worth-verdict">In the library, not scored as a top ride.</p>
      ) : (
        <p className="og-worth__verdict" data-testid="worth-verdict"><strong>{worth.quality}</strong> in the library’s scoring.</p>
      )}
      {worth.reason === null ? null : <p className="og-worth__reason" data-testid="worth-reason">{worth.reason}</p>}
      <p className="og-worth__fine">The library’s score, from its sources. Not a rider vote.</p>
      <Lines lines={worth.truth} testid="worth-lines" />
    </section>
  );
}

function when(date: string | null): string | null {
  if (date === null) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** What the source says about the ride, what riders wrote, the stops it lists and where else it appears. */
export function RideMore({ worth, detail }: { readonly worth: Worth; readonly detail: RideDetail }) {
  const nothing = worth.goodToKnow.length === 0 && worth.stops.length === 0 && worth.notes.length === 0 && worth.alsoOn.length === 0 && detail.partOf.length === 0;
  if (nothing) return null;
  return (
    <section className="og-worth og-worth--more" aria-labelledby="worth-more-title" data-testid="worth-more">
      <h2 id="worth-more-title">Good to know</h2>
      {worth.goodToKnow.length === 0 ? null : <p className="og-worth__fine">What the source says:</p>}
      <Lines lines={worth.goodToKnow} testid="worth-known" />
      {worth.stops.length === 0 ? null : (
        <dl className="og-worth__lines" data-testid="worth-stops">
          {worth.stops.map((stop) => (
            <div key={stop.key}>
              <dt>{stop.label} ({stop.names.length})</dt>
              <dd>{stop.names.join(", ")}</dd>
            </div>
          ))}
        </dl>
      )}
      {worth.notes.length === 0 ? null : (
        <div className="og-worth__notes" data-testid="worth-notes">
          <h3>Riders say</h3>
          <ul>
            {worth.notes.slice(0, 3).map((note) => (
              <li key={`${note.author}-${note.date ?? note.text.slice(0, 12)}`}>
                <q>{note.text}</q>
                <span className="og-worth__source">
                  {note.author}{when(note.date) === null ? "" : `, ${when(note.date)}`}
                  {note.url === null ? null : <> · <a href={note.url} target="_blank" rel="noopener noreferrer">on {detail.credit.sourceName}<span className="sr-only"> (opens the original in a new tab)</span></a></>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {worth.alsoOn.length === 0 ? null : (
        <div className="og-worth__notes" data-testid="worth-also">
          <h3>Also on</h3>
          <ul>
            {worth.alsoOn.map((credit) => (
              <li key={credit.sourceUrl}>{credit.creditLine} · <a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">{credit.sourceName}<span className="sr-only"> (opens the original in a new tab)</span></a></li>
            ))}
          </ul>
        </div>
      )}
      {detail.partOf.length === 0 ? null : (
        <p className="og-worth__fine">Part of: {detail.partOf.map(([id, name], index) => <span key={id}>{index === 0 ? "" : ", "}<Link href={`/explore/${encodeURIComponent(id)}`}>{name}</Link></span>)}</p>
      )}
    </section>
  );
}
