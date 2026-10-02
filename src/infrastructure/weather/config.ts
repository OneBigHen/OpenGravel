/**
 * National Weather Service deployment identity.
 *
 * All NWS callers share this resolver so preparation weather and map alerts
 * identify the same OpenGravel deployment. A production deployment should set
 * NWS_USER_AGENT to a value with a real contact as requested by NWS.
 */

export const DEFAULT_NWS_USER_AGENT =
  "OpenGravel/0.1 (https://github.com/OneBigHen/OpenGravel)";

export interface NwsEnv {
  readonly NWS_USER_AGENT?: string | undefined;
}

export function nwsUserAgentFromEnv(
  env: NwsEnv = process.env,
): string {
  const configured = env.NWS_USER_AGENT?.trim();
  return configured === undefined || configured === ""
    ? DEFAULT_NWS_USER_AGENT
    : configured;
}
