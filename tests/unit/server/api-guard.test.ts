import { describe, expect, it } from "vitest";

import { createApiGuard, guarded } from "@/server/api-guard";
import { createConcurrencyGate, createDailyCap } from "@/server/rate-limit";

const request = (ip = "203.0.113.5") => new Request("https://ogv.test/api/x", { headers: { "x-real-ip": ip } });
const ok = () => Promise.resolve(Response.json({ ok: true }));

describe("guarded", () => {
  it("answers 429 with Retry-After once a client passes its per-minute budget", async () => {
    const guard = createApiGuard({ perMinute: 2 });
    expect((await guarded(guard, request(), ok)).status).toBe(200);
    expect((await guarded(guard, request(), ok)).status).toBe(200);
    const limited = await guarded(guard, request(), ok);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another client is unaffected.
    expect((await guarded(guard, request("203.0.113.9"), ok)).status).toBe(200);
  });

  it("sheds load past the concurrency cap and frees the slot afterwards", async () => {
    const guard = createApiGuard({ perMinute: 100, maxConcurrent: 1 });
    let finish: () => void = () => undefined;
    const slow = guarded(guard, request("198.51.100.1"), () => new Promise((resolve) => {
      finish = () => resolve(Response.json({ ok: true }));
    }));
    const shed = await guarded(guard, request("198.51.100.2"), ok);
    expect(shed.status).toBe(429);
    finish();
    expect((await slow).status).toBe(200);
    expect((await guarded(guard, request("198.51.100.3"), ok)).status).toBe(200);
  });

  it("releases the slot when the work throws", async () => {
    const guard = createApiGuard({ perMinute: 100, maxConcurrent: 1 });
    await expect(guarded(guard, request(), () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect((await guarded(guard, request("198.51.100.4"), ok)).status).toBe(200);
  });
});

describe("createConcurrencyGate", () => {
  it("ignores a double release", () => {
    const gate = createConcurrencyGate(1);
    const release = gate.acquire();
    release?.();
    release?.();
    expect(gate.acquire()).not.toBeNull();
    expect(gate.acquire()).toBeNull();
  });
});

describe("createDailyCap", () => {
  it("refuses past the budget and resets on the next UTC day", () => {
    let now = Date.UTC(2026, 9, 5, 12, 0, 0);
    const cap = createDailyCap(2, () => now);
    expect(cap.take()).toBeNull();
    expect(cap.take()).toBeNull();
    expect(cap.take()).toBe(12 * 3600);
    now = Date.UTC(2026, 9, 6, 0, 0, 1);
    expect(cap.take()).toBeNull();
  });
});
