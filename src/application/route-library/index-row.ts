import { surfaceCode } from "./surface-claim";
import type { RideDerived } from "./ride-detail";
import { FLAG, type IndexRow } from "./types";

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** Flag bits for one ride (plan section 6). */
export function flagsFor(derived: RideDerived): number {
  const { detail, line } = derived;
  const hasStops = Object.values(detail.stops).some((list) => list.length > 0);
  return (
    (line !== "" ? FLAG.line : 0) |
    (detail.loop ? FLAG.loop : 0) |
    (detail.track.gpxAllowed ? FLAG.gpx : 0) |
    (detail.track.old ? FLAG.old : 0) |
    (detail.track.rough ? FLAG.rough : 0) |
    (detail.notes.length > 0 ? FLAG.notes : 0) |
    (hasStops ? FLAG.stops : 0)
  );
}

/** One card for the phone's index. `sourceIndex` points into the index's `sources` list. */
export function buildIndexRow(derived: RideDerived, sourceIndex: number): IndexRow {
  const { detail, pin, bounds } = derived;
  return {
    id: detail.id,
    n: detail.name,
    k: detail.kind,
    t: detail.type,
    q: detail.score,
    mi: detail.miles === null ? null : round(detail.miles, 1),
    st: detail.states,
    p: pin === null ? null : [round(pin.lat, 4), round(pin.lon, 4)],
    pp: pin === null ? null : pin.precision,
    bb: bounds === null ? null : [round(bounds.west, 4), round(bounds.south, 4), round(bounds.east, 4), round(bounds.north, 4)],
    f: flagsFor(derived),
    s: sourceIndex,
    c: derived.cardLine === null || derived.cardLine === "" ? null : derived.cardLine,
    sf: surfaceCode(detail.facts.surface.value),
  };
}
