import { describe, expect, it } from 'vitest';
import { FASTEST_REFERENCE_TOLERANCE, fastestReferenceCheck } from '../../../scripts/scorecard/reference';

const aToB = { label: 'Doylestown to New Hope', loopMinutes: undefined };
const loop = { label: 'Green Lane loop', loopMinutes: 120 };

describe('item d: fastest-reference sanity', () => {
  it('passes when our line is at most 2% quicker than the reference', () => {
    const atLimit = fastestReferenceCheck(aToB, { minutes: 100 * (1 - FASTEST_REFERENCE_TOLERANCE) }, { minutes: 100 });
    expect(atLimit.applicable).toBe(true);
    expect(atLimit.quickerShare).toBeCloseTo(0.02, 9);
    expect(atLimit.failed).toBe(false);
    expect(atLimit.message).toContain('Fastest reference 100.0 min');
    expect(atLimit.message).toContain('chosen line 98.0 min');
  });
  it('fails a ride whose own line is more than 2% quicker than its "fastest" reference', () => {
    const broken = fastestReferenceCheck(aToB, { minutes: 18.1 }, { minutes: 29.1 });
    expect(broken.failed).toBe(true);
    expect(broken.quickerShare).toBeCloseTo(1 - 18.1 / 29.1, 9);
    expect(broken.message).toContain('FASTEST REFERENCE FAILED');
    expect(broken.message).toContain('37.8% quicker');
  });
  it('does not fail a slower chosen line', () => {
    const slower = fastestReferenceCheck(aToB, { minutes: 110 }, { minutes: 100 });
    expect(slower.failed).toBe(false);
    expect(slower.quickerShare).toBeCloseTo(-0.1, 9);
    expect(slower.message).toContain('10.0% slower');
  });
  it('does not check loops: a loop baseline is an equal-time loop, not an A-to-B reference', () => {
    const checked = fastestReferenceCheck(loop, { minutes: 120 }, { minutes: 100 });
    expect(checked.applicable).toBe(false);
    expect(checked.failed).toBe(false);
    expect(checked.message).toContain('loop has no A-to-B');
  });
  it('never invents a failure when either route is unmeasured', () => {
    const missing = fastestReferenceCheck(aToB, null, { minutes: 100 });
    expect(missing.applicable).toBe(true);
    expect(missing.failed).toBe(false);
    expect(missing.referenceMinutes).toBe(100);
    expect(missing.chosenMinutes).toBeNull();
    expect(fastestReferenceCheck(aToB, { minutes: 50 }, null).failed).toBe(false);
    expect(fastestReferenceCheck(aToB, { minutes: 50 }, { minutes: 0 }).failed).toBe(false);
  });
});
