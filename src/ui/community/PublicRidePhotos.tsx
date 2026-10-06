"use client";

import { useRef, useState } from "react";
import { preparePublicPhoto, type PreparedPublicPhoto } from "@/application/community/prepare-photo";
import { PUBLIC_RIDE_MAX_PHOTOS } from "@/application/community/public-ride";

export function PublicRidePhotos({ photos, onChange, onBusy }: {
  readonly photos: readonly PreparedPublicPhoto[];
  readonly onChange: (photos: readonly PreparedPublicPhoto[]) => void;
  readonly onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const processing = useRef(false);
  return <div className="og-public-photos">
    <label>Ride photos (optional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photos.length >= PUBLIC_RIDE_MAX_PHOTOS} onChange={async (event) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (processing.current || files.length === 0) return;
      if (photos.length + files.length > PUBLIC_RIDE_MAX_PHOTOS) { setError("Choose up to three photos."); return; }
      processing.current = true;
      onBusy(true);
      setError(null);
      try {
        const prepared: PreparedPublicPhoto[] = [];
        for (const file of files) prepared.push(await preparePublicPhoto(file));
        onChange([...photos, ...prepared]);
      }
      catch (caught) { setError(caught instanceof Error ? caught.message : "A photo could not be read."); }
      finally { processing.current = false; onBusy(false); }
    }} /></label>
    <p>Up to three JPEG, PNG or WebP photos, 8 MB each. GPS and camera metadata are removed. Check that the pictures themselves do not show private locations.</p>
    {photos.map((photo, index) => <div key={photo.previewUrl}>
      {/* Prepared local raster only; never a user-controlled external URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.previewUrl} alt={`Photo ${index + 1} to publish`} style={{ width: "100%", maxWidth: 200 }} />
      <button type="button" className="og-secondary" onClick={() => onChange(photos.filter((_, i) => i !== index))}>Remove photo {index + 1}</button>
    </div>)}
    {error === null ? null : <p role="alert">{error}</p>}
  </div>;
}
