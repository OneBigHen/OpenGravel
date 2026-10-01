"use client";

import { useState } from "react";

/**
 * The intent composer (04-PLANNER-AND-WORKSPACE-UX §4, §8).
 *
 * The composer authors a start and a destination — by searching for a place
 * (M1) or by clicking the map — shows what has been placed, and owns the plan
 * commitment. Search is offered only when the composition root supplies a
 * geocoder; without one the rows are the two placement tools, never a fake field.
 *
 * The commit button is disabled only for the three truthful reasons the view
 * model can state, and the reason is always rendered next to it (04 §8). Its
 * test hook is `compose-create` whichever label it carries: one button commits
 * an attempt, and the label (`Create ride` / `Update ride`) says which attempt
 * that is.
 */

import type { PlannerViewModel } from "@/application/planner/planner-view-model";
import { PlaceSearchField } from "@/ui/planner/PlaceSearchField";
import { AdvisorInline, useRideAdvisor } from "@/ui/planner/RideAdvisor";
import type { ComposerPlaceSearch } from "@/ui/planner/usePlannerPlaces";
import {
  LoopTimeRow,
  RideShapeSwitch,
  RideStylePanel,
  type RideStyleControlsModel,
} from "@/ui/planner/RideStyleControls";
import {
  DISABLED_MISSING_FINISH,
  DISABLED_MISSING_START,
  NO_FINISH_LABEL,
  NO_START_LABEL,
} from "@/application/planner/planner-view-model";

/** Stable id for the disabled-reason description (one composer per page). */
const DISABLED_REASON_ID = "og-plan-disabled-reason";

/**
 * Stable id for the map's own reason (4.0s).
 *
 * Separate from the composer's because the two can coexist: a plan already in
 * flight keeps saying so, while the map the next tap needs is still dead.
 */
const MAP_REASON_ID = "og-map-required-reason";

/**
 * The composer reasons a dead map invalidates (4.0s).
 *
 * Both are instructions to place a point *on the map*. Telling the rider to do
 * that while the map did not load is worse than saying nothing, so the map's own
 * reason takes their place — and it names the action that can actually help.
 */
const PLACEMENT_REASONS: readonly string[] = [DISABLED_MISSING_START, DISABLED_MISSING_FINISH];

/**
 * Why the map cannot serve a placement while it is not up (4.0s), unless the
 * workspace supplies a reason of its own. It names the actions that can still
 * help: search does not need the canvas.
 */
const MAP_UNAVAILABLE_FALLBACK =
  "The map didn't load, so points can't be placed on it until it comes back. Retry the map.";
const MAP_UNAVAILABLE_WITH_SEARCH =
  "The map didn't load, so points can't be placed on it until it comes back. Search for a place, or retry the map.";

/** Which placement tool the workspace currently owns the next map click with. */
export type ArmedPlacementTool = "start" | "finish" | "stop" | null;

export interface IntentComposerProps {
  readonly viewModel: PlannerViewModel;
  readonly onSetStart: () => void;
  readonly onSetFinish: () => void;
  readonly onPlan: () => void;
  /** Keeps cancellation beside the planning commitment in a scrolling sheet. */
  readonly onCancelPlanning?: () => void;
  /** 04 §8: `Create ride` with no result, `Update ride` on a deliberate edit,
   * `Plan again` after a failure (the label never claims success on an error). */
  readonly planLabel?: string;
  /**
   * The recovery action when the last attempt failed (04 §29; owner review
   * 2026-09-17). Offering it next to a quiet error line is what turns "no legal
   * route" from a dead end into a next step, and it is deliberately a secondary
   * control so the primary button cannot read as a success claim.
   *
   * It shares the destination chip's action, so it cannot share its *label* once
   * the chip says `Change destination` (defect: two identical controls in one
   * surface). The visible copy names the recovered state instead: trying a
   * different destination is what the rider was doing when the attempt failed.
   */
  readonly onChangeDestination?: () => void;
  /** Swap start and destination (PQ-04); offered once both are set. */
  readonly onReverse?: () => void;
  /**
   * The armed placement tool, so the chip that owns the next map click is
   * visibly distinct (OGV-D-213). Presentation only: arming changes which click
   * places a point, and the map states the instruction (the composer's disabled
   * reason states the blocker, never both — OGV-D-214).
   */
  readonly armedTool?: ArmedPlacementTool;
  /**
   * True while the map failed to load (4.0s).
   *
   * The composer is then honest about what it cannot offer: the placement chips
   * are disabled with the map's reason, and the commitment button stops telling
   * the rider to place a point on a map that is not there. Planning a ride whose
   * points already exist is untouched — that never needed the canvas.
   */
  readonly mapUnavailable?: boolean;
  /** Why the map is unavailable, from the workspace; a plain fallback otherwise. */
  readonly mapUnavailableReason?: string | null;
  /** Place search for both rows (M1); absent means map placement only. */
  readonly placeSearch?: ComposerPlaceSearch;
  /**
   * Ride shape, loop time and the road/surface envelope (M2). Absent means the
   * composer is the two endpoint rows only, which is what a bare embedding and
   * the older surface tests render.
   */
  readonly rideStyle?: RideStyleControlsModel;
}

/** Map-pin glyph for the icon chip; decorative, the words are its name. */
function ChipLabel({ iconic, children }: { readonly iconic: boolean; readonly children: string }) {
  if (!iconic) return <>{children}</>;
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="none">
        <path
          d="M10 18s5.5-5.2 5.5-9.5a5.5 5.5 0 1 0-11 0C4.5 12.8 10 18 10 18Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <span className="og-visually-hidden">{children}</span>
    </>
  );
}

/**
 * A point's value cell: its name over the coordinate (04 §3, §5). A dropped pin
 * says "Dropped pin" (the app never invents a place name), and the coordinate
 * is machine-readable on `data-coordinate` so the browser gate can assert the
 * exact point the rider placed.
 */
function PointValue({
  slot,
  label,
  coordinate,
  hidden,
}: {
  readonly slot: "start" | "finish";
  readonly label: string;
  readonly coordinate: string | null;
  readonly hidden: boolean;
}) {
  return (
    <span
      className={hidden ? "og-composer__value og-visually-hidden" : "og-composer__value"}
      data-testid={`${slot}-value`}
      {...(coordinate === null ? {} : { "data-coordinate": coordinate })}
    >
      <span className="og-composer__value-label">{label}</span>
      {coordinate === null ? null : (
        <span className="og-composer__coordinate" data-testid={`${slot}-coordinate`}>
          {coordinate}
        </span>
      )}
    </span>
  );
}

/**
 * A chosen place reads as the place, and tapping it opens the search to change
 * it (UX rework phase 2). Before a place is chosen, or while it is being
 * changed, the search field stands in and the value cell stays for assistive
 * tech only.
 */
function PointRow({
  slot,
  label,
  coordinate,
  searchable,
  has,
  searching,
  onChange,
}: {
  readonly slot: "start" | "finish";
  readonly label: string;
  readonly coordinate: string | null;
  readonly searchable: boolean;
  readonly has: boolean;
  readonly searching: boolean;
  readonly onChange: () => void;
}) {
  const value = (
    <PointValue slot={slot} label={label} coordinate={coordinate} hidden={searchable && (!has || searching)} />
  );
  if (!searchable || !has || searching) return value;
  return (
    <button
      type="button"
      className="og-composer__place"
      data-testid={`${slot}-change`}
      title={slot === "start" ? "Change start" : "Change destination"}
      onClick={onChange}
    >
      {value}
    </button>
  );
}

/** Save the chosen place, so the next empty search offers it (NV-02). */
function SaveStar({
  slot,
  saving,
  hidden,
}: {
  readonly slot: "start" | "finish";
  readonly saving: ComposerPlaceSearch["saving"];
  readonly hidden: boolean;
}) {
  if (saving === undefined || hidden) return null;
  const saved = saving.isSaved(slot);
  if (saved === null) return null;
  const noun = slot === "start" ? "start" : "destination";
  return (
    <button
      type="button"
      className="og-composer__star"
      data-testid={`${slot}-save`}
      aria-pressed={saved}
      aria-label={saved ? `Remove the ${noun} from saved places` : `Save the ${noun} as a place`}
      title={saved ? "Saved — tap to remove" : "Save this place"}
      onClick={() => saving.toggle(slot)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
      </svg>
    </button>
  );
}

export function IntentComposer({
  viewModel,
  onSetStart,
  onSetFinish,
  onPlan,
  onCancelPlanning,
  planLabel = "Create ride",
  onChangeDestination,
  onReverse,
  armedTool = null,
  mapUnavailable = false,
  mapUnavailableReason = null,
  placeSearch,
  rideStyle,
}: IntentComposerProps) {
  const loop = rideStyle?.view.shape === "loop";
  const reverseRide = onReverse ?? rideStyle?.actions.reverse;
  const hasStart = viewModel.startLabel !== NO_START_LABEL;
  const hasFinish = viewModel.finishLabel !== NO_FINISH_LABEL;
  const mapReason = mapUnavailable
    ? (mapUnavailableReason ??
      (placeSearch === undefined ? MAP_UNAVAILABLE_FALLBACK : MAP_UNAVAILABLE_WITH_SEARCH))
    : null;
  const placementBlocked = PLACEMENT_REASONS.includes(viewModel.disabledReason ?? "");
  // The map's absence speaks for the placement reasons it invalidates. A plan
  // already in flight keeps its own sentence: that is the more specific truth
  // about the button, and it is not something a retry can change.
  const standIn = mapReason !== null && placementBlocked;
  const disabledReason = standIn ? mapReason : viewModel.disabledReason;
  // The map reason needs a line of its own only when the commitment button is not
  // already showing it — but it always needs an id, because it describes the two
  // placement chips as well.
  const mapReasonId = standIn ? DISABLED_REASON_ID : MAP_REASON_ID;
  const mapReasonLine = mapReason !== null && !standIn;
  // With search on the row, the map chip is a pin icon beside the field: the
  // row stays two lines tall, so the phone's peek detent still fits the whole
  // composer (04 §2). Its words stay in the accessible name.
  const searchable = placeSearch !== undefined;
  const rowClass = searchable ? "og-composer__row og-composer__row--search" : "og-composer__row";
  const chipClass = searchable ? "og-chip og-chip--icon" : "og-chip";
  // UX rework phase 2: a chosen place reads as the place, not as a label, a
  // value and an empty search box. Tapping it opens the search to change it.
  const [editing, setEditing] = useState<{ readonly start: boolean; readonly finish: boolean }>({
    start: false,
    finish: false,
  });
  const advisor = useRideAdvisor();
  const showStartSearch = searchable && (!hasStart || editing.start);
  const showFinishSearch = searchable && (!hasFinish || editing.finish);
  const stopEditing = (slot: "start" | "finish"): void =>
    setEditing((current) => ({ ...current, [slot]: false }));
  // "A ride from here" in one tap (UX rework phase 2, like Calimoto's round
  // trip): choosing Loop on an empty composer starts it from the rider's own
  // location. Everywhere else the switch behaves exactly as before.
  const useHereForLoop = !hasStart && placeSearch?.currentLocation !== undefined;
  const shapeModel: RideStyleControlsModel | undefined =
    rideStyle === undefined || !useHereForLoop
      ? rideStyle
      : {
          ...rideStyle,
          actions: {
            ...rideStyle.actions,
            setShape: (shape) => {
              rideStyle.actions.setShape(shape);
              if (shape === "loop") placeSearch?.currentLocation?.onUse();
            },
          },
        };
  return (
    <section className="og-composer" aria-label="Ride intent" data-skip-target="">
      {shapeModel === undefined ? null : <RideShapeSwitch model={shapeModel} />}
      <div className={rowClass}>
        <span className="og-composer__dot og-composer__dot--start" aria-hidden="true" />
        <span className={searchable ? "og-composer__label og-visually-hidden" : "og-composer__label"}>Start</span>
        <PointRow
          slot="start"
          label={viewModel.startLabel}
          coordinate={viewModel.startCoordinateLabel}
          searchable={searchable}
          has={hasStart}
          searching={showStartSearch}
          onChange={() => setEditing((current) => ({ ...current, start: true }))}
        />
        <SaveStar slot="start" saving={placeSearch?.saving} hidden={!searchable || !hasStart || showStartSearch} />
        <button
          type="button"
          className={chipClass}
          data-testid="start-chip"
          data-armed={armedTool === "start" ? "true" : "false"}
          disabled={mapUnavailable}
          {...(searchable ? { title: hasStart ? "Change start" : "Set start on map" } : {})}
          {...(mapReason === null
            ? {}
            : { "aria-describedby": mapReasonId, title: mapReason })}
          onClick={onSetStart}
        >
          <ChipLabel iconic={searchable}>{hasStart ? "Change start" : "Set start on map"}</ChipLabel>
        </button>
        {placeSearch === undefined || !showStartSearch ? null : (
          <PlaceSearchField
            slot="start"
            search={placeSearch.port}
            autoFocus={editing.start}
            onIdleBlur={hasStart ? () => stopEditing("start") : undefined}
            onPick={(place, query) => {
              stopEditing("start");
              placeSearch.onPick("start", place, query);
            }}
            {...(placeSearch.bias === undefined ? {} : { bias: placeSearch.bias })}
            {...(placeSearch.currentLocation === undefined
              ? {}
              : { currentLocation: placeSearch.currentLocation })}
            {...(placeSearch.remembered === undefined ? {} : { remembered: placeSearch.remembered })}
          />
        )}
      </div>

      {!loop && hasStart && hasFinish && reverseRide !== undefined ? (
        <button
          type="button"
          className="og-composer__swap"
          data-testid="swap-endpoints"
          aria-label="Swap start and destination"
          title="Swap start and destination"
          onClick={reverseRide}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />
          </svg>
        </button>
      ) : null}
      {loop && rideStyle !== undefined ? (
        <LoopTimeRow model={rideStyle} />
      ) : (
        <div className={rowClass}>
          <span className="og-composer__dot og-composer__dot--finish" aria-hidden="true" />
          <span className={searchable ? "og-composer__label og-visually-hidden" : "og-composer__label"}>Destination</span>
          <PointRow
            slot="finish"
            label={viewModel.finishLabel}
            coordinate={viewModel.finishCoordinateLabel}
            searchable={searchable}
            has={hasFinish}
            searching={showFinishSearch}
            onChange={() => setEditing((current) => ({ ...current, finish: true }))}
          />
          <SaveStar slot="finish" saving={placeSearch?.saving} hidden={!searchable || !hasFinish || showFinishSearch} />
          <button
            type="button"
            className={chipClass}
            data-testid="finish-chip"
            data-armed={armedTool === "finish" ? "true" : "false"}
            disabled={mapUnavailable}
            {...(searchable
              ? { title: hasFinish ? "Change destination" : "Set destination on map" }
              : {})}
            {...(mapReason === null
              ? {}
              : { "aria-describedby": mapReasonId, title: mapReason })}
            onClick={onSetFinish}
          >
            <ChipLabel iconic={searchable}>
              {hasFinish ? "Change destination" : "Set destination on map"}
            </ChipLabel>
          </button>
          {placeSearch === undefined || !showFinishSearch ? null : (
            <PlaceSearchField
              slot="finish"
              search={placeSearch.port}
              autoFocus={editing.finish}
              onIdleBlur={hasFinish ? () => stopEditing("finish") : undefined}
              onPick={(place, query) => {
                stopEditing("finish");
                placeSearch.onPick("finish", place, query);
              }}
              {...(advisor === null
                ? {}
                : {
                    describe: (text: string) => {
                      stopEditing("finish");
                      advisor.ask(text);
                    },
                  })}
              {...(placeSearch.bias === undefined ? {} : { bias: placeSearch.bias })}
              {...(placeSearch.remembered === undefined ? {} : { remembered: placeSearch.remembered })}
            />
          )}
        </div>
      )}

      {/* The advisor answers here, in the sheet; with no "Where to?" box on
          screen (a loop, or a destination already set) it offers its own. */}
      <AdvisorInline askBox={loop || !showFinishSearch} />

      {rideStyle === undefined ? null : <RideStylePanel model={rideStyle} />}

      {/* Trail Glass idle sheet: on a phone with nothing planned, the shape
          switch is hidden and this one tap starts a loop from here. */}
      {shapeModel === undefined || loop ? null : (
        <button
          type="button"
          className="og-chip og-composer__loop-quick"
          data-testid="loop-near-me"
          aria-label={hasStart ? "Loop from here" : "Loop near me"}
          onClick={() => shapeModel.actions.setShape("loop")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
            <path d="M20 4v4h-4" />
          </svg>
          Loop
        </button>
      )}

      <div className="og-composer__commitment" data-current={viewModel.planIsCurrent ? "true" : "false"}>
        <div className="og-composer__commitment-actions">
          <button
            type="button"
            className={viewModel.planIsCurrent ? "og-secondary" : "og-primary"}
            data-testid="compose-create"
            disabled={!viewModel.canPlan}
            {...(disabledReason === null ? {} : { "aria-describedby": DISABLED_REASON_ID })}
            onClick={onPlan}
          >
            {planLabel}
          </button>
          {onCancelPlanning === undefined ? null : (
            <button type="button" className="og-secondary" data-testid="cancel-planning" onClick={onCancelPlanning}>
              Cancel
            </button>
          )}
        </div>

        {viewModel.failed && onChangeDestination !== undefined && !loop ? (
          <button
            type="button"
            className="og-secondary"
            data-testid="plan-recovery"
            onClick={onChangeDestination}
          >
            Try a different destination
          </button>
        ) : null}

        {disabledReason === null ? null : (
          <p
            className="og-composer__reason"
            id={DISABLED_REASON_ID}
            data-testid="plan-disabled-reason"
          >
            {disabledReason}
          </p>
        )}
      </div>

      {/*
        The chips need the same reason even when the commitment button is not
        disabled — a complete ride can still be planned on a dead map, and the
        placement it cannot offer has to say why (4.0s).
      */}
      {mapReasonLine ? (
        <p className="og-composer__reason" id={MAP_REASON_ID} data-testid="map-required-reason">
          {mapReason}
        </p>
      ) : null}
    </section>
  );
}
