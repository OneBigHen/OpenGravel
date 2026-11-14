"use client";

import { useRef } from "react";

import { formatDistance } from "@/application/planner/measurements";
import { creditWord, qualityWord, statesWord, typeWord } from "@/application/route-library/row-words";
import type { IndexRow } from "@/application/route-library/types";
import { estimatedRideMinutes, formatRideMinutes } from "@/ui/explore/route-facts";

const KM_PER_MILE = 1.609344;
const SWIPE_PX = 40;

/** "48 mi · about 1 h 30 min"; a ride with no measured length says nothing about miles. */
export function rowLengthText(row: Pick<IndexRow, "mi">): string | null {
  if (row.mi === null) return null;
  const km = row.mi * KM_PER_MILE;
  const minutes = estimatedRideMinutes(km);
  return minutes === null ? formatDistance(km * 1000) : `${formatDistance(km * 1000)} · about ${formatRideMinutes(minutes)}`;
}

/**
 * The glass card for the ride under a tap. Rides that overlap under one finger
 * share it: "1 of 3", with arrows and a sideways swipe.
 */
export function RoutesMapCard({
  rows,
  index,
  sources,
  onIndex,
  onOpen,
  onClose,
}: {
  readonly rows: readonly IndexRow[];
  readonly index: number;
  readonly sources: readonly string[];
  readonly onIndex: (index: number) => void;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
}) {
  const start = useRef<number | null>(null);
  const row = rows[index];
  if (row === undefined) return null;
  const quality = qualityWord(row.q);
  const length = rowLengthText(row);
  const credit = creditWord(row, sources);
  const many = rows.length > 1;
  const step = (by: number): void => onIndex((index + by + rows.length) % rows.length);
  return (
    <section
      className="og-routes__card"
      aria-label="Ride on the map"
      data-testid="routes-map-card"
      onPointerDown={(event) => { start.current = event.clientX; }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!many || from === null) return;
        const moved = event.clientX - from;
        if (Math.abs(moved) >= SWIPE_PX) step(moved < 0 ? 1 : -1);
      }}
    >
      <button type="button" className="og-routes__card-close" aria-label="Close ride card" onClick={onClose}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div className="og-routes__card-head">
        <strong className="og-routes__card-name">{row.n}</strong>
        {quality === null ? null : <span className="og-routes__quality" data-testid="routes-card-quality">{quality}</span>}
      </div>
      <p className="og-routes__card-facts">
        {[length, typeWord(row), statesWord(row.st)].filter((part) => part !== null && part !== "").join(" · ")}
      </p>
      {credit === null ? null : <p className="og-routes__card-credit" data-testid="routes-card-credit">{credit}</p>}
      <div className="og-routes__card-actions">
        <button type="button" className="og-primary" data-testid="routes-open-ride" onClick={() => onOpen(row.id)}>Open ride</button>
        {many ? (
          <div className="og-routes__pager" role="group" aria-label="Rides under your finger">
            <button type="button" aria-label="Previous ride" onClick={() => step(-1)}>‹</button>
            <span data-testid="routes-card-count">{index + 1} of {rows.length}</span>
            <button type="button" aria-label="Next ride" onClick={() => step(1)}>›</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
