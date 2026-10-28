"use client";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import { sunState, type SunState } from "@/application/long-trip/daylight";
import type { MapLayersSource } from "@/application/map-layers";
import { smartChip, type SmartChipSuggestion } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";
import type { ComposerPlaceSearch } from "@/ui/planner/usePlannerPlaces";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { MapAdvisorAsk } from "@/ui/planner/RideAdvisor";
import { AppMenu } from "@/ui/nav/AppMenu";
import { LayerGlyph } from "@/ui/layers/LayerIcon";
import { useEffect, useState } from "react";

import { ConditionsPill } from "./ConditionsPill";
import { useRouteFuelGap, type FuelGapRoute } from "./useRouteFuelGap";

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

/** A chip as the row shows it: the search it runs, and the words on it. */
export interface SearchChipRowItem {
  readonly chip: SearchChip;
  readonly label: string;
  /** True for the one contextual chip after Gas. */
  readonly smart: boolean;
}

function chipFor(id: SearchChip["id"]): SearchChip {
  return SEARCH_CHIPS.find((chip) => chip.id === id)!;
}

function plain(chip: SearchChip): SearchChipRowItem {
  return { chip, label: chip.label, smart: false };
}

/**
 * The row as it renders: Gas first, then the hour's own next chip — unless a
 * suggestion takes that slot (see `smartChip`). A suggestion never makes the
 * row longer: the matched chip moves up instead of appearing twice, and when
 * the suggestion is Gas itself the hour's next chip gives up its place.
 */
export function chipRow(
  order: readonly SearchChip["id"][],
  smart: SmartChipSuggestion | null,
): readonly SearchChipRowItem[] {
  const base = order.map(chipFor);
  const first = base[0];
  if (first === undefined) return [];
  if (smart === null) return base.map(plain);
  const matched = chipFor(smart.id);
  const rest = base.slice(1).filter((chip) => chip.id !== matched.id);
  const kept = matched.id === first.id ? rest.slice(1) : rest;
  return [plain(first), { chip: matched, label: smart.label, smart: true }, ...kept.map(plain)];
}

/**
 * The chips in this hour's order, after mount so the server render matches: the
 * clock and the sun are the rider's, and the route's fuel gap arrives when the
 * along-route fuel search answers.
 */
function useChipRow(
  at: Coordinate,
  route: FuelGapRoute | null,
  mapLayers: MapLayersSource | undefined,
): readonly SearchChipRowItem[] {
  const [clock, setClock] = useState<{ readonly now: number; readonly sun: SunState | null } | null>(null);
  useEffect(() => {
    const read = (): void => {
      const now = Date.now();
      setClock({ now, sun: sunState(at, now) });
    };
    read();
    const timer = window.setInterval(read, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [at]);
  const fuelGap = useRouteFuelGap(route, mapLayers);
  if (clock === null) return SEARCH_CHIPS.map(plain);
  return chipRow(
    chipOrder(new Date(clock.now).getHours()),
    smartChip({
      now: clock.now,
      sunState: clock.sun,
      route: fuelGap === null ? null : { fuelGapMiles: fuelGap },
    }),
  );
}

export function TopSearch({ search, bias, selected, activeChip, layerOn, onClear, onChip, onLayer, onSearchList, route, mapLayers }: {
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
  /** The open route, whose fuel gaps can earn the chip after Gas. */
  readonly route?: FuelGapRoute | null;
  /** The map-layer provider that answers the along-route fuel search. */
  readonly mapLayers?: MapLayersSource | undefined;
}) {
  const chips = useChipRow(bias, route ?? null, mapLayers);
  return <div className="og-top-search" data-testid="top-search">
    <div className="og-top-search__row">
    <div className="og-top-search__bar">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <PlaceSearchField slot="finish" testIdPrefix="top-place" placeholder="Search here" search={search.port} bias={bias}
        onPick={(place, query) => search.onPick("finish", place, query)}
        {...(onSearchList === undefined ? {} : { onSubmitList: onSearchList })}
        {...(search.remembered === undefined ? {} : { remembered: search.remembered })}/>
      {selected ? <button type="button" aria-label="Clear place" onClick={onClear}>×</button> : <ConditionsPill at={bias}/>}
    </div>
    <MapAdvisorAsk />
    <AppMenu className="og-top-search__menu"/>
    </div>
    <div className="og-search-chips" aria-label="Nearby places">
      {chips.map(({ chip, label, smart }) => <button key={smart ? `smart:${chip.id}` : chip.id} type="button" data-chip={chip.id} data-smart={smart ? "true" : undefined} data-testid={smart ? `smart-chip-${chip.id}` : `search-chip-${chip.id}`} aria-pressed={activeChip === chip.id} onClick={() => onChip(chip)}>
        <LayerGlyph id={CHIP_ICON[chip.id]} className="og-search-chips__glyph"/>{label}
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
