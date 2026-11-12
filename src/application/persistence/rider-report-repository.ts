/** Device-only storage for rider reports (`rider-reports.ts`). Nothing here leaves the phone. */

import { RIDER_REPORTS_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import {
  addReport,
  liveReports,
  parseReports,
  removeReport,
  type RiderReport,
} from "@/application/roads/rider-reports";

export interface ReportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): ReportStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

/** Called after any change so a screen can refresh. */
export function subscribeRiderReports(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Live reports only; expired ones never come back. */
export function loadRiderReports(nowMs: number, storage: ReportStorage | null = defaultStorage()): readonly RiderReport[] {
  if (storage === null) return [];
  try {
    return liveReports(parseReports(storage.getItem(RIDER_REPORTS_STORAGE_KEY)), nowMs);
  } catch {
    return [];
  }
}

function save(reports: readonly RiderReport[], storage: ReportStorage | null): boolean {
  if (storage === null) return false;
  try {
    if (reports.length === 0) storage.removeItem(RIDER_REPORTS_STORAGE_KEY);
    else storage.setItem(RIDER_REPORTS_STORAGE_KEY, JSON.stringify(reports));
    notify();
    return true;
  } catch {
    return false;
  }
}

/** True when the report was stored. */
export function saveRiderReport(report: RiderReport, nowMs: number, storage: ReportStorage | null = defaultStorage()): boolean {
  return save(addReport(loadRiderReports(nowMs, storage), report, nowMs), storage);
}

export function deleteRiderReport(id: string, nowMs: number, storage: ReportStorage | null = defaultStorage()): boolean {
  return save(removeReport(loadRiderReports(nowMs, storage), id), storage);
}

export function clearRiderReports(storage: ReportStorage | null = defaultStorage()): boolean {
  return save([], storage);
}
