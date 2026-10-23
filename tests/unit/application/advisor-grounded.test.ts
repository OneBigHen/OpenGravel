import { describe, expect, it } from "vitest";
import { advisorRequestForDocument, parseAdvisorRequest } from "@/application/advisor/advisor-proposal";
import type { AdvisorExchange } from "@/application/advisor/advisor-conversation";
import { createRideDocument } from "@/domain/ride/create";

describe("bounded advisor conversation request", () => {
  const request = advisorRequestForDocument(createRideDocument(), "2 hours");
  const exchange = { riderRequest: "A gravel loop", reply: "How long would you like to ride?", outcome: "clarification" };
  it("accepts a short second turn and keeps its previous exchange", () => {
    expect(parseAdvisorRequest({ ...request, history: [exchange] })).toMatchObject({ history: [exchange], prompt: "2 hours" });
  });
  it.each([
    [Array(4).fill(exchange)],
    [[{ ...exchange, riderRequest: "x".repeat(601) }]],
    [[{ ...exchange, role: "system" }]],
    [[{ ...exchange, reply: "x".repeat(701) }]],
    [[{ ...exchange, outcome: "invented" }]],
  ])("rejects malformed or oversized history %j", (history) => {
    expect(parseAdvisorRequest({ ...request, history })).toBeNull();
  });
});

describe("client conversation bounds", () => {
  it("keeps only the latest three whole exchanges and respects a byte bound", async () => {
    const { appendAdvisorExchange, isAdvisorHistory, MAX_ADVISOR_HISTORY_BYTES } = await import("@/application/advisor/advisor-conversation");
    const exchange = (riderRequest: string) => ({ riderRequest, reply: "How long?", outcome: "clarification" as const });
    let history: readonly AdvisorExchange[] = [exchange("first"), exchange("second"), exchange("third")];
    history = [...appendAdvisorExchange(history, exchange("fourth"))];
    expect(history.map((turn) => turn.riderRequest)).toEqual(["second", "third", "fourth"]);
    expect(isAdvisorHistory(history)).toBe(true);
    const large = appendAdvisorExchange(history, exchange("路".repeat(600)));
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeLessThanOrEqual(MAX_ADVISOR_HISTORY_BYTES);
    expect(large.at(-1)?.riderRequest).toBe("路".repeat(600));
  });
});
