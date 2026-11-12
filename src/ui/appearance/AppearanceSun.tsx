"use client";

/**
 * Keeps Auto on the sun at the rider's place, on every page (round 3,
 * restructure call 7).
 *
 * Nothing is asked for: the rider's place is read only when this device has
 * already granted location (as `useRiderOrigin` does), or comes from the ride.
 * Before a place is known Auto stays on the phone's own setting. A minute's
 * check turns the theme at sunrise and sunset; it acts only when the sun's
 * answer changes, so it never fights the ride, which follows its live fix.
 */

import { useEffect } from "react";

import {
  APPEARANCE_CHANGE_EVENT,
  applyResolvedTheme,
  readAppearanceMode,
  readResolvedTheme,
  rememberRiderPlace,
  riderSunTheme,
  type ResolvedTheme,
} from "./appearance";

const CHECK_MS = 60_000;

export function AppearanceSun(): null {
  useEffect(() => {
    let last: ResolvedTheme | null = null;
    const check = (): void => {
      if (readAppearanceMode() !== "auto") {
        last = null;
        return;
      }
      const sun = riderSunTheme();
      if (sun === null || sun === last) return;
      last = sun;
      if (readResolvedTheme() !== sun) applyResolvedTheme(sun);
    };
    check();
    const timer = window.setInterval(check, CHECK_MS);
    window.addEventListener(APPEARANCE_CHANGE_EVENT, check);

    let cancelled = false;
    if (typeof navigator !== "undefined" && navigator.permissions?.query !== undefined && navigator.geolocation) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((status) => {
          if (cancelled || status.state !== "granted") return;
          navigator.geolocation.getCurrentPosition(
            (position) => {
              if (cancelled) return;
              rememberRiderPlace({ lon: position.coords.longitude, lat: position.coords.latitude });
              last = null;
              check();
            },
            () => undefined,
            { enableHighAccuracy: false, maximumAge: 3_600_000, timeout: 10_000 },
          );
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, check);
    };
  }, []);
  return null;
}
