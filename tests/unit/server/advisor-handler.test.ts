import { describe, expect, it, vi } from "vitest";

import {
  advisorContextFromDocument,
  parseAdvisorRequest,
  type AdvisorModelFields,
  type AdvisorTransport,
} from "@/application/advisor";
import type { PlaceSearchPort } from "@/application/geocoding/place-search";
import { createRideDocument } from "@/domain/ride/create";
import { handleAdvisorRequest, MAX_ADVISOR_REQUEST_BYTES } from "@/server/advisor/handler";
import { createDailyCap, createRateLimiter } from "@/server/rate-limit";

const FIELDS: AdvisorModelFields = {
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

const DOCUMENT = createRideDocument({ now: "2026-09-24T12:00:00.000Z" });
const INPUT = {
  prompt: "My email is rider@example.test. Make this a paved loop.",
  rideId: DOCUMENT.rideId,
  baseRevision: DOCUMENT.revision,
  context: advisorContextFromDocument(DOCUMENT, {
    now: new Date("2026-09-24T12:00:00.000Z"),
    timeZone: "America/New_York",
  }),
};
const FIXTURE_OUTPUT = JSON.stringify({
  outcome: "unsupported",
  clarification: null,
  fields: FIELDS,
  unmappedDetails: [],
});

function makeRequest(body: string, headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/advisor", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function dependencies(input: {
  readonly transport?: AdvisorTransport | null;
  readonly limiter?: ReturnType<typeof createRateLimiter>;
} = {}) {
  const places: PlaceSearchPort = {
    async search() { return { status: "ok", places: [] }; },
    async reverse() { return null; },
  };
  const transport: AdvisorTransport | null = input.transport === undefined
    ? {
    async send(request) {
      capturedMessages.push(JSON.stringify(request.messages));
      return { ok: true, text: FIXTURE_OUTPUT };
    },
    }
    : input.transport;
  return {
    transport,
    places,
    limiter: input.limiter ?? createRateLimiter({ windowMs: 60_000, max: 8, now: () => 0 }),
  };
}

let capturedMessages: string[] = [];

describe("advisor HTTP handler", () => {
  it("understands a written hyphenated duration while keeping the rider's other requests", async () => {
    const transport: AdvisorTransport = {
      async send(request) {
        const riderRequest = JSON.parse(request.messages[1]?.content ?? "{}") as { riderRequest?: string };
        if (riderRequest.riderRequest !== "Make this a 2 hour loop on mostly paved backroads and avoid highways") {
          return { ok: true, text: FIXTURE_OUTPUT };
        }
        return { ok: true, text: JSON.stringify({
          outcome: "proposal",
          clarification: null,
          fields: { ...FIELDS, shape: "loop", rideTimeKind: "budget", rideTimeMinutes: 120, roadCharacter: "backroads", surfacePreference: "mostly-pavement", avoidHighways: true },
          unmappedDetails: [],
        }) };
      },
    };
    const response = await handleAdvisorRequest(makeRequest(JSON.stringify({
      ...INPUT,
      prompt: "Make this a two-hour loop on mostly paved backroads and avoid highways",
    })), dependencies({ transport }));
    const body = await response.json() as { draft?: { outcome?: string; fields?: AdvisorModelFields } };

    expect(response.status).toBe(200);
    expect(body.draft?.outcome).toBe("proposal");
    expect(body.draft?.fields).toMatchObject({ shape: "loop", rideTimeMinutes: 120, roadCharacter: "backroads", avoidHighways: true });
  });

  it("redacts contact details and credentials before sending rider text to the model", async () => {
    capturedMessages = [];
    const sensitiveInput = {
      ...INPUT,
      prompt: "My name is Alice Smith. I'm Alice Smith; my email is rider@example.test; my password is hunter2 api_key=sk-12345678901234567890 PIN=3817 my pin is 2468 phone 555-111-2222. Make a paved loop.",
    };
    const response = await handleAdvisorRequest(makeRequest(JSON.stringify(sensitiveInput)), dependencies());
    const body = await response.json() as { draft?: { outcome?: string; rideId?: string } };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.draft).toMatchObject({ outcome: "unsupported", rideId: DOCUMENT.rideId });
    expect(capturedMessages.join(" ")).not.toContain("rider@example.test");
    expect(capturedMessages.join(" ")).not.toContain("Alice");
    expect(capturedMessages.join(" ")).not.toContain("hunter2");
    expect(capturedMessages.join(" ")).not.toContain("sk-12345678901234567890");
    expect(capturedMessages.join(" ")).not.toContain("3817");
    expect(capturedMessages.join(" ")).not.toContain("2468");
    expect(capturedMessages.join(" ")).not.toContain("555-111-2222");
    expect(capturedMessages.join(" ")).not.toContain(DOCUMENT.rideId);
  });

  it("keeps the advisor honestly unavailable without a configured key", async () => {
    capturedMessages = [];
    const response = await handleAdvisorRequest(
      makeRequest(JSON.stringify(INPUT)),
      dependencies({ transport: null }),
    );
    const body = await response.json() as { error?: { class?: string; message?: string } };

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({ class: "unavailable", message: "The advisor is unavailable right now." });
    expect(body.error?.message).not.toMatch(/key|openrouter|api/i);
    expect(capturedMessages).toEqual([]);
  });

  it("rejects oversized and malformed payloads before a provider call", async () => {
    const transport: AdvisorTransport = { send: vi.fn() };
    const deps = dependencies({ transport });
    const oversized = await handleAdvisorRequest(
      makeRequest("x", { "content-length": String(MAX_ADVISOR_REQUEST_BYTES + 1) }),
      deps,
    );
    const malformed = await handleAdvisorRequest(makeRequest("{bad json"), deps);

    expect(oversized.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("rejects extra nested ride-context fields before they reach the model", () => {
    expect(parseAdvisorRequest(INPUT)).not.toBeNull();
    expect(parseAdvisorRequest({
      ...INPUT,
      context: {
        ...INPUT.context,
        time: { ...INPUT.context.time, riderSecret: "must not pass" },
      },
    })).toBeNull();
    expect(parseAdvisorRequest({
      ...INPUT,
      context: { ...INPUT.context, injectedContext: "must not pass" },
    })).toBeNull();
  });

  it("rate limits repeated proposals and reports a bounded retry delay", async () => {
    const transport: AdvisorTransport = {
      async send() { return { ok: true, text: FIXTURE_OUTPUT }; },
    };
    const deps = dependencies({
      transport,
      limiter: createRateLimiter({ windowMs: 60_000, max: 1, now: () => 10_000 }),
    });
    const first = await handleAdvisorRequest(makeRequest(JSON.stringify(INPUT)), deps);
    const second = await handleAdvisorRequest(makeRequest(JSON.stringify(INPUT)), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
  });
  it("stops calling the model once the daily budget is spent, for every client", async () => {
    const send = vi.fn(async () => ({ ok: true as const, text: FIXTURE_OUTPUT }));
    const deps = { ...dependencies({ transport: { send } }), dailyCap: createDailyCap(1, () => 0) };
    const first = await handleAdvisorRequest(makeRequest(JSON.stringify(INPUT)), deps);
    const second = await handleAdvisorRequest(makeRequest(JSON.stringify(INPUT)), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
