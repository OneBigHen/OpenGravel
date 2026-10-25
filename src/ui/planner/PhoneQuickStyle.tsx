"use client";

/**
 * The phone's short ride style (small-screen design system v2 §3).
 *
 * Two one-tap segments — how the roads should ride and what surface is welcome —
 * directly under the ride summary, because reshaping the ride from the sheet is
 * the whole point of looking at the options. It owns no state: the rider's
 * choices are the composer's ride style, the same document intent the full
 * controls edit, so a tap here and a tap there are one preference and either one
 * re-plans through the same settle window (`usePlannerAnswerLifecycle`).
 *
 * Native radios styled as a segmented track: keyboard, screen reader and
 * hit-testing are the platform's, and the row scrolls inside itself when 320 px
 * cannot hold four words.
 */

import { useId } from "react";

import type { RoadCharacterIntent } from "@/domain/ride/types";
import {
  ROAD_CHARACTER_LABELS,
  SURFACE_LABELS,
  type RideStyleControlsModel,
  type SurfaceChoice,
} from "@/ui/planner/RideStyleControls";

/** Every road character, in the order a ride gets twistier. */
const ROAD_CHOICES: readonly RoadCharacterIntent[] = ["efficient", "balanced", "curvy", "backroads"];

/** The three words this row leads with. */
const SHORT_SURFACES: readonly SurfaceChoice[] = ["pavement", "mixed", "dirt-preferred"];

/**
 * The surface segments, with "Mostly paved" added in its place in the order
 * while it is the chosen preference: the full controls can set it, and the short
 * row must show the state it is in rather than light up the neighbouring word.
 */
function surfaceChoices(current: SurfaceChoice): readonly SurfaceChoice[] {
  return current === "mostly-pavement"
    ? ["pavement", "mostly-pavement", "mixed", "dirt-preferred"]
    : SHORT_SURFACES;
}

interface SegmentProps<T extends string> {
  readonly legend: string;
  readonly legendId: string;
  readonly name: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly labelFor: (option: T) => string;
  readonly onChange: (option: T) => void;
  readonly testId: string;
  readonly optionTestId: (option: T) => string;
}

/** One labelled, horizontally scrollable segment track. */
function Segment<T extends string>({
  legend,
  legendId,
  name,
  options,
  value,
  labelFor,
  onChange,
  testId,
  optionTestId,
}: SegmentProps<T>) {
  return (
    <div className="og-phone-style__row">
      <span className="og-phone-style__label" id={legendId}>
        {legend}
      </span>
      <div
        className="og-phone-style__track"
        role="radiogroup"
        aria-labelledby={legendId}
        data-testid={testId}
      >
        {options.map((option) => (
          <label key={option} className="og-phone-style__chip">
            <input
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
              data-testid={optionTestId(option)}
            />
            <span>{labelFor(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export interface PhoneQuickStyleProps {
  readonly model: RideStyleControlsModel;
}

export function PhoneQuickStyle({ model }: PhoneQuickStyleProps) {
  const id = useId();
  const { view, actions } = model;
  return (
    <section className="og-phone-style" data-testid="phone-ride-style" aria-label="Ride style">
      <Segment<RoadCharacterIntent>
        legend="Roads"
        legendId={`${id}-roads`}
        name={`${id}-roads`}
        options={ROAD_CHOICES}
        value={view.roadCharacter}
        labelFor={(option) => ROAD_CHARACTER_LABELS[option]}
        onChange={actions.setRoadCharacter}
        testId="phone-roads"
        optionTestId={(option) => `phone-road-${option}`}
      />
      <Segment<SurfaceChoice>
        legend="Surface"
        legendId={`${id}-surface`}
        name={`${id}-surface`}
        options={surfaceChoices(view.surface)}
        value={view.surface}
        labelFor={(option) => SURFACE_LABELS[option]}
        onChange={actions.setSurface}
        testId="phone-surface"
        optionTestId={(option) => `phone-surface-${option}`}
      />
    </section>
  );
}
