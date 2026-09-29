import {
  EMPTY_PLACE_MEMORY,
  parsePlaceMemory,
  recordRecent,
  toggleSaved,
  type PlaceMemory,
  type PlaceMemoryStore,
} from "@/application/geocoding/place-memory";

export const PLACE_MEMORY_STORAGE_KEY = "opengravel.vnext.place-memory.v1";

export interface PlaceMemoryKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): PlaceMemoryKeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createPlaceMemoryStore(
  storage: PlaceMemoryKeyValueStorage | null = browserStorage(),
): PlaceMemoryStore {
  const listeners = new Set<() => void>();
  let current: PlaceMemory | null = null;

  const load = (): PlaceMemory => {
    if (current !== null) return current;
    let loaded = EMPTY_PLACE_MEMORY;
    try {
      const encoded = storage?.getItem(PLACE_MEMORY_STORAGE_KEY) ?? null;
      if (encoded !== null) loaded = parsePlaceMemory(JSON.parse(encoded));
    } catch {
      // Unreadable or corrupt: start empty; the next write repairs it.
    }
    current = loaded;
    return loaded;
  };

  const commit = (next: PlaceMemory): void => {
    current = next;
    try {
      storage?.setItem(PLACE_MEMORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Full or blocked storage keeps the memory for this visit only.
    }
    listeners.forEach((listener) => listener());
  };

  return {
    read: load,
    record: (place) => commit(recordRecent(load(), place)),
    toggleSaved: (place) => commit(toggleSaved(load(), place)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
