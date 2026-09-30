"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
    return <LiveCamera key={media.playbackUrl} url={media.playbackUrl} preview={preview} name={name} sourceHref={media.sourceHref} />;
  }

  if (preview === null) return null;
  // Camera URLs are arbitrary provider endpoints and refresh in place; Next/Image
  // would require a maintained remote-host allowlist and optimization proxy.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="og-info-card__media" src={preview} alt={`Traffic camera view: ${name}`} />;
}

/** One selected camera; no stream requests until the rider asks to play. */
function LiveCamera({ url, preview, name, sourceHref }: {
  readonly url: string;
  readonly preview: string | null;
  readonly name: string;
  readonly sourceHref: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!requested) return;
    const video = videoRef.current;
    if (video === null) return;
    let closed = false;
    let player: { destroy(): void } | null = null;
    const unavailable = () => {
      if (!closed) setError("Live camera is unavailable. Try the provider camera.");
    };
    let mseStarted = false;
    const startMse = () => {
      if (closed || mseStarted) return;
      mseStarted = true;
      void import("hls.js").then(({ default: Hls }) => {
        if (closed) return;
        if (!Hls.isSupported()) {
          setError("Live video is unavailable in this browser.");
          return;
        }
        const hls = new Hls({ enableWorker: false });
        player = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) { unavailable(); hls.destroy(); player = null; }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!closed) void video.play().catch(() => undefined);
        });
        hls.attachMedia(video);
        hls.loadSource(url);
      }).catch(unavailable);
    };
    const mediaError = () => {
      if (closed) return;
      if (mseStarted) { unavailable(); return; }
      // Some browsers advertise native HLS but cannot decode a provider stream.
      // Release that source before trying MSE, once, after the explicit request.
      video.pause();
      video.removeAttribute("src");
      startMse();
      video.load();
    };
    video.addEventListener("error", mediaError);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      // Browser gesture rules may require a second tap on the native controls.
      void video.play().catch(() => undefined);
    } else {
      startMse();
    }
    return () => {
      closed = true;
      video.removeEventListener("error", mediaError);
      player?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [requested, url]);
  return <>
    <video ref={videoRef} className="og-info-card__media" controls={requested}
      playsInline preload="none" poster={preview ?? undefined}
      aria-label={`Live traffic camera: ${name}`} />
    {!requested && <button type="button" className="og-button" onClick={() => setRequested(true)}>Play live camera</button>}
    {error !== null && <p role="status">{error}</p>}
    {sourceHref !== null && <a href={sourceHref} target="_blank" rel="noopener noreferrer">Open provider camera</a>}
  </>;
}
