"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { sortBest, type LibraryChip } from "@/application/route-library/client";
import { ridesNear, stateTiles, type NearResult } from "@/application/route-library/discover";
import { creditWord, qualityAndType, statesWord } from "@/application/route-library/row-words";
import type { IndexRow } from "@/application/route-library/types";
import { LibraryRows, ShapeThumb } from "@/ui/explore/RoutesList";
import { rowLengthText } from "@/ui/explore/RoutesMapCard";

/** What a tap on a home section narrows the library to. */
export interface Narrow {
  readonly state?: string;
  readonly standout?: boolean;
  readonly types?: readonly LibraryChip[];
  readonly near?: boolean;
}

const SCORE_NOTE = "Standout and Great ride are the library’s own scores, not rider votes.";

function SectionHead({ id, title, count, onAll }: { readonly id: string; readonly title: string; readonly count?: number; readonly onAll?: () => void }) {
  return (
    <div className="og-routes__head">
      <h2 id={id} className="og-road-discovery__title">{title}</h2>
      {onAll === undefined ? null : (
        <button type="button" className="og-routes__all" onClick={onAll} aria-label={`See all: ${title}`}>
          See all{count === undefined ? "" : ` ${count.toLocaleString("en-US")}`}
        </button>
      )}
    </div>
  );
}

/** One tile per state that has rides: the code, the ride count and the name. */
export function StateTiles({ rows, onPick }: { readonly rows: readonly IndexRow[]; readonly onPick: (code: string) => void }) {
  const tiles = useMemo(() => stateTiles(rows), [rows]);
  return (
    <ul className="og-routes__tiles" aria-label="States" data-testid="state-tiles">
      {tiles.map((tile) => (
        <li key={tile.code}>
          <button type="button" className="og-routes__tile" data-testid={`state-${tile.code}`} aria-label={`${tile.name}, ${tile.count} ${tile.count === 1 ? "ride" : "rides"}`} onClick={() => onPick(tile.code)}>
            <span className="og-routes__tile-code" aria-hidden="true">{tile.code}</span>
            <span className="og-routes__tile-count" aria-hidden="true">{tile.count.toLocaleString("en-US")}</span>
            <span className="og-routes__tile-name" aria-hidden="true">{tile.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Explore's front page for the library, before the rider narrows anything: the
 * rides near them (when their place is known), the Standouts, every state with
 * its count, and the big trips. Each section opens the same result list.
 */
export function RoutesHome({ rows, sources, origin, onNarrow, children }: {
  readonly rows: readonly IndexRow[];
  readonly sources: readonly string[];
  /** The rider's place as [lat, lon], when they have shared it. */
  readonly origin: readonly [number, number] | undefined;
  readonly onNarrow: (narrow: Narrow) => void;
  /** The long tail, "every ride, best first", which the panel pages. */
  readonly children?: ReactNode;
}) {
  const near = useMemo(() => (origin === undefined ? null : ridesNear(rows, origin)), [rows, origin]);
  const standouts = useMemo(() => sortBest(rows.filter((row) => row.q >= 5), origin), [rows, origin]);
  const trips = useMemo(() => sortBest(rows.filter((row) => row.k === "trip"), origin), [rows, origin]);
  return (
    <div className="og-routes__home" data-testid="routes-home">
      {near === null || near.rows.length === 0 ? null : (
        <section className="og-routes__section" aria-labelledby="home-near">
          <SectionHead id="home-near" title="Near you" onAll={() => onNarrow({ near: true })} />
          <LibraryRows rows={near.rows} sources={sources} label="Rides near you" origin={origin} preview={3} />
        </section>
      )}
      {standouts.length === 0 ? null : (
      <section className="og-routes__section" aria-labelledby="home-standout">
        <SectionHead id="home-standout" title="Standout rides" count={standouts.length} onAll={() => onNarrow({ standout: true })} />
        <p className="og-routes__note">{SCORE_NOTE}</p>
        <LibraryRows rows={standouts} sources={sources} label="Standout rides" origin={origin} preview={3} />
      </section>
      )}
      <section className="og-routes__section" aria-labelledby="home-states">
        <SectionHead id="home-states" title="Browse by state" />
        <StateTiles rows={rows} onPick={(state) => onNarrow({ state })} />
      </section>
      {trips.length === 0 ? null : (
        <section className="og-routes__section" aria-labelledby="home-trips">
          <SectionHead id="home-trips" title="Big trips" count={trips.length} onAll={() => onNarrow({ types: ["trips"] })} />
          <LibraryRows rows={trips} sources={sources} label="Big trips" origin={origin} preview={3} />
        </section>
      )}
      {children}
    </div>
  );
}

/** The result list once the rider has narrowed the library: a title that says what is listed, the count, the rides. */
export function RoutesResults({ title, rows, sources, origin, near, onClear }: {
  readonly title: string;
  readonly rows: readonly IndexRow[];
  readonly sources: readonly string[];
  readonly origin: readonly [number, number] | undefined;
  /** Set for Near me: how the list was made. */
  readonly near: NearResult | null;
  readonly onClear: () => void;
}) {
  const note = near === null
    ? "Best rides first."
    : near.radiusMiles === null
      ? `Fewer than 5 rides start within 75 mi, so these are the nearest ${rows.length}.`
      : `${rows.length} ${rows.length === 1 ? "ride starts" : "rides start"} within ${near.radiusMiles} mi, best first.`;
  return (
    <section className="og-routes__section" aria-labelledby="routes-results-title" data-testid="routes-results">
      <div className="og-routes__head">
        <h2 id="routes-results-title" className="og-road-discovery__title" data-testid="routes-results-title">{title}</h2>
        <button type="button" className="og-routes__all" onClick={onClear} data-testid="routes-clear">All rides</button>
      </div>
      <p className="og-routes__note" data-testid="routes-results-note">
        {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "ride" : "rides"}. {note}
      </p>
      {rows.length === 0 ? (
        <p className="og-explore__empty" role="status">Nothing matches that. Try fewer filters.</p>
      ) : (
        <LibraryRows rows={rows} sources={sources} label={title} origin={origin} />
      )}
    </section>
  );
}

/**
 * The strip under the country map: the best rides around the part of the map
 * in view. "Best" is the library's own score, and the strip says so.
 */
export function BestStrip({ best, sources }: { readonly best: readonly IndexRow[]; readonly sources: readonly string[] }) {
  return (
    <section className="og-routes__strip" aria-label="Best rides near this view" data-testid="best-strip">
      <h2 className="og-routes__strip-title">Best rides near this view</h2>
      <p className="og-routes__strip-note">{SCORE_NOTE}</p>
      <ul className="og-routes__strip-list" key={best.map((row) => row.id).join()}>
        {best.map((row) => {
          const length = rowLengthText(row);
          const credit = creditWord(row, sources);
          return (
            <li key={row.id} className="og-routes__strip-card" data-testid="best-card">
              <Link href={`/explore/${encodeURIComponent(row.id)}`} className="og-routes__strip-link">
                <ShapeThumb card={row.c} name={row.n} className="og-routes__strip-shape" />
                <span className="og-routes__strip-body">
                  <strong>{row.n}</strong>
                  <span>{qualityAndType(row)}</span>
                  <span>{[length, statesWord(row.st)].filter((part) => part !== null && part !== "").join(" · ")}</span>
                  {credit === null ? null : <span className="og-routes__strip-credit">{credit}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
