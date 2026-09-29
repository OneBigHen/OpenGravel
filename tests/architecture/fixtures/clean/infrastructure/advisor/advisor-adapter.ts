import type { RideProposal } from "./ride-proposal";

export async function requestProposal(prompt: string): Promise<RideProposal> {
  return { proposalId: "fixture-proposal", rationale: prompt };
}
