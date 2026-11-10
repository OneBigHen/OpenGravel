import type { Coordinate } from '../../src/domain/ride/types';

export type Mode = 'gravel' | 'dual-sport' | 'curvy';
export interface Ride {
  id: string;
  label: string;
  source: 'catalog' | 'benchmark' | 'corpus';
  mode: Mode;
  requestId: string;
  start: Coordinate;
  end?: Coordinate;
  loopMinutes?: number;
  avoidHighways?: boolean;
  riderTrack?: { catalogId: string; geometryPolyline: string };
}
export interface Measurement {
  miles: number;
  minutes: number;
  goodMiles: number;
  goodShare: number;
  dirtShare: number | null;
  francoPerKm: number;
  busyShare: number | null;
  extraMinutes: number;
  riderMatch: number | null;
  unknownSurfaceShare: number;
  planningSeconds: number;
  trustFailures: string[];
  unknownTrust: string[];
  authorityWarnings: string[];
  geometry: readonly Coordinate[];
}
export interface Row {
  ride: Ride;
  openGravel: Measurement | null;
  fastest: Measurement | null;
  verdict: 'Win' | 'Tie' | 'Loss';
  reasons: string[];
  errors: string[];
}
