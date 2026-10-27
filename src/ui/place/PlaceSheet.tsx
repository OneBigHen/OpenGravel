"use client";

import { useEffect, useRef } from "react";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export function placeDistance(place: Coordinate, rider: Coordinate | null): string | null {
  if (rider === null) return null;
  const miles = haversine(place, rider) / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi away`;
}

export interface PlaceSheetProps {
  readonly place: PlaceMatch;
  readonly rider: Coordinate | null;
  readonly dropped?: boolean;
  readonly busy?: boolean;
  readonly saved?: boolean;
  readonly driveTime?: string | null;
  readonly onDirections: () => void;
  readonly onAddStop?: (() => void) | undefined;
  readonly onStart?: (() => void) | undefined;
  readonly startLabel?: string;
  readonly onSave: () => void;
  readonly onShare: () => void;
  readonly onClose: () => void;
}

const Glyph = ({ d }: { readonly d: string }) => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>;
const TURN = "M4 20v-6a4 4 0 0 1 4-4h10M14 6l4 4-4 4";
const PIN_PLUS = "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7v6M9 10h6";
const FLAG = "M5 21V4M5 4h11l-2 4 2 4H5";
const BOOKMARK = "M7 3h10v18l-5-3.5L7 21z";
const SHARE = "M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6";

/** The shared sheet is non-modal: the map and top search remain reachable. */
export function PlaceSheet({ place, rider, busy = false, saved = false, driveTime, onDirections, onAddStop, onStart, startLabel = "Start here", onSave, onShare, onClose }: PlaceSheetProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const invoker = document.activeElement;
    heading.current?.focus();
    return () => { if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus(); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const distance = placeDistance(place.coordinate, rider);
  // Say only what is known: an unfetched drive time used to read as a promise.
  // A context that already carries a distance ("57 South York Road · 0.2 mi")
  // must not be followed by "Distance needs your location".
  const contextHasDistance = / mi\b/.test(place.context);
  const detail = [distance ?? (contextHasDistance ? null : "Distance needs your location"), driveTime ?? null].filter((part) => part !== null).join(" · ");
  return <section className="og-place-sheet" data-testid="place-sheet" role="region" aria-labelledby="place-sheet-title">
    <div data-testid="place-card">
    <h2 id="place-sheet-title" ref={heading} tabIndex={-1}>{place.name}</h2>
    <p className="og-place-sheet__context">{place.context || `${place.coordinate.lat.toFixed(5)}, ${place.coordinate.lon.toFixed(5)}`}</p>
    {detail === "" ? null : <p className="og-place-sheet__distance">{detail}</p>}
    {/* Google's place sheet: one row of pills, Directions first and filled. */}
    <div className="og-place-sheet__actions">
      <button type="button" className="og-primary" data-testid="place-directions" onClick={onDirections} disabled={busy}><Glyph d={TURN}/>{busy ? "Finding your location…" : "Directions"}</button>
      {onStart === undefined ? null : <button type="button" className="og-secondary" onClick={onStart}><Glyph d={FLAG}/>{startLabel}</button>}
      {onAddStop === undefined ? null : <button type="button" className="og-secondary" onClick={onAddStop}><Glyph d={PIN_PLUS}/>Add stop</button>}
      <button type="button" className="og-secondary" aria-pressed={saved} onClick={onSave}><Glyph d={BOOKMARK}/>{saved ? "Saved" : "Save"}</button>
      <button type="button" className="og-secondary" onClick={onShare}><Glyph d={SHARE}/>Share</button>
    </div>
    <button type="button" className="og-place-sheet__close" aria-label="Close place details" onClick={onClose}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
  </section>;
}
