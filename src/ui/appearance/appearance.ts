/**
 * Day / Night display.
 *
 * The rider picks Auto, Day or Night in Settings. Auto follows the sun at the
 * rider's place, in the whole app (round 3, restructure call 7): day from sunrise
 * to sunset, using the solar calculation the ride already has. Until the
 * rider's place is known, Auto follows the phone's light/dark setting. The
 * choice resolves to `data-theme="day" | "night"` on <html>, which is all the
 * stylesheet reads (theme-glass.css). The same resolution runs as an inline
 * script before first paint, so a Day rider never sees a dark flash.
 *
 * While a ride is open, the ride drives {@link applyResolvedTheme} from the sun
 * at its own live fix (`src/ui/ride/RideFocus.tsx`); everywhere else
 * `AppearanceSun` does it from the rider's last known place, which is kept
 * (rounded to about 10 km) so the pre-paint script can open in the same theme.
 * A manual Day or Night is never overridden.
 */

import { sunriseOnDepartureDay, sunsetOnDepartureDay, sunState } from "@/application/long-trip";
import {
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_SUN_STORAGE_KEY,
} from "@/application/persistence/local-data-keys";
import type { Coordinate } from "@/domain/ride/types";

export type AppearanceMode = "auto" | "day" | "night";
export type ResolvedTheme = "day" | "night";

/** Registry-owned so a device wipe removes the rider's choice too. */
export { APPEARANCE_STORAGE_KEY, APPEARANCE_SUN_STORAGE_KEY };

/** The rider changed mode, Day or Night. */
export const APPEARANCE_CHANGE_EVENT = "og-appearance-change";

/**
 * `data-theme` changed, whoever decided it: the phone, the rider's choice, or
 * the sun during a ride. A surface that draws with the theme (the ride's map
 * look) listens to this instead of guessing from a mode.
 */
export const THEME_CHANGE_EVENT = "og-theme-change";

/** The browser chrome colour for each theme (status bar, PWA title bar). */
export const THEME_COLOR: Readonly<Record<ResolvedTheme, string>> = {
  day: "#F3F5F2",
  night: "#0B100E",
};

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "auto" || value === "day" || value === "night";
}

/**
 * The theme for a mode. Auto is the sun's answer at the rider's place when there
 * is one, else the phone's setting; Day and Night are the rider's own.
 */
export function resolveTheme(
  mode: AppearanceMode,
  systemPrefersLight: boolean,
  sun: ResolvedTheme | null = null,
): ResolvedTheme {
  if (mode === "auto") return sun ?? (systemPrefersLight ? "day" : "night");
  return mode;
}

/** The sun's theme at a place, and the instant it next changes. */
export interface SunTheme {
  readonly theme: ResolvedTheme;
  readonly untilMs: number;
}

const HOUR_MS = 3_600_000;

/**
 * Day from sunrise to sunset at `place`, from the same NOAA calculation the
 * ride uses (`sunState`). `null`, never a guess, when the sun gives no answer
 * there (a polar day or night): the caller then follows the phone.
 */
export function sunTheme(place: Coordinate, nowMs: number): SunTheme | null {
  const theme = sunState(place, nowMs);
  if (theme === null) return null;
  const crossing = (event: "sunrise" | "sunset", atMs: number): number | null => {
    const at = new Date(atMs).toISOString();
    const iso = event === "sunrise" ? sunriseOnDepartureDay(place, at) : sunsetOnDepartureDay(place, at)?.sunset ?? null;
    const ms = iso === null ? Number.NaN : Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  };
  const candidates = [
    crossing("sunrise", nowMs),
    crossing("sunset", nowMs),
    crossing("sunrise", nowMs + 24 * HOUR_MS),
  ].filter((ms): ms is number => ms !== null && ms > nowMs);
  // Re-checked at least hourly, so a slightly-off crossing never sticks.
  const untilMs = Math.min(nowMs + HOUR_MS, ...candidates);
  return { theme, untilMs };
}

interface StoredSun {
  readonly lat: number;
  readonly lon: number;
}

function readRiderPlace(): Coordinate | null {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_SUN_STORAGE_KEY);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Partial<StoredSun> | null;
    if (value === null || typeof value.lat !== "number" || typeof value.lon !== "number") return null;
    if (!Number.isFinite(value.lat) || !Number.isFinite(value.lon)) return null;
    return { lat: value.lat, lon: value.lon };
  } catch {
    return null;
  }
}

function writeSun(place: Coordinate, sun: SunTheme | null): void {
  try {
    window.localStorage.setItem(
      APPEARANCE_SUN_STORAGE_KEY,
      JSON.stringify(
        sun === null
          ? { lat: place.lat, lon: place.lon }
          : { lat: place.lat, lon: place.lon, theme: sun.theme, until: sun.untilMs },
      ),
    );
  } catch {
    // Storage blocked: Auto still follows the sun for this visit.
  }
}

let memoryPlace: Coordinate | null = null;

/** The sun's theme at the rider's last known place, or `null` before one is known. */
export function riderSunTheme(nowMs: number = Date.now()): ResolvedTheme | null {
  const place = memoryPlace ?? (typeof window === "undefined" ? null : readRiderPlace());
  if (place === null) return null;
  const sun = sunTheme(place, nowMs);
  writeSun(place, sun);
  return sun?.theme ?? null;
}

/**
 * Remember where the rider is (rounded to 0.1°, about 10 km: enough for the sun,
 * not a home address) and re-apply Auto.
 */
export function rememberRiderPlace(position: Coordinate): void {
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return;
  memoryPlace = { lat: Math.round(position.lat * 10) / 10, lon: Math.round(position.lon * 10) / 10 };
  writeSun(memoryPlace, sunTheme(memoryPlace, Date.now()));
}

/** Test seam: forget the remembered place. */
export function forgetRiderPlace(): void {
  memoryPlace = null;
}

export function readAppearanceMode(): AppearanceMode {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearanceMode(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/** The phone's own light/dark setting (what Auto follows before the rider's place is known). */
export function systemPrefersLight(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** The theme on screen now; `day` before anything has been applied. */
export function readResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "day";
  return document.documentElement.dataset["theme"] === "night" ? "night" : "day";
}

/**
 * Puts a resolved theme on the document and tells every listener. Separate
 * from the mode because a ride can resolve Auto from the sun rather than from
 * the phone, and a stored mode would make that a permanent choice.
 */
export function applyResolvedTheme(theme: ResolvedTheme): ResolvedTheme {
  if (typeof document !== "undefined") {
    document.documentElement.dataset["theme"] = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", THEME_COLOR[theme]);
    });
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  }
  return theme;
}

export function applyAppearance(mode: AppearanceMode): ResolvedTheme {
  return applyResolvedTheme(resolveTheme(mode, systemPrefersLight(), mode === "auto" ? riderSunTheme() : null));
}

export function setAppearanceMode(mode: AppearanceMode): void {
  try {
    if (mode === "auto") window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    else window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  applyAppearance(mode);
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: mode }));
}

/**
 * The pre-paint script: resolves the stored mode, sets data-theme and the
 * theme colour. Auto uses the sun's theme kept for the rider's place while it
 * is still current, else the phone's light/dark switch.
 * Kept in plain ES5 because it runs before any bundle.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){
var K=${JSON.stringify(APPEARANCE_STORAGE_KEY)},S=${JSON.stringify(APPEARANCE_SUN_STORAGE_KEY)},C=${JSON.stringify(THEME_COLOR)};
function mode(){try{var m=localStorage.getItem(K);return m==="day"||m==="night"?m:"auto"}catch(e){return "auto"}}
function sun(){try{var v=JSON.parse(localStorage.getItem(S)||"null");return v&&(v.theme==="day"||v.theme==="night")&&typeof v.until==="number"&&v.until>Date.now()?v.theme:null}catch(e){return null}}
var q=window.matchMedia?window.matchMedia("(prefers-color-scheme: light)"):null;
function apply(){var m=mode(),t=m==="auto"?(sun()||(q&&q.matches?"day":"night")):m;document.documentElement.dataset.theme=t;var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",C[t]);}
apply();
if(q){if(q.addEventListener)q.addEventListener("change",apply);else if(q.addListener)q.addListener(apply);}
document.addEventListener("DOMContentLoaded",apply);
})();`;
