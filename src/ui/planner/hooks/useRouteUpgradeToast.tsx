"use client";

/**
 * The quiet note that goes with a route upgrade.
 *
 * The planner shows the first route it can check within a few seconds and keeps
 * working. When a better route arrives it takes the first one's place without
 * moving the map, and this note says so once, with an Undo back to the first.
 * The note is only for the ride on screen: it hides as soon as the ride is
 * edited or the rider picks a route.
 */

import { useCallback, useState, type ReactNode } from "react";

import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { RideDocument } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import { RiderToast } from "@/ui/place/RiderToast";

export function useRouteUpgradeToast(input: {
  readonly document: RideDocument;
  readonly snapshot: PlanningSessionSnapshot;
  readonly onUndo: (routeId: RouteCandidateId) => void;
}): ReactNode {
  const { document, snapshot, onUndo } = input;
  const upgrade = snapshot.upgrade ?? null;
  const key =
    upgrade === null || snapshot.identity.rideRevision !== document.revision
      ? null
      : `${snapshot.identity.planningGeneration}:${upgrade.toRouteId}`;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const dismiss = useCallback(() => setDismissed(key), [key]);
  if (upgrade === null || key === null || dismissed === key) return null;
  const message = document.intent.shape === "loop" ? "Found a better loop" : "Found a better ride";
  return (
    <RiderToast
      notice={{ id: snapshot.identity.planningGeneration, message, undo: () => onUndo(upgrade.fromRouteId) }}
      onDismiss={dismiss}
    />
  );
}
