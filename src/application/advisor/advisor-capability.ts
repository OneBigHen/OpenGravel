/**
 * Advisor capability and no-AI parity (10 §2, 02-ARCHITECTURE-CONTRACT §12).
 *
 * The advisor is an **optional** capability whose entry point is derived from
 * its capability status (02 §12) — never from a client-only flag, and never a
 * startup requirement (02 §23). With zero model keys the advisor is simply off
 * and says so honestly; every core operation keeps working through structured
 * UI.
 *
 * The parity guarantee this substrate can enforce is ownership: a model key
 * gates the advisor and **nothing else**. {@link noKeyParity} returns a `core`
 * set that is a constant — identical with and without a key — so turning the
 * advisor on can never turn a core capability off. The individual core
 * operations (planning, route editing, route explanation, Free Ride,
 * import/export) are owned by their own surfaces; they are enumerated here only
 * to pin the 10 §2 set and prove none of them reads model config.
 */

/**
 * The advisor's capability status (02 §12 shape, narrowed: the advisor is
 * either on or honestly off — it is never "degraded"). `reason` is a stable
 * machine token; `message` is rider copy with no vendor or credential.
 */
export type AdvisorCapability =
  | { readonly status: "available" }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly message: string;
    };

/** Stable token for "this deployment configured no model". */
export const ADVISOR_DISABLED_REASON = "no-model-configured";

/** The honest disabled state's rider copy (VNX-007 / Rule E: no vendor, no key). */
export const ADVISOR_DISABLED_MESSAGE = "The advisor is not set up on this deployment.";

/** The core operations 10 §2 requires to work with AI disabled. */
export type CoreCapability =
  | "planning"
  | "route-editing"
  | "route-explanation"
  | "free-ride"
  | "import-export";

export const CORE_CAPABILITIES: readonly CoreCapability[] = [
  "planning",
  "route-editing",
  "route-explanation",
  "free-ride",
  "import-export",
];

export interface CoreCapabilityState {
  readonly capability: CoreCapability;
  /** Always `true`: core is not gated on model config (10 §2). */
  readonly available: true;
}

export interface NoKeyParityReport {
  /** Constant across model config — the parity invariant. */
  readonly core: readonly CoreCapabilityState[];
  readonly advisor: AdvisorCapability;
}

/** The advisor's capability given whether a model transport is configured. */
export function advisorCapability(modelConfigured: boolean): AdvisorCapability {
  return modelConfigured
    ? { status: "available" }
    : {
        status: "unavailable",
        reason: ADVISOR_DISABLED_REASON,
        message: ADVISOR_DISABLED_MESSAGE,
      };
}

/**
 * The no-AI parity report: `core` is available unconditionally, and only the
 * advisor depends on `modelConfigured`.
 */
export function noKeyParity(modelConfigured: boolean): NoKeyParityReport {
  return {
    core: CORE_CAPABILITIES.map((capability) => ({ capability, available: true })),
    advisor: advisorCapability(modelConfigured),
  };
}
