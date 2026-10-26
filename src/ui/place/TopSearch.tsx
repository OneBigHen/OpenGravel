"use client";

import type { Coordinate } from "@/domain/ride/types";
import type { ComposerPlaceSearch } from "@/ui/planner/usePlannerPlaces";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { useRideAdvisor } from "@/ui/planner/RideAdvisor";

export const SEARCH_CHIPS = [
  { id: "gas", label: "Gas", query: "gas" },
  { id: "food", label: "Food", query: "food" },
  { id: "coffee", label: "Coffee", query: "coffee" },
  { id: "lodging", label: "Lodging", query: "lodging" },
  { id: "moto", label: "Moto shop", query: "motorcycle shop" },
  { id: "twisty", label: "Twisty roads", query: "great-roads" },
  { id: "gravel", label: "Gravel", query: "gravel" },
] as const;
export type SearchChip = (typeof SEARCH_CHIPS)[number];

export function TopSearch({ search, bias, selected, activeChip, onClear, onChip }: {
  readonly search: ComposerPlaceSearch;
  readonly bias: Coordinate;
  readonly selected: boolean;
  readonly activeChip: string | null;
  readonly onClear: () => void;
  readonly onChip: (chip: SearchChip) => void;
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
      {SEARCH_CHIPS.map((chip) => <button key={chip.id} type="button" data-testid={`search-chip-${chip.id}`} aria-pressed={activeChip === chip.id} onClick={() => onChip(chip)}>{chip.label}</button>)}
    </div>
  </div>;
}
