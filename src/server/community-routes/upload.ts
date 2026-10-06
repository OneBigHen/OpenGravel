export const MAX_ROUTE_UPLOAD_BYTES = 3_000_000;
const READ_TIMEOUT_MS = 10_000;

type UploadResult = { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly message: string };

/** Reject cross-site writes and stop reading at the actual byte budget, even without Content-Length. */
export async function readCommunityRouteUpload(request: Request): Promise<UploadResult> {
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
  const host = request.headers.get("host") ?? url.host;
  const origin = request.headers.get("origin");
  if (origin !== `${protocol}//${host}` || request.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, status: 403, message: "Sharing requires the same origin." };
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, status: 415, message: "Send the route as JSON." };
  }
  const tooLarge = { ok: false, status: 413, message: "That route is too large to share." } as const;
  if (Number(request.headers.get("content-length") ?? "0") > MAX_ROUTE_UPLOAD_BYTES) return tooLarge;
  if (request.body === null) return { ok: false, status: 400, message: "Send a route to share." };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("read-timeout")), READ_TIMEOUT_MS);
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ROUTE_UPLOAD_BYTES) {
        void reader.cancel().catch(() => undefined);
        return tooLarge;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    void reader.cancel().catch(() => undefined);
    return { ok: false, status: 400, message: "The route could not be read. Send valid UTF-8 JSON within 10 seconds." };
  } finally { clearTimeout(timer); }
}
