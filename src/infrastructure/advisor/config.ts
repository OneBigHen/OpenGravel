/**
 * Server-side advisor transport configuration (10 §14–§15).
 *
 * Model selection is deployment config: endpoint, model and key all come from
 * the server environment, injected exactly like `plan-service` reads its own
 * gate (`env: Readonly<Record<string, string | undefined>>`). The key is a
 * server-side credential and is **never** serialized to a client (10 §15): the
 * only thing that crosses out of here toward the UI is a capability status
 * carrying an honest, key-free reason.
 *
 * With zero model keys nothing here configures a transport, the advisor is
 * honestly disabled, and every core operation keeps working (10 §2). A missing
 * key disables the advisor even if an endpoint and model are present — a
 * deployment that names a model but holds no credential cannot call it.
 */

import { advisorCapability, type AdvisorCapability } from "@/application/advisor";

/** Env keys the deployment sets to enable the advisor. */
export const ADVISOR_ENDPOINT_ENV = "ADVISOR_ENDPOINT";
export const ADVISOR_MODEL_ENV = "ADVISOR_MODEL";
export const ADVISOR_API_KEY_ENV = "ADVISOR_API_KEY";
export const ADVISOR_OPENROUTER_API_KEY_ENV = "ADVISOR_OPENROUTER_API_KEY";
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
export const OPENROUTER_MODEL_ENV = "OPENROUTER_MODEL";
export const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
/**
 * A second model for when the first is rate-limited, slow or down (the free
 * Gemini tier 429s under load): e.g. Cloudflare Workers AI's OpenAI-compatible
 * endpoint with Llama 3.3. All three must be set, or there is no fallback.
 */
export const ADVISOR_FALLBACK_ENDPOINT_ENV = "ADVISOR_FALLBACK_ENDPOINT";
export const ADVISOR_FALLBACK_MODEL_ENV = "ADVISOR_FALLBACK_MODEL";
export const ADVISOR_FALLBACK_API_KEY_ENV = "ADVISOR_FALLBACK_API_KEY";

/**
 * Fully resolved transport settings. `apiKey` is server-side only: it lives here
 * so the adapter can authorize the outbound call, and it never appears in any
 * result, capability status or rider-facing message.
 */
export interface AdvisorTransportSettings {
  readonly endpoint: string;
  readonly model: string;
  /** Server-side credential. Never serialized to a client (10 §15). */
  readonly apiKey: string;
}

function trimmed(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Reads the deployment's model config. The OpenRouter endpoint and model have
 * safe defaults; a key is still required, so an unset deployment is honestly
 * disabled instead of sending a broken request.
 */
export function advisorTransportSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdvisorTransportSettings | null {
  const endpoint = trimmed(env[ADVISOR_ENDPOINT_ENV]) ?? DEFAULT_OPENROUTER_ENDPOINT;
  const model = trimmed(env[OPENROUTER_MODEL_ENV]) ?? trimmed(env[ADVISOR_MODEL_ENV]) ?? DEFAULT_OPENROUTER_MODEL;
  const apiKey =
    trimmed(env[ADVISOR_OPENROUTER_API_KEY_ENV]) ??
    trimmed(env[OPENROUTER_API_KEY_ENV]) ??
    trimmed(env[ADVISOR_API_KEY_ENV]);
  if (apiKey === null) return null;
  return { endpoint, model, apiKey };
}

/** The fallback model's settings, or `null` unless endpoint, model and key are all set. */
export function advisorFallbackSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdvisorTransportSettings | null {
  const endpoint = trimmed(env[ADVISOR_FALLBACK_ENDPOINT_ENV]);
  const model = trimmed(env[ADVISOR_FALLBACK_MODEL_ENV]);
  const apiKey = trimmed(env[ADVISOR_FALLBACK_API_KEY_ENV]);
  return endpoint === null || model === null || apiKey === null ? null : { endpoint, model, apiKey };
}

/**
 * The advisor's capability for a deployment environment. Only the advisor is
 * gated on model config; core capabilities never consult it (10 §2).
 */
export function advisorCapabilityFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdvisorCapability {
  return advisorCapability(advisorTransportSettingsFromEnv(env) !== null);
}
