/**
 * The browser's ride safety: live sharing over this origin's `/api/live`, the
 * link kept in localStorage so a reload keeps sharing, and the battery level
 * when the browser reports one (Chromium does; Safari does not).
 */

import { createLiveShareSession } from "@/application/live/live-share";
import { LIVE_SESSION_STORAGE_KEY as STORAGE_KEY } from "@/application/live/storage-keys";
import { createRideSafety, type RideSafety } from "@/application/safety/ride-safety";


interface BatteryLike {
  readonly level: number;
}

export function createBrowserRideSafety(announce: (text: string) => void): RideSafety {
  let battery: BatteryLike | null = null;
  let askedBattery = false;
  const readBattery = (): number | null => {
    if (!askedBattery && typeof navigator !== "undefined") {
      askedBattery = true;
      const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
      void nav.getBattery?.().then((value) => { battery = value; }).catch(() => undefined);
    }
    return battery?.level ?? null;
  };
  return createRideSafety({
    live: createLiveShareSession({
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      setInterval: (work, ms) => window.setInterval(work, ms),
      clearInterval: (handle) => window.clearInterval(handle as number),
      storage: {
        read: () => {
          try {
            return window.localStorage.getItem(STORAGE_KEY);
          } catch {
            return null;
          }
        },
        write: (value) => {
          try {
            if (value === null) window.localStorage.removeItem(STORAGE_KEY);
            else window.localStorage.setItem(STORAGE_KEY, value);
          } catch {
            // A private window keeps the link for this page only.
          }
        },
      },
      battery: readBattery,
    }),
    announce,
  });
}
