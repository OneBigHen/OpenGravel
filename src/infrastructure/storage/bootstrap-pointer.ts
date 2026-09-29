/** The tiny localStorage fallback for bootstrapping the active IndexedDB draft. */

import type {
  BootstrapHintRead,
  BootstrapPointerHint,
  BootstrapPointerPort,
} from "@/application/persistence/ride-repository";

export const BOOTSTRAP_POINTER_KEY = "opengravel.vnext.bootstrap";

function isBootstrapPointerHint(value: unknown): value is BootstrapPointerHint {
  if (typeof value !== "object" || value === null) return false;
  const parsed = value as { version?: unknown; rideId?: unknown; updatedAt?: unknown };
  return (
    parsed.version === 1 &&
    typeof parsed.rideId === "string" &&
    parsed.rideId.startsWith("ride_") &&
    typeof parsed.updatedAt === "string"
  );
}

export function createLocalStorageBootstrapPointer(): BootstrapPointerPort {
  return {
    read(): BootstrapHintRead {
      if (typeof window === "undefined") return { status: "absent" };
      let value: string | null;
      try {
        value = window.localStorage.getItem(BOOTSTRAP_POINTER_KEY);
      } catch {
        // A locked-down or momentarily unavailable localStorage is a failed read, not
        // an empty cache: reporting `absent` here would let a caller drop a hint that
        // may still be perfectly good (5.1t finding A6).
        return { status: "unreadable" };
      }
      if (value === null) return { status: "absent" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { status: "corrupt" };
      }
      // A wrong shape is as unusable as unparseable text, and equally safe to drop.
      return isBootstrapPointerHint(parsed)
        ? { status: "found", hint: parsed }
        : { status: "corrupt" };
    },
    write(pointer: Pick<BootstrapPointerHint, "rideId" | "updatedAt">): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          BOOTSTRAP_POINTER_KEY,
          JSON.stringify({ version: 1, ...pointer }),
        );
      } catch {
        // IndexedDB remains authoritative when localStorage is unavailable.
      }
    },
    invalidate(): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(BOOTSTRAP_POINTER_KEY);
      } catch {
        // IndexedDB remains authoritative when localStorage is unavailable.
      }
    },
  };
}
