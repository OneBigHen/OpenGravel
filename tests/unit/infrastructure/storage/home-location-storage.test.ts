import { describe, expect, it, vi } from "vitest";
import {
  createHomeLocationStorage,
  HOME_LOCATION_STORAGE_KEY,
} from "@/infrastructure/storage/home-location-storage";

describe("home location storage", () => {
  it("writes and reads a validated local preference", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const home = createHomeLocationStorage(storage);

    expect(home.write({ lon: -77.2, lat: 40.1 })).toBe(true);
    expect(values.has(HOME_LOCATION_STORAGE_KEY)).toBe(true);
    expect(home.read()).toEqual({ status: "found", coordinate: { lon: -77.2, lat: 40.1 }, label: null });
    // A named Home keeps its name, so Settings can say which Home (RS-13).
    expect(home.write({ lon: -75.28, lat: 40.24 }, "Lansdale, PA")).toBe(true);
    expect(home.read()).toEqual({ status: "found", coordinate: { lon: -75.28, lat: 40.24 }, label: "Lansdale, PA" });
    expect(home.clear()).toBe(true);
    expect(home.read()).toEqual({ status: "absent" });
  });

  it("distinguishes an invalid preference and storage failures", () => {
    const malformed = createHomeLocationStorage({
      getItem: () => "{bad json",
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    expect(malformed.read()).toEqual({ status: "invalid" });
    expect(malformed.write({ lon: 181, lat: 0 })).toBe(false);

    const broken = createHomeLocationStorage({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(broken.read()).toEqual({ status: "unreadable" });
    expect(broken.write({ lon: 0, lat: 0 })).toBe(false);
    expect(broken.clear()).toBe(false);
  });
});
