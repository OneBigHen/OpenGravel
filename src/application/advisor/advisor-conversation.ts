/** A stateless wire conversation: three exchanges, with no model/system roles supplied by the browser. */
export interface AdvisorExchange {
  readonly riderRequest: string;
  readonly reply: string;
  readonly outcome: "proposal" | "clarification" | "unsupported" | "answer";
}

export const MAX_ADVISOR_EXCHANGES = 3;
export const MAX_ADVISOR_HISTORY_BYTES = 3000;
export const utf8Size = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

export function isAdvisorHistory(value: unknown): value is readonly AdvisorExchange[] {
  return Array.isArray(value) && value.length <= MAX_ADVISOR_EXCHANGES
    && utf8Size(value) <= MAX_ADVISOR_HISTORY_BYTES
    && value.every((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      const item = entry as Record<string, unknown>;
      return Object.keys(item).length === 3
        && typeof item["riderRequest"] === "string" && item["riderRequest"].trim().length >= 2
        && item["riderRequest"].length <= 600 && !item["riderRequest"].includes("\u0000")
        && typeof item["reply"] === "string" && item["reply"].length > 0
        && item["reply"].length <= 700 && !item["reply"].includes("\u0000")
        && ["proposal", "clarification", "unsupported", "answer"].includes(String(item["outcome"]));
    });
}

/** Drop whole oldest exchanges, never truncate a rider's remaining question. */
export function appendAdvisorExchange(history: readonly AdvisorExchange[], exchange: AdvisorExchange): readonly AdvisorExchange[] {
  const next = [...history, { ...exchange, reply: exchange.reply.slice(0, 700) }].slice(-MAX_ADVISOR_EXCHANGES);
  while (next.length > 0 && utf8Size(next) > MAX_ADVISOR_HISTORY_BYTES) next.shift();
  if (!isAdvisorHistory(next)) return [];
  return next;
}
