import { handleRevokeShare } from "@/server/sharing/public-share-handler";
import { publicShareStore } from "@/server/sharing/public-share-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{ shareId: string }> }): Promise<Response> {
  return handleRevokeShare(request, (await context.params).shareId, publicShareStore());
}
