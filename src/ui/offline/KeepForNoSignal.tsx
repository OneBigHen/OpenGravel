"use client";

/**
 * "Keep for no signal": the one switch on a saved ride (R3-7).
 *
 * On, it keeps the ride's map corridor, line, turns and surface on this phone.
 * It says "Kept, 31 MB" only after `rideIsKept` has found every tile; while it
 * works it shows how far it is, and a full phone or a failed tile says so and
 * the switch goes back off. Nothing here says "offline" unless that is true.
 */

import { useEffect, useRef, useState } from "react";

import { formatKeptSize, type RidePackService } from "@/application/offline/ride-pack";
import { LayerSwitch } from "@/ui/layers/LayerSwitch";

import "./keep-for-no-signal.css";

type KeepState =
  | { readonly kind: "checking" }
  | { readonly kind: "off"; readonly message: string | null }
  | { readonly kind: "keeping"; readonly percent: number }
  | { readonly kind: "kept"; readonly bytes: number };

export interface KeepForNoSignalProps {
  readonly rideId: string;
  readonly service: RidePackService;
  /** Told when the ride becomes kept or stops being kept. */
  readonly onChange?: () => void;
}

export function KeepForNoSignal({ rideId, service, onChange }: KeepForNoSignalProps) {
  const [state, setState] = useState<KeepState>({ kind: "checking" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const kept = await service.rideIsKept(rideId);
      if (!live) return;
      if (!kept) { setState({ kind: "off", message: null }); return; }
      const summary = (await service.keptRides()).find((ride) => ride.rideId === rideId);
      if (live) setState(summary === undefined ? { kind: "off", message: null } : { kind: "kept", bytes: summary.bytes });
    })();
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [rideId, service]);

  const toggle = async (): Promise<void> => {
    if (state.kind === "checking") return;
    if (state.kind === "keeping") {
      abort.current?.abort();
      return;
    }
    if (state.kind === "kept") {
      await service.dropRide(rideId).catch(() => undefined);
      setState({ kind: "off", message: null });
      onChange?.();
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "keeping", percent: 0 });
    const outcome = await service.keepRide(rideId, {
      signal: controller.signal,
      onProgress: ({ done, total }) => setState({ kind: "keeping", percent: total === 0 ? 0 : Math.floor((done / total) * 100) }),
    });
    abort.current = null;
    if (outcome.status === "kept" && (await service.rideIsKept(rideId))) {
      setState({ kind: "kept", bytes: outcome.bytes });
    } else {
      setState({ kind: "off", message: outcome.status === "failed" && outcome.reason !== "cancelled" ? outcome.message : null });
    }
    onChange?.();
  };

  const on = state.kind === "kept" || state.kind === "keeping";
  const detail =
    state.kind === "kept" ? `Kept, ${formatKeptSize(state.bytes)}`
      : state.kind === "keeping" ? `Keeping… ${state.percent}%`
        : state.kind === "off" ? state.message
          : null;

  return (
    <div className="og-keep" data-testid={`keep-no-signal-${rideId}`} data-state={state.kind}>
      <button
        type="button"
        className="og-keep__row"
        role="switch"
        aria-checked={on}
        disabled={state.kind === "checking"}
        data-testid={`keep-no-signal-toggle-${rideId}`}
        onClick={() => void toggle()}
      >
        <span className="og-keep__label">Keep for no signal</span>
        <LayerSwitch on={on} />
      </button>
      {detail === null ? null : (
        <p
          className="og-keep__detail"
          data-testid={`keep-no-signal-status-${rideId}`}
          data-tone={state.kind === "off" ? "error" : undefined}
          role="status"
          aria-live="polite"
        >
          {detail}
        </p>
      )}
    </div>
  );
}
