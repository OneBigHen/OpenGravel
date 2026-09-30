import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

export type CameraSecurityState = "PA" | "NJ" | "NY" | "DE" | "MD" | "VA" | "WV";

export interface CameraResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type CameraDnsLookup = (hostname: string) => Promise<readonly CameraResolvedAddress[]>;

export class CameraUrlSecurityError extends Error {
  readonly code: "invalid-url" | "untrusted-origin" | "private-address" | "dns-failed" | "redirect" | "configuration" | "upstream-response";

  constructor(
    code: CameraUrlSecurityError["code"],
    message = "Camera URL rejected",
  ) {
    super(message);
    this.name = "CameraUrlSecurityError";
    this.code = code;
  }
}

export const DEFAULT_CAMERA_ORIGINS: Readonly<Record<CameraSecurityState, readonly string[]>> = {
  NJ: ["https://njtpk-wink.xcmdata.org"],
  NY: [
    "https://s9.nysdot.skyvdn.com",
    "https://s52.nysdot.skyvdn.com",
    "https://s53.nysdot.skyvdn.com",
    "https://s51.nysdot.skyvdn.com",
    "https://s7.nysdot.skyvdn.com",
  ],
  DE: ["https://video.deldot.gov"],
  MD: [
    "https://strmr5.sha.maryland.gov",
    "https://strmr3.sha.maryland.gov",
    "https://strmr10.sha.maryland.gov",
  ],
  VA: [],
  WV: ["https://vtc3.roadsummary.com"],
  PA: [
    "https://pa-se1.arcadis-ivds.com",
    "https://pa-se1.arcadis-ivds.com:8200",
    "https://pa-se2.arcadis-ivds.com",
    "https://pa-se2.arcadis-ivds.com:8200",
    "https://pa-se3.arcadis-ivds.com",
    "https://pa-se3.arcadis-ivds.com:8200",
    "https://pa-se4.arcadis-ivds.com",
    "https://pa-se4.arcadis-ivds.com:8200",
  ],
};

export const DEFAULT_CAMERA_METADATA_ORIGINS: Readonly<Record<CameraSecurityState, readonly string[]>> = {
  PA: ["https://www.511pa.com", "https://pa.arcadis-ivds.com"],
  NJ: ["https://511nj.org"],
  NY: ["https://511ny.org"],
  DE: ["https://tmc.deldot.gov"],
  MD: ["https://chartexp1.sha.maryland.gov"],
  VA: ["https://511.vdot.virginia.gov"],
  WV: ["https://dev.www.511wv.cloud.ilchost.com"],
};

const ORIGIN_ENV_PREFIX = "TRAFFIC_CAMERA_ALLOWED_ORIGINS_";
const REDIRECT_STATUS_MIN = 300;
const REDIRECT_STATUS_MAX = 399;
export const MAX_CAMERA_MANIFEST_BYTES = 1_000_000;

function normalizeOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CameraUrlSecurityError("configuration", "Invalid traffic-camera origin configuration");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname.includes("*") || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new CameraUrlSecurityError("configuration", "Traffic-camera origins must be exact HTTPS origins");
  }
  return url.origin.toLowerCase();
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51) ||
    (first === 203 && second === 0) ||
    first >= 224;
}

function firstIpv6Hextet(address: string): number | null {
  const first = address.replace(/^\[|\]$/g, "").split(":")[0];
  if (first === undefined || first === "") return 0;
  const value = Number.parseInt(first, 16);
  return Number.isFinite(value) ? value : null;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return normalized === "::" || normalized === "::1" || isPrivateIpv4(mapped);
  }
  const first = firstIpv6Hextet(normalized);
  // Only global-unicast IPv6 is usable for an upstream camera request. This
  // deliberately excludes link-local, unique-local, multicast, unspecified,
  // documentation, and other non-routable address classes.
  return first === null || first < 0x2000 || first > 0x3fff || normalized.startsWith("2001:db8:");
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host.endsWith(".internal") || host.endsWith(".home.arpa") || host.endsWith(".lan") ||
    host.endsWith(".test") || host.endsWith(".invalid") || host.endsWith(".example");
}

async function systemLookup(hostname: string): Promise<readonly CameraResolvedAddress[]> {
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    return addresses
      .filter((entry): entry is typeof entry & { family: 4 | 6 } => entry.family === 4 || entry.family === 6)
      .map((entry) => ({ address: entry.address, family: entry.family }));
  } catch {
    throw new CameraUrlSecurityError("dns-failed");
  }
}

function configuredOrigins(
  state: CameraSecurityState,
  env: Readonly<Record<string, string | undefined>>,
  defaults: Readonly<Record<CameraSecurityState, readonly string[]>>,
  envPrefix: string,
): ReadonlySet<string> {
  const values = new Set<string>((defaults[state] ?? []).map(normalizeOrigin));
  const configured = env[`${envPrefix}${state}`]?.trim();
  if (configured === undefined || configured === "") return values;
  for (const value of configured.split(",")) {
    if (value.trim() === "") continue;
    values.add(normalizeOrigin(value));
  }
  return values;
}

export interface CameraUrlPolicy {
  readonly origins: ReadonlySet<string>;
  readonly lookup: CameraDnsLookup;
  readonly resolve: (input: string | URL) => Promise<{ readonly url: URL; readonly address: CameraResolvedAddress }>;
  readonly validate: (input: string | URL) => Promise<URL>;
}

function createPolicyForOrigins(origins: ReadonlySet<string>, lookup: CameraDnsLookup): CameraUrlPolicy {
  const resolve = async (input: string | URL): Promise<{ readonly url: URL; readonly address: CameraResolvedAddress }> => {
    let url: URL;
    try {
      url = input instanceof URL ? new URL(input.toString()) : new URL(input);
    } catch {
      throw new CameraUrlSecurityError("invalid-url");
    }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      throw new CameraUrlSecurityError("invalid-url");
    }
    if (url.port !== "" && !origins.has(url.origin.toLowerCase())) {
      throw new CameraUrlSecurityError("invalid-url");
    }
    if (!origins.has(url.origin.toLowerCase()) || isLocalHostname(url.hostname)) {
      throw new CameraUrlSecurityError("untrusted-origin");
    }
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && isPrivateAddress(literal)) throw new CameraUrlSecurityError("private-address");
    let addresses: readonly CameraResolvedAddress[];
    try {
      addresses = await lookup(literal);
    } catch (error) {
      if (error instanceof CameraUrlSecurityError) throw error;
      throw new CameraUrlSecurityError("dns-failed");
    }
    if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address.address))) {
      throw new CameraUrlSecurityError("private-address");
    }
    const address = addresses.find((candidate) => !isPrivateAddress(candidate.address));
    if (address === undefined) throw new CameraUrlSecurityError("dns-failed");
    return { url, address };
  };
  return {
    origins,
    lookup,
    resolve,
    validate: async (input) => (await resolve(input)).url,
  };
}

export function createCameraUrlPolicy(
  state: CameraSecurityState,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly lookup?: CameraDnsLookup;
    readonly defaultOrigins?: Readonly<Record<CameraSecurityState, readonly string[]>>;
    readonly envPrefix?: string;
  } = {},
): CameraUrlPolicy {
  const origins = configuredOrigins(
    state,
    env,
    options.defaultOrigins ?? DEFAULT_CAMERA_ORIGINS,
    options.envPrefix ?? ORIGIN_ENV_PREFIX,
  );
  const lookup = options.lookup ?? systemLookup;
  return createPolicyForOrigins(origins, lookup);
}

export function createExactOriginPolicy(
  origins: readonly string[],
  options: { readonly lookup?: CameraDnsLookup } = {},
): CameraUrlPolicy {
  const normalized = new Set(origins.map(normalizeOrigin));
  return createPolicyForOrigins(normalized, options.lookup ?? systemLookup);
}

export function createCameraMetadataPolicy(
  state: CameraSecurityState,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly lookup?: CameraDnsLookup } = {},
): CameraUrlPolicy {
  return createCameraUrlPolicy(state, env, {
    ...options,
    defaultOrigins: DEFAULT_CAMERA_METADATA_ORIGINS,
    envPrefix: "TRAFFIC_CAMERA_METADATA_ORIGINS_",
  });
}

function requestHeaders(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

function requestBody(init: RequestInit | undefined): string | Uint8Array | undefined {
  const body = init?.body;
  if (body === undefined || body === null || typeof body === "string" || body instanceof Uint8Array) return body ?? undefined;
  throw new CameraUrlSecurityError("invalid-url", "Unsupported camera request body");
}

export function cameraFetchTarget(input: RequestInfo | URL): string | URL {
  if (typeof input === "string" || input instanceof URL) return input;
  throw new CameraUrlSecurityError("invalid-url", "Camera transport requires an explicit URL");
}

export async function readCappedResponseText(
  response: Response,
  maxBytes = MAX_CAMERA_MANIFEST_BYTES,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) throw new CameraUrlSecurityError("upstream-response", "Camera playlist exceeds the response limit");
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the controlled upstream error if cancellation also fails.
    }
    if (error instanceof CameraUrlSecurityError) throw error;
    throw new CameraUrlSecurityError("upstream-response");
  } finally {
    reader.releaseLock();
  }
}

async function pinnedHttpsFetch(
  resolved: { readonly url: URL; readonly address: CameraResolvedAddress },
  init: RequestInit | undefined,
  requestFunction: typeof httpsRequest = httpsRequest,
): Promise<Response> {
  const { url, address } = resolved;
  const body = requestBody(init);
  return new Promise<Response>((resolve, reject) => {
    const requestOptions = {
      method: init?.method ?? "GET",
      headers: requestHeaders(init),
      signal: init?.signal ?? undefined,
      autoSelectFamily: false,
      lookup: (hostname, options, callback) => {
        const failure = new Error("Camera request hostname changed");
        if (hostname !== url.hostname) {
          if (options.all) callback(failure, []);
          else callback(failure, "", 0);
          return;
        }
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    } as Parameters<typeof httpsRequest>[1] & { readonly autoSelectFamily?: boolean };
    const request = requestFunction(url, requestOptions, (response) => {
      try {
        const status = response.statusCode ?? 0;
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          response.resume();
          reject(new CameraUrlSecurityError("upstream-response"));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            if (name.toLowerCase() === "set-cookie") {
              for (const cookie of value) headers.append(name, cookie);
            } else {
              headers.set(name, value.join(", "));
            }
          } else if (value !== undefined) headers.set(name, value);
        }
        if (status === 204 || status === 205 || status === 304) {
          response.resume();
          resolve(new Response(null, { status, statusText: response.statusMessage, headers }));
          return;
        }
        resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
          status,
          statusText: response.statusMessage,
          headers,
        }));
      } catch {
        response.destroy();
        reject(new CameraUrlSecurityError("upstream-response"));
      }
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

export async function fetchPinnedCameraUrl(
  policy: CameraUrlPolicy,
  input: string | URL,
  init: RequestInit = {},
  options: { readonly request?: typeof httpsRequest } = {},
): Promise<Response> {
  const resolved = await policy.resolve(input);
  const response = await pinnedHttpsFetch(resolved, { ...init, redirect: "manual" }, options.request);
  if (response.status >= REDIRECT_STATUS_MIN && response.status <= REDIRECT_STATUS_MAX) {
    try {
      await response.body?.cancel();
    } catch {
      // Redirect bodies are discarded; preserve the security error as the public result.
    }
    throw new CameraUrlSecurityError("redirect");
  }
  return response;
}
