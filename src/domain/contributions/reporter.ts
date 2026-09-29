import type { ContributionEnvelope } from "./types";

/**
 * The only reporter identity a contribution may carry (02-ARCHITECTURE-CONTRACT
 * §20 pseudonymous actor): a locally minted UUID v4 pseudonym. It is never an
 * email, account id, display name, or any other raw personal identity, and a
 * contribution is not a profile or social object.
 */
export interface ContributionReporterIdentity {
  readonly pseudoId: string;
}

/** Projects the bounded reporter identity out of validated provenance. */
export function reporterIdentityFor(
  envelope: ContributionEnvelope,
): ContributionReporterIdentity {
  return { pseudoId: envelope.provenance.contributorPseudoId };
}
