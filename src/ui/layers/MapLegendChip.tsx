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

export function MapLegendChip({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      className="og-map-legend"
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
