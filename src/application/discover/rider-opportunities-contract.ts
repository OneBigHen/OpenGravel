import type { RiderOpportunity } from "./rider-opportunities";

export interface RiderOpportunitiesBody {
  readonly generatedAt: string;
  readonly mode: "near" | "route";
  readonly opportunities: readonly RiderOpportunity[];
  readonly searchedRadiusMiles: number | null;
  readonly sources: readonly {
    readonly id: string;
    readonly status: "ok" | "unavailable" | "partial";
    readonly reason: string | null;
  }[];
}
