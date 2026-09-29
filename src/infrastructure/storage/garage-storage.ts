import { createGarage, garageIsValid } from "@/application/garage/garage-model";
import type { GarageStoragePort } from "@/application/garage/garage-storage";

export interface GarageStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const GARAGE_STORAGE_KEY = "opengravel.vnext.garage.v1";

function defaultStorage(): GarageStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageGarageStorage(
  storage: GarageStorageLike | null = defaultStorage(),
): GarageStoragePort {
  return {
    read() {
      try {
        const raw = storage?.getItem(GARAGE_STORAGE_KEY);
        if (raw === null || raw === undefined) return createGarage();
        const parsed: unknown = JSON.parse(raw);
        return garageIsValid(parsed) ? parsed : createGarage();
      } catch {
        return createGarage();
      }
    },
    write(garage) {
      try {
        storage?.setItem(GARAGE_STORAGE_KEY, JSON.stringify(garage));
      } catch {
        // Browser storage can be disabled or full; garage remains usable in memory.
      }
    },
    clear() {
      try {
        storage?.removeItem(GARAGE_STORAGE_KEY);
      } catch {
        // Deletion remains best effort when browser storage is unavailable.
      }
    },
  };
}
