"use client";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import { riderRouteOptions } from "@/application/planner/rider-route-options";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { RideActionsProps } from "./RideActions";
import { RouteDecisionCard } from "./RouteDecisionCard";

export interface RouteOptionsProps {
  readonly cards: readonly RouteCardVm[];
  readonly startLabel: string;
  readonly finishLabel: string;
  readonly onSelect: (id: RouteCandidateId) => void;
  readonly onReverse?: (() => void) | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly onOptions?: (() => void) | undefined;
  readonly optionsLabel?: string | undefined;
  readonly start: RideActionsProps["start"];
}
const shortName = (label: string) => label.split(",")[0]?.trim() || label;

export function RouteOptions({ cards, startLabel, finishLabel, onSelect, onReverse, onEdit, onOptions, optionsLabel, start }: RouteOptionsProps) {
  return <section className="og-route-options" data-testid="route-options" aria-label="Route options">
    <div className="og-route-options__header">
      <h2 data-testid="route-options-header" tabIndex={-1} data-sheet-focus>{shortName(startLabel)} → {shortName(finishLabel)}</h2>
      {onReverse === undefined ? null : <button type="button" data-testid="route-options-swap" aria-label="Swap start and destination" onClick={onReverse}>⇅</button>}
      {onEdit === undefined ? null : <button type="button" data-testid="route-options-edit" onClick={onEdit}>Edit</button>}
    </div>
    <div className="og-route-options__scroll">
      <ul className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
        {riderRouteOptions(cards).map(({ card, label, reason }) => <RouteDecisionCard key={card.routeId} compact card={card} compactLabel={label} compactReason={reason} onSelect={onSelect}/>)}
      </ul>
      {onOptions === undefined ? null : <button type="button" className="og-route-options__settings" data-testid="route-options-settings" onClick={onOptions}><span>Options</span><span>{optionsLabel} ›</span></button>}
    </div>
    {start === null ? null : <div className="og-route-options__start">
      <button type="button" className="og-primary" data-testid="start-ride" disabled={start.starting || start.refusal !== null} onClick={start.onStart}>{start.starting ? "Starting…" : "Start ride"}</button>
      {start.refusal === null ? null : <p data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p role="alert">{start.error}</p>}
    </div>}
  </section>;
}
