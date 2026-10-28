"use client";

import { useState } from "react";
import type { BreadcrumbWaypoint } from "@/domain/breadcrumb/types";

export function BreadcrumbWaypointEditor({ point, index, onSave, onRemove, onClose }: {
  readonly point: BreadcrumbWaypoint;
  readonly index: number;
  readonly onSave: (name: string) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(point.name ?? "");
  return (
    <form className="og-breadcrumb-editor" aria-label={`Waypoint ${index + 1}`} onSubmit={(event) => { event.preventDefault(); onSave(name); }}>
      <label htmlFor="breadcrumb-name">Waypoint {index + 1}</label>
      <input id="breadcrumb-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Add a name" autoFocus />
      <div className="og-breadcrumb-editor__actions">
        <button type="button" onClick={onRemove}>Delete</button>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit">Save name</button>
      </div>
    </form>
  );
}
