import { expect, it } from "vitest";
import { readCommunityRouteUpload, MAX_ROUTE_UPLOAD_BYTES } from "@/server/community-routes/upload";

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/community/routes", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body, duplex: "half" } as RequestInit);
}
it("rejects cross-site publishing and non-JSON before reading", async () => {
  expect(await readCommunityRouteUpload(request("{}", { origin: "https://evil.test" }))).toMatchObject({ ok: false, status: 403 });
  expect(await readCommunityRouteUpload(request("{}", { "content-type": "text/plain" }))).toMatchObject({ ok: false, status: 415 });
});
it("bounds actual streamed bytes without trusting Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('"' + "é".repeat(MAX_ROUTE_UPLOAD_BYTES / 2) + '"')); controller.close(); } });
  expect(await readCommunityRouteUpload(request(stream, { "content-length": "1" }))).toMatchObject({ ok: false, status: 413 });
});
it("accepts valid same-origin JSON through the HTTPS proxy", async () => {
  expect(await readCommunityRouteUpload(request('{"name":"Ride","geometry":[[0,0],[1,1]]}', { host: "opengravel.henning.rodeo", "x-forwarded-proto": "https", origin: "https://opengravel.henning.rodeo" }))).toMatchObject({ ok: true, body: { name: "Ride" } });
});
it("rejects invalid UTF-8 and malformed JSON", async () => {
  expect(await readCommunityRouteUpload(request(new Uint8Array([255])))).toMatchObject({ ok: false, status: 400 });
  expect(await readCommunityRouteUpload(request("{"))).toMatchObject({ ok: false, status: 400 });
});
it("accepts the declared maximum combination of points, notes and three resized photos", async () => {
  const body = JSON.stringify({ name: "Ride", description: "x".repeat(2000), geometry: Array.from({ length: 20_000 }, () => [-75.123456789, 40.123456789]), photos: ["A".repeat(400_000), "A".repeat(400_000), "A".repeat(400_000)] });
  expect(await readCommunityRouteUpload(request(body))).toMatchObject({ ok: true });
});
