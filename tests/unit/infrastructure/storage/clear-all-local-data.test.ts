import { describe, expect, it, vi } from "vitest";

import { clearAllLocalData, LOCAL_DATA_STORAGE_KEYS } from "@/infrastructure/storage/clear-all-local-data";

const EXPECTED_KEYS = [
  "opengravel.vnext.garage.v1",
  "opengravel-vnext-satellite",
  "opengravel.vnext.telemetry-consent",
  "opengravel.vnext.bootstrap",
  "opengravel.vnext.ride-focus",
  "opengravel.vnext.home-location.v1",
  "opengravel-vnext-draft-dirty",
  "opengravel-vnext-place-names",
  "ogv-community-device-id",
  "opengravel-vnext-ride-places-enabled",
  "opengravel-vnext-planner-places-enabled",
  "opengravel.vnext.rider-settings",
  "opengravel.vnext.free-ride-telemetry",
];

describe("clearAllLocalData", () => {
  it("removes every app-owned local-storage key and deletes the VNext database", async () => {
    const values = new Map(EXPECTED_KEYS.map((key) => [key, "present"]));
    const storage = {
      removeItem: vi.fn((key: string) => { values.delete(key); }),
    };
    const deleteDatabase = vi.fn(async () => undefined);

    await clearAllLocalData(storage, deleteDatabase);

    expect(LOCAL_DATA_STORAGE_KEYS).toEqual(EXPECTED_KEYS);
    expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual(EXPECTED_KEYS);
    expect(values.size).toBe(0);
    expect(deleteDatabase).toHaveBeenCalledOnce();
  });
});
