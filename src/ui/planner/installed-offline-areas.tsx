"use client";

/**
 * The downloaded offline areas on this device, for the planner's briefing.
 *
 * The store behind them is infrastructure, and the UI may not reach into that;
 * the composition root builds it and provides it here. It is a context rather
 * than one more briefing prop because the planner workspace is a composition
 * root with a line budget, and the offline summary is not its responsibility.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { OfflineRegionsPort } from "@/application/offline/offline-regions";

/** Only the read the briefing needs; nothing here can change storage. */
export type InstalledOfflineAreas = Pick<OfflineRegionsPort, "installed">;

const InstalledOfflineAreasContext = createContext<InstalledOfflineAreas | undefined>(undefined);

export function InstalledOfflineAreasProvider({
  regions,
  children,
}: {
  readonly regions: InstalledOfflineAreas | undefined;
  readonly children: ReactNode;
}) {
  return (
    <InstalledOfflineAreasContext.Provider value={regions}>{children}</InstalledOfflineAreasContext.Provider>
  );
}

/** `undefined` when this surface was not given the store (unknown, never zero). */
export function useInstalledOfflineAreas(): InstalledOfflineAreas | undefined {
  return useContext(InstalledOfflineAreasContext);
}
