import type { PolicyMode } from "./types";

export interface SourcePolicy {
  readonly mode: PolicyMode;
  readonly basis: string;
  readonly note?: string;
}

export interface SourcesPolicy {
  readonly default: SourcePolicy;
  readonly sources: Readonly<Record<string, SourcePolicy>>;
}

const MODES: ReadonlySet<string> = new Set(["host", "link", "hide"]);

function key(name: string): string {
  return name.trim().toLowerCase();
}

function parsePolicy(value: unknown, where: string): SourcePolicy {
  if (typeof value !== "object" || value === null) throw new Error(`sources policy: ${where} must be an object`);
  const { mode, basis, note } = value as Record<string, unknown>;
  if (typeof mode !== "string" || !MODES.has(mode)) throw new Error(`sources policy: ${where} needs mode host, link or hide`);
  if (typeof basis !== "string" || basis.trim() === "") throw new Error(`sources policy: ${where} needs a basis`);
  return { mode: mode as PolicyMode, basis, ...(typeof note === "string" ? { note } : {}) };
}

export function parseSourcesPolicy(value: unknown): SourcesPolicy {
  if (typeof value !== "object" || value === null) throw new Error("sources policy must be an object");
  const raw = value as Record<string, unknown>;
  const sourceEntries = typeof raw["sources"] === "object" && raw["sources"] !== null ? Object.entries(raw["sources"] as Record<string, unknown>) : [];
  return {
    default: parsePolicy(raw["default"], "default"),
    sources: Object.fromEntries(sourceEntries.map(([name, policy]) => [key(name), parsePolicy(policy, name)])),
  };
}

/** The policy line for one source name; unlisted sources get the default. */
export function policyForSource(policy: SourcesPolicy, sourceName: string): SourcePolicy {
  return policy.sources[key(sourceName)] ?? policy.default;
}
