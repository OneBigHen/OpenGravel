import { useMemo } from "react";

import {
  DEFAULT_LOOP_MINUTES,
  defaultLoopToleranceMinutes,
} from "@/application/planner/build-plan-request";
import type { RideCommand } from "@/domain/ride/commands";
import type { RideDocument } from "@/domain/ride/types";
import {
  shapeChoice,
  type RideStyleControlsModel,
} from "@/ui/planner/RideStyleControls";
import type { ArrivalTarget } from "@/application/planner/arrive-by";
import {
  arriveByCommand,
  departureCommand,
  reverseRideCommand,
  bikeCommand,
  highwayPolicyCommand,
  loopTimeCommand,
  rideShapeCommand,
  roadCharacterCommand,
  noveltyPreferenceCommand,
  surfacePreferenceCommand,
  tollPolicyCommand,
  type RideDocumentStore,
} from "@/ui/stores/ride-document-store";

/**
 * Ride style for the composer (M2): a projection of the authored intent plus one
 * typed command per choice. Owns no state; the document store decides.
 */
export function usePlannerRideStyle(input: {
  readonly document: RideDocument;
  readonly rideDocumentStore: RideDocumentStore;
}): RideStyleControlsModel {
  const { document, rideDocumentStore } = input;
  const { shape, time, roadCharacter, noveltyPreference, surface, avoidHighways, tollPolicy } = document.intent;

  const actions = useMemo(() => {
    const dispatch = (build: (current: RideDocument) => RideCommand): void => {
      const state = rideDocumentStore.getState();
      state.dispatch(build(state.document));
    };
    return {
      setBike: (bike: RideDocument["intent"]["bike"]): void =>
        dispatch((current) => bikeCommand(current, bike)),
      setShape: (next: "destination" | "loop"): void =>
        dispatch((current) => rideShapeCommand(current, next)),
      setLoopMinutes: (minutes: number): void =>
        dispatch((current) =>
          loopTimeCommand(current, minutes, defaultLoopToleranceMinutes(minutes)),
        ),
      setRoadCharacter: (next: RideDocument["intent"]["roadCharacter"]): void =>
        dispatch((current) => roadCharacterCommand(current, next)),
      setNoveltyPreference: (next: NonNullable<RideDocument["intent"]["noveltyPreference"]>): void =>
        dispatch((current) => noveltyPreferenceCommand(current, next)),
      setSurface: (next: RideDocument["intent"]["surface"]["preference"]): void =>
        dispatch((current) => surfacePreferenceCommand(current, next)),
      setAvoidHighways: (avoid: boolean): void =>
        dispatch((current) => highwayPolicyCommand(current, avoid)),
      setAvoidTolls: (avoid: boolean): void =>
        dispatch((current) => tollPolicyCommand(current, avoid)),
      setDeparture: (departure: RideDocument["intent"]["departure"]): void =>
        dispatch((current) => departureCommand(current, departure)),
      setArriveBy: (arrival: ArrivalTarget | null): void => {
        const current = rideDocumentStore.getState().document.intent.time;
        if (arrival === null && current.kind !== "arriveBy") return;
        dispatch((document) => arriveByCommand(document, arrival));
      },
      reverse: (): void => dispatch((current) => reverseRideCommand(current)),
    };
  }, [rideDocumentStore]);

  const view = useMemo(
    () => ({
      shape: shapeChoice(shape),
      loopMinutes: time.kind === "budget" ? time.targetMinutes : DEFAULT_LOOP_MINUTES,
      roadCharacter,
      noveltyPreference: noveltyPreference ?? "balanced",
      surface: surface.preference,
      avoidHighways,
      avoidTolls: tollPolicy === "avoid",
    }),
    [shape, time, roadCharacter, noveltyPreference, surface.preference, avoidHighways, tollPolicy],
  );

  return useMemo(() => ({ view, actions }), [view, actions]);
}
