"use client";

/**
 * The phone's route header (Google Maps' "Your location → Work" card).
 *
 * While a ride is on the map, or being planned, the search bar and its category
 * chips have nothing to do: the top of the screen says where the ride runs
 * instead. A tap on either line opens the ride's editor in the sheet; × leaves
 * the route (the sheet then offers Undo clear); ⇅ turns an A → B ride around.
 */

import type { PlannerViewModel } from "@/application/planner/planner-view-model";
import type { RideDocument } from "@/domain/ride/types";
import type { RideStyleControlsModel } from "@/ui/planner/RideStyleControls";

export interface TripCardProps {
  readonly startLabel: string;
  readonly finishLabel: string;
  readonly loop: boolean;
  readonly onEdit: () => void;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly onSwap?: (() => void) | undefined;
  /**
   * A ride is on the map (PF-3): the card folds to one 52px line, "Your
   * location → Destination", so the top of the screen is map again. While the
   * ride is still being planned it keeps the two-line form.
   */
  readonly compact?: boolean;
}

const CLOSE = <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>;
const SWAP = <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4"/></svg>;

export function TripCard({ startLabel, finishLabel, loop, onEdit, onClose, closeLabel, onSwap, compact = false }: TripCardProps) {
  const editLabel = `Edit ride: from ${startLabel} ${loop ? "and back" : `to ${finishLabel}`}`;
  if (compact) return <div className="og-trip" data-testid="trip-card" data-compact="true">
    <button type="button" className="og-trip__lines og-trip__one" data-testid="trip-edit" aria-label={editLabel} onClick={onEdit}>
      {loop ? <>
        <span className="og-trip__dot" data-end="loop" aria-hidden="true"/>
        <span className="og-trip__label og-trip__label--finish">{`Loop from ${startLabel}`}</span>
      </> : <>
        <span className="og-trip__dot" data-end="start" aria-hidden="true"/>
        <span className="og-trip__label og-trip__label--start">{startLabel}</span>
        <svg className="og-trip__arrow" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
        <span className="og-trip__dot" data-end="finish" aria-hidden="true"/>
        <span className="og-trip__label og-trip__label--finish">{finishLabel}</span>
      </>}
    </button>
    <div className="og-trip__tools">
      {onSwap === undefined || loop ? null : <button type="button" className="og-trip__tool" data-testid="trip-swap" aria-label="Swap start and destination" title="Swap start and destination" onClick={onSwap}>{SWAP}</button>}
      <button type="button" className="og-trip__tool" data-testid="trip-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>{CLOSE}</button>
    </div>
  </div>;
  return <div className="og-trip" data-testid="trip-card">
    <button type="button" className="og-trip__lines" data-testid="trip-edit" aria-label={editLabel} onClick={onEdit}>
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
      <button type="button" className="og-trip__tool" data-testid="trip-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>{CLOSE}</button>
      {onSwap === undefined || loop ? null : <button type="button" className="og-trip__tool" data-testid="trip-swap" aria-label="Swap start and destination" title="Swap start and destination" onClick={onSwap}>{SWAP}</button>}
    </div>
  </div>;
}

/** The card as the planner composes it: the ride's ends, its shape and its actions. */
export function PlannerTripCard({ document, viewModel, rideStyle, onCancelPlanning, onClearRide, onEditRide }: {
  readonly document: RideDocument;
  readonly viewModel: PlannerViewModel;
  readonly rideStyle: RideStyleControlsModel;
  readonly onCancelPlanning: () => void;
  readonly onClearRide: () => void;
  readonly onEditRide: () => void;
}) {
  const endLabel = (end: RideDocument["intent"]["start"], fallback: string): string =>
    end?.provenance.type === "gps" ? "Your location" : end?.label ?? fallback;
  const hasRide = viewModel.routeCards.length > 0;
  return <TripCard
    startLabel={endLabel(document.intent.start, viewModel.startLabel)}
    finishLabel={endLabel(document.intent.finish, viewModel.finishLabel)}
    loop={rideStyle.view.shape === "loop"}
    onSwap={rideStyle.actions.reverse}
    closeLabel={hasRide ? "Close route" : "Stop planning"}
    compact={hasRide}
    onClose={hasRide ? onClearRide : onCancelPlanning}
    onEdit={(): void => {
      // Directions from a place card edit in their own view of the sheet.
      const optionsEdit = window.document.querySelector<HTMLButtonElement>('[data-testid="route-options-edit"]');
      if (optionsEdit !== null) { optionsEdit.click(); return; }
      onEditRide();
      window.setTimeout(() => {
        window.document.querySelector<HTMLElement>(".og-planner__sheet .og-composer")?.scrollIntoView({ block: "start" });
      }, 280);
    }}
  />;
}
