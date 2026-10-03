import {
  handleRiderOpportunitiesNear,
  handleRiderOpportunitiesRoute,
} from "@/server/rider-opportunities/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleRiderOpportunitiesNear(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRiderOpportunitiesRoute(request);
}
