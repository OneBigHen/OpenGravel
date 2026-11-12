"use client";

/**
 * Rides kept for no signal (R3-7), with their size and a Remove each. Hidden
 * when nothing is kept: Settings promises nothing offline it does not hold.
 * Only rides whose every tile is on the device are listed.
 */

import { useEffect, useState } from "react";

import { formatKeptSize, type KeptRideSummary, type RidePackService } from "@/application/offline/ride-pack";
import { SettingsGroup, SettingsRowButton } from "@/ui/settings/SettingsGroup";

export function KeptRidesSection({ service }: { readonly service: Pick<RidePackService, "keptRides" | "dropRide"> }) {
  const [rides, setRides] = useState<readonly KeptRideSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void service.keptRides().then((kept) => { if (live) setRides(kept); }, () => undefined);
    return () => { live = false; };
  }, [service]);

  if (rides.length === 0) return null;
  const total = rides.reduce((sum, ride) => sum + ride.bytes, 0);

  const remove = async (rideId: string): Promise<void> => {
    setBusy(rideId);
    await service.dropRide(rideId).catch(() => undefined);
    setRides(await service.keptRides().catch(() => []));
    setBusy(null);
  };

  return (
    <SettingsGroup
      id="settings-kept-rides-title"
      label="Kept for no signal"
      aside={formatKeptSize(total)}
      testId="settings-kept-rides"
    >
      {rides.map((ride) => (
        <SettingsRowButton
          key={ride.rideId}
          label={ride.title}
          meta={formatKeptSize(ride.bytes)}
          value="Remove"
          chevron={false}
          disabled={busy === ride.rideId}
          ariaLabel={`Remove ${ride.title} from this phone`}
          testId={`settings-kept-ride-remove-${ride.rideId}`}
          onClick={() => void remove(ride.rideId)}
        />
      ))}
    </SettingsGroup>
  );
}
