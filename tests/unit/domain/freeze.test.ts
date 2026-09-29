import { describe, expect, it } from "vitest";

import { deepFreeze } from "@/domain/util/freeze";

class Widget {
  readonly name = "widget";
}

describe("deepFreeze (03-DOMAIN-MODEL §2)", () => {
  it("deep-freezes plain objects and arrays", () => {
    const nested = { c: true };
    const value = deepFreeze({ a: { b: [1, nested] } });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(Reflect.set(nested, "c", false)).toBe(false);
  });

  it("returns the same reference and leaves the input identity intact", () => {
    const value = { a: 1 };

    expect(deepFreeze(value)).toBe(value);
  });

  it("handles cycles and shared references once", () => {
    const shared = { count: 0 };
    const cyclic: { self?: unknown; shared: { count: number } } = { shared };
    cyclic.self = cyclic;

    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(cyclic.shared).toBe(shared);
  });

  it("accepts a null-prototype object as plain data", () => {
    const value = Object.create(null) as Record<string, number>;
    value["x"] = 1;

    expect(() => deepFreeze(value)).not.toThrow();
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each<[string, object]>([
    ["a Map", new Map([["a", 1]])],
    ["a Set", new Set([1])],
    ["a Date", new Date("2026-05-01T00:00:00.000Z")],
    ["a class instance", new Widget()],
  ])("rejects %s with a TypeError", (_label, value) => {
    expect(() => deepFreeze(value)).toThrow(TypeError);
    expect(() => deepFreeze(value)).toThrow(/plain data/);
  });

  it("rejects a non-plain object nested inside plain data", () => {
    expect(() => deepFreeze({ nested: { when: new Date() } })).toThrow(
      TypeError,
    );
  });
});
