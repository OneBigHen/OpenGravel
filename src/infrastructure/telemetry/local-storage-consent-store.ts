/**
 * Local-storage telemetry consent store (Task 11.4; 11 §14).
 *
 * Mirrors the envelope style of the storage bootstrap pointer: `absent` when
 * nothing is stored, `unreadable` when storage itself fails, `corrupt` when
 * the record is malformed. A corrupt or unreadable record is never treated as
 * an acknowledgement — the gate stays off.
 */

import type { TelemetryConsentState } from "@/application/telemetry/consent";
import type {
  TelemetryConsentRead,
  TelemetryConsentStore,
} from "@/application/telemetry/ports/telemetry-consent-store";

/** The minimal storage surface this adapter needs. */
export interface TelemetryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const TELEMETRY_CONSENT_STORAGE_KEY = "opengravel.vnext.telemetry-consent";

function defaultStorage(): TelemetryStorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function parseConsentRecord(raw: string): TelemetryConsentRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { status: "corrupt" };
  }
  const record = parsed as {
    status?: unknown;
    acknowledgedAt?: unknown;
    policyVersion?: unknown;
  };
  if (record.status === "acknowledged") {
    if (
      typeof record.acknowledgedAt !== "string" ||
      typeof record.policyVersion !== "number"
    ) {
      return { status: "corrupt" };
    }
    return {
      status: "found",
      state: {
        status: "acknowledged",
        acknowledgedAt: record.acknowledgedAt,
        policyVersion: record.policyVersion,
      },
    };
  }
  if (record.status === "unacknowledged") {
    return { status: "found", state: { status: "unacknowledged" } };
  }
  return { status: "corrupt" };
}

export function createLocalStorageTelemetryConsentStore(
  storage: TelemetryStorageLike | null = defaultStorage(),
): TelemetryConsentStore {
  return {
    read(): TelemetryConsentRead {
      try {
        if (storage === null) return { status: "absent" };
        const raw = storage.getItem(TELEMETRY_CONSENT_STORAGE_KEY);
        return raw === null ? { status: "absent" } : parseConsentRecord(raw);
      } catch {
        return { status: "unreadable" };
      }
    },
    write(state: TelemetryConsentState): void {
      try {
        storage?.setItem(TELEMETRY_CONSENT_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Fail closed: the service gate stays off when nothing can persist.
      }
    },
    clear(): void {
      try {
        storage?.removeItem(TELEMETRY_CONSENT_STORAGE_KEY);
      } catch {
        // Fail closed: the service gate never reopens on its own.
      }
    },
  };
}
