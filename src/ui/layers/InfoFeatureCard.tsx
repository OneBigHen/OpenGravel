"use client";

/**
 * The card for a tapped map-layer feature (UX rework phase 8): what it is,
 * the one supporting line the provider gave, where the data comes from, and —
 * for a stop — "Add as stop", the same typed command the places card uses.
 *
 * A tapped road line (`great-roads`, `gravel`) instead offers "Ride this road":
 * its two via points are handed to the host, which adds them as stops.
 */

import {
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
}

export function InfoFeatureCard({
  feature,
  onClose,
  onAddStop,
  onAvoidRoad,
  rideRoadReference = null,
  onRideRoad,
}: InfoFeatureCardProps) {
  const layer = mapLayer(feature.layerId);
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
      {feature.detail === null ? null : <p className="og-info-card__detail">{feature.detail}</p>}
      {feature.media === undefined || feature.media === null ? null : (
        <InfoFeatureMedia media={feature.media} name={feature.name} />
      )}
      <p className="og-info-card__source">
        {layer.source}. {layer.caveat}
      </p>
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
