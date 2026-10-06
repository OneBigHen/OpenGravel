import { PUBLIC_PHOTO_MAX_BYTES } from "./public-ride";

export interface PreparedPublicPhoto { readonly base64: string; readonly previewUrl: string }

/** Browser-side resize for mobile uploads; server validation remains authoritative. */
export async function preparePublicPhoto(file: File): Promise<PreparedPublicPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Choose a JPEG, PNG or WebP photo up to 8 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 20_000_000) throw new Error("This photo is too large to process. Choose a smaller image.");
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Photo preparation is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value === null ? reject(new Error("Photo preparation failed.")) : resolve(value), "image/webp", 0.8));
    if (blob.size > PUBLIC_PHOTO_MAX_BYTES) throw new Error("This photo is still too large after resizing. Choose a smaller image.");
    const previewUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("The photo could not be read."));
      reader.readAsDataURL(blob);
    });
    return { previewUrl, base64: previewUrl.slice(previewUrl.indexOf(",") + 1) };
  } finally { bitmap.close(); }
}
