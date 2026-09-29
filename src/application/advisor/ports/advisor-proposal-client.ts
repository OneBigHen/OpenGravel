import type { AdvisorDraftResult, AdvisorRequest } from "../advisor-proposal";

/** Browser-to-server seam for the optional advisor capability. */
export interface AdvisorProposalClient {
  request(request: AdvisorRequest, signal?: AbortSignal): Promise<AdvisorDraftResult>;
}
