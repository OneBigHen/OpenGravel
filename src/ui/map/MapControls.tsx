"use client";

/**
 * The map's instrument controls (05-MAP-INTERACTION-AND-CARTOGRAPHY §9).
 *
 * Three controls that answer three questions a rider asks of a map they did not
 * draw: *which way is north?*, *can I zoom without a trackpad?*, and *how far is
 * that?*. They are OpenGravel's own buttons rather than the renderer's default
 * control, for one reason: the renderer's navigation control cannot wear the
 * Day/Night glass, cannot be 44 px on a phone, and cannot say "the map is
 * rotated 42 degrees east" to a screen reader.
 *
 * Nothing here holds state. The camera arrives from the host through the
 * `MapHost` port and every press is a callback, so this file can be exercised in
 * jsdom without WebGL and the map remains the single authority on its own
 * bearing and zoom.
 */

import type { CSSProperties } from "react";

import type { MapScaleBar as MapScale } from "@/application/map/scale";

/** A rotation this small still reads as "north-up" to a rider's eye. */
export const COMPASS_VISIBLE_DEGREES = 1;

/** Zoom changes below this are rounding noise, not a state the button is in. */
const ZOOM_LIMIT_EPSILON = 0.01;

/**
 * The compass's accessible name: the action, then the fact that makes it worth
 * taking — the rotation the map is currently drawing.
 *
 * "Face north. Map is rotated 42 degrees east." A rider who cannot see the
 * needle still learns the map is turned, which is the only reason a compass is
 * on a map at all (12 §15).
 */
export function compassLabel(bearing: number): string {
  const degrees = Math.round(Math.abs(bearing));
  const direction = bearing < 0 ? "west" : "east";
  return `Face north. Map is rotated ${degrees} ${degrees === 1 ? "degree" : "degrees"} ${direction}.`;
}

export interface MapCompassProps {
  /** The renderer's bearing in degrees, already rounded to a whole degree. */
  readonly bearing: number;
  readonly onFaceNorth: () => void;
}

/**
 * A 44 px disc with a 20 px needle, rotated against the map's bearing.
 *
 * The needle is the map's own rotation, so it is visible only when the map is
 * actually turned: a compass that sits there pointing north on a north-up map
 * is a decoration, and this one is an instrument. Hidden it also leaves the tab
 * order, so a keyboard rider never lands on a control with nothing to do.
 */
export function MapCompass({ bearing, onFaceNorth }: MapCompassProps) {
  const visible = Math.abs(bearing) >= COMPASS_VISIBLE_DEGREES;
  return (
    <button
      type="button"
      className="og-map__compass"
      data-testid="map-compass"
      data-visible={visible ? "true" : "false"}
      aria-hidden={visible ? undefined : true}
      aria-label={visible ? compassLabel(bearing) : undefined}
      tabIndex={visible ? undefined : -1}
      // The needle's angle is the only per-frame value here; the stylesheet owns
      // the drawing, the host owns the number (never a colour or a size).
      style={{ "--og-bearing": String(bearing) } as CSSProperties}
      onClick={onFaceNorth}
    >
      <svg
        className="og-map__compass-needle"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {/* The ember tip always points north; the tail states what it turns on. */}
        <path className="og-map__compass-tip" d="M12 2.5 16.5 12h-9z" />
        <path className="og-map__compass-tail" d="M12 21.5 7.5 12h9z" />
      </svg>
    </button>
  );
}

export interface MapZoomControlsProps {
  /** The renderer's zoom, rounded to two decimals. */
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}

/**
 * Real zoom buttons, one level a press.
 *
 * No long-press repeat: a press that keeps firing under a thumb resting on a
 * mounted phone is a gesture accident waiting to happen, and the canvas already
 * answers a double-tap. At a limit the button says so through `aria-disabled`
 * and stays focusable — a control that disappears or silently does nothing is
 * worse than one that says "this is as far as it goes".
 */
export function MapZoomControls({
  zoom,
  minZoom,
  maxZoom,
  onZoomIn,
  onZoomOut,
}: MapZoomControlsProps) {
  const atMax = zoom >= maxZoom - ZOOM_LIMIT_EPSILON;
  const atMin = zoom <= minZoom + ZOOM_LIMIT_EPSILON;
  return (
    <>
      <button
        type="button"
        className="og-map__zoom"
        data-testid="map-zoom-in"
        data-zoom="in"
        data-disabled={atMax ? "true" : "false"}
        aria-label="Zoom in"
        aria-disabled={atMax ? true : undefined}
        onClick={atMax ? undefined : onZoomIn}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 6v12M6 12h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="og-map__zoom"
        data-testid="map-zoom-out"
        data-zoom="out"
        data-disabled={atMin ? "true" : "false"}
        aria-label="Zoom out"
        aria-disabled={atMin ? true : undefined}
        onClick={atMin ? undefined : onZoomOut}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

export interface MapScaleBarProps {
  readonly scale: MapScale;
  /**
   * How much chrome covers the map's left and bottom edges, in CSS pixels (the
   * measured camera insets, 05 §9). The rule sits at the bottom-left of the map
   * the rider can actually see, not of the canvas under the sheet.
   */
  readonly insetLeft: number;
  readonly insetBottom: number;
}

/**
 * The scale rule: a 1 px line with two end ticks and the distance it spans.
 *
 * It sits on a quiet glass chip so it stays legible over pale gravel, dark
 * forest and satellite imagery alike — the same pane the round controls wear.
 * A ruler the rider has to squint at is not a ruler.
 */
export function MapScaleBar({ scale, insetLeft, insetBottom }: MapScaleBarProps) {
  return (
    <div
      className="og-map__scale"
      data-testid="map-scale"
      role="img"
      aria-label={`Map scale: ${scale.label}`}
      style={
        {
          "--og-scale-width": `${scale.widthPx}px`,
          "--og-map-inset-left": `${Math.round(insetLeft)}px`,
          "--og-map-inset-bottom": `${Math.round(insetBottom)}px`,
        } as CSSProperties
      }
    >
      <span className="og-map__scale-rule" aria-hidden="true" />
      <span className="og-map__scale-label" aria-hidden="true">
        {scale.label}
      </span>
    </div>
  );
}
