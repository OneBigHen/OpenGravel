import { describe, expect, it } from "vitest";
import { createGarage } from "@/application/garage/garage-model";
import { createLocalStorageGarageStorage } from "@/infrastructure/storage/garage-storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

describe("garage storage", () => {
  it("round trips a versioned garage", () => {
    const storage = memoryStorage();
    const adapter = createLocalStorageGarageStorage(storage);
    const garage = createGarage();
    adapter.write(garage);
    expect(adapter.read()).toEqual(garage);
  });

  it("falls back to a seeded garage for corrupt or unavailable storage", () => {
    expect(createLocalStorageGarageStorage(memoryStorage({ "opengravel.vnext.garage.v1": "{" })).read().bikes).toHaveLength(1);
    expect(createLocalStorageGarageStorage(null).read().bikes).toHaveLength(1);
    const broken = { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("unavailable"); }, removeItem: () => { throw new Error("unavailable"); } };
    expect(createLocalStorageGarageStorage(broken).read().bikes).toHaveLength(1);
  });
});
