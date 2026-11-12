/**
 * The three honest lines under a route (N3, taste call 5): how much of it is
 * dirt, whether the rider's bike can do it, and what was checked today — always
 * in that order.
 *
 * The rule the module exists for: **unknown or unavailable data never reads as
 * good**. A surface mix the answer did not carry, a bike fit the router did not
 * measure, and a closure check that did not answer all take the neutral tone
 * and say so. Only measured, known-clear facts earn the known-good tone; the one
 * `bad` case is a limit the rider set on their own bike being exceeded.
 *
 * Pure: the caller supplies the candidate's evidence, its distance and the
 * rider's bike. Nothing here reads a store, a clock or the DOM, so every
 * combination the tests below can build is a combination a rider can be shown.
 */

import { bikeFitFacts, surfaceShares } from "@/application/roads/engine-road-evidence";
import { isUsableEvidence, type EvidenceSource } from "@/domain/evidence/types";
import type { RouteEvidence } from "@/domain/route/types";

import { surfaceFacts, type SurfaceShares } from "./surface-facts";

/** How a truth line reads. `unknown` is neutral ink, never a quiet "fine". */
export type RideTruthTone = "good" | "warn" | "bad" | "unknown";

/** A stretch of the route, in metres from its start, for a map tap. */
export interface RideTruthStretch {
  readonly fromMeters: number;
  readonly toMeters: number;
}

/** One line under the hero. `jumpTo` is the stretch a tap should fly to. */
export interface RideTruthLine {
  readonly tone: RideTruthTone;
  readonly text: string;
  readonly jumpTo?: RideTruthStretch;
}

/**
 * Exactly three lines, in the order the sheet and the cards show them:
 * surface, bike, checked (taste call 5).
 */
export type RideTruth = readonly [
  surface: RideTruthLine,
  bike: RideTruthLine,
  checked: RideTruthLine,
];

/**
 * The part of a garage bike the bike line reads: its name and the two limits
 * the rider set. A `BikeProfile` from the garage model satisfies this, so
 * `activeBike(garage)` can be passed as is.
 *
 * `avoid` is a limit for this line, not a routing hint: a route that rides
 * gravel or rough track anyway is over what the rider asked their bike to do,
 * and the line says so in the `bad` tone.
 */
export interface RideTruthBike {
  readonly name: string;
  readonly maintainedGravel: "allow" | "avoid";
  readonly roughTracks: "allow" | "avoid";
}

export interface RideTruthInput {
  /** The candidate's evidence map. Absence is "not checked", never clear. */
  readonly evidence?: RouteEvidence;
  /** The line's length, so surface shares can be said in miles. */
  readonly distanceMeters?: number;
  /** The rider's active bike; absent means no bike was selected. */
  readonly bike?: RideTruthBike;
  /** The candidate's warnings, for the road-check copy. */
  readonly warnings?: readonly { readonly code: string }[];
}

const METERS_PER_MILE = 1609.344;

/** Answers this far above zero are risk bands, not a measured metre count. */
const CLOSED_RISK = 0.9;

const ROAD_WARNING_CODES = {
  closure: "road-closure-reported",
  restriction: "road-restriction-on-route",
  work: "road-work-on-route",
  seasonal: "seasonal-access-unverified",
} as const;

/**
 * The coordinator's own reason for a motor-vehicle designation it could not
 * establish for this date. It is the one signal a candidate carries for a
 * seasonal road that prevented the access check from being clear.
 */
const ACCESS_UNCONFIRMED_REASON = "does not establish motorcycle access";

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The measured surface shares, or `undefined` when the answer carried no
 * usable mix. An `unknown` or `unavailable` status is not usable even if a
 * value rode along: absence is never promoted into a measurement.
 */
function measuredShares(evidence: RouteEvidence | undefined): SurfaceShares | undefined {
  const mix = evidence?.["surfaceMix"];
  if (mix === undefined || !isUsableEvidence(mix)) return undefined;
  return surfaceShares(mix) ?? undefined;
}

/** `12 mi`, `0.8 mi`, `<0.1 mi` — never a rounded-away zero. */
function milesText(meters: number): string {
  const value = meters / METERS_PER_MILE;
  if (!(value > 0)) return "0 mi";
  if (value >= 10) return `${Math.round(value)} mi`;
  if (value >= 0.1) return `${Number(value.toFixed(1))} mi`;
  return "<0.1 mi";
}

function unpavedWord(shares: SurfaceShares): string {
  if (shares.dirt > 0 && shares.gravel > 0) return "dirt & gravel";
  if (shares.dirt > 0) return "dirt";
  return "gravel";
}

/** The unpaved phrase with its honest size, or "no gravel" when there is none. */
function unpavedPhrase(shares: SurfaceShares | undefined, meters: number | null): string {
  if (shares === undefined || meters === null || !(meters > 0)) return "no gravel";
  return `${milesText(meters)} ${unpavedWord(shares)}`;
}

function surfaceLine(input: RideTruthInput): RideTruthLine {
  const shares = measuredShares(input.evidence);
  const facts = surfaceFacts(shares, input.distanceMeters);
  if (shares === undefined || facts.line === "surface unknown") {
    return { tone: "unknown", text: "Surface unknown" };
  }
  const total = shares.paved + shares.gravel + shares.dirt + shares.unknown;
  if (!(total > 0)) return { tone: "unknown", text: "Surface unknown" };
  // Any unknown stretch is a caveat even when it is under a mile; the whole
  // line being unknown is `unknown`, not a warning about a mostly-known ride.
  if (shares.unknown / total >= 0.999) return { tone: "unknown", text: "Surface unknown" };
  if (shares.unknown > 0) return { tone: "warn", text: facts.line };
  return { tone: "good", text: facts.line };
}

function bikeLine(input: RideTruthInput): RideTruthLine {
  const bike = input.bike;
  if (bike === undefined) {
    return { tone: "unknown", text: "Not checked for your bike: no bike selected" };
  }

  const shares = measuredShares(input.evidence);
  const fit = bikeFitFacts(input.evidence?.["bikeFit"]) ?? undefined;
  const facts = surfaceFacts(shares, input.distanceMeters);
  const distance = input.distanceMeters !== undefined &&
    Number.isFinite(input.distanceMeters) &&
    input.distanceMeters > 0
    ? input.distanceMeters
    : null;
  const surfaceKnown = shares !== undefined && facts.line !== "surface unknown";
  const unpavedMeters = surfaceKnown && distance !== null ? facts.unpavedShare * distance : null;

  const roughMeters = fit?.roughTrackMeters ?? 0;
  const overGravel = unpavedMeters !== null && unpavedMeters > 0 && bike.maintainedGravel === "avoid";
  const overRough = roughMeters > 0 && bike.roughTracks === "avoid";

  if (overGravel || overRough) {
    const parts: string[] = [];
    if (overGravel) parts.push(unpavedPhrase(shares, unpavedMeters));
    if (overRough) parts.push(`${milesText(roughMeters)} rough track`);
    return {
      tone: "bad",
      text: `Over the limit for ${bike.name}: ${parts.join(", ")}`,
      ...(fit?.worst === undefined ? {} : { jumpTo: fit.worst }),
    };
  }

  // The part of the line nobody measured: a surface nobody tagged, or ground
  // the road runs did not describe. The larger of the two is what is unchecked.
  const unverifiedMeters = Math.max(
    facts.unknownMiles === null ? 0 : facts.unknownMiles * METERS_PER_MILE,
    fit === undefined ? 0 : fit.unmeasuredMeters,
  );

  if (unverifiedMeters > 0) {
    return {
      tone: "unknown",
      text: `Not checked for your bike: ${milesText(unverifiedMeters)} unknown surface`,
      ...(fit?.worst === undefined ? {} : { jumpTo: fit.worst }),
    };
  }
  if (fit === undefined) {
    return { tone: "unknown", text: "Not checked for your bike: rough-track check did not run" };
  }
  if (!surfaceKnown) {
    return { tone: "unknown", text: "Not checked for your bike: surface not measured" };
  }
  if (distance === null) {
    return { tone: "unknown", text: "Not checked for your bike: ride length not known" };
  }

  const parts = [
    unpavedPhrase(shares, unpavedMeters),
    roughMeters > 0 ? `${milesText(roughMeters)} rough track` : "no rough track",
  ];
  return {
    tone: "good",
    text: `Fine for ${bike.name}: ${parts.join(", ")}`,
    ...(fit.worst === undefined ? {} : { jumpTo: fit.worst }),
  };
}

/** Sources once each, in the order the evidence lists them. */
function distinctSources(sources: readonly EvidenceSource[]): readonly EvidenceSource[] {
  const seen = new Map<string, EvidenceSource>();
  for (const source of sources) {
    if (!seen.has(source.id)) seen.set(source.id, source);
  }
  return [...seen.values()];
}

/** The newest observation the sources state, or `null` when none says when. */
function latestObservedAt(sources: readonly EvidenceSource[]): string | null {
  let latest: number | null = null;
  for (const source of sources) {
    if (source.observedAt === undefined) continue;
    const at = Date.parse(source.observedAt);
    if (!Number.isFinite(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

/** Rider-local clock, e.g. `9:14 AM`; empty when the instant is unreadable. */
function clockText(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  // Assembled from parts so a locale's choice of space before AM cannot change
  // the copy the tests and the sheet agree on.
  const parts = CLOCK.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("dayPeriod")}`.trim();
}

/**
 * The seasonal-road caveat: the candidate's own warning count when it has one,
 * otherwise the access evidence's unproven designation (a count nobody stated
 * is not invented).
 */
function seasonalCopy(input: RideTruthInput): string | null {
  const count = input.warnings?.filter((warning) => warning.code === ROAD_WARNING_CODES.seasonal).length ?? 0;
  if (count > 0) return `${count} seasonal road${count === 1 ? "" : "s"} not confirmed`;
  const access = input.evidence?.["access"];
  if (
    access !== undefined &&
    access.status === "unknown" &&
    access.reason !== undefined &&
    access.reason.includes(ACCESS_UNCONFIRMED_REASON)
  ) {
    return "Seasonal road not confirmed";
  }
  return null;
}

function checkedLine(input: RideTruthInput): RideTruthLine {
  const closures = input.evidence?.["closures"];
  if (closures === undefined) return { tone: "unknown", text: "Closure check did not answer" };
  if (closures.status === "stale") return { tone: "unknown", text: "Closure check is out of date" };
  if (!isUsableEvidence(closures) || typeof closures.value !== "number" || !Number.isFinite(closures.value)) {
    return { tone: "unknown", text: "Closure check did not answer" };
  }

  const risk = Math.max(0, closures.value);
  const codes = new Set((input.warnings ?? []).map((warning) => warning.code));
  if (risk >= CLOSED_RISK || codes.has(ROAD_WARNING_CODES.closure)) {
    return { tone: "bad", text: "A road closure was reported on this route" };
  }
  if (codes.has(ROAD_WARNING_CODES.restriction)) {
    return { tone: "warn", text: "A road restriction was reported on this route" };
  }
  if (codes.has(ROAD_WARNING_CODES.work)) {
    return { tone: "warn", text: "Road work was reported on this route" };
  }
  if (risk > 0) return { tone: "warn", text: "A road restriction was reported on this route" };

  const seasonal = seasonalCopy(input);
  if (seasonal !== null) return { tone: "warn", text: seasonal };

  const sources = distinctSources(closures.provenance);
  const at = latestObservedAt(sources);
  const clock = at === null ? "" : clockText(at);
  const count = sources.length === 0
    ? "no closures on this route"
    : `${sources.length} source${sources.length === 1 ? "" : "s"}, no closures on this route`;
  return {
    tone: "good",
    text: clock === "" ? `Checked: ${count}` : `Checked ${clock}: ${count}`,
  };
}

/** The three lines, in the order they are shown: surface, bike, checked. */
export function rideTruth(input: RideTruthInput): RideTruth {
  return [surfaceLine(input), bikeLine(input), checkedLine(input)];
}

/**
 * Adds the rider's own reported spots to the checked line, apart from the
 * official checks. Never changes the tone, never says "closed": a report is the
 * rider's private note, not a fact about the road.
 */
export function withRiderReportSentence(
  line: RideTruthLine,
  status: { readonly avoided: number; readonly couldNotAvoid: boolean },
): RideTruthLine {
  const sentence = status.couldNotAvoid
    ? "Could not avoid the spot you reported."
    : status.avoided === 1
      ? "Avoiding 1 spot you reported."
      : status.avoided > 1
        ? `Avoiding ${status.avoided} spots you reported.`
        : null;
  if (sentence === null) return line;
  const base = line.text.replace(/[.\s]+$/, "");
  return { ...line, text: `${base}. ${sentence}` };
}
