import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 760px)";
/** True on a phone-width viewport; false where matchMedia does not exist. */
export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}
function subscribe(changed: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
export function usePhonePlanner(): boolean {
  return useSyncExternalStore(subscribe, isPhoneViewport, () => false);
}
