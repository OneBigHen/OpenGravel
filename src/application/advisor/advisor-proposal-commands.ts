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
  | "tolls";

export interface AdvisorProposalChange {
  readonly field: AdvisorProposalField;
  readonly before: string;
  readonly after: string;
}

export interface ReadyAdvisorProposal {
  readonly status: "ready";
  readonly command: Extract<RideCommand, { type: "proposal.apply" }>;
  readonly changes: readonly AdvisorProposalChange[];
  readonly notes: readonly string[];
  readonly summary: string;
}

export type AdvisorProposalBuildResult =
  | ReadyAdvisorProposal
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

function timeLabel(time: TimeIntent): string {
  if (time.kind === "none") return "No time target";
  if (time.kind === "budget") {
    const hours = time.targetMinutes / 60;
    return Number.isInteger(hours) ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${time.targetMinutes} minutes`;
  }
  return `${time.kind === "returnBy" ? "Back by" : "Arrive by"} ${time.localTime} on ${time.date}`;
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
  return changes;
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
  if (operations.length === 0) return { status: "unsupported", message: "The advisor did not find a ride setting to change." };

  const command: Extract<RideCommand, { type: "proposal.apply" }> = {
    ...base(document, "Apply ride description"),
    type: "proposal.apply",
    proposalId: `advisor_${crypto.randomUUID()}`,
    operations,
  };
  const validation = applyRideCommand(document, command, options.now === undefined ? {} : { now: options.now });
  if (validation.outcome === "stale") return failure("stale-revision");
  if (validation.outcome === "invalid") return failure("invalid-request");
  if (validation.outcome === "noop") return { status: "unsupported", message: "This ride already matches those settings." };
  const changes = changesFor(document.intent, validation.document.intent, draft.timeZone);
  if (changes.length === 0) return { status: "unsupported", message: "This ride already matches those settings." };
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
    changes,
    notes: draft.notes,
    summary: "Review the proposed changes before applying them.",
  };
}
