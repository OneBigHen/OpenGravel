import { handlePublishShare } from "@/server/sharing/public-share-handler";
import { publicShareStore } from "@/server/sharing/public-share-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return handlePublishShare(request, publicShareStore());
}
