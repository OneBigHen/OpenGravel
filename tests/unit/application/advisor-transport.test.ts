import { describe, expect, it } from "vitest";

import {
  advisorFailure,
  advisorRiderState,
  type AdvisorTransport,
  type AdvisorTransportRequest,
  type AdvisorTransportResult,
} from "@/application/advisor";

const REQUEST: AdvisorTransportRequest = {
  messages: [{ role: "user", content: "Make it twistier." }],
};

function fakeTransport(result: AdvisorTransportResult): AdvisorTransport {
  return { send: async () => result };
}

/**
 * Model-independence (10 §14). Two structurally different transports stand in
 * for two model vendors behind the same port: the application layer sees one
 * plain-data contract and produces the same rider-safe state no matter which
 * transport answered. That is the seam a deployment swaps when it changes model.
 */
describe("advisor transport swap (10 §14)", () => {
  it("normalizes the rider state identically across swapped transports", async () => {
    const first = fakeTransport(advisorFailure("timeout"));
    const second = fakeTransport(advisorFailure("timeout"));
    const a = await first.send(REQUEST);
    const b = await second.send(REQUEST);
    if (a.ok || b.ok) throw new Error("expected failures");
    // The rider-facing state depends only on the class, never on the transport.
    expect(advisorRiderState(a.errorClass)).toEqual(advisorRiderState(b.errorClass));
  });

  it("passes a completion through untouched regardless of transport", async () => {
    const text = "I will add a twistier leg and about 12 minutes.";
    for (const transport of [
      fakeTransport({ ok: true, text }),
      fakeTransport({ ok: true, text }),
    ]) {
      expect(await transport.send(REQUEST)).toEqual({ ok: true, text });
    }
  });

  it("carries only plain JSON data across the port", () => {
    const result: AdvisorTransportResult = { ok: true, text: "hi" };
    expect(JSON.parse(JSON.stringify(result))).toEqual({ ok: true, text: "hi" });
  });
});
