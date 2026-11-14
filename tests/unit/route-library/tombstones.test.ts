import { describe, expect, it } from "vitest";

import { mergeTombstones, parseTombstones, RIDE_ID, tombstonesJson, withTakedown } from "@/application/route-library/tombstones";
import type { Tombstone } from "@/application/route-library/types";

const at = "2026-11-01T09:00:00Z";

function stone(id: string, reason = "removed"): Tombstone {
  return { id, removedAt: at, reason };
}

describe("the tombstones file", () => {
  it("reads a bare array and the object form, sorted by id", () => {
    expect(parseTombstones([stone("zz-removed"), stone("aa-removed")]).map((entry) => entry.id)).toEqual(["aa-removed", "zz-removed"]);
    expect(parseTombstones({ removed: [stone("nc-gone")] })).toEqual([stone("nc-gone")]);
  });

  it("refuses a bad id, a missing reason, a bad date and a duplicate", () => {
    expect(() => parseTombstones([{ ...stone("ok-id"), id: "Not An Id" }])).toThrow(/id must be a ride id/);
    expect(() => parseTombstones([{ id: "ok-id", removedAt: at }])).toThrow(/reason is required/);
    expect(() => parseTombstones([{ ...stone("ok-id"), removedAt: "last Tuesday" }])).toThrow(/removedAt must be a date/);
    expect(() => parseTombstones([stone("ok-id"), stone("ok-id")])).toThrow(/appears twice/);
    expect(() => parseTombstones({ nope: [] })).toThrow(/expected an array/);
  });

  it("accepts every id shape the ride endpoints accept", () => {
    expect(RIDE_ID.test("pa-pa-151-south-heights-hookstown")).toBe(true);
    expect(RIDE_ID.test("a1")).toBe(true);
    expect(RIDE_ID.test("two--hyphens")).toBe(false);
    expect(RIDE_ID.test("-leading")).toBe(false);
    expect(() => parseTombstones([stone("two--hyphens")])).toThrow(/id must be a ride id/);
  });

  it("writes a stable file that reads back the same", () => {
    const list = [stone("aa-removed"), stone("zz-removed", "source withdrew it")];
    expect(parseTombstones(JSON.parse(tombstonesJson(list)))).toEqual(list);
  });
});

describe("carrying removals from pack to pack", () => {
  it("keeps a deliberate removal even while the record file is still on disk, and hides it", () => {
    const merged = mergeTombstones({
      deliberate: [stone("bad-listing", "wrong road")],
      carried: [],
      previousIds: [],
      currentIds: ["good-ride"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([stone("bad-listing", "wrong road")]);
  });

  it("records a card that disappeared since the previous pack, with the build date", () => {
    const merged = mergeTombstones({
      deliberate: [],
      carried: [],
      previousIds: ["gone-ride", "still-here"],
      currentIds: ["still-here"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([{ id: "gone-ride", removedAt: "2026-11-14T00:00:00Z", reason: "no longer in the library" }]);
  });

  it("says a hidden source's ride was withdrawn by its source, not that it vanished", () => {
    const merged = mergeTombstones({
      deliberate: [],
      carried: [],
      previousIds: ["hidden-ride"],
      currentIds: [],
      withdrawn: ["hidden-ride"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged[0]?.reason).toBe("withdrawn by its source");
  });

  it("keeps an earlier removal through later builds", () => {
    const merged = mergeTombstones({
      deliberate: [],
      carried: [stone("long-gone", "source withdrew it")],
      previousIds: [],
      currentIds: ["other-ride"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([stone("long-gone", "source withdrew it")]);
  });

  it("drops a carried removal when the ride is live again and was not deliberately removed", () => {
    const merged = mergeTombstones({
      deliberate: [],
      carried: [stone("came-back")],
      previousIds: [],
      currentIds: ["came-back"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([]);
  });

  it("does not resurrect a ride that is both live and deliberately removed", () => {
    const merged = mergeTombstones({
      deliberate: [stone("came-back", "still a bad listing")],
      carried: [stone("came-back")],
      previousIds: ["came-back"],
      currentIds: ["came-back"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([stone("came-back", "still a bad listing")]);
  });

  it("lets the deliberate reason win over the previous pack's wording", () => {
    const merged = mergeTombstones({
      deliberate: [stone("bad-listing", "owner's takedown")],
      carried: [stone("bad-listing", "no longer in the library")],
      previousIds: [],
      currentIds: [],
      removedAt: "2026-11-14T00:00:00Z",
    });
    expect(merged).toEqual([stone("bad-listing", "owner's takedown")]);
  });

  it("is stable when the same removals are merged again", () => {
    const once = mergeTombstones({
      deliberate: [stone("bad-listing")],
      carried: [],
      previousIds: ["gone-ride"],
      currentIds: ["good-ride"],
      removedAt: "2026-11-14T00:00:00Z",
    });
    const twice = mergeTombstones({
      deliberate: [stone("bad-listing")],
      carried: once,
      previousIds: ["good-ride"],
      currentIds: ["good-ride"],
      removedAt: "2026-11-15T00:00:00Z",
    });
    expect(twice).toEqual(once);
  });
});

describe("adding a takedown", () => {
  it("replaces the same id and keeps the rest sorted", () => {
    const list = withTakedown([stone("aa-removed"), stone("zz-removed", "old reason")], stone("zz-removed", "new reason"));
    expect(list).toEqual([stone("aa-removed"), stone("zz-removed", "new reason")]);
  });

  it("adds a new id without losing the existing removals", () => {
    const list = withTakedown([stone("aa-removed")], stone("mm-removed"));
    expect(list.map((entry) => entry.id)).toEqual(["aa-removed", "mm-removed"]);
  });
});
