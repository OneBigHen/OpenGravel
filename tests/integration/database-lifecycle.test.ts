import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { deleteVNextDatabase, vnextDatabase } from "@/infrastructure/storage/db";

describe("VNext database lifecycle", () => {
  afterEach(async () => {
    await deleteVNextDatabase();
  });

  it("provides a fresh usable singleton after deleting local data", async () => {
    const beforeDelete = vnextDatabase();
    await beforeDelete.open();

    await deleteVNextDatabase();
    const afterDelete = vnextDatabase();

    expect(afterDelete).not.toBe(beforeDelete);
    await expect(afterDelete.geometry.count()).resolves.toBe(0);
  });
});
