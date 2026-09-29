import {
  newContributorPseudoId,
  parseContribution,
  type ContributionEnvelope,
  type ContributionValidationError as ContributionIssue,
} from "@/domain/contributions";

export type ContributionFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ContributionSubmissionResponse {
  readonly id: string;
  readonly contribution: ContributionEnvelope;
  readonly receivedAt: string;
}

export interface SubmitContributionOptions {
  readonly endpoint?: string;
  readonly fetcher?: ContributionFetcher;
  readonly signal?: AbortSignal;
}

export class ContributionValidationError extends Error {
  public readonly issues: readonly ContributionIssue[];

  public constructor(issues: readonly ContributionIssue[]) {
    super("The contribution is not valid.");
    this.name = "ContributionValidationError";
    this.issues = issues;
  }
}

export class ContributionSubmissionError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  public constructor(status: number, body: unknown) {
    super("The contribution server rejected the submission.");
    this.name = "ContributionSubmissionError";
    this.status = status;
    this.body = body;
  }
}

function isSubmissionResponse(value: unknown): value is ContributionSubmissionResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.receivedAt === "string"
    && typeof candidate.contribution === "object"
    && candidate.contribution !== null;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return { error: { code: "invalid-response", message: "The contribution server returned an invalid response." } };
  }
}

/** Browser/client seam for the foundation endpoint; it has no UI ownership. */
export async function submitContribution(
  envelope: ContributionEnvelope,
  options: SubmitContributionOptions = {},
): Promise<ContributionSubmissionResponse> {
  const parsed = parseContribution(envelope);
  if (!parsed.ok) throw new ContributionValidationError(parsed.errors);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(options.endpoint ?? "/api/contributions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.value),
    signal: options.signal,
  });
  const body = await responseBody(response);
  if (!response.ok) throw new ContributionSubmissionError(response.status, body);
  if (!isSubmissionResponse(body)) throw new ContributionSubmissionError(502, body);
  return body;
}

export interface ContributionDevSmokeOptions {
  readonly fetcher?: ContributionFetcher;
  readonly now?: string;
}

/**
 * A callable development smoke path for local endpoint checks. It is not wired
 * into the product UI and deliberately refuses to run in production builds.
 */
export async function runContributionDevSmoke(
  options: ContributionDevSmokeOptions = {},
): Promise<ContributionSubmissionResponse> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Contribution development smoke is disabled in production.");
  }
  const observedAt = options.now ?? new Date().toISOString();
  const parsed = parseContribution({
    kind: "surface",
    roadRef: { roadId: "road_dev_smoke", spanId: "span_dev_smoke" },
    observedAt,
    gps_precision_m: 25,
    value: "unknown",
    provenance: {
      contributorPseudoId: newContributorPseudoId(),
      clientVersion: "dev-smoke",
      evidenceLevel: "low",
    },
  }, { now: observedAt });
  if (!parsed.ok) throw new ContributionValidationError(parsed.errors);
  return submitContribution(parsed.value, { fetcher: options.fetcher });
}
