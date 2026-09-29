import type { Coordinate } from "@/domain/ride/types";
import { validateCoordinate } from "@/domain/ride/validate";

export const HOME_LOCATION_STORAGE_KEY = "opengravel.vnext.home-location.v1";

export type HomeLocationRead =
  | {
      readonly status: "found";
      readonly coordinate: Coordinate;
      /** The place's name when it was saved, so Settings can say which Home (RS-13). */
      readonly label: string | null;
    }
  | { readonly status: "absent" }
  | { readonly status: "invalid" }
  | { readonly status: "unreadable" };

export interface HomeLocationStoragePort {
  read(): HomeLocationRead;
  write(coordinate: Coordinate, label?: string | null): boolean;
  clear(): boolean;
}

export interface HomeLocationKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): HomeLocationKeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A local-only preference adapter; its coordinate is never a RideDocument intent. */
export function createHomeLocationStorage(
  storage: HomeLocationKeyValueStorage | null = browserStorage(),
): HomeLocationStoragePort {
  return {
    read(): HomeLocationRead {
      if (storage === null) return { status: "absent" };
      let encoded: string | null;
      try {
        encoded = storage.getItem(HOME_LOCATION_STORAGE_KEY);
      } catch {
        return { status: "unreadable" };
      }
      if (encoded === null) return { status: "absent" };
      let value: unknown;
      try {
        value = JSON.parse(encoded);
      } catch {
        return { status: "invalid" };
      }
      if (typeof value !== "object" || value === null || Array.isArray(value) ||
          validateCoordinate(value as Coordinate).length > 0) return { status: "invalid" };
      const coordinate = value as Coordinate & { readonly label?: unknown };
      const label = typeof coordinate.label === "string" && coordinate.label.trim() !== "" ? coordinate.label.trim() : null;
      return { status: "found", coordinate: { lon: coordinate.lon, lat: coordinate.lat }, label };
    },

    write(coordinate: Coordinate, label: string | null = null): boolean {
      if (storage === null || validateCoordinate(coordinate).length > 0) return false;
      try {
        const value = { lon: coordinate.lon, lat: coordinate.lat, ...(label === null || label.trim() === "" ? {} : { label: label.trim().slice(0, 120) }) };
        storage.setItem(HOME_LOCATION_STORAGE_KEY, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },

    clear(): boolean {
      if (storage === null) return false;
      try {
        storage.removeItem(HOME_LOCATION_STORAGE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}
