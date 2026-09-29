/**
 * The route-plan **fixture** seam (16-TEST-AND-RELEASE-GATES §7;
 * 17-IMPLEMENTATION-PLAN Task 2.4b).
 *
 * The critical browser gate needs a plan answer that is deterministic and does
 * not require a routing engine to be up. This module is that answer, and it is
 * built to be impossible to mistake for a real one:
 *
 * - it is **env-gated** (`OGV_ROUTE_PLAN_FIXTURE=1`), so an ordinary deployment
 *   cannot reach it;
 * - its file must carry `"fixture": true`, so an unmarked file is refused
 *   instead of being served as if it were an engine's answer;
 * - its candidates name the provider `"fixture"`, and
 *   `plan-service` adds a `FIXTURE — not a live router` diagnostic to every
 *   answer built from them;
 * - it lives under the fixed `tests/fixtures/route-plan/` root and is only ever
 *   read on the fixture path — the live GraphHopper path is untouched.
 *
 * ## What it is *not*
 *
 * This is not a router substitute and not a fallback: there is no degradation
 * path from "the engine is down" to "serve a fixture". A deployment that is not
 * explicitly in fixture mode plans against the engine, full stop.
 *
 * ## Same shape, same path
 *
 * The file holds plain `ProviderCandidate` data — exactly what a provider's
 * `candidates()` call returns, including instructions and provider metadata —
 * so the fixture travels through the identical validation, eligibility-stub,
 * mapping and role-stub code path a live answer does. The only difference
 * between the two paths is where the candidates came from.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ProviderCandidate,
  ProviderInstruction,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { isRouteInstruction, MAX_ROUTE_INSTRUCTIONS } from "@/domain/route/types";

/** The provider id every fixture candidate and diagnostic carries. */
export const FIXTURE_PROVIDER_ID = "fixture";

/** Set to `"1"` to plan from the fixture instead of calling the provider. */
export const FIXTURE_MODE_ENV = "OGV_ROUTE_PLAN_FIXTURE";

/** Simulated answer latency, in milliseconds (`OGV_ROUTE_PLAN_FIXTURE_DELAY_MS`). */
export const FIXTURE_DELAY_ENV = "OGV_ROUTE_PLAN_FIXTURE_DELAY_MS";

/** Repository-relative path, resolved from the server's `process.cwd()`. */
export const FIXTURE_CANDIDATES_PATH =
  "tests/fixtures/route-plan/candidates-basic.json";

/** Static fixture root; keeping this explicit prevents whole-project tracing. */
const FIXTURE_DIRECTORY = "tests/fixtures/route-plan";

/** Upper bound on the simulated latency: a bad value must not hold a request open. */
export const MAX_FIXTURE_DELAY_MS = 60_000;

/** The diagnostic note every fixture answer must carry. */
export const FIXTURE_NOTE = "FIXTURE — not a live router";

/** The marked fixture file, once the env says to use it. */
export interface FixturePlanMode {
  readonly candidatesPath: string;
  readonly delayMs: number;
}

/** Why the fixture could not answer; each maps to one plan-service error. */
export type FixtureFailureReason =
  | "cancelled"
  | "fixture-unreadable"
  | "fixture-invalid";

export type FixtureCandidatesResult =
  | { readonly ok: true; readonly candidates: readonly ProviderCandidate[] }
  | { readonly ok: false; readonly reason: FixtureFailureReason };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/** Parses the delay; anything unreadable means "answer immediately". */
function fixtureDelayFromEnv(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[FIXTURE_DELAY_ENV];
  if (raw === undefined) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_FIXTURE_DELAY_MS);
}

/**
 * The fixture mode this environment asks for, or `null` for the live path.
 *
 * Only the exact string `"1"` enables it: a typo, an empty value or any other
 * truthy-looking string keeps the deployment on its real router.
 */
export function fixturePlanModeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FixturePlanMode | null {
  if (env[FIXTURE_MODE_ENV] !== "1") return null;
  return {
    candidatesPath: FIXTURE_CANDIDATES_PATH,
    delayMs: fixtureDelayFromEnv(env),
  };
}

/** One coordinate, or `null` when it is not a usable lon/lat pair. */
function parseCoordinate(value: unknown): Coordinate | null {
  if (!isPlainObject(value)) return null;
  const { lon, lat } = value;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { lon, lat };
}

function parseInstructions(value: unknown): readonly ProviderInstruction[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_ROUTE_INSTRUCTIONS ||
    value.some((instruction) => !isRouteInstruction(instruction))
  ) return null;
  return value;
}

function parseMetadata(
  value: unknown,
): Readonly<Record<string, string | number | boolean>> | null {
  if (value === undefined) return {};
  if (!isPlainObject(value)) return null;
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "boolean") {
      metadata[key] = entry;
      continue;
    }
    if (isFiniteNumber(entry)) {
      metadata[key] = entry;
      continue;
    }
    return null;
  }
  return metadata;
}

/** One candidate, or `null` when any field the provider port requires is unusable. */
function parseCandidate(value: unknown): ProviderCandidate | null {
  if (!isPlainObject(value)) return null;

  const { providerId, profile } = value;
  if (typeof providerId !== "string" || providerId.length === 0) return null;
  if (typeof profile !== "string" || profile.length === 0) return null;

  const geometryValue = value["geometry"];
  if (!Array.isArray(geometryValue) || geometryValue.length < 2) return null;
  const geometry: Coordinate[] = [];
  for (const entry of geometryValue) {
    const coordinate = parseCoordinate(entry);
    if (coordinate === null) return null;
    geometry.push(coordinate);
  }

  const distanceMeters = value["distanceMeters"];
  const durationSeconds = value["durationSeconds"];
  if (!isNonNegativeNumber(distanceMeters) || !isNonNegativeNumber(durationSeconds)) {
    return null;
  }

  const instructions = parseInstructions(value["instructions"]);
  if (instructions === null) return null;
  if (instructions.some((instruction) =>
    instruction.geometryIndex !== undefined && instruction.geometryIndex >= geometry.length,
  )) return null;
  const providerMetadata = parseMetadata(value["providerMetadata"]);
  if (providerMetadata === null) return null;

  return {
    providerId,
    profile,
    geometry,
    distanceMeters,
    durationSeconds,
    instructions,
    providerMetadata,
  };
}

/**
 * Validates a parsed fixture document. Pure and total: it either returns the
 * candidates or says the document is invalid, and a document that is not
 * *marked* as a fixture is invalid by construction — an unlabeled file must
 * never become a route answer.
 */
export function parseFixtureCandidates(value: unknown): FixtureCandidatesResult {
  if (!isPlainObject(value)) return { ok: false, reason: "fixture-invalid" };
  if (value["fixture"] !== true) return { ok: false, reason: "fixture-invalid" };

  const candidatesValue = value["candidates"];
  if (!Array.isArray(candidatesValue) || candidatesValue.length === 0) {
    return { ok: false, reason: "fixture-invalid" };
  }

  const candidates: ProviderCandidate[] = [];
  for (const entry of candidatesValue) {
    const candidate = parseCandidate(entry);
    if (candidate === null) return { ok: false, reason: "fixture-invalid" };
    candidates.push(candidate);
  }
  return { ok: true, candidates };
}

/** Resolves after `ms`, or as soon as the caller's attempt is cancelled. */
function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Reads the fixture and returns its candidates as a provider would.
 *
 * A cancelled attempt never returns candidates (`reason: "cancelled"`) — the
 * fixture obeys the same cancellation contract as a real provider — and an
 * unreadable or unmarked file is an explicit `fixture-unreadable` /
 * `fixture-invalid` rather than an empty answer that could look like
 * "no route here".
 */
export async function loadFixtureCandidates(
  mode: FixturePlanMode,
  signal: AbortSignal,
): Promise<FixtureCandidatesResult> {
  if (mode.delayMs > 0) await waitForDelay(mode.delayMs, signal);
  if (signal.aborted) return { ok: false, reason: "cancelled" };

  let raw: string;
  try {
    const relativePath = path.relative(FIXTURE_DIRECTORY, mode.candidatesPath);
    if (
      relativePath === "" ||
      path.isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`)
    ) {
      return { ok: false, reason: "fixture-unreadable" };
    }
    raw = await readFile(
      path.join(process.cwd(), "tests/fixtures/route-plan", relativePath),
      "utf8",
    );
  } catch {
    // The path is a server-side diagnostic; it never travels to a client.
    return { ok: false, reason: "fixture-unreadable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: "fixture-invalid" };
  }
  return parseFixtureCandidates(parsed);
}
