/**
 * How old a surface report is, in the words a rider reads.
 *
 * The aggregated assessment carries an `ageDays` that is measured against each
 * report's own timestamp, so it is always zero and the sheet used to print
 * "Today" beside every report. This reads the report's own date instead, so a
 * three-year-old note says so.
 *
 * A timestamp that cannot be read is "Date unknown": never "Today".
 */

const MS_PER_DAY = 86_400_000;

/** `Today` / `Yesterday` / `5 days ago` / `2 years ago` / `Date unknown`. */
export function surfaceReportAge(observedAt: string | null | undefined, now: number): string {
  const at = observedAt === null || observedAt === undefined ? Number.NaN : Date.parse(observedAt);
  if (!Number.isFinite(at) || !Number.isFinite(now)) return "Date unknown";
  const ageDays = Math.floor((now - at) / MS_PER_DAY);
  if (ageDays <= 0) return "Today";
  if (ageDays === 1) return "Yesterday";
  if (ageDays < 60) return `${ageDays} days ago`;
  if (ageDays < 365) return `${Math.round(ageDays / 30)} months ago`;
  const years = Math.round(ageDays / 365);
  return years === 1 ? "A year ago" : `${years} years ago`;
}
