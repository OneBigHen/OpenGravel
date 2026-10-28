"use client";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";
import type { ComposerPlaceSearch } from "@/ui/planner/usePlannerPlaces";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { useRideAdvisor } from "@/ui/planner/RideAdvisor";
import { AppMenu } from "@/ui/nav/AppMenu";
import { LayerGlyph } from "@/ui/layers/LayerIcon";
import { useEffect, useState } from "react";

import { ConditionsPill } from "./ConditionsPill";

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

/** Each chip's icon from the layers set, so the two surfaces read as one. */
const CHIP_ICON: Readonly<Record<SearchChip["id"], string>> = {
  gas: "fuel",
  food: "food",
  coffee: "coffee",
  lodging: "lodging",
  moto: "repair",
};

/**
 * What a rider reaches for first at this hour: gas first always, then coffee
 * in the morning, food at midday and supper, a bed late.
 */
function chipOrder(hour: number): readonly SearchChip["id"][] {
  // Gas never moves; what follows it is what this hour asks for.
  if (hour >= 5 && hour < 10) return ["gas", "coffee", "food", "moto", "lodging"];
  if (hour >= 10 && hour < 16) return ["gas", "food", "coffee", "moto", "lodging"];
  if (hour >= 16 && hour < 21) return ["gas", "food", "lodging", "coffee", "moto"];
  return ["gas", "lodging", "food", "coffee", "moto"];
}

/** The chips in this hour's order, after mount so the server render matches. */
function useChipOrder(): readonly SearchChip[] {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const read = (): void => setHour(new Date().getHours());
    read();
    const timer = window.setInterval(read, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (hour === null) return SEARCH_CHIPS;
  return chipOrder(hour).map((id) => SEARCH_CHIPS.find((chip) => chip.id === id)!);
}

export function TopSearch({ search, bias, selected, activeChip, layerOn, onClear, onChip, onLayer, onSearchList }: {
  readonly search: ComposerPlaceSearch;
  readonly bias: Coordinate;
  readonly selected: boolean;
  readonly activeChip: string | null;
  readonly layerOn: (layer: LayerChip["layer"]) => boolean;
  readonly onClear: () => void;
  readonly onChip: (chip: SearchChip) => void;
  readonly onLayer: (chip: LayerChip) => void;
  /** Enter on words that match many places shows them as a list. */
  readonly onSearchList?: (query: string, places: readonly PlaceMatch[]) => void;
}) {
  const advisor = useRideAdvisor();
  const chips = useChipOrder();
  return <div className="og-top-search" data-testid="top-search">
    <div className="og-top-search__row">
    <div className="og-top-search__bar">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <PlaceSearchField slot="finish" testIdPrefix="top-place" placeholder="Search here" search={search.port} bias={bias}
        onPick={(place, query) => search.onPick("finish", place, query)}
        {...(onSearchList === undefined ? {} : { onSubmitList: onSearchList })}
        {...(search.remembered === undefined ? {} : { remembered: search.remembered })}
        {...(advisor === null ? {} : { describe: (text: string) => advisor.ask(text) })}/>
      {selected ? <button type="button" aria-label="Clear place" onClick={onClear}>×</button> : <ConditionsPill at={bias}/>}
    </div>
    <AppMenu className="og-top-search__menu"/>
    </div>
    <div className="og-search-chips" aria-label="Nearby places">
      {chips.map((chip) => <button key={chip.id} type="button" data-chip={chip.id} data-testid={`search-chip-${chip.id}`} aria-pressed={activeChip === chip.id} onClick={() => onChip(chip)}>
        <LayerGlyph id={CHIP_ICON[chip.id]} className="og-search-chips__glyph"/>{chip.label}
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
