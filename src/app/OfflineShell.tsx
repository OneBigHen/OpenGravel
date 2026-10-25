"use client";

import { useEffect } from "react";
import { inNativeShell } from "@/infrastructure/ride/native-shell";

/** The native app owns its shell. Development never installs a persistent SW. */
export function OfflineShell({ assetBasePath = "" }: { readonly assetBasePath?: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || inNativeShell(window) || !("serviceWorker" in navigator)) return;
    const buildId = process.env.NEXT_PUBLIC_OGV_SHELL_BUILD_ID;
    if (!buildId) return;
    void navigator.serviceWorker.register(`${assetBasePath}/sw.js?build=${encodeURIComponent(buildId)}`, {
      scope: `${assetBasePath}/`,
      updateViaCache: "none",
    }).catch(() => {
      // Unavailable storage, an interrupted install or an unsupported browser
      // leaves the page usable online; Settings continues to warn about restart.
    });
  }, [assetBasePath]);
  return null;
}
