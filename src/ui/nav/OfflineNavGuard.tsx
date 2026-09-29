"use client";

import { useEffect, useState } from "react";

/**
 * Offline, a tap on an in-app link used to fail its data fetch, fall back to a
 * full page load and land on the browser's error page, losing the page the
 * rider was on (AQ-02). While the browser reports no connection this keeps the
 * current page and says why, then clears itself once the connection returns.
 */
export function OfflineNavGuard() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent): void => {
      if (navigator.onLine !== false) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      const label = anchor.textContent?.trim() || anchor.getAttribute("aria-label") || "That page";
      setMessage(`You're offline. ${label} opens when you're back online.`);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setMessage(null), 6000);
    };
    const onOnline = (): void => setMessage(null);
    // Capture on the document runs before the router's own link handler.
    document.addEventListener("click", onClick, true);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return (
    <div className="og-offline-toast" role="status" aria-live="polite" hidden={message === null}>
      {message}
    </div>
  );
}
