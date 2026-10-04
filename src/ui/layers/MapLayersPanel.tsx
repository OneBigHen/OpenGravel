"use client";

/**
 * The map-layers control (UX rework phase 8): one round button in the map's
 * control cluster that opens a panel of layers grouped by what a rider asks —
 * live conditions, roads, stops, land and access. Each row is a switch with
 * its colour, a one-line legend and a status; the source and its limits are
 * one tap away, because community-mapped data must never pass for authority.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  MAP_LAYER_CATEGORIES,
  MAP_LAYERS,
  type LayerFreshness,
  type MapLayerDefinition,
  type MapLayerId,
} from "@/application/map-layers";

import type { MapLayerStatus } from "./useMapLayers";

export interface MapLayersPanelProps {
  readonly freshness?: readonly LayerFreshness[];
  readonly enabled: readonly MapLayerId[];
  readonly status: Readonly<Record<MapLayerId, MapLayerStatus>>;
  readonly counts: Readonly<Record<MapLayerId, number>>;
  readonly cameraRouteOnly: boolean;
  readonly cameraRouteAvailable: boolean;
  readonly onToggleCameraRouteOnly: () => void;
  readonly onToggle: (id: MapLayerId) => void;
  readonly onClearAll: () => void;
}

function statusText(layer: MapLayerDefinition, status: MapLayerStatus, count: number): string | null {
  switch (status) {
    case "off":
      return null;
    case "zoom-in":
      return "Zoom in";
    case "loading":
      return "Loading…";
    case "unavailable":
      return "Unavailable";
    case "stale":
      return "Stale";
    case "ready":
      return (layer.kind !== "features" || layer.id === "weather-radar" || layer.id === "hillshade") ? "On" : count === 0 ? (["mvum", "work-zones", "road-surface"].includes(layer.id) ? "No records · gaps unknown" : "None here") : String(count);
  }
}

function LayerRow({
  layer,
  on,
  status,
  count,
  onToggle,
  extra,
  freshness,
}: {
  readonly layer: MapLayerDefinition;
  readonly on: boolean;
  readonly status: MapLayerStatus;
  readonly count: number;
  readonly onToggle: () => void;
  readonly extra?: ReactNode;
  readonly freshness?: LayerFreshness | undefined;
}) {
  const [about, setAbout] = useState(false);
  const label = statusText(layer, status, count);
  return (
    <li className="og-layers__row" data-on={on ? "true" : "false"}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className="og-layers__switch"
        data-testid={`map-layer-${layer.id}`}
        onClick={onToggle}
      >
        <svg className="og-layers__swatch" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <rect width="34" height="34" rx="10" fill={layer.colorToken === undefined ? layer.color : `var(${layer.colorToken})`} opacity={on ? 1 : 0.22} />
          <text x="17" y="18" textAnchor="middle" dominantBaseline="middle" fill={on ? "var(--og-paper)" : "var(--og-ink)"}>{layer.glyph}</text>
        </svg>
        <span className="og-layers__text">
          <span className="og-layers__name">{layer.name}</span>
          <span className="og-layers__legend">{layer.legend}</span>
        </span>
        {label === null ? null : (
          <span className="og-layers__status" data-status={status} role="status" aria-live="polite">
            {label}
          </span>
        )}
        <span className="og-layers__toggle" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="og-layers__about"
        aria-expanded={about}
        aria-label={`About ${layer.name}`}
        onClick={() => setAbout((open) => !open)}
      >
        i
      </button>
      {about ? (
        <p className="og-layers__caveat">
          <strong>{layer.source}.</strong> {layer.caveat}
        </p>
      ) : null}
      {on && freshness !== undefined ? <p className="og-layers__caveat">
        {freshness.stale ? "Stale · " : ""}{freshness.source} · {freshness.observedAt === null ? "Retrieved" : "Observed"} {new Date(freshness.observedAt ?? freshness.fetchedAt).toLocaleString()} · {freshness.note}
      </p> : null}
      {extra}
    </li>
  );
}

export function MapLayersPanel({
  enabled,
  freshness = [],
  status,
  counts,
  cameraRouteOnly,
  cameraRouteAvailable,
  onToggleCameraRouteOnly,
  onToggle,
  onClearAll,
}: MapLayersPanelProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Escape closes the panel and hands focus back to Layers (PD-03).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const active = enabled.length;
  return (
    <div className="og-layers" data-open={open ? "true" : "false"} data-testid="map-layers">
      <button
        type="button"
        className="og-layers__button"
        data-testid="map-layers-toggle"
        aria-label="Layers"
        ref={buttonRef}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3 9 5-9 5-9-5z" />
          <path d="m3 12.5 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </svg>
        <span className="og-layers__button-label">Layers</span>
        {active === 0 ? null : <span className="og-layers__badge">{active}</span>}
      </button>
      {open ? (
        <section className="og-layers__panel" id={panelId} aria-label="Map layers">
          <header className="og-layers__head">
            <h2>Map layers</h2>
            {active === 0 ? null : (
              <button type="button" className="og-layers__clear" onClick={onClearAll}>
                Clear all
              </button>
            )}
            <button type="button" className="og-layers__close" aria-label="Close map layers" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="og-layers__body">
            {MAP_LAYER_CATEGORIES.map((category) => (
              <section key={category.id} className="og-layers__group" aria-label={category.name}>
                <h3>{category.name}</h3>
                <ul>
                  {MAP_LAYERS.filter((layer) => layer.category === category.id).map((layer) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      freshness={freshness.find((entry) => entry.layerId === layer.id)}
                      on={enabled.includes(layer.id)}
                      status={status[layer.id]}
                      count={counts[layer.id]}
                      onToggle={() => onToggle(layer.id)}
                      extra={
                        layer.id === "traffic-cameras" && enabled.includes("traffic-cameras") ? (
                          <button
                            type="button"
                            role="switch"
                            aria-checked={cameraRouteOnly}
                            disabled={!cameraRouteAvailable}
                            className="og-layers__subswitch"
                            data-on={cameraRouteOnly ? "true" : "false"}
                            onClick={onToggleCameraRouteOnly}
                          >
                            <span>
                              <strong>Along route only</strong>
                              <small>
                                {cameraRouteAvailable ? "Within about 3 mi of the selected route" : "Select a route first"}
                              </small>
                            </span>
                            <span className="og-layers__toggle" aria-hidden="true" />
                          </button>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
