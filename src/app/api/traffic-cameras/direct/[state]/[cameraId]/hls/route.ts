import { handleDirectCameraHls } from "@/server/traffic-cameras/direct-hls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly state: string; readonly cameraId: string }> },
): Promise<Response> {
  const { state, cameraId } = await params;
  return handleDirectCameraHls(request, state, cameraId);
}
