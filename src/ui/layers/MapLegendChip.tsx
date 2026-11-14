"use client";

/**
 * The cold-open legend (first-minute wow, W1): one small glass chip at the
 * bottom-left of the map that says what the two default road layers look like —
 * a tan dash for gravel, orange for the twisty roads — and opens the Layers
 * sheet when tapped.
 *
 * It is a legend, not a control row: the home screen keeps search, Loop and
 * Ride, and this sits quietly on the map beside the scale rule. The map draws
 * it inside its own bottom-left stack, so it can never overlap the scale bar or
 * the round controls.
 */

import { useEffect, useState } from "react";

/** Phone first PF-6: the legend is a first-three-opens hint, not furniture. */
const SEEN_KEY = "og-legend-seen";
const SEEN_LIMIT = 3;
const FADE_AFTER_MS = 8000;
const FADE_MS = 200;
/** One count per app open, however many times the chip mounts. */
let countedThisOpen: boolean | null = null;

function shouldShowThisOpen(): boolean {
  if (countedThisOpen !== null) return countedThisOpen;
  let seen = 0;
  try {
    seen = Number.parseInt(window.localStorage.getItem(SEEN_KEY) ?? "0", 10) || 0;
    window.localStorage.setItem(SEEN_KEY, String(seen + 1));
  } catch {
    // Storage blocked: show it; the timer still takes it away.
  }
  countedThisOpen = seen < SEEN_LIMIT;
  return countedThisOpen;
}

export function MapLegendChip({ onOpen, mapReady = true }: { readonly onOpen: () => void; readonly mapReady?: boolean }) {
  const [phase, setPhase] = useState<"shown" | "fading" | "gone">(() => (shouldShowThisOpen() ? "shown" : "gone"));
  // Fades 8 s after the map is ready, or on the first gesture on the map.
  useEffect(() => {
    if (phase !== "shown" || !mapReady) return undefined;
    const fade = (): void => setPhase("fading");
    const timer = window.setTimeout(fade, FADE_AFTER_MS);
    const onGesture = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest(".maplibregl-canvas, .maplibregl-map") !== null) fade();
    };
    document.addEventListener("pointerdown", onGesture, true);
    document.addEventListener("wheel", onGesture, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("wheel", onGesture, true);
    };
  }, [phase, mapReady]);
  useEffect(() => {
    if (phase !== "fading") return undefined;
    const timer = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  if (phase === "gone") return null;
  return (
    <button
      type="button"
      className="og-map-legend"
      data-fading={phase === "fading" ? "true" : undefined}
      data-testid="map-legend"
      aria-label="Map legend: dashed tan is gravel, orange is twisty roads. Open Layers."
      onClick={onOpen}
    >
      <span className="og-map-legend__item" aria-hidden="true">
        <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
          <line x1="1" y1="4" x2="21" y2="4" className="og-map-legend__gravel" />
        </svg>
        Gravel
      </span>
      <span className="og-map-legend__item" aria-hidden="true">
        <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
          <line x1="1" y1="4" x2="21" y2="4" className="og-map-legend__twisty" />
        </svg>
        Twisty
      </span>
    </button>
  );
}
