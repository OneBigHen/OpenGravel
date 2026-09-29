import { describe, expect, it, vi } from "vitest";

import { advisorRequestForDocument } from "@/application/advisor";
import { createRideDocument } from "@/domain/ride/create";
import { createAdvisorApiClient } from "@/infrastructure/advisor/advisor-api-client";

const DOCUMENT = createRideDocument({ now: "2026-09-24T12:00:00.000Z" });
const REQUEST = advisorRequestForDocument(DOCUMENT, "Make a 2 hour loop", {
  now: new Date("2026-09-24T12:00:00.000Z"),
  timeZone: "America/New_York",
});
const DRAFT = {
  rideId: DOCUMENT.rideId,
  baseRevision: 0,
  localDate: "2026-09-24",
  timeZone: "America/New_York",
  outcome: "unsupported",
  clarification: null,
  fields: {
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
    surfacePreference: null,
    terrainLevel: null,
    avoidHighways: null,
    tollPolicy: null,
    departureKind: "unchanged",
    departureLocalDate: null,
    departureLocalTime: null,
  },
  resolvedPlaces: { start: null, finish: null, stop: null },
  notes: [],
};

describe("advisor browser API adapter", () => {
  it("posts the bounded request to the app route and validates its draft", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ draft: DRAFT }), { status: 200 }),
    );
    const client = createAdvisorApiClient({ fetcher });
    const result = await client.request(REQUEST);

    expect(result).toMatchObject({ ok: true, draft: { outcome: "unsupported" } });
    expect(fetcher).toHaveBeenCalledWith("/api/advisor", expect.objectContaining({ method: "POST" }));
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(REQUEST);
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("does not expose provider error details and rejects malformed place coordinates", async () => {
    const errorClient = createAdvisorApiClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ error: { class: "unavailable", message: "https://private.example/token" } }),
        { status: 503 },
      )),
    });
    const failure = await errorClient.request(REQUEST);
    expect(failure).toMatchObject({ ok: false, message: "The advisor is unavailable right now." });
    expect(JSON.stringify(failure)).not.toContain("private.example");

    const malformedClient = createAdvisorApiClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        draft: {
          ...DRAFT,
          outcome: "proposal",
          fields: { ...DRAFT.fields, startPlace: "Town" },
          resolvedPlaces: {
            start: {
              id: "model:fake",
              label: "Fake place",
              name: "Fake place",
              context: "",
              provider: "model",
              coordinate: { lat: 91, lon: 0 },
            },
            finish: null,
            stop: null,
          },
        },
      }), { status: 200 })),
    });
    expect(await malformedClient.request(REQUEST)).toMatchObject({ ok: false, errorClass: "unavailable" });
  });
});
