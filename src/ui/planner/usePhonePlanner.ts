import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 760px)";
/**
 * The desktop plan tier. It matches the wide composition in `globals.css`, where
 * the planning rail and the ride inspector are sibling columns and the map keeps
 * only the Layers control; between 761 and 1180 px the surface is the tablet's
 * sheet, which is not this tier.
 */
export const DESKTOP_QUERY = "(min-width: 1181px)";

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** True on a phone-width viewport; false where matchMedia does not exist. */
export function isPhoneViewport(): boolean {
  return matches(PHONE_QUERY);
}

/** True on the desktop plan tier (≥ 1181 px); false where matchMedia does not exist. */
export function isDesktopViewport(): boolean {
  return matches(DESKTOP_QUERY);
}

function subscribeTo(query: string) {
  return (changed: () => void): (() => void) => {
    if (typeof window.matchMedia !== "function") return () => undefined;
    const media = window.matchMedia(query);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  };
}

// One stable subscriber per tier: a new function identity per render would make
// `useSyncExternalStore` tear down and re-add its listener every time.
const subscribePhone = subscribeTo(PHONE_QUERY);
const subscribeDesktop = subscribeTo(DESKTOP_QUERY);

export function usePhonePlanner(): boolean {
  return useSyncExternalStore(subscribePhone, isPhoneViewport, () => false);
}

export function useDesktopPlanner(): boolean {
  return useSyncExternalStore(subscribeDesktop, isDesktopViewport, () => false);
}

// Short landscape retains the existing rail, matching the composition in CSS.
const COMPACT_QUERY = "(max-width: 1180px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))";
const subscribeCompact = subscribeTo(COMPACT_QUERY);
export function isCompactViewport(): boolean { return matches(COMPACT_QUERY); }
export function useCompactPlanner(): boolean {
  return useSyncExternalStore(subscribeCompact, isCompactViewport, () => false);
}
