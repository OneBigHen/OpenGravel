import { manifestResponse } from "@/server/route-library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return manifestResponse();
}
