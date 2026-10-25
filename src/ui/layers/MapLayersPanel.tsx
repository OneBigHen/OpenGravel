"use client";

/**
 * The map-layers control (UX rework phase 8): one round button in the map's
 * control cluster that opens a panel of layers grouped by what a rider asks —
 * live conditions, roads, stops, land and access. Each row is a switch with
 * its colour, a one-line legend and a status; the source and its limits are
 * one tap away, because community-mapped data must never pass for authority.
 *
 * Every row — the four quick sets, the map style radios, the layers and the
 * Places overlay — has the same three parts: one icon tile, the words, and the
 * control on the right.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  MAP_LAYER_CATEGORIES,
  MAP_LAYER_LENSES,
  MAP_LAYERS,
  type LayerFreshness,
  type MapLayerDefinition,
  type MapLayerId,
} from "@/application/map-layers";

import type { MapLayerStatus } from "./useMapLayers";
import { LayerSwitch } from "./LayerSwitch";
import { LOOK_LABEL, LOOK_NOTE, type BasemapLook } from "@/ui/map/basemap-look";

/** The basemap style rows the sheet owns on a phone. */
export interface MapStyleChoice {
  readonly look: BasemapLook;
  readonly options: readonly BasemapLook[];
  readonly onChoose: (look: BasemapLook) => void;
}

export interface MapLayersPanelProps {
  readonly freshness?: readonly LayerFreshness[];
  readonly enabled: readonly MapLayerId[];
  readonly status: Readonly<Record<MapLayerId, MapLayerStatus>>;
  readonly counts: Readonly<Record<MapLayerId, number>>;
  readonly cameraRouteOnly: boolean;
  readonly cameraRouteAvailable: boolean;
  readonly onToggleCameraRouteOnly: () => void;
  readonly onToggle: (id: MapLayerId) => void;
  /** Turns a lens's whole set of layers on or off together. */
  readonly onToggleLens?: (ids: readonly MapLayerId[]) => void;
  readonly onClearAll: () => void;
  /** Present when the sheet, not the map's globe button, chooses the basemap. */
  readonly mapStyle?: MapStyleChoice;
  /** Rows owned by another surface (the Places overlay), rendered in the sheet. */
  readonly settings?: ReactNode;
}

const LOOK_GLYPH: Readonly<Record<BasemapLook, string>> = {
  map: "◱",
  night: "☾",
  satellite: "◉",
};

/** Map style as radio rows: one tap changes the basemap and closes nothing. */
function MapStyleRows({ style }: { readonly style: MapStyleChoice }) {
  return (
    <section className="og-layers__group og-layers__group--style" aria-label="Map style">
      <h3>Map style</h3>
      <ul role="radiogroup" aria-label="Map style">
        {style.options.map((option) => {
          const on = style.look === option;
          return (
            <li key={option} className="og-layers__row" data-on={on ? "true" : "false"}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                className="og-layers__switch og-layers__switch--choice"
                data-testid={`sheet-map-style-${option}`}
                onClick={() => style.onChoose(option)}
              >
                <span className="og-layers__swatch" aria-hidden="true">{LOOK_GLYPH[option]}</span>
                <span className="og-layers__text">
                  <span className="og-layers__name">{LOOK_LABEL[option]}</span>
                  <span className="og-layers__legend">{LOOK_NOTE[option]}</span>
                </span>
                <span className="og-layers__check" aria-hidden="true">{on ? "✓" : null}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
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
      return "Out of date";
    case "ready":
      return (layer.kind !== "features" || layer.id === "weather-radar" || layer.id === "hillshade") ? "On" : count === 0 ? "None here" : String(count);
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
        <svg className="og-layers__swatch" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <rect width="40" height="40" rx="12" fill={layer.colorToken === undefined ? layer.color : `var(${layer.colorToken})`} opacity={on ? 1 : 0.22} />
          <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" fill={on ? "var(--og-paper)" : "var(--og-ink)"}>{layer.glyph}</text>
        </svg>
        <span className="og-layers__text">
          <span className="og-layers__name">{layer.name}</span>
          <span className="og-layers__legend">{layer.legend}</span>
        </span>
        <span className="og-layers__status" data-status={status} role="status" aria-live="polite">
          {label}
        </span>
        <LayerSwitch on={on} />
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
          {freshness === undefined ? null : <> {freshness.source} · {freshness.observedAt === null ? "Retrieved" : "Observed"} {new Date(freshness.observedAt ?? freshness.fetchedAt).toLocaleString()} · {freshness.note}</>}
        </p>
      ) : null}
      {on && freshness !== undefined && !about ? <p className="og-layers__caveat">
        {freshness.stale ? "May be out of date · " : ""}Updated {new Date(freshness.observedAt ?? freshness.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
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
  onToggleLens,
  onClearAll,
  mapStyle,
  settings,
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
            {mapStyle === undefined ? null : <MapStyleRows style={mapStyle} />}
            {onToggleLens === undefined ? null : (
              <ul className="og-layers__lenses" aria-label="Quick layer sets">
                {MAP_LAYER_LENSES.map((lens) => {
                  const on = lens.layers.every((id) => enabled.includes(id));
                  return (
                    <li key={lens.id}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        className="og-layers__lens"
                        data-on={on ? "true" : "false"}
                        data-testid={`map-lens-${lens.id}`}
                        onClick={() => onToggleLens(lens.layers)}
                      >
                        <span className="og-layers__swatch" aria-hidden="true">{lens.glyph}</span>
                        <span className="og-layers__name">{lens.name}</span>
                        <span className="og-layers__legend">{lens.hint}</span>
                        <LayerSwitch on={on} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
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
                            <LayerSwitch on={cameraRouteOnly} />
                          </button>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
            {settings}
          </div>
        </section>
      ) : null}
    </div>
  );
}
