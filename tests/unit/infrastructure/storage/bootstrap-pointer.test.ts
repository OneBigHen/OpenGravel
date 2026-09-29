import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOOTSTRAP_POINTER_KEY,
  createLocalStorageBootstrapPointer,
} from "@/infrastructure/storage/bootstrap-pointer";
import { createRideDocument } from "@/domain/ride/create";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(BOOTSTRAP_POINTER_KEY);
});

describe("localStorage bootstrap pointer", () => {
  it("stores only the active ride id, never the ride document", () => {
    const pointer = createLocalStorageBootstrapPointer();
    const document = createRideDocument();

    pointer.write({ rideId: document.rideId, updatedAt: document.updatedAt });

    expect(localStorage.getItem(BOOTSTRAP_POINTER_KEY)).toContain('"version":1');
    expect(localStorage.getItem(BOOTSTRAP_POINTER_KEY)).not.toContain("intent");
    expect(pointer.read()).toEqual({
      status: "found",
      hint: {
        version: 1,
        rideId: document.rideId,
        updatedAt: document.updatedAt,
      },
    });
  });

  it("reports an absent hint as absent and can invalidate it", () => {
    const pointer = createLocalStorageBootstrapPointer();

    expect(pointer.read()).toEqual({ status: "absent" });
    localStorage.setItem(BOOTSTRAP_POINTER_KEY, "anything");
    pointer.invalidate();
    expect(localStorage.getItem(BOOTSTRAP_POINTER_KEY)).toBeNull();
  });

  it("reports an unusable cache as corrupt so the caller can drop it", () => {
    const pointer = createLocalStorageBootstrapPointer();
    const unusable = [
      "not-json",
      JSON.stringify({ version: 2, rideId: "ride_x", updatedAt: "2026-09-17T12:00:00.000Z" }),
      JSON.stringify({ version: 1, rideId: "not-a-ride", updatedAt: "2026-09-17T12:00:00.000Z" }),
      JSON.stringify({ version: 1, rideId: "ride_x" }),
    ];

    for (const value of unusable) {
      localStorage.setItem(BOOTSTRAP_POINTER_KEY, value);
      expect(pointer.read()).toEqual({ status: "corrupt" });
    }
  });

  it("distinguishes a store it cannot read from a hint that is not there", () => {
    const pointer = createLocalStorageBootstrapPointer();
    const document = createRideDocument();
    pointer.write({ rideId: document.rideId, updatedAt: document.updatedAt });
    // jsdom's Storage is a proxy: `vi.spyOn(localStorage, "getItem")` lands inside the
    // store as an item instead of replacing the method, so the failure is injected on
    // the prototype the instance really reads through.
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = (): string | null => {
      throw new DOMException("access denied", "SecurityError");
    };

    try {
      // "I could not read it" is not "there is nothing there": the caller keeps the
      // hint and can try again on the next boot (5.1t finding A6).
      expect(pointer.read()).toEqual({ status: "unreadable" });
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }

    expect(pointer.read()).toMatchObject({
      status: "found",
      hint: { rideId: document.rideId },
    });
  });

  it("swallows a write failure instead of failing the caller who is saving", () => {
    const pointer = createLocalStorageBootstrapPointer();
    const document = createRideDocument();
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = (): void => {
      throw new DOMException("quota", "QuotaExceededError");
    };

    try {
      expect(() =>
        pointer.write({ rideId: document.rideId, updatedAt: document.updatedAt }),
      ).not.toThrow();
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
