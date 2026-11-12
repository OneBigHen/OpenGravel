"use client";

/** Settings → Units and data → "Spots you reported". Private to this device; each can be removed. */

import { useEffect, useState } from "react";

import {
  clearRiderReports,
  deleteRiderReport,
  loadRiderReports,
  subscribeRiderReports,
} from "@/application/persistence/rider-report-repository";
import { reportMarkerText, type RiderReport } from "@/application/roads/rider-reports";

export function RiderReportsSection({ refreshKey }: { readonly refreshKey?: unknown }) {
  const [reports, setReports] = useState<readonly RiderReport[]>([]);
  useEffect(() => {
    const refresh = (): void => setReports(loadRiderReports(Date.now()));
    refresh();
    return subscribeRiderReports(refresh);
  }, [refreshKey]);
  return (
    <div className="og-settings__card-block" data-testid="settings-rider-reports">
      <p className="og-settings__row-label" data-testid="settings-rider-reports-title">Spots you reported ({reports.length})</p>
      {reports.length === 0 ? (
        <p className="og-settings__note">None. Your plans avoid a spot only after you mark it while riding. Spots stay on this device.</p>
      ) : (
        <>
          <div>
            {reports.map((report) => (
              <div key={report.id} className="og-settings__row" data-testid="settings-rider-report">
                <span className="og-settings__row-text"><span className="og-settings__row-label">{reportMarkerText(report)}</span></span>
                <button type="button" className="og-settings__button" data-testid="settings-rider-report-remove" onClick={(): void => { deleteRiderReport(report.id, Date.now()); }}>Remove</button>
              </div>
            ))}
          </div>
          <button type="button" className="og-settings__button" data-testid="settings-rider-reports-clear" onClick={(): void => { clearRiderReports(); }}>Remove all</button>
        </>
      )}
    </div>
  );
}
