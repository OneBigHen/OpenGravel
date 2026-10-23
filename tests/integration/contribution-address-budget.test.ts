import { afterEach, describe, expect, it } from "vitest";

import { handleContributionPostRequest } from "@/app/api/contributions/route";
import { SQLiteContributionStore } from "@/server/contributions/store";

/**
 * The contribution abuse bounds compared counts for a client-declared UUID, so a
 * script that minted a fresh pseudonym per request could fill the shared 250-slot
 * moderation queue (and post thirty notes an hour) from one machine, closing the
 * queue for every rider. The route now also budgets submissions per source
 * address, which the client cannot mint.
 */

const NOW = "2026-09-17T12:00:00.000Z";
const stores: SQLiteContributionStore[] = [];

function store(): SQLiteContributionStore {
  const created = new SQLiteContributionStore(":memory:", { now: () => NOW });
  stores.push(created);
  return created;
}

/** A fresh, valid v4 pseudonym per request: the identity the client controls. */
let sequence = 0;
function pseudonym(): string {
  sequence += 1;
  const suffix = sequence.toString(16).padStart(12, "0").slice(-12);
  return `123e4567-e89b-42d3-a456-${suffix}`;
}

function request(address: string, contributor = pseudonym()): Request {
  return new Request("http://localhost/api/contributions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": address },
    body: JSON.stringify({
      kind: "condition",
      roadRef: { roadId: "road_main", spanId: "span_main" },
      observedAt: NOW,
      gps_precision_m: 12,
      value: { tag: "comment", severity: "minor", note: "Gravel is loose after the bridge." },
      provenance: { contributorPseudoId: contributor, clientVersion: "0.1.0", evidenceLevel: "low" },
    }),
  });
}

afterEach(() => {
  for (const created of stores.splice(0)) created.close();
});

describe("contribution submissions are budgeted per source address", () => {
  it("refuses one address long before it can fill the shared moderation queue", async () => {
    const target = store();
    const address = "203.0.113.61";
    const statuses: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const response = await handleContributionPostRequest(request(address), target);
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
        const body = await response.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("abuse");
        expect(body.error.message).toMatch(/this connection/i);
        break;
      }
    }

    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 201).length).toBeLessThan(40);
    // The queue, shared by every rider, is nowhere near its 250-slot ceiling.
    expect(target.pendingCount()).toBeLessThan(250);
  });

  it("keeps another address's submissions working", async () => {
    const target = store();
    const blocked = "203.0.113.62";
    while ((await handleContributionPostRequest(request(blocked), target)).status !== 429) {
      // Spend the first address's hour.
    }
    expect((await handleContributionPostRequest(request("203.0.113.63"), target)).status).toBe(201);
  });
});
