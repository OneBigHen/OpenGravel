import sharp from "sharp";
import { PUBLIC_PHOTO_MAX_BYTES, PUBLIC_RIDE_MAX_PHOTOS } from "@/application/community/public-ride";

export interface PublicRoutePhoto {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}
const MAX_PHOTO_BYTES = PUBLIC_PHOTO_MAX_BYTES;
const MAX_PIXELS = 20_000_000;

function rasterSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}

/** Independently rebuild every public image. No source metadata, SVG, animation, or uploaded bytes are served. */
export async function prepareRoutePhotos(value: unknown): Promise<readonly PublicRoutePhoto[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PUBLIC_RIDE_MAX_PHOTOS) throw new Error("Choose up to three photos.");
  const photos: PublicRoutePhoto[] = [];
  for (const encoded of value) {
    if (typeof encoded !== "string" || encoded.length > 400_000) throw new Error("A photo exceeds the upload size limit.");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("A photo has invalid encoding.");
    const input = Buffer.from(encoded, "base64");
    if (input.toString("base64") !== encoded || input.length > MAX_PHOTO_BYTES || !rasterSignature(input)) throw new Error("Photos must be JPEG, PNG or WebP raster images within the size limit.");
    try {
      const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("Unsupported photo.");
      const output = await image.rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).webp({ quality: 80, effort: 3 }).timeout({ seconds: 3 }).toBuffer({ resolveWithObject: true });
      if (output.data.length > MAX_PHOTO_BYTES) throw new Error("Photo output too large.");
      photos.push({ bytes: output.data, width: output.info.width, height: output.info.height });
    } catch {
      throw new Error("That photo could not be safely read. Choose a smaller JPEG, PNG or WebP photo.");
    }
  }
  return photos;
}
