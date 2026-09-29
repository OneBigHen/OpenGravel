import { NextResponse, type NextRequest } from "next/server";

import { createGuard } from "@/server/security/guard";

const guard = createGuard();

/** Blocklist, scanner probes and per-address API budgets (src/server/security/guard.ts). */
export function proxy(request: NextRequest): NextResponse {
  const verdict = guard.inspect(request, request.nextUrl.pathname);
  if (verdict.action === "pass") return NextResponse.next();
  if (verdict.log !== null) console.warn(verdict.log);
  return new NextResponse(verdict.status === 429 ? "Too many requests. Try again in a minute." : null, {
    status: verdict.status,
    headers: {
      "cache-control": "no-store",
      ...(verdict.retryAfterSeconds === undefined ? {} : { "retry-after": String(verdict.retryAfterSeconds) }),
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
