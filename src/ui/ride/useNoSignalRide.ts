"use client";

/**
 * The ride with no signal (R3-7). Tells the ride store when the phone loses
 * or finds its network, and finds the kept ride that matches the line being
 * followed, so the screen can say "No signal, kept ride" only when it is true.
 */

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";

import type { RidePackRecord, RidePackService } from "@/application/offline/ride-pack";
import type { Coordinate } from "@/domain/ride/types";
import type { RideFocusStore } from "@/ui/stores/ride-focus-store";

export type RidePackLookup = Pick<RidePackService, "keptPackForLine">;

export interface NoSignalRide {
  readonly noSignal: boolean;
  /** The kept ride this line belongs to, checked tile by tile; `null` otherwise. */
  readonly kept: RidePackRecord | null;
}

export function useNoSignalRide(
  store: StoreApi<RideFocusStore>,
  line: readonly Coordinate[],
  ridePacks: RidePackLookup | undefined,
): NoSignalRide {
  useEffect(() => {
    const update = (): void => store.getState().setNoSignal(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [store]);
  const noSignal = useStore(store, (state) => state.noSignal);
  const [kept, setKept] = useState<RidePackRecord | null>(null);
  useEffect(() => {
    if (!noSignal || ridePacks === undefined || line.length < 2) return;
    let live = true;
    void ridePacks.keptPackForLine(line).then((pack) => { if (live) setKept(pack); }, () => { if (live) setKept(null); });
    return () => { live = false; };
  }, [noSignal, ridePacks, line]);
  // A lookup from before signal came back, or for another line, is never shown.
  const active = noSignal && ridePacks !== undefined && line.length >= 2;
  return { noSignal, kept: active && kept !== null && kept.line.length === line.length ? kept : null };
}
