"use client";

/**
 * The card behind a ride-interest tap (OGV#13): name, a short summary, a
 * photo when the source has one, and "Add as stop" — the same reroute-detour
 * command the fuel-ahead list already uses (`RideDetour`'s "Go"), so
 * choosing a Wikimedia landmark reroutes exactly the way choosing a gas
 * station does. Wikimedia never ranks a route on its own (OGV-D-278/282);
 * only this tap can turn a point into a stop.
 */

import { useRef } from "react";

import type { RideInterestPoint } from "@/application/ride-interest";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export interface RideInterestCardProps {
  readonly point: RideInterestPoint;
  readonly onClose: () => void;
  readonly onAddStop: (point: RideInterestPoint) => void;
}

export function RideInterestCard({ point, onClose, onAddStop }: RideInterestCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  useDialogFocus(cardRef, onClose);

  return (
    <section
      ref={cardRef}
      className="og-ride-interest-card og-ride__floating-card"
      data-testid="ride-interest-card"
      role="dialog"
      aria-label={`${point.name} details`}
    >
      {point.photoUrl === null ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- a provider photo, never known to the Next.js image loader's allow-list.
        <img className="og-ride-interest-card__photo" src={point.photoUrl} alt={point.name} />
      )}
      <div className="og-ride-interest-card__body">
        <div className="og-ride-interest-card__topline">
          <h2 className="og-ride-interest-card__title">{point.name}</h2>
          <button
            type="button"
            className="og-ride-interest-card__close"
            aria-label="Close details"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {point.summary === null ? null : <p className="og-ride-interest-card__summary">{point.summary}</p>}
        <p className="og-ride-interest-card__attribution">{point.attribution}</p>
        <div className="og-ride-interest-card__actions">
          <button
            type="button"
            className="og-ride__action og-ride__action--primary"
            data-testid="ride-interest-add-stop"
            onClick={() => onAddStop(point)}
          >
            Add as stop
          </button>
          {point.detailUrl === null ? null : (
            <a className="og-ride__action" href={point.detailUrl} target="_blank" rel="noopener noreferrer">
              Details
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
