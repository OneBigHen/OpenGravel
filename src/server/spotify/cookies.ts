export interface CookieOptions {
  readonly maxAge?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "Lax" | "Strict";
  readonly path?: string;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const pieces = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) pieces.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) pieces.push("HttpOnly");
  if (options.secure === true) pieces.push("Secure");
  pieces.push(`SameSite=${options.sameSite ?? "Lax"}`);
  pieces.push(`Path=${options.path ?? "/"}`);
  return pieces.join("; ");
}

export function expiredCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAge: 0, secure });
}
