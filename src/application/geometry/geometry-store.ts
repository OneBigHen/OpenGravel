/**
 * The GeometryStore port (02-ARCHITECTURE-CONTRACT §4, OGV-ARC-007).
 *
 * Large geometry is addressed by a stable handle (`GeometryRef`), never by
 * value. Application and domain code depend on this interface only, so the same
 * code runs against an in-memory map (tests, SSR) or IndexedDB (browser)
 * without knowing which.
 *
 * ## Immutability contract
 *
 * `put` always mints a **new** ref; there is deliberately no update operation.
 * A history entry or a document that refers to a payload can therefore never
 * observe that payload change underneath it — a new geometry value is a new
 * handle, and the old handle keeps resolving to the old bytes. Orphaned
 * payloads are the cost of that guarantee, and `remove` is the explicit way to
 * reclaim one.
 *
 * ## Contract for implementers
 *
 * - `put` mints the ref and returns the stored record deeply frozen;
 * - `get` returns a deeply frozen record, or `null` when the handle is unknown
 *   (a missing handle is an ordinary absence, not an error);
 * - `remove` is idempotent: removing an unknown handle resolves;
 * - an invalid payload is rejected before anything is written, with
 *   `GeometryValidationError` carrying the domain validator's issues.
 *
 * Implementations must not be handed live mutable state: the record is built
 * and frozen here, in one place, so the two adapters cannot drift.
 */

import type {
  GeometryKind,
  GeometryPayload,
  GeometryRecord,
} from "@/domain/geometry/types";
import { countGeometryPoints, validateGeometryPayload } from "@/domain/geometry/types";
import { GEOMETRY_KINDS } from "@/domain/geometry/types";
import { newGeometryRef, type GeometryRef } from "@/domain/ride/ids";
import { deepFreeze } from "@/domain/util/freeze";

/** How a payload is described at write time. */
export interface GeometryPutOptions {
  readonly kind: GeometryKind;
  /** ISO-8601 instant stamped into `createdAt`; defaults to the wall clock. */
  readonly now?: string;
}

/** Reads and writes of large geometry by stable handle. */
export interface GeometryStore {
  /** Validates, mints a new ref and stores the payload. Always a new handle. */
  put(payload: GeometryPayload, options: GeometryPutOptions): Promise<GeometryRecord>;
  /** The frozen record for `ref`, or `null` when nothing is stored under it. */
  get(ref: GeometryRef): Promise<GeometryRecord | null>;
  has(ref: GeometryRef): Promise<boolean>;
  /** Idempotent: removing a handle that stores nothing resolves. */
  remove(ref: GeometryRef): Promise<void>;
}

/** Raised by `put` when the domain validator rejects the payload. */
export class GeometryValidationError extends Error {
  /** The domain validator's issues, verbatim and in order. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid geometry payload: ${issues.join("; ")}`);
    this.name = "GeometryValidationError";
    this.issues = [...issues];
  }
}

/**
 * The one place a `GeometryRecord` is materialized, shared by every adapter:
 * re-check the kind, run the domain validator, mint the handle, denormalize the
 * point count and freeze the result. Centralizing it is what keeps "immutable
 * writes" a property of the port rather than a habit of each adapter.
 */
export function buildGeometryRecord(
  payload: GeometryPayload,
  options: GeometryPutOptions,
): GeometryRecord {
  const issues = validateGeometryPayload(payload);
  if (options.kind === undefined || !GEOMETRY_KINDS.includes(options.kind)) {
    issues.push(`geometry kind "${String(options.kind)}" is not a known geometry kind`);
  }
  if (issues.length > 0) {
    throw new GeometryValidationError(issues);
  }
  return deepFreeze<GeometryRecord>({
    geometryRef: newGeometryRef(),
    kind: options.kind,
    payload,
    pointCount: countGeometryPoints(payload),
    createdAt: options.now ?? new Date().toISOString(),
  });
}
