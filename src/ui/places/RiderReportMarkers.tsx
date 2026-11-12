"use client";

/**
 * The rider's own reported spots as markers on the planner map (R3-6). A marker
 * is drawn through the same pill layer as other map marks; tapping one opens a
 * small card that says what the rider marked and offers Remove. It never says a
 * road is closed: it says what *you* marked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteRiderReport,
  loadRiderReports,
  subscribeRiderReports,
} from "@/application/persistence/rider-report-repository";
import type { PlaceScene } from "@/application/places";
import { reportMarkerText, riderReportKindLabel, type RiderReport } from "@/application/roads/rider-reports";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export const RIDER_REPORT_PLACE_PREFIX = "rr:";

export function useRiderReportMarkers() {
  const [reports, setReports] = useState<readonly RiderReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const refresh = (): void => setReports(loadRiderReports(Date.now()));
    refresh();
    return subscribeRiderReports(refresh);
  }, []);
  const scenePlaces = useMemo<readonly PlaceScene[]>(
    () => reports.map((report) => ({
      id: `${RIDER_REPORT_PLACE_PREFIX}${report.id}` as PlaceScene["id"],
      kind: "rider-report",
      coordinate: report.point,
      pill: report.kind === "gate-closed" ? "You: gate" : "You: rough",
      tone: "quiet" as const,
      priority: 500,
      selected: report.id === selectedId,
    })),
    [reports, selectedId],
  );
  const selected = reports.find((report) => report.id === selectedId) ?? null;
  const select = useCallback((placeId: string): boolean => {
    if (!placeId.startsWith(RIDER_REPORT_PLACE_PREFIX)) return false;
    setSelectedId(placeId.slice(RIDER_REPORT_PLACE_PREFIX.length));
    return true;
  }, []);
  const clear = useCallback((): void => setSelectedId(null), []);
  const remove = useCallback((id: string): void => {
    deleteRiderReport(id, Date.now());
    setSelectedId(null);
  }, []);
  return { scenePlaces, selected, select, clear, remove };
}

export function RiderReportCard({ report, onRemove, onClose }: {
  readonly report: RiderReport;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useDialogFocus(ref, onClose);
  return (
    <section ref={ref} className="og-places-card" data-testid="rider-report-card" role="dialog" aria-label={`Your ${riderReportKindLabel(report.kind)} marker`}>
      <div className="og-places-card__topline">
        <p className="og-places-card__when" data-testid="rider-report-text">{reportMarkerText(report)}</p>
        <button type="button" className="og-places-card__close" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button>
      </div>
      <p>Only on this device. Your plans avoid it until you remove it.</p>
      <button type="button" className="og-ride__sheet-row" data-testid="rider-report-remove" onClick={onRemove}>
        <span className="og-ride__sheet-row-label">Remove</span>
      </button>
    </section>
  );
}
