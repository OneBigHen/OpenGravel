/**
 * Converts a bounded advisor draft into the existing RideCommand protocol.
 * This is the final proposal boundary: no model-shaped object reaches the ride
 * store, and the reducer validates the complete compound command before the UI
 * offers Apply.
 */

import { defaultLoopToleranceMinutes } from "@/application/planner/build-plan-request";
import type { RideCommand, RideCommandOp } from "@/domain/ride/commands";
import { applyRideCommand } from "@/domain/ride/reducer";
import { newCommandId, newPointId, newStopId } from "@/domain/ride/ids";
import type { RideDocument, RideIntent, TimeIntent } from "@/domain/ride/types";
import { advisorRiderState, type AdvisorErrorClass } from "./advisor-errors";
import type { AdvisorDraft } from "./advisor-proposal";
import type { AdvisorStopSearchRequest } from "./advisor-stops";

export type AdvisorProposalField =
  | "shape"
  | "start"
  | "finish"
  | "stop"
  | "time"
  | "departure"
  | "roadCharacter"
  | "novelty"
  | "surface"
  | "terrain"
  | "highways"
  | "tolls"
  | "traffic";

export interface AdvisorProposalChange {
  readonly field: AdvisorProposalField;
  readonly before: string;
  readonly after: string;
}

/** Rider-readable, fully projected interpretation after applying the proposal in memory. */
export interface AdvisorProposalInterpretation {
  readonly shape: RideIntent["shape"];
  readonly start: string | null;
  readonly finish: string | null;
  readonly stops: readonly { readonly label: string | null | undefined; readonly arrivalIntent: RideIntent["stops"][number]["arrivalIntent"] }[];
  readonly roadCharacter: RideIntent["roadCharacter"];
  readonly novelty: NonNullable<RideIntent["noveltyPreference"]>;
  readonly surface: RideIntent["surface"]["preference"];
  readonly terrain: RideIntent["terrain"]["level"];
  readonly avoidHighways: boolean;
  readonly tollPolicy: RideIntent["tollPolicy"];
  readonly traffic: RideIntent["traffic"];
  readonly departure: string;
  readonly time: TimeIntent;
  readonly timeLabel: string;
  readonly unknowns: readonly string[];
}

export interface ReadyAdvisorProposal {
  readonly status: "ready";
  readonly command: Extract<RideCommand, { type: "proposal.apply" }>;
  readonly baseRevision: number;
  readonly changes: readonly AdvisorProposalChange[];
  readonly interpretation: AdvisorProposalInterpretation;
  readonly stopSearches: readonly AdvisorStopSearchRequest[];
  readonly timeBudgetMinutes: number | null;
  readonly notes: readonly string[];
  readonly summary: string;
}

/** A search-only proposal applies no ride mutation before the rider picks a place. */
export interface AdvisorSearchProposal {
  readonly status: "search";
  readonly baseRevision: number;
  readonly changes: readonly [];
  readonly stopSearches: readonly AdvisorStopSearchRequest[];
  readonly timeBudgetMinutes: number | null;
  readonly notes: readonly string[];
  readonly summary: string;
}

export type AdvisorReadyProposal = ReadyAdvisorProposal | AdvisorSearchProposal;

export type AdvisorProposalBuildResult =
  | ReadyAdvisorProposal
  | AdvisorSearchProposal
  | { readonly status: "answer"; readonly message: string }
  | { readonly status: "clarification"; readonly message: string }
  | { readonly status: "unsupported"; readonly message: string }
  | {
      readonly status: "error";
      readonly errorClass: AdvisorErrorClass;
      readonly message: string;
      readonly recovery: "retry" | "refresh" | "none";
    };

function failure(errorClass: AdvisorErrorClass): AdvisorProposalBuildResult {
  return { status: "error", ...advisorRiderState(errorClass) };
}

function finiteLocalDateTimeToIso(date: string, time: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return null;
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) {
    return null;
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const checkDate = new Date(localAsUtc);
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) return null;

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    let candidate = localAsUtc;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
      );
      const representedUtc = Date.UTC(
        Number(parts["year"]),
        Number(parts["month"]) - 1,
        Number(parts["day"]),
        Number(parts["hour"]),
        Number(parts["minute"]),
      );
      candidate = localAsUtc - (representedUtc - candidate);
    }
    const finalParts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    if (
      finalParts["year"] !== String(year).padStart(4, "0") ||
      finalParts["month"] !== String(month).padStart(2, "0") ||
      finalParts["day"] !== String(day).padStart(2, "0") ||
      finalParts["hour"] !== String(hour).padStart(2, "0") ||
      finalParts["minute"] !== String(minute).padStart(2, "0")
    ) return null;
    return new Date(candidate).toISOString();
  } catch {
    return null;
  }
}

function timeFromDraft(draft: AdvisorDraft): TimeIntent | null {
  const fields = draft.fields;
  switch (fields.rideTimeKind) {
    case "unchanged": return null;
    case "none": return { kind: "none" };
    case "budget": {
      const minutes = fields.rideTimeMinutes;
      if (minutes === null || !Number.isInteger(minutes) || minutes < 15 || minutes > 1_440) return null;
      return { kind: "budget", targetMinutes: minutes, toleranceMinutes: defaultLoopToleranceMinutes(minutes) };
    }
    case "returnBy":
    case "arriveBy": {
      const localTime = fields.rideTimeLocalTime;
      const date = fields.rideTimeDate ?? draft.localDate;
      if (localTime === null || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
      return { kind: fields.rideTimeKind, localTime, date, toleranceMinutes: 15 };
    }
  }
}

function timeBudgetMinutes(intent: RideIntent, timeZone: string, now: Date): number | null {
  if (intent.time.kind === "budget") return intent.time.targetMinutes;
  if (intent.time.kind !== "returnBy" && intent.time.kind !== "arriveBy") return null;
  const deadline = finiteLocalDateTimeToIso(intent.time.date, intent.time.localTime, timeZone);
  if (deadline === null) return null;
  const departure = intent.departure.kind === "future" ? Date.parse(intent.departure.at) : now.getTime();
  return Number.isFinite(departure) ? Math.max(0, (Date.parse(deadline) - departure) / 60_000) : null;
}

function searchOnlyProposal(document: RideDocument, draft: AdvisorDraft, now: Date, intent = document.intent): AdvisorSearchProposal {
  return {
    status: "search",
    baseRevision: document.revision,
    changes: [],
    stopSearches: draft.fields.stopSearches ?? [],
    timeBudgetMinutes: timeBudgetMinutes(intent, draft.timeZone, now),
    notes: draft.notes,
    summary: "Choose places to add, then replan.",
  };
}

function base(document: RideDocument, label: string) {
  return {
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "advisor" as const,
    label,
  };
}

function shapeLabel(value: RideIntent["shape"]): string {
  return value === "destination" ? "A to B" : value === "loop" ? "Loop" : "Open ride";
}

/** One local clock time as the rider reads it: "6:00 pm", never "18:00". */
function clockLabel(localTime: string): string {
  const [hourText = "0", minuteText = "00"] = localTime.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return localTime;
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minuteText} ${suffix}`;
}

/**
 * A rider-local date as words ("Sep 26"). The date is already the rider's own
 * local day, so the month and day names are formatted on that day rather than
 * shifted through a time zone again.
 */
function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function timeLabel(time: TimeIntent): string {
  if (time.kind === "none") return "No time target";
  if (time.kind === "budget") {
    const hours = time.targetMinutes / 60;
    return Number.isInteger(hours) ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${time.targetMinutes} minutes`;
  }
  return `${time.kind === "returnBy" ? "Back by" : "Arrive by"} ${clockLabel(time.localTime)} on ${dayLabel(time.date)}`;
}

function departureLabel(value: RideIntent["departure"], timeZone: string): string {
  if (value.kind === "now") return "Leave now";
  const date = new Date(value.at);
  if (!Number.isFinite(date.getTime())) return "Scheduled departure";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "Scheduled departure";
  }
}

function changesFor(before: RideIntent, after: RideIntent, timeZone: string): AdvisorProposalChange[] {
  const changes: AdvisorProposalChange[] = [];
  const add = (field: AdvisorProposalField, left: string, right: string): void => {
    if (left !== right) changes.push({ field, before: left, after: right });
  };
  add("shape", shapeLabel(before.shape), shapeLabel(after.shape));
  add("start", before.start?.label ?? "No start set", after.start?.label ?? "No start set");
  add("finish", before.finish?.label ?? "No finish set", after.finish?.label ?? "No finish set");
  const stopSummary = (stops: RideIntent["stops"]): string =>
    stops.length === 0 ? "No stops" : stops.map((stop) => stop.label ?? "Unnamed stop").join(", ");
  add("stop", stopSummary(before.stops), stopSummary(after.stops));
  add("time", timeLabel(before.time), timeLabel(after.time));
  add("departure", departureLabel(before.departure, timeZone), departureLabel(after.departure, timeZone));
  add("roadCharacter", before.roadCharacter, after.roadCharacter);
  add("novelty", before.noveltyPreference ?? "balanced", after.noveltyPreference ?? "balanced");
  add("surface", before.surface.preference, after.surface.preference);
  add("terrain", before.terrain.level, after.terrain.level);
  add("highways", before.avoidHighways ? "Avoid" : "Allowed", after.avoidHighways ? "Avoid" : "Allowed");
  add("tolls", before.tollPolicy === "avoid" ? "Avoid" : "Allowed with warning", after.tollPolicy === "avoid" ? "Avoid" : "Allowed with warning");
  const trafficLabel = (traffic: RideIntent["traffic"]): string => (traffic === "protect-ride" ? "Avoid busy roads" : "Fastest through traffic");
  add("traffic", trafficLabel(before.traffic), trafficLabel(after.traffic));
  return changes;
}

/**
 * Re-validates a draft the server already returned against the ride as it is
 * now, so a stale proposal can be refreshed without another model call, more
 * latency or more of the shared daily budget. The model's intent does not
 * change; only the revision it is applied to moves forward.
 */
export function refreshAdvisorProposal(
  document: RideDocument,
  draft: AdvisorDraft,
  options: { readonly now?: string } = {},
): AdvisorProposalBuildResult {
  if (document.rideId !== draft.rideId) return failure("stale-revision");
  return buildAdvisorProposal(document, { ...draft, baseRevision: document.revision }, options);
}

/** Builds a revision-fenced proposal and dry-runs it through the domain reducer. */
export function buildAdvisorProposal(
  document: RideDocument,
  draft: AdvisorDraft,
  options: { readonly now?: string } = {},
): AdvisorProposalBuildResult {
  if (document.rideId !== draft.rideId || document.revision !== draft.baseRevision) {
    return failure("stale-revision");
  }
  if (draft.outcome === "answer") {
    return { status: "answer", message: draft.answer ?? "Plan a ride first so I can explain it." };
  }
  if (draft.outcome === "clarification") {
    const messages = {
      "ride-time": "I couldn't understand the ride time. Try a duration such as 2 hours.",
      place: "I couldn't match that place. Try a town or address.",
      referent: "Choose a place or road on the map first.",
      other: "I need one more detail before I can suggest ride changes.",
    } as const;
    return { status: "clarification", message: messages[draft.clarification ?? "other"] };
  }
  if (draft.outcome === "unsupported") {
    return { status: "unsupported", message: advisorRiderState("unsupported-action").message };
  }

  const fields = draft.fields;
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime())) return failure("invalid-request");
  const requestedTime = fields.rideTimeKind === "returnBy" || fields.rideTimeKind === "arriveBy"
    ? { date: fields.rideTimeDate ?? draft.localDate, time: fields.rideTimeLocalTime }
    : fields.departureKind === "future"
      ? { date: fields.departureLocalDate ?? draft.localDate, time: fields.departureLocalTime }
      : null;
  if (requestedTime !== null) {
    const instant = requestedTime.time === null
      ? null
      : finiteLocalDateTimeToIso(requestedTime.date, requestedTime.time, draft.timeZone);
    if (instant === null) {
      return { status: "clarification", message: "I couldn't understand that local ride time. Choose a valid date and time." };
    }
    if (Date.parse(instant) <= now.getTime()) {
      return { status: "clarification", message: "That ride time has already passed. Choose a later time." };
    }
  }
  const operations: RideCommandOp[] = [];
  if (fields.shape !== null) {
    operations.push({ ...base(document, "Change ride shape"), type: "ride.shape.set", shape: fields.shape });
  }
  if (fields.startPlace !== null) {
    const place = draft.resolvedPlaces.start;
    if (place === null) return failure("grounding-failed");
    operations.push({
      ...base(document, "Set ride start"),
      type: "start.set",
      point: {
        id: newPointId(),
        kind: "start",
        coordinate: place.coordinate,
        label: place.label,
        provenance: { type: "search", provider: place.provider, placeId: place.id, query: fields.startPlace },
      },
    });
  }
  if (fields.finishPlace !== null) {
    const place = draft.resolvedPlaces.finish;
    if (place === null) return failure("grounding-failed");
    operations.push({
      ...base(document, "Set ride finish"),
      type: "finish.set",
      point: {
        id: newPointId(),
        kind: "finish",
        coordinate: place.coordinate,
        label: place.label,
        provenance: { type: "search", provider: place.provider, placeId: place.id, query: fields.finishPlace },
      },
    });
  }
  if (fields.stopPlace !== null) {
    const place = draft.resolvedPlaces.stop;
    if (place === null || fields.stopArrivalIntent === null) return failure("grounding-failed");
    operations.push({
      ...base(document, "Add ride stop"),
      type: "stop.insert",
      stop: {
        id: newStopId(),
        kind: "stop",
        coordinate: place.coordinate,
        label: place.label,
        arrivalIntent: fields.stopArrivalIntent,
        provenance: { type: "search", provider: place.provider, placeId: place.id, query: fields.stopPlace },
      },
    });
  } else if (fields.stopArrivalIntent !== null || draft.resolvedPlaces.stop !== null) {
    return failure("invalid-request");
  }
  if (fields.rideTimeKind !== "unchanged") {
    const time = timeFromDraft(draft);
    if (time === null) return failure("invalid-request");
    operations.push({ ...base(document, "Set ride time"), type: "time.set", time });
  }
  if (fields.departureKind !== "unchanged") {
    const departure = fields.departureKind === "now"
      ? { kind: "now" as const }
      : fields.departureLocalTime === null
        ? null
        : {
            kind: "future" as const,
            at: finiteLocalDateTimeToIso(
              fields.departureLocalDate ?? draft.localDate,
              fields.departureLocalTime,
              draft.timeZone,
            ) ?? "",
          };
    if (departure === null || (departure.kind === "future" && departure.at === "")) {
      return failure("invalid-request");
    }
    operations.push({ ...base(document, "Set departure time"), type: "departure.set", departure });
  }
  if (fields.roadCharacter !== null) {
    operations.push({ ...base(document, "Set road character"), type: "roadCharacter.set", roadCharacter: fields.roadCharacter });
  }
  if (fields.noveltyPreference !== null) {
    operations.push({
      ...base(document, "Set road familiarity"),
      type: "noveltyPreference.set",
      noveltyPreference: fields.noveltyPreference,
    });
  }
  if (fields.surfacePreference !== null) {
    operations.push({
      ...base(document, "Set surface preference"),
      type: "surface.set",
      surface: { ...document.intent.surface, preference: fields.surfacePreference },
    });
  }
  if (fields.terrainLevel !== null) {
    operations.push({
      ...base(document, "Set terrain preference"),
      type: "terrain.set",
      terrain: { ...document.intent.terrain, level: fields.terrainLevel },
    });
  }
  if (fields.avoidHighways !== null) {
    operations.push({ ...base(document, "Set highway preference"), type: "highwayPolicy.set", avoid: fields.avoidHighways });
  }
  if (fields.tollPolicy !== null) {
    operations.push({ ...base(document, "Set toll preference"), type: "tollPolicy.set", tollPolicy: fields.tollPolicy });
  }
  if (fields.trafficPreference !== null) {
    operations.push({ ...base(document, "Set traffic preference"), type: "trafficPreference.set", traffic: fields.trafficPreference });
  }
  const stopSearches = fields.stopSearches ?? [];
  if (operations.length === 0) {
    return stopSearches.length > 0
      ? searchOnlyProposal(document, draft, now)
      : { status: "unsupported", message: "The advisor did not find a ride setting to change." };
  }

  const command: Extract<RideCommand, { type: "proposal.apply" }> = {
    ...base(document, "Apply ride description"),
    type: "proposal.apply",
    proposalId: `advisor_${crypto.randomUUID()}`,
    operations,
  };
  const validation = applyRideCommand(document, command, options.now === undefined ? {} : { now: options.now });
  if (validation.outcome === "stale") return failure("stale-revision");
  if (validation.outcome === "invalid") return failure("invalid-request");
  if (validation.outcome === "noop") {
    return stopSearches.length > 0
      ? searchOnlyProposal(document, draft, now)
      : { status: "unsupported", message: "This ride already matches those settings." };
  }
  const changes = changesFor(document.intent, validation.document.intent, draft.timeZone);
  if (changes.length === 0) {
    return stopSearches.length > 0
      ? searchOnlyProposal(document, draft, now, validation.document.intent)
      : { status: "unsupported", message: "This ride already matches those settings." };
  }
  const changedFields = new Set(changes.map((change) => change.field));
  const operationField: Partial<Record<RideCommandOp["type"], AdvisorProposalField>> = {
    "ride.shape.set": "shape",
    "start.set": "start",
    "finish.set": "finish",
    "stop.insert": "stop",
    "time.set": "time",
    "departure.set": "departure",
    "roadCharacter.set": "roadCharacter",
    "noveltyPreference.set": "novelty",
    "surface.set": "surface",
    "terrain.set": "terrain",
    "highwayPolicy.set": "highways",
    "tollPolicy.set": "tolls",
    "trafficPreference.set": "traffic",
  };
  const effectiveCommand = {
    ...command,
    operations: operations.filter((operation) => {
      const field = operationField[operation.type];
      return field !== undefined && changedFields.has(field);
    }),
  };
  const effectiveValidation = applyRideCommand(
    document,
    effectiveCommand,
    options.now === undefined ? {} : { now: options.now },
  );
  if (effectiveValidation.outcome !== "applied") return failure("invalid-request");
  return {
    status: "ready",
    command: effectiveCommand,
    baseRevision: document.revision,
    changes,
    interpretation: {
      shape: effectiveValidation.document.intent.shape,
      start: effectiveValidation.document.intent.start?.label ?? null,
      finish: effectiveValidation.document.intent.finish?.label ?? null,
      stops: effectiveValidation.document.intent.stops.map((stop) => ({ label: stop.label, arrivalIntent: stop.arrivalIntent })),
      roadCharacter: effectiveValidation.document.intent.roadCharacter,
      novelty: effectiveValidation.document.intent.noveltyPreference ?? "balanced",
      surface: effectiveValidation.document.intent.surface.preference,
      terrain: effectiveValidation.document.intent.terrain.level,
      avoidHighways: effectiveValidation.document.intent.avoidHighways,
      tollPolicy: effectiveValidation.document.intent.tollPolicy,
      traffic: effectiveValidation.document.intent.traffic,
      departure: departureLabel(effectiveValidation.document.intent.departure, draft.timeZone),
      time: effectiveValidation.document.intent.time,
      timeLabel: timeLabel(effectiveValidation.document.intent.time),
      unknowns: draft.notes,
    },
    stopSearches,
    timeBudgetMinutes: timeBudgetMinutes(effectiveValidation.document.intent, draft.timeZone, now),
    notes: draft.notes,
    summary: "Review the proposed changes before applying them.",
  };
}
