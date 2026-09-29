/**
 * The phone's own share sheet (IO-01). Safari, the iOS app's web view and
 * Android Chrome expose `navigator.share`; desktop browsers mostly do not, and
 * there the sheet keeps Copy link as its only action.
 */

export type NativeShareOutcome = "shared" | "cancelled" | "failed";

export interface NativeShareData {
  readonly title: string;
  readonly url: string;
}

function shareApi(): ((data: ShareData) => Promise<void>) | null {
  if (typeof navigator === "undefined") return null;
  return typeof navigator.share === "function" ? navigator.share.bind(navigator) : null;
}

export function canShareNatively(): boolean {
  return shareApi() !== null;
}

export async function shareNatively(data: NativeShareData): Promise<NativeShareOutcome> {
  const share = shareApi();
  if (share === null) return "failed";
  try {
    await share({ title: data.title, text: data.title, url: data.url });
    return "shared";
  } catch (error) {
    // Dismissing the sheet rejects with AbortError; that is a choice, not a failure.
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}
