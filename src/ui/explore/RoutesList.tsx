"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { decodeCardLine } from "@/application/route-library/card-line";
import { LIBRARY_CHIPS, LIBRARY_CHIP_LABEL, type LibraryChip } from "@/application/route-library/client";
import { creditWord, qualityAndType } from "@/application/route-library/row-words";
import type { IndexRow } from "@/application/route-library/types";
import { RouteLinePreview } from "@/ui/explore/RouteLinePreview";
import { rowLengthText } from "@/ui/explore/RoutesMapCard";
import { rememberListPosition } from "@/ui/explore/list-position";

/** Rides shown before "Show more". */
export const LIBRARY_PAGE = 30;

const PHONE_QUERY = "(max-width: 760px)";

function subscribePhone(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True on a phone-width screen, where Explore shows the list or the map, not both. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/** A ride's 16-point shape as a line the existing thumbnail can draw. */
function shapeLine(card: string | null): readonly { readonly lat: number; readonly lon: number }[] {
  // Tiny degrees keep the thumbnail's own latitude correction at 1, so the shape stays true.
  return decodeCardLine(card).map((point) => ({ lat: (63 - point.y) * 0.0005, lon: point.x * 0.0005 }));
}

function LibraryRow({ row, sources }: { readonly row: IndexRow; readonly sources: readonly string[] }) {
  const length = rowLengthText(row);
  const credit = creditWord(row, sources);
  const line = shapeLine(row.c);
  return (
    <li className="og-explore-card og-explore-card--ride" data-testid="library-row">
      <Link
        className="og-explore-card__link"
        href={`/explore/${encodeURIComponent(row.id)}`}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          rememberListPosition(window.scrollY);
        }}
      >
        {line.length >= 2 ? (
          <RouteLinePreview line={line} name={row.n} className="og-explore-card__preview og-routes__shape" />
        ) : (
          <div className="og-explore-card__preview og-map-preview-unavailable" aria-hidden="true">
            <span className="og-map-preview-unavailable__glyph">⌖</span>
          </div>
        )}
        <span className="og-explore-card__body">
          <strong className="og-explore-card__title">{row.n}</strong>
          <span className="og-explore-card__facts">
            <span className="og-explore-card__fact">{qualityAndType(row)}</span>
            {length === null ? null : <span className="og-explore-card__fact">{length}</span>}
          </span>
          <span className="og-explore-card__credit">
            {row.p === null ? <span>Not on the map yet</span> : null}
            {credit === null ? null : <span className="og-explore-card__byline">{credit}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The library's rides as the usual rows, best first, thirty at a time. */
export function LibraryRows({ rows, sources, label }: { readonly rows: readonly IndexRow[]; readonly sources: readonly string[]; readonly label: string }) {
  // A new set of rides starts again from the first page.
  const key = useMemo(() => `${rows.length}:${rows[0]?.id ?? ""}:${rows.at(-1)?.id ?? ""}`, [rows]);
  const [more, setMore] = useState<{ readonly key: string; readonly pages: number }>({ key, pages: 1 });
  const pages = more.key === key ? more.pages : 1;
  const visible = rows.slice(0, pages * LIBRARY_PAGE);
  if (rows.length === 0) return null;
  return (
    <>
      <ul className="og-explore__list" aria-label={label} data-testid="library-list">
        {visible.map((row) => <LibraryRow key={row.id} row={row} sources={sources} />)}
      </ul>
      {visible.length < rows.length ? (
        <button type="button" className="og-secondary og-routes__more" onClick={() => setMore({ key, pages: pages + 1 })}>
          Show more ({rows.length - visible.length} left)
        </button>
      ) : null}
    </>
  );
}

/** The five ride-type chips. Several can be on at once: rides that are any of them show. */
export function LibraryChips({ chips, onChange }: { readonly chips: readonly LibraryChip[]; readonly onChange: (next: readonly LibraryChip[]) => void }) {
  return (
    <>
      {LIBRARY_CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          className="og-explore__quick-chip og-routes__chip"
          aria-pressed={chips.includes(chip)}
          data-testid={`chip-${chip}`}
          onClick={() => onChange(chips.includes(chip) ? chips.filter((other) => other !== chip) : LIBRARY_CHIPS.filter((other) => other === chip || chips.includes(other)))}
        >
          {LIBRARY_CHIP_LABEL[chip]}
        </button>
      ))}
    </>
  );
}
