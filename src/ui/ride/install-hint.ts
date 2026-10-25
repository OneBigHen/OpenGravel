/**
 * Rules for the one "Add to Home Screen" hint on the ride screen. Pure so the
 * rules are testable without a browser.
 */

export const INSTALL_HINT_KEY = "og.ride.install-hint-dismissed";
/** The hint is only offered while a ride is starting, never mid-ride. */
export const INSTALL_HINT_WINDOW_MS = 10_000;

export interface InstallHintEnvironment {
  readonly userAgent: string;
  readonly platform?: string;
  readonly maxTouchPoints?: number;
  /** display-mode: standalone, navigator.standalone, or the iOS app shell. */
  readonly standalone: boolean;
  readonly dismissed: boolean;
}

function isIos(env: InstallHintEnvironment): boolean {
  return /iphone|ipad|ipod/i.test(env.userAgent) ||
    (env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1);
}

/** Safari itself, not Chrome / Firefox / Edge / in-app browsers on iOS. */
function isSafari(env: InstallHintEnvironment): boolean {
  return isIos(env) &&
    /safari/i.test(env.userAgent) &&
    !/crios|fxios|edgios|opios|gsa\/|instagram|fban|fbav|line\//i.test(env.userAgent);
}

export function shouldShowInstallHint(env: InstallHintEnvironment, msSinceRideStart: number): boolean {
  if (env.standalone || env.dismissed) return false;
  if (msSinceRideStart > INSTALL_HINT_WINDOW_MS) return false;
  return isSafari(env);
}

export function readInstallHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInstallHintDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_HINT_KEY, "1");
  } catch {
    // Not remembered; it only shows for 10 s at ride start anyway.
  }
}

export function readStandalone(): boolean {
  return (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.documentElement.dataset.native === "1";
}
