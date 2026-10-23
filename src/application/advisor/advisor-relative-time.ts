/** Deterministic arithmetic for the common, unambiguous relative-duration request. */
export type RelativeAdvisorTime = { readonly kind: "none" } | { readonly kind: "clarification" } | { readonly kind: "budget"; readonly minutes: number };

export function relativeAdvisorTime(prompt: string, plannedMinutes: number | undefined): RelativeAdvisorTime {
  const match = /^(?:please\s+)?(?:make\s+(?:it|this(?:\s+ride|\s+route)?|the\s+ride|the\s+route)\s+)?(\d{1,4})\s*(minutes?|mins?|hours?|hrs?)\s+(shorter|longer)(?:\s+please)?[.!]?$/i.exec(prompt.trim());
  if (match === null) return { kind: "none" };
  if (plannedMinutes === undefined || !Number.isFinite(plannedMinutes)) return { kind: "clarification" };
  const delta = Number(match[1]) * (/^(hour|hr)/i.test(match[2]!) ? 60 : 1);
  const minutes = Math.round(plannedMinutes + (match[3]!.toLowerCase() === "shorter" ? -delta : delta));
  return minutes >= 15 && minutes <= 1440 ? { kind: "budget", minutes } : { kind: "clarification" };
}
