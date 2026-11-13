import type { FastestReferenceCheck, Measurement, Ride } from './types';

/** Our own line may be at most this much quicker than the line called "fastest". */
export const FASTEST_REFERENCE_TOLERANCE = 0.02;

const minutes = (value: number | null): string => value === null ? 'unknown' : `${value.toFixed(1)} min`;

/**
 * Scorecard v4 item d: what the "fastest" reference is, in plain English, and
 * whether our own chosen line beats it by more than 2%. If it does, the
 * reference is not fastest; the 1.35x time budget has been measured from the
 * wrong line, so the ride is marked FAILED.
 */
export function fastestReferenceCheck(
  ride: Pick<Ride, 'label' | 'loopMinutes'>,
  chosen: Pick<Measurement, 'minutes'> | null,
  reference: Pick<Measurement, 'minutes'> | null,
): FastestReferenceCheck {
  if (ride.loopMinutes !== undefined) {
    return {
      applicable: false, referenceMinutes: reference?.minutes ?? null, chosenMinutes: chosen?.minutes ?? null,
      quickerShare: null, failed: false,
      message: 'Not checked: a loop has no A-to-B "fastest" reference; its baseline is an equal-time loop.',
    };
  }
  if (!chosen || !reference || !(reference.minutes > 0)) {
    return {
      applicable: true, referenceMinutes: reference?.minutes ?? null, chosenMinutes: chosen?.minutes ?? null,
      quickerShare: null, failed: false,
      message: 'Fastest reference unknown: the reference or the chosen line was not measured, so the 2% check cannot run.',
    };
  }
  const quickerShare = 1 - chosen.minutes / reference.minutes;
  const failed = quickerShare > FASTEST_REFERENCE_TOLERANCE + 1e-9;
  const difference = `${(Math.abs(quickerShare) * 100).toFixed(1)}% ${quickerShare >= 0 ? 'quicker' : 'slower'}`;
  const prefix = `Fastest reference ${minutes(reference.minutes)} (motorcycle_fastest, no alternatives); chosen line ${minutes(chosen.minutes)}, ${difference}.`;
  return {
    applicable: true,
    referenceMinutes: reference.minutes,
    chosenMinutes: chosen.minutes,
    quickerShare,
    failed,
    message: failed
      ? `FASTEST REFERENCE FAILED: ${prefix} Our line is ${(quickerShare * 100).toFixed(1)}% quicker than the line called "fastest" (limit 2%), so the time budget is measured from the wrong line.`
      : prefix,
  };
}
