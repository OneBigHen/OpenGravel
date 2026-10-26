"use client";

/**
 * "Next gas" on the ride (docs/vnext/design/maps-for-riders.md §1, §5): one line
 * in the ride sheet, and one button when the tank will not reach the station.
 *
 * Google Maps tells a driver which station is next; a rider on a small tank
 * needs the second half of that sentence — *does the range reach it?* — because
 * the answer decides whether the next stop is now or in forty miles. The line is
 * built on what the ride already has: the gas stations the ride-interest
 * overlay prefetched along the route (`useRideInterest`), the rider's distance
 * along it, and the bike's range from the garage.
 *
 * The rules it keeps:
 *
 * - **No stations data is said out loud** ("Gas stations unknown along this
 *   ride"), never blank, and never read as "there is none".
 * - **The range sentence appears only when it is measured.** An unknown range
 *   (no distance along the route, no bike) leaves the plain next-station line;
 *   it never becomes "you're fine".
 * - **One button, and it changes the ride only when pressed.** "Add gas stop"
 *   routes via the station the range last reaches, through the same reroute
 *   command the interest card uses (§1: the map never edits the ride itself).
 * - **Free Ride has no line to measure along**, so it shows the nearest station
 *   inside a 25-mile box in the direction the rider is already going, or
 *   nothing at all.
 *
 * The line is deliberately *not* a live region: on a route it changes with every
 * position tick, and a screen reader must not read out the miles as they tick
 * down. It is re-read when the rider opens the sheet.
 */

import { useEffect, useState } from "react";

import {
  EMPTY_FUEL_ODOMETER,
  FUEL_LOOK_AHEAD_MILES,
  advanceFuelOdometer,
  fuelAhead,
  fuelSearchBounds,
  nearestGasAhead,
  rangeLeftMiles,
  resetFuelOdometer,
  wholeMiles,
  wholeRangeMiles,
  type FuelOdometer,
  type GasAhead,
  type GasStation,
} from "@/application/ride-session/fuel-ahead";
import type { MapLayersSource } from "@/application/map-layers";
import type { Coordinate } from "@/domain/ride/types";

import "./ride-fuel.css";

export interface RideFuelLineProps {
  /** Gas along the route ahead, nearest first (from the ride's own prefetch). */
  readonly stations: readonly GasAhead[];
  /**
   * How many gas stations the ride found anywhere along the route. Zero means the
   * provider did not answer, which is not the same as a road without gas.
   */
  readonly stationsFound: number;
  /**
   * The guided route the stations belong to; `null` outside a guided ride, where
   * there is no line to measure along.
   */
  readonly routeKey: string | null;
  /** The rider's distance along that route now, or `null` when unknown. */
  readonly alongMiles: number | null;
  readonly position: Coordinate | null;
  readonly headingDegrees: number | null;
  /** The bike's usable range before reserve, or `null` when the garage has none. */
  readonly usableMiles: number | null;
  /** The layers port, for the Free Ride's nearby search. Absent = nothing. */
  readonly source?: MapLayersSource | undefined;
  /** Routes via the chosen station, through the ride's own reroute command. */
  readonly onAddStop?: ((coordinate: Coordinate, name: string) => void) | undefined;
}

/** How the line reads: plain, a caution, or an honest unknown. */
type FuelTone = "next" | "warn" | "unknown";

interface FuelLine {
  readonly text: string;
  readonly tone: FuelTone;
  /** What "Add gas stop" adds; `null` when the line offers no action. */
  readonly stop: GasAhead | null;
}

/** About 1.4 miles: the Free Ride re-asks only after the rider has moved on. */
const NEARBY_BUCKET_DEGREES = 0.02;

function nearbyBucket(position: Coordinate): string {
  return `${Math.round(position.lat / NEARBY_BUCKET_DEGREES)}:${Math.round(position.lon / NEARBY_BUCKET_DEGREES)}`;
}

function nextGasLine(station: GasAhead): FuelLine {
  return { text: `Next gas ${wholeMiles(station.aheadMiles)} mi · ${station.name}`, tone: "next", stop: null };
}

export function RideFuelLine({
  stations,
  stationsFound,
  routeKey,
  alongMiles,
  position,
  headingDegrees,
  usableMiles,
  source,
  onAddStop,
}: RideFuelLineProps) {
  const guided = routeKey !== null;

  // The ridden count: a pure fold of the route progress samples the ride already
  // has. Adjusted during render (React's own pattern for derived state) so the
  // range never lags a frame behind the distance it is judged against.
  const [odometer, setOdometer] = useState<FuelOdometer>(EMPTY_FUEL_ODOMETER);
  const advanced = advanceFuelOdometer(odometer, { routeKey, alongMiles });
  if (advanced !== odometer) setOdometer(advanced);

  /** Set by "Filled up", cleared by its own timer; the line is the feedback. */
  const [filledNote, setFilledNote] = useState(false);
  useEffect(() => {
    if (!filledNote) return;
    const timer = window.setTimeout(() => setFilledNote(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [filledNote]);

  /*
    Free Ride: no line to search a corridor against, so ask the layers endpoint
    for the fuel in a box around the rider. One call per ~1.4 miles travelled,
    never per fix; a failure contributes nothing (the optional provider rule).
  */
  const bucket = guided || position === null ? null : nearbyBucket(position);
  const load = source?.load;
  const [nearby, setNearby] = useState<{ readonly bucket: string; readonly stations: readonly GasStation[] } | null>(null);
  useEffect(() => {
    if (bucket === null || load === undefined || position === null) return;
    const at: Coordinate = position;
    const controller = new AbortController();
    void load(fuelSearchBounds(at), ["fuel"], controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setNearby({
          bucket,
          stations: result.features.flatMap((feature) => {
            if (feature.layerId !== "fuel" || feature.geometry.type !== "Point") return [];
            const [lon, lat] = feature.geometry.coordinates;
            return [{ id: feature.id, name: feature.name, coordinate: { lon, lat } }];
          }),
        });
      },
      () => {
        if (!controller.signal.aborted) setNearby({ bucket, stations: [] });
      },
    );
    return () => controller.abort();
    // A new bucket is the only reason to ask again; the position itself changes
    // with every fix and would turn this into a per-tick request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, load]);

  let line: FuelLine | null;
  if (!guided) {
    const found =
      position === null || nearby?.bucket !== bucket
        ? null
        : nearestGasAhead(nearby.stations, position, headingDegrees);
    // No direction, no station in range, or a failed search: the Free Ride says
    // nothing rather than naming a station behind the rider.
    line = found === null ? null : nextGasLine(found);
  } else if (stationsFound === 0) {
    // Unknown stays unknown: an empty answer is a provider that did not answer,
    // not a road with no gas, so it is stated rather than hidden.
    line = { text: "Gas stations unknown along this ride", tone: "unknown", stop: null };
  } else if (stations.length === 0) {
    // Stations exist on this ride, none of them ahead inside the search distance.
    line = { text: `No gas along the next ${FUEL_LOOK_AHEAD_MILES} mi`, tone: "warn", stop: null };
  } else {
    // A distance the ride cannot measure leaves the range out entirely.
    const rangeLeft = rangeLeftMiles(usableMiles, alongMiles === null ? null : odometer.riddenMiles);
    const verdict = fuelAhead(stations, rangeLeft);
    if (verdict.kind === "none") {
      line = { text: `No gas along the next ${FUEL_LOOK_AHEAD_MILES} mi`, tone: "warn", stop: null };
    } else if (verdict.kind === "next") {
      line = nextGasLine(verdict.station);
    } else {
      line = {
        text: `Gas: ${wholeMiles(verdict.station.aheadMiles)} mi to next station — range left ~${wholeRangeMiles(verdict.rangeLeftMiles)} mi`,
        tone: "warn",
        stop: verdict.stop,
      };
    }
  }

  if (line === null) return null;
  const add =
    line.stop === null || onAddStop === undefined ? null : { stop: line.stop, onAddStop };
  const canFill = guided && usableMiles !== null;

  return (
    <section className="og-ride-fuel" data-testid="ride-fuel" data-tone={line.tone} aria-label="Gas ahead">
      <p className="og-ride-fuel__line" data-testid="ride-fuel-line">
        {line.text}
      </p>
      {add === null && !canFill ? null : (
        <div className="og-ride-fuel__actions">
          {add === null ? null : (
            <button
              type="button"
              className="og-ride__action og-ride__action--primary"
              data-testid="ride-fuel-add-stop"
              onClick={() => add.onAddStop(add.stop.coordinate, add.stop.name)}
            >
              Add gas stop
            </button>
          )}
          {!canFill ? null : (
            <button
              type="button"
              className="og-ride__action og-ride__action--link"
              data-testid="ride-fuel-filled-up"
              onClick={() => {
                setOdometer(resetFuelOdometer);
                setFilledNote(true);
              }}
            >
              Filled up
            </button>
          )}
        </div>
      )}
      {!filledNote ? null : (
        <p className="og-ride-fuel__note" data-testid="ride-fuel-filled-note" role="status">
          Range counted from here.
        </p>
      )}
    </section>
  );
}
