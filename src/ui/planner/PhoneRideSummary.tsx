"use client";

import type { RouteCardVm } from "@/application/planner/planner-view-model";
import type { RouteCandidateId } from "@/domain/route/ids";
import type { ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";
import type { RideActionsProps } from "./RideActions";
import { rideGlanceSurface } from "./MapRideGlance";
import { useElevationProfile } from "./useElevationProfile";

const NO_LINE: readonly Coordinate[] = [];
export function PhoneRideSummary({ card, cards, start, route, elevationSource, comparing, onCompare, onSelect, weatherLine, destinationLine = null }: {
  readonly card: RouteCardVm;
  readonly cards: readonly RouteCardVm[];
  readonly start: RideActionsProps["start"];
  readonly route: { readonly routeId: string; readonly geometry: readonly Coordinate[] } | null;
  readonly elevationSource: ElevationSource | undefined;
  readonly comparing: boolean;
  readonly onCompare: () => void;
  readonly onSelect: (id: RouteCandidateId) => void;
  readonly weatherLine: string | null;
  readonly destinationLine?: string | null;
}) {
  const elevation = useElevationProfile(elevationSource, route?.routeId ?? null, route?.geometry ?? NO_LINE);
  const meta = [card.badges.find((badge) => /curv|twist/i.test(badge)) ?? card.curviness?.label, rideGlanceSurface(card).label];
  if (elevation?.status === "ready") meta.push(`↗ ${Math.round(elevation.profile.climbMeters * 3.28084).toLocaleString("en-US")} ft`);
  return <section className="og-phone-summary" data-testid="phone-ride-summary" aria-label="Your ride">
    {comparing ? <div className="og-phone-alternatives" data-testid="phone-alternatives" aria-label="Compare rides">
      {cards.map((choice) => <button key={choice.routeId} type="button" aria-pressed={choice.isSelected} onClick={() => onSelect(choice.routeId)}>
        <span>{choice.roleLabel}</span>
        <strong>{choice.durationLabel} · {choice.distanceLabel}</strong>
        <span>{rideGlanceSurface(choice).label}</span>
      </button>)}
    </div> : <div>
      {destinationLine === null ? null : <p className="og-phone-summary__where" data-testid="phone-destination">{destinationLine}</p>}
      <h2>{card.durationLabel} · {card.distanceLabel}</h2>
      <p className="og-phone-summary__meta">{meta.filter(Boolean).join(" · ")}</p>
    </div>}
    {start === null ? null : <div className="og-phone-summary__start">
      <button className="og-primary" type="button" data-testid="start-ride" disabled={start.starting || start.refusal !== null} onClick={start.onStart}>{start.starting ? "Starting…" : "Start ride"}</button>
      {start.refusal === null ? null : <p data-testid="start-ride-reason">{start.refusal}</p>}
      {start.error === null ? null : <p role="alert">{start.error}</p>}
    </div>}
    {weatherLine === null ? null : <p className="og-phone-summary__weather" data-testid="phone-weather">{weatherLine}</p>}
    <button type="button" className="og-phone-summary__compare" data-testid="compare-rides" onClick={onCompare}>{comparing ? "Back to ride" : `Compare rides (${cards.length})`}</button>
  </section>;
}
