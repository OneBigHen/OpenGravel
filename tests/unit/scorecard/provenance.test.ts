import { describe, expect, it } from 'vitest';
import { canonicalJson, parseRouterInfo, readRouterProvenance, UNKNOWN } from '../../../scripts/scorecard/provenance';

describe('router provenance from GraphHopper /info', () => {
  it('reads the graph build date and hashes profiles independently of key order', () => {
    const first = parseRouterInfo({
      import_date: '2026-11-12T13:21:00Z',
      profiles: { 'motorcycle_twisty': { vehicle: 'motorcycle', elevation: true }, 'motorcycle_fastest': { vehicle: 'motorcycle', elevation: false } },
    });
    const second = parseRouterInfo({
      profiles: { 'motorcycle_fastest': { elevation: false, vehicle: 'motorcycle' }, 'motorcycle_twisty': { elevation: true, vehicle: 'motorcycle' } },
      import_date: '2026-11-12T13:21:00Z',
    });
    expect(first.graphBuildDate).toBe('2026-11-12T13:21:00Z');
    expect(first.profileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.profileHash).toBe(second.profileHash);
  });
  it('changes the hash when a profile changes', () => {
    const before = parseRouterInfo({ profiles: { bike: { vehicle: 'motorcycle' } } });
    const after = parseRouterInfo({ profiles: { bike: { vehicle: 'car' } } });
    expect(after.profileHash).not.toBe(before.profileHash);
  });
  it('sorts nested keys, so the same profiles always hash the same', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [3, { f: 4, e: 5 }] })).toBe('{"a":[3,{"e":5,"f":4}],"b":{"c":2,"d":1}}');
  });
  it('records unknown when /info does not carry the fields', () => {
    expect(parseRouterInfo({})).toEqual({ graphBuildDate: UNKNOWN, profileHash: UNKNOWN });
    expect(parseRouterInfo(null)).toEqual({ graphBuildDate: UNKNOWN, profileHash: UNKNOWN });
    expect(parseRouterInfo({ import_date: '   ', profiles: 'not-a-map' })).toEqual({ graphBuildDate: UNKNOWN, profileHash: UNKNOWN });
  });
  it('accepts an epoch import date, because a graph build is never guessed', () => {
    expect(parseRouterInfo({ import_date: 1_762_954_860 }).graphBuildDate).toBe('2025-11-12T13:41:00.000Z');
  });
  it('asks /info once and returns both values', async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ import_date: '2026-11-12T13:21:00Z', profiles: { bike: { vehicle: 'motorcycle' } } }), { status: 200 });
    }) as typeof fetch;
    const provenance = await readRouterProvenance('http://127.0.0.1:8989/', { fetcher });
    expect(calls).toEqual(['http://127.0.0.1:8989/info']);
    expect(provenance.graphBuildDate).toBe('2026-11-12T13:21:00Z');
    expect(provenance.profileHash).toMatch(/^sha256:/);
  });
  it('is unknown, never fatal, when /info fails or cannot be reached', async () => {
    const badStatus = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    expect(await readRouterProvenance('http://127.0.0.1:8989', { fetcher: badStatus })).toEqual({ graphBuildDate: UNKNOWN, profileHash: UNKNOWN });
    const throws = (async () => { throw new Error('tunnel down'); }) as unknown as typeof fetch;
    expect(await readRouterProvenance('http://127.0.0.1:8989', { fetcher: throws })).toEqual({ graphBuildDate: UNKNOWN, profileHash: UNKNOWN });
  });
});
