import { handleGeocodeSearch } from "@/server/geocoding/handler";
import { geocodeDependencies } from "./geocoder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleGeocodeSearch(request, geocodeDependencies);
}
