/**
 * The browser's `/api/discover` corridor client (OGV#13): a transport
 * failure, a validation error, or a malformed body all read as
 * "unavailable" rather than throwing into the ride (degrade silently).
 */

import { describe, expect, it, vi } from "vitest";

import { thinLine, createHttpDiscoverSource } from "@/infrastructure/discover/http-discover-source";

const LINE = [{ lon: -75.3, lat: 40.1 }, { lon: -75.2, lat: 40.2 }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchMockReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn<typeof fetch>(async () => jsonResponse(body, status));
}

describe("createHttpDiscoverSource", () => {
  it("posts the line as [lon, lat] pairs with the buffer, to /api/discover", async () => {
    const fetchMock = fetchMockReturning({ places: [] });
    const source = createHttpDiscoverSource({ fetch: fetchMock });
    await source.alongRoute(LINE, 2400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetchMock).mock.calls[0]!;
    expect(call[0]).toBe("/api/discover");
    const init = call[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      line: [[-75.3, 40.1], [-75.2, 40.2]],
      bufferMeters: 2400,
    });
  });

  it("prefixes the base path when one is configured", async () => {
    const fetchMock = fetchMockReturning({ places: [] });
    const source = createHttpDiscoverSource({ basePath: "/ogv", fetch: fetchMock });
    await source.alongRoute(LINE, 2400);
    expect(vi.mocked(fetchMock).mock.calls[0]![0]).toBe("/ogv/api/discover");
  });

  it("returns the places when the body is well-formed", async () => {
    const places = [{ id: "wikidata:Q1", name: "Ringing Rocks", coordinate: { lon: -75.1, lat: 40.5 } }];
    const source = createHttpDiscoverSource({ fetch: fetchMockReturning({ places }) });
    const answer = await source.alongRoute(LINE, 2400);
    expect(answer).toEqual({ available: true, places });
  });

  it("reports unavailable on a non-OK response", async () => {
    const source = createHttpDiscoverSource({ fetch: fetchMockReturning({ error: { code: "validation" } }, 400) });
    expect(await source.alongRoute(LINE, 2400)).toEqual({ available: false, places: [] });
  });

  it("reports unavailable when a place is missing required fields", async () => {
    const source = createHttpDiscoverSource({ fetch: fetchMockReturning({ places: [{ id: "x" }] }) });
    expect(await source.alongRoute(LINE, 2400)).toEqual({ available: false, places: [] });
  });

  it("reports unavailable when fetch itself throws", async () => {
    const source = createHttpDiscoverSource({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await source.alongRoute(LINE, 2400)).toEqual({ available: false, places: [] });
  });

  it("rethrows an abort so the caller's own signal handling still works", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = createHttpDiscoverSource({ fetch: vi.fn(async () => { throw new Error("aborted"); }) });
    await expect(source.alongRoute(LINE, 2400, controller.signal)).rejects.toThrow("aborted");
  });
});

describe("thinLine", () => {
  it("keeps short lines and thins long ones to the limit, ends kept", () => {
    const line = Array.from({ length: 9_001 }, (_, index) => ({ lon: index / 1_000, lat: 40 }));
    const thinned = thinLine(line);
    expect(thinned).toHaveLength(4_000);
    expect(thinned[0]).toEqual(line[0]);
    expect(thinned.at(-1)).toEqual(line.at(-1));
    expect(thinLine(line.slice(0, 10))).toHaveLength(10);
  });
});
