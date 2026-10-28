/**
 * Ride safety on the ride screen: the live "Follow my ride" link and crash
 * detection, held together because each needs the other. Crash detection runs
 * while the rider shares a live link (followers are who it alerts); a
 * suspicion opens the "Are you OK?" countdown, and only a countdown that runs
 * out (or "Alert now") reaches followers. Saying "I'm OK" after the alert went
 * out clears it on their page.
 *
 * The ride screen feeds it GPS fixes and motion samples and renders its
 * snapshot; nothing here touches the DOM, timers or the network directly.
 */

import type { LiveShareSession, LiveShareSnapshot } from "@/application/live/live-share";
import {
  createCrashAlertController,
  type CrashAlertController,
  type CrashAlertEvent,
  type CrashAlertScheduler,
  type CrashAlertSnapshot,
} from "@/application/safety/crash-alert";
import { createCrashDetector, type CrashDetector } from "@/domain/safety/crash-detector";
import type { LiveExpectedFinish, LiveRouteGeometry } from "@/domain/live/types";

export interface RideSafetySnapshot {
  readonly live: LiveShareSnapshot;
  readonly crash: CrashAlertSnapshot;
}

export interface RideSafetyFix {
  readonly atMs: number;
  readonly lat: number;
  readonly lon: number;
  readonly speedMps: number | null;
  readonly headingDeg: number | null;
  readonly accuracyM: number | null;
}

export interface RideSafety {
  /** The same object until something changes (safe for useSyncExternalStore). */
  snapshot(): RideSafetySnapshot;
  /** The countdown as of now, for a screen that ticks the seconds. */
  crashNow(): CrashAlertSnapshot;
  subscribe(listener: (snapshot: RideSafetySnapshot) => void): () => void;
  startSharing(input: {
    readonly riderName: string;
    readonly route?: LiveRouteGeometry | null;
    readonly plan?: LiveExpectedFinish | null;
  }): Promise<string | null>;
  stopSharing(): Promise<void>;
  acceptFix(fix: RideSafetyFix): void;
  acceptMotion(sample: { readonly atMs: number; readonly x: number; readonly y: number; readonly z: number }): void;
  imOkay(): void;
  alertNow(): void;
  imOkayNow(): void;
  /** After mount: restores a shared link and restarts sending. */
  restore(): void;
  /** Before unmount: stops timers and any countdown; `restore` starts again. */
  suspend(): void;
  dispose(): void;
}

export interface RideSafetyDeps {
  readonly live: LiveShareSession;
  readonly scheduler?: CrashAlertScheduler;
  readonly detector?: CrashDetector;
  /** Voice and vibration for the countdown; optional. */
  readonly announce?: (text: string) => void;
}

export function createRideSafety(deps: RideSafetyDeps): RideSafety {
  const detector = deps.detector ?? createCrashDetector();
  const listeners = new Set<(snapshot: RideSafetySnapshot) => void>();
  const now = (): number => deps.scheduler?.now() ?? Date.now();
  let current: RideSafetySnapshot | null = null;

  function snapshot(): RideSafetySnapshot {
    if (current === null) current = { live: deps.live.snapshot(), crash: controller.snapshot() };
    return current;
  }

  function emit(): void {
    current = null;
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function onEvent(event: CrashAlertEvent): void {
    switch (event.type) {
      case "countdown-started":
        deps.announce?.("Crash detected? Tap I'm OK, or your followers will be alerted in one minute.");
        break;
      case "dismissed":
        detector.dismiss(now());
        break;
      case "escalated":
        deps.announce?.("Alerting your followers with your location.");
        void deps.live.raiseAlert("possible-crash");
        break;
      case "cancelled-after-alert":
        detector.dismiss(now());
        void deps.live.clearAlert();
        break;
    }
    emit();
  }

  // Declared after the handlers it calls; they only run once it exists.
  const controller: CrashAlertController = createCrashAlertController({
    ...(deps.scheduler === undefined ? {} : { scheduler: deps.scheduler }),
    onEvent,
  });

  const unsubscribeLive = deps.live.subscribe(() => emit());
  const sharing = (): boolean => deps.live.snapshot().status === "sharing";

  return {
    snapshot,
    crashNow: () => controller.snapshot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startSharing: (input) => deps.live.start(input),
    async stopSharing() {
      controller.reset();
      detector.reset();
      await deps.live.finish();
      emit();
    },
    acceptFix(fix) {
      deps.live.accept(fix);
      if (!sharing()) return;
      for (const event of detector.pushFix({ atMs: fix.atMs, lat: fix.lat, lon: fix.lon, speedMps: fix.speedMps, accuracyM: fix.accuracyM })) {
        controller.suspect(event);
      }
    },
    acceptMotion(sample) {
      if (!sharing()) return;
      for (const event of detector.pushMotion(sample)) controller.suspect(event);
    },
    imOkay: () => { controller.dismiss(); },
    alertNow: () => { controller.alertNow(); },
    imOkayNow: () => { controller.cancelAfterAlert(); },
    restore() {
      deps.live.restore();
    },
    suspend() {
      controller.reset();
      deps.live.dispose();
      // Neither reset nor dispose publishes, so the cached snapshot would keep
      // reporting the countdown a torn-down screen no longer has.
      emit();
    },
    dispose() {
      unsubscribeLive();
      controller.dispose();
      deps.live.dispose();
      listeners.clear();
    },
  };
}
