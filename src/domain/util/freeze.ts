/**
 * Deep immutability for authored domain values.
 *
 * RideDocument is the authored truth (03-DOMAIN-MODEL §2): once created it is
 * replaced by a new revision, never mutated in place. Freezing the whole tree
 * turns an accidental in-place edit into a visible failure instead of a silent
 * history bug.
 *
 * Plain-data contract: an authored ride is JSON-like data — plain objects
 * (including null-prototype objects) and arrays. Platform objects do not become
 * immutable under `Object.freeze`: a frozen `Map` still accepts `.set()`, a
 * frozen `Set` still accepts `.add()`, and a frozen `Date` still accepts
 * `.setTime()`. This module therefore REJECTS them with a `TypeError` instead of
 * pretending they were frozen. Keep collections out of domain values, or wrap
 * them behind one.
 */

type UnknownRecord = Record<PropertyKey, unknown>;

function isObjectLike(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeObject(value: object): string {
  const constructor: unknown = (value as { readonly constructor?: unknown })
    .constructor;
  if (typeof constructor !== "function" || typeof constructor.name !== "string") {
    return "a non-plain object";
  }
  return constructor.name.length > 0 ? constructor.name : "a non-plain object";
}

function assertFreezable(value: object): void {
  if (Array.isArray(value) || isPlainObject(value)) return;
  throw new TypeError(
    `deepFreeze accepts only plain data (objects and arrays): ${describeObject(value)} cannot be deeply frozen`,
  );
}

function freezeTree(value: unknown, seen: WeakSet<object>): void {
  if (!isObjectLike(value) || seen.has(value)) return;
  assertFreezable(value);
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeTree((value as UnknownRecord)[key], seen);
  }
  Object.freeze(value);
}

/**
 * Recursively freezes every plain object and array reachable from `value` and
 * returns the same reference. Pure: it creates nothing and reads nothing
 * outside its argument. Cycles and shared references are handled once. A
 * non-plain object (Map, Set, Date, class instance, typed array, ...) throws a
 * `TypeError` listing its type, because freezing it would be a lie.
 */
export function deepFreeze<T>(value: T): T {
  if (isObjectLike(value)) freezeTree(value, new WeakSet<object>());
  return value;
}
