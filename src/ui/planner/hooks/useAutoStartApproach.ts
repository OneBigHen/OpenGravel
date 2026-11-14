import { useEffect, useRef } from "react";

import { peekApproach } from "@/application/ride-session/approach-request";

/**
 * "Ride to the start" was tapped on this ride's card: the rider has already
 * said go, so the ride opens on the ride screen without a second Start. The
 * ride screen then plans the way to the start (approach-request.ts).
 */
export function useAutoStartApproach(rideId: string, ready: boolean, start: () => Promise<void>): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ready || !peekApproach(rideId)) return;
    const timer = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rideId, ready, start]);
}
