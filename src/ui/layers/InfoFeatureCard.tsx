"use client";

/**
 * The card for a tapped map-layer feature (UX rework phase 8): what it is,
 * the one supporting line the provider gave, where the data comes from, and —
 * for a stop — "Add as stop", the same typed command the places card uses.
 */

import { mapLayer, type InfoFeature } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

import { InfoFeatureMedia } from "./InfoFeatureMedia";

export interface InfoFeatureCardProps {
  readonly feature: InfoFeature;
  readonly onClose: () => void;
  /** Present when the host can add a stop; only point features offer it. */
  readonly onAddStop?: ((coordinate: Coordinate, name: string) => void) | undefined;
}

export function InfoFeatureCard({ feature, onClose, onAddStop }: InfoFeatureCardProps) {
  const layer = mapLayer(feature.layerId);
  const point = feature.geometry.type === "Point" ? feature.geometry.coordinates : null;
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
      {point === null ? null : (
        <div className="og-info-card__actions">
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
          {sourceHref === null ? null : (
            <a className="og-info-card__link" href={sourceHref} target="_blank" rel="noreferrer">
              {feature.media?.videoAvailable === true ? "Open live camera" : "Open source"}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
