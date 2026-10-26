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
  const detail = [distance ?? "Distance needs your location", driveTime ?? null].filter((part) => part !== null).join(" · ");
  return <section className="og-place-sheet" data-testid="place-sheet" role="region" aria-labelledby="place-sheet-title">
    <div data-testid="place-card">
    <h2 id="place-sheet-title" ref={heading} tabIndex={-1}>{place.name}</h2>
    <p className="og-place-sheet__context">{place.context || `${place.coordinate.lat.toFixed(5)}, ${place.coordinate.lon.toFixed(5)}`}</p>
    <p className="og-place-sheet__distance">{detail}</p>
    <div className="og-place-sheet__actions">
      <button type="button" className="og-primary" data-testid="place-directions" onClick={onDirections} disabled={busy}>{busy ? "Finding your location…" : "Directions"}</button>
      {onAddStop === undefined ? null : <button type="button" className="og-secondary" onClick={onAddStop}>Add stop</button>}
      {onStart === undefined ? null : <button type="button" className="og-secondary" onClick={onStart}>{startLabel}</button>}
      <button type="button" className="og-secondary" aria-pressed={saved} onClick={onSave}>{saved ? "Saved" : "Save"}</button>
      <button type="button" className="og-secondary" onClick={onShare}>Share</button>
    </div>
    <button type="button" className="og-place-sheet__close" aria-label="Close place details" onClick={onClose}>×</button>
    </div>
  </section>;
}
