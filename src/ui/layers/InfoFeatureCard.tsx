"use client";

/**
 * The card for a tapped map-layer feature (UX rework phase 8): what it is,
 * the one supporting line the provider gave, where the data comes from, and —
 * for a stop — "Add as stop", the same typed command the places card uses.
 *
 * A tapped road line (`great-roads`, `gravel`) instead offers "Ride this road":
 * its two via points are handed to the host, which adds them as stops.
 */

import { RideCreditLine } from "@/ui/credit/RideCreditLine";
import { useState } from "react";

import {
  curatedRideDistanceLine,
  curatedRideSurfaceLine,
  isRideRoadLayer,
  mapLayer,
  rideRoadViaPoints,
  type InfoFeature,
  type LngLat,
} from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

import { InfoFeatureMedia } from "./InfoFeatureMedia";

export interface InfoFeatureCardProps {
  readonly feature: InfoFeature;
  readonly onClose: () => void;
  /** Present when the host can add a stop; only point features offer it. */
  readonly onAddStop?: ((coordinate: Coordinate, name: string) => void) | undefined;
  readonly onAvoidRoad?: ((geometry: readonly Coordinate[], name: string) => void) | undefined;
  /** Where the rider is coming from, so a tapped road is entered at the near end. */
  readonly rideRoadReference?: Coordinate | null | undefined;
  /** Present when the host can add a road's two via points as stops. */
  readonly onRideRoad?:
    | ((entry: Coordinate, exit: Coordinate, name: string) => void)
    | undefined;
  /**
   * Present when the host can open a curated catalog ride in the planner
   * (first-minute wow, W5): the same handoff Explore's "Ride this" uses.
   */
  readonly onRideThisRoute?: ((routeId: string) => Promise<void> | void) | undefined;
}

export function InfoFeatureCard({
  feature,
  onClose,
  onAddStop,
  onAvoidRoad,
  rideRoadReference = null,
  onRideRoad,
  onRideThisRoute,
}: InfoFeatureCardProps) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const layer = mapLayer(feature.layerId);
  const ride = feature.catalogRide ?? null;
  const point = feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
  const viaPoints =
    onRideRoad === undefined || !isRideRoadLayer(feature.layerId) || feature.geometry.type !== "LineString"
      ? null
      : rideRoadViaPoints(feature.geometry.coordinates, referenceLngLat(rideRoadReference));
  const roadLine = isRideRoadLayer(feature.layerId) && feature.geometry.type === "LineString" && feature.geometry.coordinates.length >= 2 ? feature.geometry.coordinates.map(toCoordinate) : null;
  const searchHref = point === null || layer.category !== "stops"
    ? null
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${feature.name} ${point[1]},${point[0]}`)}`;
  const sourceHref = feature.media?.sourceHref ?? null;
  return (
    <section
      className="og-info-card"
      data-testid="info-feature-card"
      aria-label={feature.name}
      style={{ "--og-layer-color": layer.color } as React.CSSProperties}
    >
      <div className="og-info-card__top">
        <span className="og-info-card__layer">
          <span className="og-info-card__glyph" aria-hidden="true">{layer.glyph}</span>
          {layer.name}
        </span>
        <button type="button" className="og-info-card__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 className="og-info-card__title">{feature.name}</h2>
      {ride === null ? (
        feature.detail === null ? null : <p className="og-info-card__detail">{feature.detail}</p>
      ) : (
        // A curated ride's own facts: the distance it publishes, and its
        // surface only as far as the source states it.
        <dl className="og-info-card__facts">
          <div>
            <dt>Distance</dt>
            <dd>{curatedRideDistanceLine(ride)}</dd>
          </div>
          <div>
            <dt>Surface</dt>
            <dd data-testid="curated-ride-surface">{curatedRideSurfaceLine(ride)}</dd>
          </div>
        </dl>
      )}
      {ride === null ? null : <RideCreditLine credit={ride.credit} />}
      {feature.media === undefined || feature.media === null ? null : (
        <InfoFeatureMedia media={feature.media} name={feature.name} />
      )}
      {feature.layerId === "contours" ? null : (
        <p className="og-info-card__source">
          {layer.source}. {layer.caveat}
        </p>
      )}
      {ride === null || onRideThisRoute === undefined ? null : (
        <div className="og-info-card__actions">
          <button
            type="button"
            className="og-info-card__add"
            data-testid="info-feature-ride-this"
            aria-busy={opening}
            disabled={opening}
            onClick={() => {
              setOpening(true);
              setOpenError(null);
              void Promise.resolve(onRideThisRoute(ride.routeId)).catch(() => {
                setOpening(false);
                setOpenError("That ride could not be opened. Check your connection and try again.");
              });
            }}
          >
            {opening ? "Opening this ride…" : "Ride this"}
          </button>
        </div>
      )}
      {openError === null ? null : (
        <p className="og-info-card__error" role="status">{openError}</p>
      )}
      {viaPoints === null && point === null && (roadLine === null || onAvoidRoad === undefined) ? null : (
        <div className="og-info-card__actions">
          {viaPoints === null || onRideRoad === undefined ? null : (
            <button
              type="button"
              className="og-info-card__add"
              data-testid="info-feature-ride-road"
              onClick={() =>
                onRideRoad(toCoordinate(viaPoints[0]), toCoordinate(viaPoints[1]), feature.name)
              }
            >
              Ride this road
            </button>
          )}
          {roadLine === null || onAvoidRoad === undefined ? null : <button type="button" className="og-info-card__add og-info-card__avoid" onClick={() => onAvoidRoad(roadLine, feature.name)}>Avoid this road</button>}
          {point === null ? null : (
            <>
              {onAddStop === undefined || layer.category !== "stops" ? null : (
                <button
                  type="button"
                  className="og-info-card__add"
                  data-testid="info-feature-add-stop"
                  onClick={() => onAddStop({ lon: point[0], lat: point[1] }, feature.name)}
                >
                  Add as stop
                </button>
              )}
              {searchHref === null ? null : (
                <a className="og-info-card__link" href={searchHref} target="_blank" rel="noreferrer">
                  Hours and reviews
                </a>
              )}
              {sourceHref === null || feature.media?.playbackUrl != null ? null : (
                <a className="og-info-card__link" href={sourceHref} target="_blank" rel="noreferrer">
                  {feature.media?.videoAvailable === true ? "Open live camera" : "Open source"}
                </a>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function referenceLngLat(reference: Coordinate | null | undefined): LngLat | null {
  return reference === null || reference === undefined ? null : [reference.lon, reference.lat];
}

function toCoordinate(point: LngLat): Coordinate {
  return { lon: point[0], lat: point[1] };
}
