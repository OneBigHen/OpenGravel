import { RidesClient } from "@/app/RidesClient";

export const dynamic = "force-dynamic";

export default function RidesPage() {
  // Ride cards show each ride on a real map image (owner: routes need bearings).
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return <RidesClient {...(token === undefined || !token.startsWith("pk.") ? {} : { mapboxToken: token })} />;
}
