/**
 * The two pure comparisons the durable write path depends on.
 *
 * `structurallyEqual` decides whether the quarantining re-read still sees the same
 * unreclaimed row (`ride-repository.ts`, `loadRide`); `isSameWriterAdvance` decides
 * whether a newer revision may supersede the stored row instead of conflicting
 * (`saveRide`). Both are exported so their edge cases can be pinned directly, and
 * the behavioral halves live in `tests/integration/ride-repository.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { RideRecord } from "@/application/persistence/ride-repository";
import { createRideDocument } from "@/domain/ride/create";
import {
  isSameWriterAdvance,
  structurallyEqual,
} from "@/infrastructure/storage/ride-repository";

function record(overrides: Partial<RideRecord> = {}): RideRecord {
  const document = createRideDocument({ now: "2026-09-17T12:00:00.000Z" });
  return {
    rideId: document.rideId,
    revision: document.revision,
    updatedAt: document.updatedAt,
    writerToken: "tab-a",
    document,
    ...overrides,
  };
}

describe("structurallyEqual", () => {
  it("compares Dates by their timestamp, not by their empty key list", () => {
    expect(structurallyEqual(new Date(1), new Date(2))).toBe(false);
    expect(structurallyEqual(new Date(2), new Date(2))).toBe(true);
    expect(structurallyEqual(new Date(2), {})).toBe(false);
    expect(structurallyEqual({ at: new Date(1) }, { at: new Date(2) })).toBe(false);
    expect(structurallyEqual({ at: new Date(1) }, { at: new Date(1) })).toBe(true);
  });

  it("does not call distinct Maps, Sets, Views or class instances equal", () => {
    expect(structurallyEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(structurallyEqual(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true);
    expect(structurallyEqual(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
    expect(structurallyEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(structurallyEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(structurallyEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(structurallyEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(structurallyEqual(new Uint8Array([1, 2]), new Uint16Array([1]))).toBe(false);
    // A Map is not a Set and a Date is not a plain record, whatever their keys say.
    expect(structurallyEqual(new Map(), new Set())).toBe(false);
    expect(structurallyEqual(new Error("boom"), { message: "boom" })).toBe(false);
  });

  it("keeps comparing plain rows and arrays by content, not by key order", () => {
    expect(structurallyEqual({ alpha: 1, beta: 2 }, { beta: 2, alpha: 1 })).toBe(true);
    expect(structurallyEqual({ alpha: 1 }, { alpha: 2 })).toBe(false);
    expect(structurallyEqual({ alpha: 1 }, { alpha: 1, beta: 2 })).toBe(false);
    expect(structurallyEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(structurallyEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(structurallyEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("terminates on a self-referential row instead of recursing forever", () => {
    const left: Record<string, unknown> = { name: "loop" };
    left["self"] = left;
    const right: Record<string, unknown> = { name: "loop" };
    right["self"] = right;

    expect(structurallyEqual(left, right)).toBe(true);
  });
});

describe("isSameWriterAdvance", () => {
  it("requires a usable writer token on both sides", () => {
    const stored = record({ revision: 4 });

    // `undefined === undefined` is not evidence of the same writer: without this the
    // revision guard is bypassed whenever tokens are absent on both sides.
    expect(isSameWriterAdvance(stored, undefined, 5)).toBe(false);
    expect(isSameWriterAdvance(stored, "", 5)).toBe(false);
    expect(isSameWriterAdvance({ ...stored, writerToken: "" }, "", 5)).toBe(false);
    expect(
      isSameWriterAdvance(record({ writerToken: undefined as never }), undefined, 5),
    ).toBe(false);
    expect(isSameWriterAdvance(null, "tab-a", 5)).toBe(false);
  });

  it("accepts only this writer's own strictly newer revision", () => {
    const stored = record({ revision: 4, writerToken: "tab-a" });

    expect(isSameWriterAdvance(stored, "tab-a", 5)).toBe(true);
    expect(isSameWriterAdvance(stored, "tab-a", 4)).toBe(false);
    expect(isSameWriterAdvance(stored, "tab-a", 3)).toBe(false);
    expect(isSameWriterAdvance(stored, "tab-b", 5)).toBe(false);
  });
});
