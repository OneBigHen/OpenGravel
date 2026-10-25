"use client";

/**
 * Ride style (MVP parity M2): the shape of the ride, a loop's ride time, and the
 * road/surface/highway/toll envelope — every one of them a control that changes
 * what the router answers (OGV-D-262; `tests/real-router/ride-style-live.test.ts`).
 *
 * The controls are native radios and checkboxes styled as chips and switches,
 * so keyboard and screen-reader behavior are the platform's own. Each change is
 * one typed command through `onChange`; this module owns no ride state.
 *
 * Layout: the shape switch and the loop's ride time sit in the composer's own
 * rows; the envelope lives behind one "Ride style" row whose short value is the
 * road and the surface (`Balanced · Mixed`), the two choices that change the
 * shape of a ride most, with the rest of the envelope inside. On a phone that
 * row is a disclosure (the peek detent has room for exactly one more line,
 * 04 §2); from 761 px up it is always open.
 */

import { useId, useState, useSyncExternalStore } from "react";

import type { ArrivalTarget } from "@/application/planner/arrive-by";
import { loopMinutesUntilSunset } from "@/application/planner/loop-until-sunset";
import type { BikeConstraintSnapshot, Coordinate, DepartureIntent, NoveltyPreference, RideIntent, RoadCharacterIntent, SurfaceIntent, TrafficPreference } from "@/domain/ride/types";

export type RideShapeChoice = "destination" | "loop";
export type SurfaceChoice = SurfaceIntent["preference"];

/** What the controls show; projected from the document by the workspace hook. */
export interface RideStyleView {
  readonly shape: RideShapeChoice;
  /** The loop's ride time in minutes (the default when none was chosen). */
  readonly loopMinutes: number;
  /** Where a loop starts; the sunset chip needs it, and hides without it. */
  readonly startCoordinate?: Coordinate | null;
  readonly roadCharacter: RoadCharacterIntent;
  readonly noveltyPreference: NoveltyPreference;
  readonly surface: SurfaceChoice;
  readonly traffic: TrafficPreference;
  readonly avoidHighways: boolean;
  readonly avoidTolls: boolean;
}

export interface RideStyleActions {
  readonly setBike: (bike: BikeConstraintSnapshot) => void;
  readonly setShape: (shape: RideShapeChoice) => void;
  readonly setLoopMinutes: (minutes: number) => void;
  readonly setRoadCharacter: (character: RoadCharacterIntent) => void;
  readonly setNoveltyPreference: (preference: NoveltyPreference) => void;
  readonly setTraffic: (traffic: TrafficPreference) => void;
  readonly setSurface: (surface: SurfaceChoice) => void;
  readonly setAvoidHighways: (avoid: boolean) => void;
  readonly setAvoidTolls: (avoid: boolean) => void;
  /** When the ride leaves (M4); the route briefing's control, not this panel's. */
  readonly setDeparture: (departure: DepartureIntent) => void;
  /** Arrive by a time (NV-09); null returns to a plain departure. */
  readonly setArriveBy?: (arrival: ArrivalTarget | null) => void;
  /** Swap start and destination (PQ-04). */
  readonly reverse?: () => void;
}

export interface RideStyleControlsModel {
  readonly view: RideStyleView;
  readonly actions: RideStyleActions;
}

/** Short escapes first, with longer loops still available. */
export const LOOP_MINUTE_CHOICES: readonly number[] = [45, 60, 90, 120, 180, 240, 360];

/** The longest loop the picker offers; the sunset chip never exceeds it. */
export const LOOP_MAX_MINUTES = Math.max(...LOOP_MINUTE_CHOICES);

export const ROAD_CHARACTER_LABELS: Readonly<Record<RoadCharacterIntent, string>> = {
  efficient: "Fast",
  balanced: "Balanced",
  curvy: "Curvy",
  backroads: "Backroads",
};

export const SURFACE_LABELS: Readonly<Record<SurfaceChoice, string>> = {
  pavement: "Paved",
  "mostly-pavement": "Mostly paved",
  mixed: "Mixed",
  "dirt-preferred": "Dirt OK",
};

export const TRAFFIC_LABELS: Readonly<Record<TrafficPreference, string>> = {
  "protect-ride": "Avoid busy roads",
  "minimize-delay": "Fastest",
};

export const NOVELTY_LABELS: Readonly<Record<NoveltyPreference, string>> = {
  "prefer-new-to-me": "New to me",
  balanced: "Balanced",
  "prefer-familiar": "Familiar",
};

const ROAD_CHARACTERS: readonly RoadCharacterIntent[] = ["efficient", "balanced", "curvy", "backroads"];
const NOVELTY_PREFERENCES: readonly NoveltyPreference[] = ["prefer-new-to-me", "balanced", "prefer-familiar"];
const SURFACES: readonly SurfaceChoice[] = ["pavement", "mostly-pavement", "mixed", "dirt-preferred"];

/** `2 h`, `1 h 30 min` — ride times are whole hours today, but never lie if not. */
export function formatRideTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The short value the collapsed `Ride style` row shows: `Balanced · Mixed`.
 * Everything else the panel holds — familiarity, traffic, highways, tolls — is
 * inside it, so the row keeps one value that reads at a glance instead of a
 * sentence that wraps beside an eyebrow.
 */
export function rideStyleSummary(view: RideStyleView): string {
  return [ROAD_CHARACTER_LABELS[view.roadCharacter], SURFACE_LABELS[view.surface]].join(" · ");
}

/** The authored shape as a composer choice: an open ride plans like a destination. */
export function shapeChoice(shape: RideIntent["shape"]): RideShapeChoice {
  return shape === "loop" ? "loop" : "destination";
}

interface ChipGroupProps<T extends string> {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly labelFor: (value: T) => string;
  readonly onChange: (value: T) => void;
  readonly testId: string;
  readonly legendHidden?: boolean;
}

/** A radio group drawn as a row of chips. */
function ChipGroup<T extends string>({
  name,
  legend,
  options,
  value,
  labelFor,
  onChange,
  testId,
  legendHidden = false,
}: ChipGroupProps<T>) {
  return (
    <fieldset className="og-style__group" data-testid={testId}>
      <legend className={legendHidden ? "og-visually-hidden" : "og-style__legend"}>{legend}</legend>
      <div className="og-style__chips">
        {options.map((option) => (
          <label key={option} className="og-style__chip">
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
              data-testid={`${testId}-${option}`}
            />
            <span>{labelFor(option)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** `To a destination | Loop`: the first choice a rider makes about a ride. */
export function RideShapeSwitch({ model }: { readonly model: RideStyleControlsModel }) {
  const name = useId();
  return (
    <ChipGroup<RideShapeChoice>
      name={name}
      legend="Ride shape"
      legendHidden
      options={["destination", "loop"]}
      value={model.view.shape}
      labelFor={(shape) => (shape === "loop" ? "Loop from start" : "To a destination")}
      onChange={model.actions.setShape}
      testId="ride-shape"
    />
  );
}

/**
 * The minute clock the sunset chip reads.
 *
 * One shared interval serves every mounted loop row and stops when the last
 * one goes away, so a destination ride — or any surface without the picker —
 * runs no timer at all. The snapshot is the `Date` of the last tick, which is
 * all the chip needs: it recomputes at most once a minute.
 */
const minuteClockListeners = new Set<() => void>();
let minuteClockNow: Date | null = null;
let minuteClockTimer: number | null = null;

function subscribeMinuteClock(listener: () => void): () => void {
  minuteClockListeners.add(listener);
  if (minuteClockTimer === null) {
    minuteClockNow = new Date();
    minuteClockTimer = window.setInterval(() => {
      minuteClockNow = new Date();
      for (const each of minuteClockListeners) each();
    }, 60_000);
  }
  return () => {
    minuteClockListeners.delete(listener);
    if (minuteClockListeners.size === 0 && minuteClockTimer !== null) {
      window.clearInterval(minuteClockTimer);
      minuteClockTimer = null;
    }
  };
}

function readMinuteClock(): Date | null {
  return minuteClockNow;
}

/** Null on the server, so the chip never disagrees with the markup it hydrates. */
function readServerMinuteClock(): null {
  return null;
}

/** Now, at most once a minute; `fixed` pins it for tests and snapshots. */
function useMinuteClock(fixed: Date | undefined): Date | null {
  const ticked = useSyncExternalStore(subscribeMinuteClock, readMinuteClock, readServerMinuteClock);
  return fixed ?? ticked;
}

export interface LoopTimeRowProps {
  readonly model: RideStyleControlsModel;
  /** The clock the sunset chip reads; tests pin it instead of waiting. */
  readonly now?: Date;
}

/** A loop's ride time, in the row the destination occupies on a one-way ride. */
export function LoopTimeRow({ model, now }: LoopTimeRowProps) {
  const name = useId();
  const clock = useMinuteClock(now);
  const sunsetMinutes = clock === null
    ? null
    : loopMinutesUntilSunset({
        coordinate: model.view.startCoordinate ?? null,
        now: clock,
        maxMinutes: LOOP_MAX_MINUTES,
      });
  /**
   * The sunset chip writes the same minutes a plain chip would, so it can only
   * be told apart by remembering the choice; it stays chosen while that value
   * is still the ride time it would set.
   */
  const [chosenSunsetMinutes, setChosenSunsetMinutes] = useState<number | null>(null);
  const sunsetChosen = sunsetMinutes !== null
    && chosenSunsetMinutes === sunsetMinutes
    && sunsetMinutes === model.view.loopMinutes;
  const chooseSunset = (minutes: number): void => {
    setChosenSunsetMinutes(minutes);
    model.actions.setLoopMinutes(minutes);
  };
  const choosePlain = (minutes: number): void => {
    setChosenSunsetMinutes(null);
    model.actions.setLoopMinutes(minutes);
  };
  return (
    <div className="og-composer__row og-composer__row--loop">
      <span className="og-composer__label" id={`${name}-label`}>
        Ride time
      </span>
      <div className="og-style__loop" role="radiogroup" aria-labelledby={`${name}-label`} data-testid="loop-time">
        {sunsetMinutes === null ? null : (
          <label className="og-style__chip">
            <input
              type="radio"
              name={name}
              value="sunset"
              checked={sunsetChosen}
              onChange={() => chooseSunset(sunsetMinutes)}
              data-testid="loop-time-sunset"
            />
            <span>Until sunset · {formatRideTime(sunsetMinutes)}</span>
          </label>
        )}
        {LOOP_MINUTE_CHOICES.map((minutes) => (
          <label key={minutes} className="og-style__chip">
            <input
              type="radio"
              name={name}
              value={minutes}
              checked={minutes === model.view.loopMinutes && !sunsetChosen}
              onChange={() => choosePlain(minutes)}
              data-testid={`loop-time-${minutes}`}
            />
            <span>{formatRideTime(minutes)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Road character, surface, highways and tolls behind one summary row. */
export function RideStylePanel({ model }: { readonly model: RideStyleControlsModel }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const characterName = useId();
  const noveltyName = useId();
  const surfaceName = useId();
  const trafficName = useId();
  const { view, actions } = model;
  return (
    <section className="og-style" aria-label="Ride style" data-testid="ride-style">
      {/* Wide layouts show the panel open under a plain heading; only the
          compact sheet needs the disclosure button (CSS picks one). */}
      <p className="og-style__heading" aria-hidden="true">
        <span className="og-composer__label">Ride style</span>
      </p>
      <button
        type="button"
        className="og-style__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="ride-style-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="og-composer__label og-style__toggle-label">Ride style</span>
        <span className="og-style__summary" data-testid="ride-style-summary">
          {rideStyleSummary(view)}
        </span>
        {/* A disclosure row points at what it opens: right when closed, down
            when open. */}
        <span aria-hidden="true" className="og-style__chevron">
          {open ? "⌄" : "›"}
        </span>
      </button>
      <div id={panelId} className="og-style__panel" data-open={open ? "true" : "false"}>
        <ChipGroup<RoadCharacterIntent>
          name={characterName}
          legend="Roads"
          options={ROAD_CHARACTERS}
          value={view.roadCharacter}
          labelFor={(character) => ROAD_CHARACTER_LABELS[character]}
          onChange={actions.setRoadCharacter}
          testId="road-character"
        />
        <ChipGroup<NoveltyPreference>
          name={noveltyName}
          legend="Road familiarity"
          options={NOVELTY_PREFERENCES}
          value={view.noveltyPreference}
          labelFor={(preference) => NOVELTY_LABELS[preference]}
          onChange={actions.setNoveltyPreference}
          testId="novelty-preference"
        />
        <ChipGroup<SurfaceChoice>
          name={surfaceName}
          legend="Surface"
          options={SURFACES}
          value={view.surface}
          labelFor={(surface) => SURFACE_LABELS[surface]}
          onChange={actions.setSurface}
          testId="surface-preference"
        />
        <ChipGroup<TrafficPreference>
          name={trafficName}
          legend="Traffic"
          options={["protect-ride", "minimize-delay"]}
          value={view.traffic}
          labelFor={(traffic) => TRAFFIC_LABELS[traffic]}
          onChange={actions.setTraffic}
          testId="traffic-preference"
        />
        <div className="og-style__switches">
          <label className="og-style__switch">
            <input
              type="checkbox"
              role="switch"
              checked={view.avoidHighways}
              onChange={(event) => actions.setAvoidHighways(event.target.checked)}
              data-testid="avoid-highways"
            />
            <span>Avoid highways</span>
          </label>
          <label className="og-style__switch">
            <input
              type="checkbox"
              role="switch"
              checked={view.avoidTolls}
              onChange={(event) => actions.setAvoidTolls(event.target.checked)}
              data-testid="avoid-tolls"
            />
            <span>Avoid tolls</span>
          </label>
        </div>
      </div>
    </section>
  );
}
