import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { createRiderPreferenceModel } from "@/domain/personalization/rider-preference";
import { VNextDatabase } from "@/infrastructure/storage/db";
import {
  createRiderPreferenceRepository,
  RIDER_PREFERENCE_SETTING_KEY,
} from "@/infrastructure/storage/rider-preference-repository";

let sequence = 0;

function databaseName(): string {
  sequence += 1;
  return `opengravel-vnext-rider-preference-${sequence}`;
}

describe("RiderPreferenceRepository", () => {
  it("round-trips a model after reopening the real Dexie database", async () => {
    const name = databaseName();
    const model = createRiderPreferenceModel({ curvature: { mean: 1.5 } });
    const writer = new VNextDatabase(name);

    await createRiderPreferenceRepository(writer).save(model);
    writer.close();

    const reader = new VNextDatabase(name);
    await expect(createRiderPreferenceRepository(reader).load()).resolves.toEqual(model);
    reader.close();
  });

  it("clears the stored model and treats a missing row as empty", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRiderPreferenceRepository(database);

    await repository.save(createRiderPreferenceModel());
    await repository.clear();

    await expect(repository.load()).resolves.toBeNull();
    database.close();
  });

  it("rejects an invalid save without overwriting valid state", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRiderPreferenceRepository(database);
    const valid = createRiderPreferenceModel({ backroad: { mean: 1.25 } });
    const invalid = { ...valid, version: 2 } as unknown as typeof valid;

    await repository.save(valid);
    await expect(repository.save(invalid)).rejects.toThrow("Invalid rider preference model");
    await expect(repository.load()).resolves.toEqual(valid);
    database.close();
  });

  it("returns null for a corrupt persisted row", async () => {
    const database = new VNextDatabase(databaseName());
    const repository = createRiderPreferenceRepository(database);

    await database.settings.put({
      key: RIDER_PREFERENCE_SETTING_KEY,
      value: { version: 1, mean: { curvature: "corrupt" } },
    });

    await expect(repository.load()).resolves.toBeNull();
    database.close();
  });
});
