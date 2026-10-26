"use client";

import type { Coordinate } from "@/domain/ride/types";
import type { ComposerPlaceSearch } from "@/ui/planner/usePlannerPlaces";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { useRideAdvisor } from "@/ui/planner/RideAdvisor";

/** Searches a place category near the rider. Every chip here runs a search. */
export const SEARCH_CHIPS = [
  { id: "gas", label: "Gas", query: "gas", empty: "No gas in this area" },
  { id: "food", label: "Food", query: "food", empty: "No food in this area" },
  { id: "coffee", label: "Coffee", query: "coffee", empty: "No coffee in this area" },
  { id: "lodging", label: "Lodging", query: "lodging", empty: "No lodging in this area" },
  { id: "moto", label: "Moto shop", query: "motorcycle shop", empty: "No moto shops in this area" },
] as const;
export type SearchChip = (typeof SEARCH_CHIPS)[number];

/**
 * Switches a road overlay on the map. They used to sit in the search row and
 * looked like searches; the switch and the word "layer" keep the promise clear.
 */
export const LAYER_CHIPS = [
  { id: "twisty", layer: "great-roads", label: "Twisty roads layer" },
  { id: "gravel", layer: "gravel", label: "Gravel layer" },
] as const;
export type LayerChip = (typeof LAYER_CHIPS)[number];

/** A pump drawn as a line glyph, so it looks the same on every phone. */
function GasPump() {
  return <svg className="og-search-chips__glyph" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16"/>
    <path d="M3 21h11"/>
    <path d="M7.5 7h3"/>
    <path d="M13 9h2.5a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-2-3"/>
  </svg>;
}

export function TopSearch({ search, bias, selected, activeChip, layerOn, onClear, onChip, onLayer }: {
  readonly search: ComposerPlaceSearch;
  readonly bias: Coordinate;
  readonly selected: boolean;
  readonly activeChip: string | null;
  readonly layerOn: (layer: LayerChip["layer"]) => boolean;
  readonly onClear: () => void;
  readonly onChip: (chip: SearchChip) => void;
  readonly onLayer: (chip: LayerChip) => void;
}) {
  const advisor = useRideAdvisor();
  return <div className="og-top-search" data-testid="top-search">
    <div className="og-top-search__bar">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <PlaceSearchField slot="finish" testIdPrefix="top-place" placeholder="Search here" search={search.port} bias={bias}
        onPick={(place, query) => search.onPick("finish", place, query)}
        {...(search.remembered === undefined ? {} : { remembered: search.remembered })}
        {...(advisor === null ? {} : { describe: (text: string) => advisor.ask(text) })}/>
      {selected ? <button type="button" aria-label="Clear place" onClick={onClear}>×</button> : null}
    </div>
    <div className="og-search-chips" aria-label="Nearby places">
      {SEARCH_CHIPS.map((chip) => <button key={chip.id} type="button" data-testid={`search-chip-${chip.id}`} aria-pressed={activeChip === chip.id} onClick={() => onChip(chip)}>
        {chip.id === "gas" ? <GasPump/> : null}{chip.label}
      </button>)}
      <span className="og-search-chips__divider" aria-hidden="true"/>
      <span className="og-search-chips__layers" role="group" aria-label="Map layers">
        {LAYER_CHIPS.map((chip) => {
          const on = layerOn(chip.layer);
          return <button key={chip.id} type="button" data-layer="true" data-testid={`layer-chip-${chip.id}`} aria-pressed={on} title={`${chip.label} on the map`} onClick={() => onLayer(chip)}>
            <span className="og-layer-chips__switch" aria-hidden="true" data-on={on ? "true" : "false"}/>
            {chip.label}
          </button>;
        })}
      </span>
    </div>
  </div>;
}
