import { expect, it } from "vitest";
import sharp from "sharp";
import { prepareRoutePhotos } from "@/server/community-routes/photos";
import { CommunityRouteStore } from "@/server/community-routes/store";

it("decodes and reencodes raster photos, stripping GPS and source metadata", async () => {
  const input = await sharp({ create: { width: 32, height: 24, channels: 3, background: "green" } }).jpeg().withExif({ IFD0: { Artist: "private-author" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 1/1 1/1" } }).toBuffer();
  const result = await prepareRoutePhotos([input.toString("base64")]);
  expect(result).toHaveLength(1);
  const metadata = await sharp(result[0]!.bytes).metadata();
  expect(metadata.format).toBe("webp");
  expect(metadata.exif).toBeUndefined();
  expect(metadata.xmp).toBeUndefined();
  expect(result[0]).toMatchObject({ width: 32, height: 24 });
});
it("refuses SVG, invalid encoding, excessive photo counts and oversized bytes", async () => {
  await expect(prepareRoutePhotos([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>').toString("base64")])).rejects.toThrow(/photo|raster/i);
  await expect(prepareRoutePhotos(["not base64!"])).rejects.toThrow(/photo|encoding/i);
  await expect(prepareRoutePhotos(["x", "x", "x", "x"])).rejects.toThrow(/three|3/i);
  await expect(prepareRoutePhotos(["A".repeat(400_004)])).rejects.toThrow(/large|limit/i);
});
it("stores normalized photos separately and removes public access with the route", async () => {
  const store = new CommunityRouteStore(":memory:");
  const photos = await prepareRoutePhotos([(await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64")]);
  store.addRoute("community_test", { name: "Ride" }, "2026-10-06", photos);
  expect(store.photo("community_test", 0)?.bytes).toEqual(photos[0]!.bytes);
  expect(store.routes()[0]!.raw).not.toHaveProperty("photos");
  store.remove("community_test", "Private", "2026-10-06");
  expect(store.photo("community_test", 0)).toBeNull();
});
