import { describe, expect, it } from "vitest";

import {
  advisorContextFromDocument,
  buildAdvisorProposal,
  requestAdvisorDraft,
  type AdvisorModelFields,
} from "@/application/advisor";
import type { AdvisorMessage, AdvisorTransport, AdvisorTransportRequest } from "@/application/advisor";
import type { PlaceMatch, PlaceSearchPort } from "@/application/geocoding/place-search";
import { createRideDocument } from "@/domain/ride/create";
import type { RideDocument } from "@/domain/ride/types";

const EVAL_NOW = new Date("2026-09-24T12:00:00.000Z");
const PLACES: Readonly<Record<string, PlaceMatch>> = {
  "Jim Thorpe": {
    id: "fixture:jim-thorpe",
    label: "Jim Thorpe, PA",
    name: "Jim Thorpe",
    context: "Carbon County, PA",
    coordinate: { lat: 40.8759, lon: -75.7324 },
    provider: "fixture",
  },
  Bethlehem: {
    id: "fixture:bethlehem",
    label: "Bethlehem, PA",
    name: "Bethlehem",
    context: "Lehigh County, PA",
    coordinate: { lat: 40.6259, lon: -75.3705 },
    provider: "fixture",
  },
  "Hawk Mountain": {
    id: "fixture:hawk-mountain",
    label: "Hawk Mountain Sanctuary, PA",
    name: "Hawk Mountain Sanctuary",
    context: "Berks County, PA",
    coordinate: { lat: 40.6376, lon: -75.9944 },
    provider: "fixture",
  },
  "coffee shop in Jim Thorpe": {
    id: "fixture:jim-thorpe-coffee-house",
    label: "Jim Thorpe Coffee House, Jim Thorpe, PA",
    name: "Jim Thorpe Coffee House",
    context: "Jim Thorpe, PA",
    coordinate: { lat: 40.8754, lon: -75.7321 },
    provider: "fixture",
  },
};

const unchanged: AdvisorModelFields = {
  shape: null,
  startPlace: null,
  finishPlace: null,
  stopPlace: null,
  stopArrivalIntent: null,
  rideTimeKind: "unchanged",
  rideTimeMinutes: null,
  rideTimeDate: null,
  rideTimeLocalTime: null,
  roadCharacter: null,
  noveltyPreference: null,
  surfacePreference: null,
  terrainLevel: null,
  avoidHighways: null,
  tollPolicy: null,
  trafficPreference: null,
  departureKind: "unchanged",
  departureLocalDate: null,
  departureLocalTime: null,
};

interface EvalCase {
  readonly prompt: string;
  readonly outcome?: "proposal" | "clarification" | "unsupported";
  readonly clarification?: "ride-time" | "place" | "referent" | "other" | null;
  readonly fields?: Partial<AdvisorModelFields>;
  readonly extraProposalFields?: Readonly<Record<string, unknown>>;
  readonly unmappedDetails?: readonly string[];
  readonly extraFields?: Readonly<Record<string, unknown>>;
  readonly expectedOperations?: readonly string[];
  readonly expectedChanges?: readonly string[];
}

/** Fourteen fixed rider prompts; no live model, network, or clock enters this eval. */
const cases: readonly EvalCase[] = [
  {
    prompt: "Two hours of twisty backroads from Jim Thorpe, avoid highways",
    fields: { shape: "loop", startPlace: "Jim Thorpe", rideTimeKind: "budget", rideTimeMinutes: 120, roadCharacter: "backroads", avoidHighways: true },
    expectedOperations: ["ride.shape.set", "start.set", "time.set", "roadCharacter.set", "highwayPolicy.set"],
    expectedChanges: ["shape", "start", "time", "roadCharacter", "highways"],
  },
  {
    prompt: "Ride from Bethlehem to Hawk Mountain, mostly pavement",
    fields: { shape: "destination", startPlace: "Bethlehem", finishPlace: "Hawk Mountain", surfacePreference: "mostly-pavement" },
    expectedOperations: ["start.set", "finish.set", "surface.set"],
    expectedChanges: ["start", "finish", "surface"],
  },
  {
    prompt: "Make this route curvier",
    fields: { roadCharacter: "curvy" },
    expectedOperations: ["roadCharacter.set"],
    expectedChanges: ["roadCharacter"],
  },
  {
    prompt: "Avoid highways and toll roads",
    fields: { avoidHighways: true, tollPolicy: "avoid" },
    expectedOperations: ["highwayPolicy.set"],
    expectedChanges: ["highways"],
  },
  {
    prompt: "Make it a 90 minute loop",
    fields: { shape: "loop", rideTimeKind: "budget", rideTimeMinutes: 90 },
    expectedOperations: ["ride.shape.set", "time.set"],
    expectedChanges: ["shape", "time"],
  },
  {
    prompt: "Go from Jim Thorpe to Bethlehem by the direct route",
    fields: { shape: "destination", startPlace: "Jim Thorpe", finishPlace: "Bethlehem", roadCharacter: "efficient" },
    expectedOperations: ["start.set", "finish.set", "roadCharacter.set"],
    expectedChanges: ["start", "finish", "roadCharacter"],
  },
  {
    prompt: "Leave tomorrow at 8 AM",
    fields: { departureKind: "future", departureLocalDate: "2026-09-25", departureLocalTime: "08:00" },
    expectedOperations: ["departure.set"],
    expectedChanges: ["departure"],
  },
  {
    prompt: "Have me back by 4 today",
    fields: { rideTimeKind: "returnBy", rideTimeLocalTime: "16:00" },
    expectedOperations: ["time.set"],
    expectedChanges: ["time"],
  },
  {
    prompt: "Keep it paved and only use easy terrain",
    fields: { surfacePreference: "pavement", terrainLevel: "known-easy-only" },
    expectedOperations: ["surface.set", "terrain.set"],
    expectedChanges: ["surface", "terrain"],
  },
  {
    prompt: "Start at Jim Thorpe, make a two hour loop, leave now",
    fields: { shape: "loop", startPlace: "Jim Thorpe", rideTimeKind: "budget", rideTimeMinutes: 120, departureKind: "now" },
    expectedOperations: ["ride.shape.set", "start.set", "time.set"],
    expectedChanges: ["shape", "start", "time"],
  },
  {
    prompt: "Take me home",
    outcome: "unsupported",
    clarification: null,
  },
  {
    prompt: "Add coffee to this route",
    outcome: "clarification",
    clarification: "place",
  },
  {
    prompt: "Add a coffee stop in Jim Thorpe",
    extraProposalFields: { stopPlace: "coffee shop in Jim Thorpe", stopArrivalIntent: "food" },
    expectedOperations: ["stop.insert"],
    expectedChanges: ["stop"],
  },
  {
    prompt: "Mostly paved, and set the made-up adventure score to 4",
    fields: { surfacePreference: "mostly-pavement" },
    extraFields: { adventureScore: 4 },
    expectedOperations: ["surface.set"],
    expectedChanges: ["surface"],
  },
];

function outputFor(entry: EvalCase): string {
  return JSON.stringify({
    outcome: entry.outcome ?? "proposal",
    clarification: entry.clarification ?? null,
    fields: { ...unchanged, ...(entry.fields ?? {}), ...(entry.extraProposalFields ?? {}) },
    unmappedDetails: entry.unmappedDetails ?? [],
    ...(entry.extraFields ?? {}),
  });
}

type MutableModelOutput = Record<string, unknown> & {
  fields: Record<string, unknown>;
};

function fixtureTransport(): AdvisorTransport {
  return {
    async send(request: AdvisorTransportRequest) {
      const messages: readonly AdvisorMessage[] = request.messages;
      const user = JSON.parse(messages[1]?.content ?? "{}") as { riderRequest?: string };
      const entry = cases.find((item) => item.prompt === user.riderRequest);
      if (entry === undefined) return { ok: false, errorClass: "invalid-request", retryable: false, message: "invalid" };
      expect(request.outputSchema).toMatchObject({ name: "opengravel_ride_proposal" });
      return { ok: true, text: outputFor(entry) };
    },
  };
}

const places: PlaceSearchPort = {
  async search(query) {
    const place = PLACES[query];
    return { status: "ok", places: place === undefined ? [] : [place] };
  },
  async reverse() { return null; },
};

describe("M8 advisor rider-prompt eval", () => {
  it.each([
    {
      label: "omits a schema-required ride field",
      mutate: (output: MutableModelOutput) => { delete output.fields["surfacePreference"]; },
    },
    {
      label: "omits a schema-required clarification field",
      mutate: (output: MutableModelOutput) => { delete output["clarification"]; },
    },
    {
      label: "uses an invalid clarification enum value",
      mutate: (output: MutableModelOutput) => { output["clarification"] = "later-today"; },
    },
    {
      label: "attaches a clarification to a proposal outcome",
      mutate: (output: MutableModelOutput) => { output["clarification"] = "ride-time"; },
    },
    {
      label: "omits the clarification kind for a clarification outcome",
      mutate: (output: MutableModelOutput) => {
        output["outcome"] = "clarification";
        output["clarification"] = null;
      },
    },
  ])("rejects a model response that $label", async ({ mutate }) => {
    const document = createRideDocument({ now: EVAL_NOW.toISOString() });
    const output = JSON.parse(outputFor(cases[0]!)) as MutableModelOutput;
    mutate(output);
    const transport: AdvisorTransport = {
      async send() { return { ok: true, text: JSON.stringify(output) }; },
    };
    const result = await requestAdvisorDraft({
      prompt: cases[0]!.prompt,
      rideId: document.rideId,
      baseRevision: document.revision,
      context: advisorContextFromDocument(document, { now: EVAL_NOW, timeZone: "America/New_York" }),
    }, { transport, places });

    expect(result).toMatchObject({ ok: false, errorClass: "unavailable" });
  });

  it.each(cases)('understands "$prompt" through the fixture transport', async (entry) => {
    const document: RideDocument = createRideDocument({ now: EVAL_NOW.toISOString() });
    const request = {
      prompt: entry.prompt,
      rideId: document.rideId,
      baseRevision: document.revision,
      context: advisorContextFromDocument(document, {
        now: EVAL_NOW,
        timeZone: "America/New_York",
      }),
    };
    const response = await requestAdvisorDraft(request, {
      transport: fixtureTransport(),
      places,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.draft.outcome).toBe(entry.outcome ?? "proposal");
    if (response.draft.outcome !== "proposal") {
      expect(buildAdvisorProposal(document, response.draft, { now: EVAL_NOW.toISOString() }).status).toBe(entry.outcome);
      return;
    }
    const proposal = buildAdvisorProposal(document, response.draft, { now: EVAL_NOW.toISOString() });
    expect(proposal.status).toBe("ready");
    if (proposal.status !== "ready") return;
    expect(proposal.command.operations.map((operation) => operation.type)).toEqual(entry.expectedOperations);
    expect(proposal.changes.map((change) => change.field)).toEqual(entry.expectedChanges);
    expect(proposal.notes).toEqual(entry.unmappedDetails?.length || entry.extraFields !== undefined
      ? ["I left out a detail that does not map to a supported ride setting yet."]
      : []);
  });
});

describe("a weaker fallback model's habits", () => {
  async function draftFrom(output: Record<string, unknown>, search = places) {
    const document = createRideDocument({ now: EVAL_NOW.toISOString() });
    const transport: AdvisorTransport = { async send() { return { ok: true, text: JSON.stringify(output) }; } };
    return requestAdvisorDraft({
      prompt: "2 hour twisty loop from Jim Thorpe, no highways",
      rideId: document.rideId,
      baseRevision: document.revision,
      context: advisorContextFromDocument(document, { now: EVAL_NOW, timeZone: "America/New_York" }),
    }, { transport, places: search });
  }

  // Captured from Workers AI Llama 3.3 on 2026-09-26.
  const llama = {
    outcome: "proposal",
    clarification: null,
    fields: {
      ...unchanged, shape: "loop", startPlace: "Jim Thorpe", finishPlace: "unchanged",
      rideTimeKind: "budget", rideTimeMinutes: 120, roadCharacter: "balanced", avoidHighways: true, departureKind: "now",
    },
    unmappedDetails: ["twisty"],
  };

  it("reads a placeholder place as no change, never as a town to search for", async () => {
    const searched: string[] = [];
    const spy: PlaceSearchPort = { ...places, async search(query, options) { searched.push(query); return places.search(query, options); } };
    const result = await draftFrom(llama, spy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.finishPlace).toBeNull();
    expect(searched).not.toContain("unchanged");
  });

  it("maps a rider's 'twisty' to curvy roads when the model left it unmapped", async () => {
    const result = await draftFrom(llama);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fields.roadCharacter).toBe("curvy");
    expect(result.draft.notes).toEqual([]);
  });
});
