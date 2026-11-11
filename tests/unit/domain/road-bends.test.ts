import { describe, expect, it } from 'vitest';
import {
  BEND_MIN_ARC_METERS, BEND_RADIUS_METERS, measureRoadBends, type BendRoadRun,
} from '../../../src/domain/geometry/road-bends';
import { haversine } from '../../../src/domain/geometry/analysis';
import type { Coordinate } from '../../../src/domain/ride/types';

const xy = (x: number, y: number): Coordinate => ({ lon: -75 + x / (111_320 * Math.cos(40 * Math.PI / 180)), lat: 40 + y / 111_195 });
const length = (line: readonly Coordinate[]) => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
const runs = (line: readonly Coordinate[], roadClass = 'secondary', urbanDensity = 'rural'): BendRoadRun[] =>
  [{ meters: length(line), roadClass, urbanDensity }];

/** Drive a line: alternate arcs of `radius` (sweeping `sweep` degrees, right then left) and short straights. */
function switchbacks(radius: number, sweep: number, legs: number, straight = 10): Coordinate[] {
  const step = 2;
  const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let x = 0, y = 0, heading = 0;
  for (let leg = 0; leg < legs; leg++) {
    const direction = leg % 2 === 0 ? 1 : -1;
    const arcSteps = Math.max(1, Math.round(radius * (sweep * Math.PI / 180) / step));
    for (let i = 0; i < arcSteps; i++) {
      heading += direction * step / radius;
      x += Math.cos(heading) * step; y += Math.sin(heading) * step;
      points.push({ x, y });
    }
    for (let i = 0; i < Math.round(straight / step); i++) {
      x += Math.cos(heading) * step; y += Math.sin(heading) * step;
      points.push({ x, y });
    }
  }
  return points.map(p => xy(p.x, p.y));
}
const straight = Array.from({ length: 301 }, (_, i) => xy(i * 10, 0));
/** A town grid: four 400 m legs of right-angle corners. */
const grid = [
  ...Array.from({ length: 21 }, (_, i) => xy(i * 20, 0)),
  ...Array.from({ length: 21 }, (_, i) => xy(400, (i + 1) * 20)),
  ...Array.from({ length: 21 }, (_, i) => xy(400 - i * 20, 400)),
  ...Array.from({ length: 21 }, (_, i) => xy(0, 400 - (i + 1) * 20)),
];
/** A single 90 degree arc of `radius` metres. */
function arc(radius: number, degrees = 90): Coordinate[] {
  const steps = Math.max(2, Math.round(radius * (degrees * Math.PI / 180) / 10));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (degrees * Math.PI / 180) * i / steps;
    return xy(radius * Math.sin(a), radius * (1 - Math.cos(a)));
  });
}

describe('road bends: what counts as the rider\'s kind of road', () => {
  it('scores a straight highway as zero', () => {
    expect(measureRoadBends(straight, runs(straight, 'motorway'))!.bendMeters).toBe(0);
    expect(measureRoadBends(straight, runs(straight, 'secondary'))!.bendMeters).toBe(0);
  });

  it('does not call a 1 km sweeper a bend, however long it goes on', () => {
    expect(measureRoadBends(arc(1000, 172), runs(arc(1000, 172)))!.bendMeters).toBe(0);
  });

  it('scores a town grid of right-angle turns as about zero', () => {
    const m = measureRoadBends(grid, runs(grid))!;
    expect(m.bendMeters / length(grid)).toBeLessThan(0.01);
    expect(m.bendMeters).toBe(0);
  });

  it('scores a real switchback road high', () => {
    const road = switchbacks(30, 120, 6);
    const m = measureRoadBends(road, runs(road))!;
    expect(m.bendShare).toBeGreaterThan(0.5);
    expect(m.bendMeters).toBeGreaterThan(length(road) * 0.5);
  });

  it('credits a tight arc but not a gentle one', () => {
    const tight = arc(80);
    const gentle = arc(300);
    expect(measureRoadBends(tight, runs(tight))!.bendMeters).toBeCloseTo(length(tight), 0);
    expect(measureRoadBends(gentle, runs(gentle))!.bendMeters).toBe(0);
    expect(BEND_RADIUS_METERS).toBe(175);
  });

  it('needs a sustained arc, so the corner where two roads meet is not a bend', () => {
    const corner = [...Array.from({ length: 21 }, (_, i) => xy(i * 10, 0)), ...Array.from({ length: 20 }, (_, i) => xy(200, (i + 1) * 10))];
    expect(measureRoadBends(corner, runs(corner))!.bendMeters).toBe(0);
    // The same corner loses even the short credit a 50 m arc would get when it lasts less than the minimum.
    const short = arc(25, 60); // 26 m of arc
    expect(length(short)).toBeLessThan(BEND_MIN_ARC_METERS + 3);
    expect(measureRoadBends(short, runs(short))!.bendMeters).toBe(0);
  });

  it('ignores a bend beside an instructed junction vertex', () => {
    const road = arc(80);
    const withoutJunction = measureRoadBends(road, runs(road))!;
    const atApex = measureRoadBends(road, runs(road), [Math.floor(road.length / 2)])!;
    expect(withoutJunction.bendMeters).toBeGreaterThan(100);
    expect(atApex.bendMeters).toBeLessThan(withoutJunction.bendMeters - 20);
  });

  it('does not pay for town streets, service roads, links or roundabouts', () => {
    const road = switchbacks(30, 120, 4);
    expect(measureRoadBends(road, runs(road, 'residential', 'rural'))!.bendMeters).toBe(0);
    expect(measureRoadBends(road, runs(road, 'secondary', 'city'))!.bendMeters).toBe(0);
    expect(measureRoadBends(road, [{ ...runs(road)[0]!, roadClassLink: true }])!.bendMeters).toBe(0);
    expect(measureRoadBends(road, [{ ...runs(road)[0]!, roundabout: true }])!.bendMeters).toBe(0);
  });

  it('lets a busy road earn only where it is truly twisty', () => {
    const tight = arc(80);
    const gentle = arc(150);
    expect(measureRoadBends(tight, runs(tight, 'primary'))!.bendMeters).toBeGreaterThan(0);
    expect(measureRoadBends(gentle, runs(gentle, 'primary'))!.bendMeters).toBe(0);
  });

  it('weights the tightest arcs more and never credits more than the route length', () => {
    const road = switchbacks(30, 120, 6);
    const m = measureRoadBends(road, runs(road))!;
    expect(m.bendMeters).toBeLessThanOrEqual(length(road) + 1e-6);
    expect(m.tightMeters).toBeLessThanOrEqual(m.bendMeters + 1e-6);
  });

  it('fails closed when ordered road facts are missing or inconsistent', () => {
    expect(measureRoadBends(straight, [])).toBeNull();
    expect(measureRoadBends([straight[0]!, straight[1]!], runs(straight))).toBeNull();
    expect(measureRoadBends(straight, [{ meters: 10, roadClass: 'secondary', urbanDensity: 'rural' }])).toBeNull();
    expect(measureRoadBends(straight, [{ meters: -1, roadClass: 'secondary', urbanDensity: 'rural' }])).toBeNull();
  });
});
