"use client";

/**
 * The phone's route header (Google Maps' "Your location → Work" card).
 *
 * While a ride is on the map, or being planned, the search bar and its category
 * chips have nothing to do: the top of the screen says where the ride runs
 * instead. A tap on either line opens the ride's editor in the sheet; × leaves
 * the route (the sheet then offers Undo clear); ⇅ turns an A → B ride around.
 */

export interface TripCardProps {
  readonly startLabel: string;
  readonly finishLabel: string;
  readonly loop: boolean;
  readonly onEdit: () => void;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly onSwap?: (() => void) | undefined;
}

export function TripCard({ startLabel, finishLabel, loop, onEdit, onClose, closeLabel, onSwap }: TripCardProps) {
  return <div className="og-trip" data-testid="trip-card">
    <button type="button" className="og-trip__lines" data-testid="trip-edit" aria-label={`Edit ride: from ${startLabel} ${loop ? "and back" : `to ${finishLabel}`}`} onClick={onEdit}>
      <span className="og-trip__line">
        <span className="og-trip__dot" data-end="start" aria-hidden="true"/>
        <span className="og-trip__label">{startLabel}</span>
      </span>
      <span className="og-trip__rule" aria-hidden="true"/>
      <span className="og-trip__line">
        <span className="og-trip__dot" data-end={loop ? "loop" : "finish"} aria-hidden="true"/>
        <span className="og-trip__label">{loop ? "Loop back to start" : finishLabel}</span>
      </span>
    </button>
    <div className="og-trip__tools">
      <button type="button" className="og-trip__tool" data-testid="trip-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      {onSwap === undefined || loop ? null : <button type="button" className="og-trip__tool" data-testid="trip-swap" aria-label="Swap start and destination" title="Swap start and destination" onClick={onSwap}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4"/></svg>
      </button>}
    </div>
  </div>;
}
