/**
 * Small things that make the iOS app feel like an app, not a page in a frame
 * (UX rework 2, native polish). Everything here is a no-op in a browser.
 *
 * - Haptics: one delegated tap listener gives the controls that matter a
 *   physical answer (Start ride, Stop, a route choice, the sheet handle), keyed
 *   by their existing test ids so no component has to know about the phone.
 * - Turn haptic: a firm tap on each announced turn, felt through a jacket.
 */

type ImpactStyle = "LIGHT" | "MEDIUM" | "HEAVY";
type NotificationType = "SUCCESS" | "WARNING" | "ERROR";

interface HapticsPlugin {
  impact(options: { readonly style: ImpactStyle }): Promise<void>;
  notification(options: { readonly type: NotificationType }): Promise<void>;
  selectionChanged?(): Promise<void>;
}

interface CapacitorScope {
  readonly Capacitor?: {
    isNativePlatform?(): boolean;
    readonly Plugins?: { readonly Haptics?: HapticsPlugin };
  };
}

export type HapticKind = "light" | "medium" | "heavy" | "select" | "success" | "warning";

function hapticsPlugin(scope: unknown): HapticsPlugin | undefined {
  const capacitor = (scope as CapacitorScope | undefined)?.Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return undefined;
  const plugin = capacitor.Plugins?.Haptics;
  return typeof plugin?.impact === "function" && typeof plugin.notification === "function" ? plugin : undefined;
}

/** Plays one haptic; silently nothing outside the app. */
export function haptic(kind: HapticKind, scope: unknown = globalThis): void {
  const plugin = hapticsPlugin(scope);
  if (plugin === undefined) return;
  const played =
    kind === "success" ? plugin.notification({ type: "SUCCESS" })
    : kind === "warning" ? plugin.notification({ type: "WARNING" })
    : kind === "select" && plugin.selectionChanged !== undefined ? plugin.selectionChanged()
    : plugin.impact({ style: kind === "heavy" ? "HEAVY" : kind === "medium" ? "MEDIUM" : "LIGHT" });
  void played.catch(() => undefined);
}

/** Which controls answer a tap, and how. Prefix match on `data-testid`. */
const TAP_HAPTICS: readonly (readonly [string, HapticKind])[] = [
  ["start-ride", "medium"],
  ["ride-finish", "success"],
  ["ride-stop", "warning"],
  ["ride-resume", "medium"],
  ["ride-pause", "light"],
  ["advisor-apply", "medium"],
  ["head-home", "medium"],
  ["free-ride-loop-", "medium"],
  ["ride-reroute", "medium"],
  ["route-card-", "select"],
  ["sheet-handle", "light"],
  ["place-option", "light"],
  ["compose-create", "medium"],
];

export function hapticForTestId(testId: string | null): HapticKind | null {
  if (testId === null) return null;
  for (const [prefix, kind] of TAP_HAPTICS) {
    if (testId === prefix || (prefix.endsWith("-") && testId.startsWith(prefix)) || testId.startsWith(`${prefix}-`)) return kind;
  }
  return null;
}

/**
 * Installs the delegated tap haptics once per page. Returns the uninstaller,
 * or `null` in a browser.
 */
export function installTapHaptics(scope: unknown = globalThis): (() => void) | null {
  if (hapticsPlugin(scope) === undefined) return null;
  const documentRef = (scope as { readonly document?: Document }).document;
  if (documentRef === undefined) return null;
  const onClick = (event: Event): void => {
    const target = event.target as Element | null;
    const control = target?.closest?.("[data-testid]");
    if (control === null || control === undefined || (control as HTMLButtonElement).disabled === true) return;
    const kind = hapticForTestId(control.getAttribute("data-testid"));
    if (kind !== null) haptic(kind, scope);
  };
  documentRef.addEventListener("click", onClick, { capture: true });
  return () => documentRef.removeEventListener("click", onClick, { capture: true });
}
