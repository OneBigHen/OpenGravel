"use client";

import { useCallback, useEffect, useState } from "react";

export interface RiderOrigin {
  /** `[lon, lat]`, or undefined until the rider's position is known. */
  readonly origin: readonly [number, number] | undefined;
  /** Set once the rider asks for their location with a control of their own. */
  readonly setOrigin: (origin: readonly [number, number]) => void;
}

/**
 * Where the rider is, only when this device has already let OpenGravel see it.
 *
 * Nothing is asked for: without a granted permission the origin stays unknown
 * and every distance that depends on it is simply absent. A rider who taps a
 * "Near me" control supplies it through `setOrigin`.
 */
export function useRiderOrigin(): RiderOrigin {
  const [origin, setOriginState] = useState<readonly [number, number] | undefined>();
  useEffect(() => {
    if (typeof navigator === "undefined" || navigator.permissions?.query === undefined || !navigator.geolocation) return;
    let cancelled = false;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
      if (cancelled || status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!cancelled) setOriginState((current) => current ?? [position.coords.longitude, position.coords.latitude]);
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
      );
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const setOrigin = useCallback((next: readonly [number, number]) => setOriginState(next), []);
  return { origin, setOrigin };
}
