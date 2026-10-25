"use client";

/**
 * Settings → Install: OpenGravel on the home screen opens full screen, like an
 * app. Shown only in a browser tab (never once installed or in the iOS app).
 * Chrome and Android offer their own prompt; Safari gets the two steps.
 */

import { useEffect, useState } from "react";
import { SettingsGroup } from "./SettingsGroup";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

type Platform = "installed" | "ios" | "other";

function detectPlatform(): Platform {
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.documentElement.dataset.native === "1";
  if (standalone) return "installed";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

export function InstallSection() {
  const [platform, setPlatform] = useState<Platform>("installed");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // Read once after hydration; the server render shows nothing.
    const detected = detectPlatform();
    const onPrompt = (event: Event): void => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    queueMicrotask(() => setPlatform(detected));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (platform === "installed") return null;
  if (platform === "other" && prompt === null) return null;

  return (
    <SettingsGroup id="settings-install-title" label="Install" testId="install-section">
      {platform === "ios" ? (
        <ol className="og-install__steps og-settings__card-block">
          <li>Tap <strong>Share</strong> <span aria-hidden="true">(the square with the arrow)</span> in Safari’s toolbar.</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
      ) : (
        <div className="og-settings__card-block">
          <button
            type="button"
            className="og-primary"
            onClick={() => {
              void prompt?.prompt();
              setPrompt(null);
            }}
          >
            Install OpenGravel
          </button>
        </div>
      )}
    </SettingsGroup>
  );
}
