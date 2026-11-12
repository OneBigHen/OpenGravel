/**
 * Writes tests/fixtures/road-bends/*.json: ten single-road lines with the road-bends-v1 answer.
 * The same files pin the TypeScript measure (tests/unit/geometry/road-bend-fixtures.test.ts) and the
 * router's own copy of the maths (infra/graphhopper/moto/ext/OgChecks.java), so the bend metres the
 * app counts and the og_curve field the graph carries are one measure.
 *
 * Run: node --import tsx scripts/geometry/write-road-bend-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { haversine } from '../../src/domain/geometry/analysis';
import { measureRoadBends, type BendRoadRun } from '../../src/domain/geometry/road-bends';
import type { Coordinate } from '../../src/domain/ride/types';

/** A piece of road: a straight, or an arc of the given radius turning left (+) or right (-) by `degrees`. */
type Piece = { straight: number } | { radius: number; degrees: number };

const ORIGIN = { lat: 40.8, lon: -75.6 };
const VERTEX_METERS = 5;

/** Turn pieces into a line of vertices about 5 m apart, on a flat local plane around ORIGIN. */
export function draw(pieces: readonly Piece[], heading0 = 30): Coordinate[] {
  let x = 0, y = 0, heading = (heading0 * Math.PI) / 180;
  const points: Array<[number, number]> = [[0, 0]];
  for (const piece of pieces) {
    if ('straight' in piece) {
      const steps = Math.max(1, Math.round(piece.straight / VERTEX_METERS));
      for (let i = 0; i < steps; i++) { x += Math.sin(heading) * piece.straight / steps; y += Math.cos(heading) * piece.straight / steps; points.push([x, y]); }
    } else {
      const length = piece.radius * Math.abs(piece.degrees) * Math.PI / 180;
      const steps = Math.max(2, Math.round(length / VERTEX_METERS));
      const dTheta = (piece.degrees * Math.PI / 180) / steps;
      for (let i = 0; i < steps; i++) {
        // Chord of the arc step, taken along the mid heading, so the vertices sit on the arc.
        const chord = 2 * piece.radius * Math.sin(Math.abs(dTheta) / 2);
        const mid = heading - dTheta / 2;
        x += Math.sin(mid) * chord; y += Math.cos(mid) * chord;
        heading -= dTheta;
        points.push([x, y]);
      }
    }
  }
  const metersPerLat = 111_195;
  const metersPerLon = metersPerLat * Math.cos(ORIGIN.lat * Math.PI / 180);
  return points.map(([px, py]) => ({ lat: Number((ORIGIN.lat + py / metersPerLat).toFixed(7)), lon: Number((ORIGIN.lon + px / metersPerLon).toFixed(7)) }));
}

const zigzag = (legs: number, leg: number, degrees: number): Piece[] => {
  const pieces: Piece[] = [];
  for (let i = 0; i < legs; i++) pieces.push({ straight: leg }, { radius: 2, degrees: i % 2 === 0 ? degrees : -degrees });
  return pieces;
};

interface FixtureSpec {
  name: string;
  description: string;
  pieces: Piece[];
  road: Omit<BendRoadRun, 'meters'>;
  /** For the cut-arc fixture: the vertex where a side road meets it (the router splits the edge there). */
  splitAtFraction?: number;
}

const rural = (roadClass: string): Omit<BendRoadRun, 'meters'> => ({ roadClass, urbanDensity: 'rural', roadClassLink: false, roundabout: false });

export const FIXTURES: FixtureSpec[] = [
  { name: '01-straight', description: '1 km straight secondary road: no bends', pieces: [{ straight: 1000 }], road: rural('secondary') },
  { name: '02-sweeper-150', description: 'A 150 m radius sweeper through 90 degrees on a tertiary road', pieces: [{ straight: 200 }, { radius: 150, degrees: 90 }, { straight: 200 }], road: rural('tertiary') },
  { name: '03-curve-80', description: 'An 80 m radius curve through 120 degrees', pieces: [{ straight: 150 }, { radius: 80, degrees: -120 }, { straight: 150 }], road: rural('secondary') },
  { name: '04-hairpins-25', description: 'Three 25 m hairpins, alternating, 60 m apart', pieces: [{ straight: 100 }, { radius: 25, degrees: 180 }, { straight: 60 }, { radius: 25, degrees: -180 }, { straight: 60 }, { radius: 25, degrees: 180 }, { straight: 100 }], road: rural('unclassified') },
  { name: '05-zigzag', description: 'A jinking zig-zag: 15 m legs, 30 degree kinks alternating; mostly noise, so it earns little', pieces: [{ straight: 50 }, ...zigzag(20, 15, 30), { straight: 50 }], road: rural('tertiary') },
  { name: '06-s-bends-60', description: 'Four 60 m radius bends of 70 degrees, left and right with no straight between', pieces: [{ straight: 100 }, { radius: 60, degrees: 70 }, { radius: 60, degrees: -70 }, { radius: 60, degrees: 70 }, { radius: 60, degrees: -70 }, { straight: 100 }], road: rural('secondary') },
  { name: '07-arc-cut-by-side-road', description: 'A 90 m radius arc through 150 degrees; a side road meets it at the middle, so the router has two edges', pieces: [{ straight: 300 }, { radius: 90, degrees: 150 }, { straight: 300 }], road: rural('tertiary'), splitAtFraction: 0.5 },
  { name: '08-town-street', description: 'A residential street with tight 40 m bends: town streets earn nothing', pieces: [{ straight: 100 }, { radius: 40, degrees: 90 }, { straight: 80 }, { radius: 40, degrees: -90 }, { straight: 100 }], road: { roadClass: 'residential', urbanDensity: 'residential', roadClassLink: false, roundabout: false } },
  { name: '09-primary-sweeper', description: 'A 150 m radius sweeper on a primary road: busy roads earn only under 100 m', pieces: [{ straight: 200 }, { radius: 150, degrees: 90 }, { straight: 200 }], road: rural('primary') },
  { name: '10-primary-tight', description: 'A 70 m radius bend on a primary road: tight enough to earn', pieces: [{ straight: 200 }, { radius: 70, degrees: -100 }, { straight: 200 }], road: rural('primary') },
];

export interface RoadBendFixture {
  name: string;
  description: string;
  line: Coordinate[];
  run: BendRoadRun;
  splitIndex: number | null;
  expected: { version: string; bendMeters: number; tightMeters: number; bendShare: number };
}

export function buildFixture(spec: FixtureSpec): RoadBendFixture {
  const line = draw(spec.pieces);
  const meters = line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
  const run: BendRoadRun = { meters, ...spec.road };
  const result = measureRoadBends(line, [run]);
  if (!result) throw new Error(`${spec.name}: measure returned null`);
  return {
    name: spec.name, description: spec.description, line, run,
    splitIndex: spec.splitAtFraction === undefined ? null : Math.round((line.length - 1) * spec.splitAtFraction),
    expected: { version: result.version, bendMeters: result.bendMeters, tightMeters: result.tightMeters, bendShare: result.bendShare },
  };
}

if (process.argv[1]?.endsWith('write-road-bend-fixtures.ts')) {
  const dir = 'tests/fixtures/road-bends';
  mkdirSync(dir, { recursive: true });
  for (const spec of FIXTURES) {
    const fixture = buildFixture(spec);
    writeFileSync(`${dir}/${spec.name}.json`, `${JSON.stringify(fixture, null, 1)}\n`);
    console.log(`${spec.name}: ${fixture.expected.bendMeters.toFixed(1)} bend m of ${fixture.run.meters.toFixed(0)} m`);
  }
}
