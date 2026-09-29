/**
 * The browser Ride Focus environment
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §3, §7, §8, §25;
 * `src/infrastructure/ride/browser-ride-environment.ts`).
 *
 * This adapter is the only place the product touches `navigator.wakeLock`,
 * `navigator.permissions` and `speechSynthesis`, so its contract is asserted
 * against doubles rather than a browser: the wake lock is attempted only while a
 * ride is physically active and released on pause, the platform's own release
 * (hiding the tab) is re-acquired on the way back, and every outcome is one of
 * the states the surface prints — including `unsupported`, which is a different
 * sentence to the rider than `failed` (8 §25).
 */

import { describe, expect, it, vi } from "vitest";

import {
  createBrowserRideEnvironment,
  type RideEnvironmentDocument,
} from "@/infrastructure/ride/browser-ride-environment";
import type { RideFocusEnvironmentSnapshot } from "@/application/ride-session/ports/ride-focus-environment";

interface SentinelDouble extends WakeLockSentinel {
  readonly releases: number;
  fire(type: "release"): void;
}

function sentinel(): SentinelDouble {
  const listeners = new Set<() => void>();
  let releases = 0;
  const value = {
    released: false,
    onrelease: null,
    addEventListener: (_type: "release", listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "release", listener: () => void): void => {
      listeners.delete(listener);
    },
    dispatchEvent: (): boolean => true,
    release: async (): Promise<void> => {
      releases += 1;
    },
    fire: (type: "release"): void => {
      if (type !== "release") return;
      for (const listener of listeners) listener();
    },
  };
  Object.defineProperty(value, "releases", { get: () => releases });
  Object.defineProperty(value, "released", { get: () => releases > 0 });
  return value as unknown as SentinelDouble;
}

function visibilityDocument(initialHidden = false): RideEnvironmentDocument & {
  setHidden(hidden: boolean): void;
} {
  const listeners = new Set<() => void>();
  let hidden = initialHidden;
  return {
    get hidden() {
      return hidden;
    },
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
    setHidden(next: boolean): void {
      hidden = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Lets the adapter's promisy internals settle without a fake clock. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("wake lock (08 §8)", () => {
  it("is unsupported when the browser has no Screen Wake Lock API", async () => {
    const environment = createBrowserRideEnvironment({ browser: {}, document: null });

    expect(environment.snapshot().wakeLock).toBe("unsupported");
    environment.setRideActive(true);
    await settle();
    expect(environment.snapshot().wakeLock).toBe("unsupported");

    environment.dispose();
  });

  it("holds the lock only while a ride is active", async () => {
    const held = sentinel();
    const request = vi.fn(async () => held as WakeLockSentinel);
    const release = vi.spyOn(held, "release");
    const environment = createBrowserRideEnvironment({
      browser: { wakeLock: { request } as unknown as WakeLock },
      document: null,
    });

    expect(environment.snapshot().wakeLock).toBe("off");
    environment.setRideActive(true);
    await settle();
    expect(request).toHaveBeenCalledWith("screen");
    expect(environment.snapshot().wakeLock).toBe("active");

    // Pause, completion and abandonment all arrive here: 8 §8 releases the lock
    // on every one of them.
    environment.setRideActive(false);
    await settle();
    expect(release).toHaveBeenCalled();
    expect(environment.snapshot().wakeLock).toBe("off");

    environment.dispose();
  });

  it("reports a refusal as failed, without throwing or ending the ride", async () => {
    const environment = createBrowserRideEnvironment({
      browser: {
        wakeLock: {
          request: async () => {
            throw new Error("the platform refused");
          },
        } as unknown as WakeLock,
      },
      document: null,
    });

    environment.setRideActive(true);
    await settle();

    expect(environment.snapshot().wakeLock).toBe("failed");
    environment.dispose();
  });

  it("re-acquires the lock when the rider comes back to the tab", async () => {
    const documentLike = visibilityDocument();
    let acquisitions = 0;
    const environment = createBrowserRideEnvironment({
      browser: {
        wakeLock: {
          request: async () => {
            acquisitions += 1;
            return sentinel() as unknown as WakeLockSentinel;
          },
        } as unknown as WakeLock,
      },
      document: documentLike,
    });

    environment.setRideActive(true);
    await settle();
    expect(environment.snapshot().wakeLock).toBe("active");

    // The platform drops the lock when the page is hidden; the ride is still on,
    // so the adapter must ask again on return.
    documentLike.setHidden(true);
    expect(environment.snapshot().wakeLock).toBe("off");

    documentLike.setHidden(false);
    await settle();
    expect(environment.snapshot().wakeLock).toBe("active");
    expect(acquisitions).toBe(2);

    environment.dispose();
  });

  it("releases on dispose and stops notifying after it", async () => {
    const held = sentinel();
    const environment = createBrowserRideEnvironment({
      browser: { wakeLock: { request: async () => held } as unknown as WakeLock },
      document: null,
    });
    const seen: RideFocusEnvironmentSnapshot[] = [];
    environment.subscribe((snapshot) => seen.push(snapshot));

    environment.setRideActive(true);
    await settle();
    const before = seen.length;
    environment.dispose();
    await settle();

    expect(seen.length).toBe(before);
    expect(environment.snapshot().wakeLock).toBe("off");
  });
});

describe("location permission (08 §3)", () => {
  it("is unsupported when the device has no geolocation at all", async () => {
    const environment = createBrowserRideEnvironment({ browser: {}, document: null });
    await settle();

    expect(environment.snapshot().locationPermission).toBe("unsupported");
    await expect(environment.requestLocationPermission()).resolves.toBe("unsupported");
    environment.dispose();
  });

  it("reads the browser's own permission without prompting", async () => {
    const environment = createBrowserRideEnvironment({
      browser: {
        geolocation: {} as Geolocation,
        permissions: {
          query: async () => ({ state: "denied", onchange: null }),
        } as unknown as Permissions,
      },
      document: null,
    });
    await settle();

    expect(environment.snapshot().locationPermission).toBe("denied");
    environment.dispose();
  });

  it("says unknown when the permission cannot be queried", async () => {
    const environment = createBrowserRideEnvironment({
      browser: {
        geolocation: {} as Geolocation,
        permissions: {
          query: async () => {
            throw new Error("unsupported query");
          },
        } as unknown as Permissions,
      },
      document: null,
    });
    await settle();

    expect(environment.snapshot().locationPermission).toBe("unknown");
    environment.dispose();
  });

  it("turns a refused prompt into a denied state, and a granted one into granted", async () => {
    const denied = createBrowserRideEnvironment({
      browser: {
        geolocation: {
          getCurrentPosition: (_ok, fail) => {
            fail?.({
              code: 1,
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            } as GeolocationPositionError);
          },
        } as Geolocation,
      },
      document: null,
    });

    await expect(denied.requestLocationPermission()).resolves.toBe("denied");
    expect(denied.snapshot().locationPermission).toBe("denied");
    denied.dispose();

    const granted = createBrowserRideEnvironment({
      browser: {
        geolocation: {
          getCurrentPosition: (ok) => {
            ok?.({} as GeolocationPosition);
          },
        } as Geolocation,
        permissions: {
          query: async () => ({ state: "granted", onchange: null }),
        } as unknown as Permissions,
      },
      document: null,
    });

    await expect(granted.requestLocationPermission()).resolves.toBe("granted");
    expect(granted.snapshot().locationPermission).toBe("granted");
    granted.dispose();
  });

  it("never asks the web view for location when the app's native watcher owns it (DV-05)", async () => {
    const getCurrentPosition = vi.fn();
    const environment = createBrowserRideEnvironment({
      nativeLocation: true,
      browser: { geolocation: { getCurrentPosition } as unknown as Geolocation },
      document: null,
    });

    await environment.requestLocationPermission();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    environment.dispose();
  });

  it("treats a timeout as not-a-denial", async () => {
    const environment = createBrowserRideEnvironment({
      browser: {
        geolocation: {
          getCurrentPosition: (_ok, fail) => {
            fail?.({
              code: 3,
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            } as GeolocationPositionError);
          },
        } as Geolocation,
        permissions: {
          query: async () => ({ state: "prompt", onchange: null }),
        } as unknown as Permissions,
      },
      document: null,
    });
    await settle();

    await expect(environment.requestLocationPermission()).resolves.toBe("prompt");
    environment.dispose();
  });
});

describe("speech (08 §7)", () => {
  it("reports ready when the browser can speak and unsupported when it cannot", () => {
    const ready = createBrowserRideEnvironment({
      browser: { speechSynthesis: {} as SpeechSynthesis },
      document: null,
    });
    expect(ready.snapshot().speech).toBe("ready");
    ready.dispose();

    const unsupported = createBrowserRideEnvironment({ browser: {}, document: null });
    expect(unsupported.snapshot().speech).toBe("unsupported");
    unsupported.dispose();
  });
});

describe("subscription", () => {
  it("delivers the current snapshot at subscription time", () => {
    const environment = createBrowserRideEnvironment({
      browser: { speechSynthesis: {} as SpeechSynthesis },
      document: null,
    });
    const listener = vi.fn();
    const unsubscribe = environment.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ speech: "ready", wakeLock: "unsupported" });

    unsubscribe();
    environment.dispose();
  });
});
