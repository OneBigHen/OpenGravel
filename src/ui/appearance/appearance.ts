/**
 * Day / Night display.
 *
 * The rider picks Auto, Day or Night in Settings; Auto follows the phone. The
 * choice resolves to `data-theme="day" | "night"` on <html>, which is all the
 * stylesheet reads (theme-glass.css). The same resolution runs as an inline
 * script before first paint, so a Day rider never sees a dark flash.
 *
 * While a ride is open, Auto also follows the *sky*: the ride knows where the
 * rider is, so {@link applyResolvedTheme} is driven from the sun's own state at
 * that coordinate (`src/ui/ride/RideFocus.tsx`). A manual Day or Night is never
 * overridden, and the ride puts Auto back on the phone's setting when it closes.
 */

import { APPEARANCE_STORAGE_KEY } from "@/application/persistence/local-data-keys";

export type AppearanceMode = "auto" | "day" | "night";
export type ResolvedTheme = "day" | "night";

/** Registry-owned so a device wipe removes the rider's choice too. */
export { APPEARANCE_STORAGE_KEY };

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

export function resolveTheme(mode: AppearanceMode, systemPrefersLight: boolean): ResolvedTheme {
  if (mode === "auto") return systemPrefersLight ? "day" : "night";
  return mode;
}

export function readAppearanceMode(): AppearanceMode {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearanceMode(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/** The phone's own light/dark setting (what Auto follows outside a ride). */
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
  return applyResolvedTheme(resolveTheme(mode, systemPrefersLight()));
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
 * theme colour, and keeps Auto in step with the phone's light/dark switch.
 * Kept in plain ES5 because it runs before any bundle.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){
var K=${JSON.stringify(APPEARANCE_STORAGE_KEY)},C=${JSON.stringify(THEME_COLOR)};
function mode(){try{var m=localStorage.getItem(K);return m==="day"||m==="night"?m:"auto"}catch(e){return "auto"}}
var q=window.matchMedia?window.matchMedia("(prefers-color-scheme: light)"):null;
function apply(){var m=mode(),t=m==="auto"?(q&&q.matches?"day":"night"):m;document.documentElement.dataset.theme=t;var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",C[t]);}
apply();
if(q){if(q.addEventListener)q.addEventListener("change",apply);else if(q.addListener)q.addListener(apply);}
document.addEventListener("DOMContentLoaded",apply);
})();`;
