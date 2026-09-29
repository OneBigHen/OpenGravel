"use client";

/**
 * The map-layers control (UX rework phase 8): one round button in the map's
 * control cluster that opens a panel of layers grouped by what a rider asks —
 * live conditions, roads, stops, land and access. Each row is a switch with
 * its colour, a one-line legend and a status; the source and its limits are
 * one tap away, because community-mapped data must never pass for authority.
 */

import { useEffect, useId, useRef, useState } from "react";

import {
  MAP_LAYER_CATEGORIES,
  MAP_LAYERS,
  type MapLayerDefinition,
  type MapLayerId,
} from "@/application/map-layers";

import type { MapLayerStatus } from "./useMapLayers";

export interface MapLayersPanelProps {
  readonly enabled: readonly MapLayerId[];
  readonly status: Readonly<Record<MapLayerId, MapLayerStatus>>;
  readonly counts: Readonly<Record<MapLayerId, number>>;
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
    case "ready":
      return layer.kind !== "features" ? "On" : count === 0 ? "None here" : String(count);
  }
}

function LayerRow({
  layer,
  on,
  status,
  count,
  onToggle,
}: {
  readonly layer: MapLayerDefinition;
  readonly on: boolean;
  readonly status: MapLayerStatus;
  readonly count: number;
  readonly onToggle: () => void;
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
        <span className="og-layers__swatch" style={{ "--og-layer-color": layer.color } as React.CSSProperties} aria-hidden="true">
          {layer.glyph}
        </span>
        <span className="og-layers__text">
          <span className="og-layers__name">{layer.name}</span>
          <span className="og-layers__legend">{layer.legend}</span>
        </span>
        {label === null ? null : (
          <span className="og-layers__status" data-status={status}>
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
    </li>
  );
}

export function MapLayersPanel({ enabled, status, counts, onToggle, onClearAll }: MapLayersPanelProps) {
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
                      on={enabled.includes(layer.id)}
                      status={status[layer.id]}
                      count={counts[layer.id]}
                      onToggle={() => onToggle(layer.id)}
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
