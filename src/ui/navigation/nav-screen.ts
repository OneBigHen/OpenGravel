/**
 * Which screen guides a ride in the iPhone app (owner 2026-09-29: "address the
 * iPhone nav screen vs what we built, and cut over or give an option").
 *
 * - `opengravel`: our Ride Focus (map, maneuver card, three-stat strip,
 *   Places, Fuel ahead). Ferrostar still runs underneath, without a screen:
 *   it owns GPS, turn timing, the voice and the Lock Screen.
 * - `native`: Ferrostar's own navigation screen, presented over the app.
 *
 * Only the app offers the choice; the browser always uses Ride Focus.
 */

export type NavScreen = "opengravel" | "native";

export const NAV_SCREEN_STORAGE_KEY = "og-nav-screen";
export const NAV_SCREEN_CHANGE_EVENT = "og-nav-screen-change";
export const DEFAULT_NAV_SCREEN: NavScreen = "opengravel";

export function isNavScreen(value: unknown): value is NavScreen {
  return value === "opengravel" || value === "native";
}

export function readNavScreen(): NavScreen {
  try {
    const stored = globalThis.localStorage?.getItem(NAV_SCREEN_STORAGE_KEY);
    return isNavScreen(stored) ? stored : DEFAULT_NAV_SCREEN;
  } catch {
    return DEFAULT_NAV_SCREEN;
  }
}

export function setNavScreen(screen: NavScreen): void {
  try {
    if (screen === DEFAULT_NAV_SCREEN) globalThis.localStorage?.removeItem(NAV_SCREEN_STORAGE_KEY);
    else globalThis.localStorage?.setItem(NAV_SCREEN_STORAGE_KEY, screen);
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
  globalThis.dispatchEvent?.(new CustomEvent(NAV_SCREEN_CHANGE_EVENT, { detail: screen }));
}
