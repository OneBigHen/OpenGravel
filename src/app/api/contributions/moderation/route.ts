import {
  handleContributionModerationDecideRequest,
  handleContributionModerationGetRequest,
  sharedContributionStore,
} from "@/server/contributions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleContributionModerationGetRequest(request, sharedContributionStore());
}

export async function POST(request: Request): Promise<Response> {
  return handleContributionModerationDecideRequest(request, sharedContributionStore());
}
