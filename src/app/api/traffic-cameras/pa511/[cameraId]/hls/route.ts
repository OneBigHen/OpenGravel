import { handlePa511HlsRequest } from "@/server/traffic-cameras/pa511-hls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly cameraId: string }> },
): Promise<Response> {
  const { cameraId } = await params;
  return handlePa511HlsRequest(request, cameraId);
}
