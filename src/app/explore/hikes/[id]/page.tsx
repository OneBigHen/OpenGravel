import { HikeDetail } from "@/app/HikeExplore";

export default async function HikePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HikeDetail id={decodeURIComponent(id)} {...(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ? { mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN } : {})} />;
}
