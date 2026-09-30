"use client";

import { useEffect, useMemo, useState } from "react";

import type { InfoMedia } from "@/application/map-layers";

export interface InfoFeatureMediaProps {
  readonly media: InfoMedia;
  readonly name: string;
}

function refreshed(url: string, nonce: number): string {
  if (nonce === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_ogv=${nonce}`;
}

export function InfoFeatureMedia({ media, name }: InfoFeatureMediaProps) {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (media.previewUrl === null || media.refreshSeconds === null || media.refreshSeconds <= 0) return;
    const timer = window.setInterval(() => setNonce(Date.now()), media.refreshSeconds * 1_000);
    return () => window.clearInterval(timer);
  }, [media.previewUrl, media.refreshSeconds]);

  const preview = useMemo(
    () => media.previewUrl === null ? null : refreshed(media.previewUrl, nonce),
    [media.previewUrl, nonce],
  );

  if (media.playbackUrl !== null) {
    return (
      <video
        className="og-info-card__media"
        controls
        playsInline
        preload="none"
        poster={preview ?? undefined}
        aria-label={`Live traffic camera: ${name}`}
      >
        <source src={media.playbackUrl} type="application/vnd.apple.mpegurl" />
      </video>
    );
  }

  if (preview === null) return null;
  return <img className="og-info-card__media" src={preview} alt={`Traffic camera view: ${name}`} />;
}
