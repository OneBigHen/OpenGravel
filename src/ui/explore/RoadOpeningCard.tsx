"use client";
import { useRef, useState } from "react";
import type {
  RoadOpeningSummary,
  UndatedSeasonalRoadSummary,
} from "@/application/route-intelligence/opening-calendar-contract";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { RoadLocationMap } from "@/ui/explore/RoadLocationMap";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export function openingWindowLabel(event: RoadOpeningSummary): string {
  const format = (value: string): string =>
    new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(event.certainty === "recurring-season"
        ? { timeZone: "UTC" }
        : { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
    });
  return `${format(event.startsAt)} – ${format(event.certainty === "recurring-season" ? new Date(Date.parse(event.endsAt) - 1).toISOString() : event.endsAt)}`;
}
function RoadDetail({
  road,
  source,
  windowLabel,
  map,
  onClose,
}: {
  readonly road: RoadOpeningSummary | UndatedSeasonalRoadSummary;
  readonly source: string;
  readonly windowLabel: string;
  readonly map?: ExploreMapConfig | undefined;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useDialogFocus(ref, onClose);
  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`${road.roadName ?? "Seasonal road"} details`}
      className="og-road-detail-sheet"
    >
      <div className="og-road-detail-sheet__head">
        <h2>{road.roadName ?? "Unnamed seasonal road"}</h2>
        <button type="button" className="og-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p>
        {source} · {windowLabel}
      </p>
      <p>{road.description}</p>
      <RoadLocationMap
        anchor={road.anchor}
        name={road.roadName ?? "Seasonal road"}
        live={map}
      />
      <p>
        Location shown by the authority. Access is rechecked when planning; an
        unpublished season does not prove this road is open.
      </p>
    </section>
  );
}
export function RoadOpeningCard({
  road,
  source,
  token,
  map,
  onRouteThrough,
  added = false,
  busy = false,
}: {
  readonly road: RoadOpeningSummary | UndatedSeasonalRoadSummary;
  readonly source: string;
  readonly token?: string | undefined;
  readonly map?: ExploreMapConfig | undefined;
  readonly onRouteThrough?: ((road: RoadOpeningSummary) => void) | undefined;
  readonly added?: boolean;
  readonly busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const windowLabel =
    "startsAt" in road ? openingWindowLabel(road) : "Dates not published";
  const dated = "startsAt" in road ? road : null;
  return (
    <li className="og-explore-card">
      <div className="og-explore-card__body">
        <RoadLocationMap
          anchor={road.anchor}
          name={road.roadName ?? "Seasonal road"}
          token={token}
        />
        <span className="og-explore-card__topline">
          <span>Seasonal road</span>
          <span>{source}</span>
        </span>
        <strong>{road.roadName ?? "Unnamed seasonal road"}</strong>
        <span>{windowLabel}</span>
        <p>{road.description}</p>
        <div className="og-explore__actions">
          <button
            type="button"
            className="og-secondary"
            onClick={() => setOpen(true)}
          >
            Show on map<span className="sr-only"> · {road.roadName}</span>
          </button>
          {dated !== null && onRouteThrough !== undefined ? (
            <button
              type="button"
              className="og-primary"
              disabled={added || busy || (dated.line?.length ?? 0) < 2}
              onClick={() => onRouteThrough(dated)}
            >
              {busy ? "Adding road…" : added ? "Added" : "Route through it"}
              <span className="sr-only"> · {road.roadName}</span>
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <RoadDetail
          road={road}
          source={source}
          windowLabel={windowLabel}
          map={map}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </li>
  );
}
