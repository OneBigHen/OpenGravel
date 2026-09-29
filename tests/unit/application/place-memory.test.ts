import { describe, expect, it } from "vitest";

import {
  EMPTY_PLACE_MEMORY,
  isSaved,
  MAX_RECENT_PLACES,
  parsePlaceMemory,
  recordRecent,
  rememberedPlaces,
  toggleSaved,
} from "@/application/geocoding/place-memory";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { createPlaceMemoryStore, PLACE_MEMORY_STORAGE_KEY } from "@/infrastructure/storage/place-memory-storage";

/** NV-02: recents, saved places and Home, local to the device. */
function place(name: string, lat: number, context = "Lehigh County, PA"): PlaceMatch {
  return { id: `fixture:${name}`, label: `${name}, PA`, name, context, coordinate: { lat, lon: -75.5 }, provider: "fixture" };
}

const DINER = place("Blue Comet Diner", 40.6);
const GAP = place("Delaware Water Gap", 40.97, "Monroe County, PA");

describe("place memory", () => {
  it("keeps recents newest first, once each, and bounded", () => {
    let memory = recordRecent(recordRecent(EMPTY_PLACE_MEMORY, DINER), GAP);
    memory = recordRecent(memory, { ...DINER, id: "photon:other-id" });
    expect(memory.recents.map((entry) => entry.name)).toEqual(["Blue Comet Diner", "Delaware Water Gap"]);
    for (let index = 0; index < 20; index += 1) memory = recordRecent(memory, place(`P${index}`, 41 + index * 0.01));
    expect(memory.recents).toHaveLength(MAX_RECENT_PLACES);
  });

  it("stars and unstars a place by where it is", () => {
    const saved = toggleSaved(EMPTY_PLACE_MEMORY, DINER);
    expect(isSaved(saved, { lat: 40.60001, lon: -75.5 })).toBe(true);
    expect(isSaved(toggleSaved(saved, DINER), DINER.coordinate)).toBe(false);
  });

  it("matches a query against the start of any word, and Home by its name", () => {
    const memory = toggleSaved(recordRecent(EMPTY_PLACE_MEMORY, GAP), DINER);
    const home = { ...place("Home", 40.5), provider: "home" };
    expect(rememberedPlaces(memory, home, "", 6).map((entry) => entry.kind)).toEqual(["home", "saved", "recent"]);
    expect(rememberedPlaces(memory, home, "comet", 3).map((entry) => entry.place.name)).toEqual(["Blue Comet Diner"]);
    expect(rememberedPlaces(memory, home, "monroe", 3).map((entry) => entry.place.name)).toEqual(["Delaware Water Gap"]);
    expect(rememberedPlaces(memory, home, "hom", 3).map((entry) => entry.kind)).toEqual(["home"]);
    expect(rememberedPlaces(memory, null, "", 1)).toHaveLength(1);
  });

  it("drops malformed stored entries one by one", () => {
    const parsed = parsePlaceMemory({ saved: [DINER, { name: "x" }], recents: "nope" });
    expect(parsed).toEqual({ saved: [DINER], recents: [] });
    expect(parsePlaceMemory(null)).toEqual(EMPTY_PLACE_MEMORY);
  });
});

describe("the device store", () => {
  it("persists, notifies, and survives corrupt storage", () => {
    const data = new Map<string, string>([[PLACE_MEMORY_STORAGE_KEY, "{not json"]]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
    const store = createPlaceMemoryStore(storage);
    expect(store.read()).toEqual(EMPTY_PLACE_MEMORY);
    let calls = 0;
    const stop = store.subscribe(() => {
      calls += 1;
    });
    store.record(DINER);
    store.toggleSaved(GAP);
    stop();
    store.record(GAP);
    expect(calls).toBe(2);
    const reread = createPlaceMemoryStore(storage).read();
    expect(reread.recents.map((entry) => entry.name)).toEqual(["Delaware Water Gap", "Blue Comet Diner"]);
    expect(reread.saved.map((entry) => entry.name)).toEqual(["Delaware Water Gap"]);
  });
});
