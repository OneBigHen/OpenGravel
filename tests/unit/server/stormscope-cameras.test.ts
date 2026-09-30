import { describe, expect, it } from "vitest";

import {
  parseStormScopeCamera,
  parseStormScopeIndex,
} from "@/server/traffic-cameras/stormscope";

describe("StormScope nationwide camera fallback", () => {
  it("validates schema-v2 shard indexes", () => {
    const index = parseStormScopeIndex({
      camera_schema_version: 2,
      generated_at: "2026-07-12T20:46:37Z",
      total: 36592,
      shards: [
        { id: "0023", path: "camera-shards/0023.json?generation=abc", bbox: [-80.5, 39.7, -74.7, 42.3] },
      ],
    });
    expect(index.total).toBe(36592);
    expect(index.shards[0]?.id).toBe("0023");
  });

  it("keeps DOT HLS cameras with provenance and health", () => {
    const camera = parseStormScopeCamera({
      id: 17001,
      name: "I-80 at Example",
      lat: 40.4,
      lon: -76.2,
      url: "https://video.example.test/live.m3u8",
      type: "hls",
      source: "dot",
      state: "PA",
      provider: "Example DOT",
      source_url: "https://511.example.test/camera/1",
      last_verified: "2026-09-01T00:00:00Z",
      health: "healthy",
      failure_class: null,
      refresh_cadence_seconds: null,
      status: "Active",
    });
    expect(camera).toMatchObject({
      id: "stormscope-17001",
      state: "PA",
      provider: "Example DOT",
      playbackUrl: null,
      videoAvailable: false,
    });
  });

  it("keeps image cameras with provider cadence and rejects non-DOT/offline rows", () => {
    const image = parseStormScopeCamera({
      id: 8,
      name: "US 1",
      lat: 39.9,
      lon: -75.1,
      url: "https://images.example.test/cam.jpg",
      type: "image",
      source: "dot",
      source_url: "https://511.example.test/",
      health: "unknown",
      failure_class: null,
      last_verified: null,
      refresh_cadence_seconds: 5,
      status: "Unknown",
    });
    expect(image).toMatchObject({ previewUrl: "https://images.example.test/cam.jpg", refreshSeconds: 5 });
    expect(parseStormScopeCamera({
      id: 81,
      name: "Park camera",
      lat: 39.9,
      lon: -75.1,
      url: "https://images.example.test/park.jpg",
      type: "image",
      source: "nps",
      source_url: "https://nps.example.test/",
      health: "healthy",
      status: "Active",
      last_verified: "2026-09-01T00:00:00Z",
      failure_class: null,
      refresh_cadence_seconds: 10,
    })).toBeNull();
    expect(parseStormScopeCamera({
      id: 9,
      name: "dead",
      lat: 39,
      lon: -75,
      url: "https://images.example.test/dead.jpg",
      type: "image",
      source: "dot",
      health: "offline",
      status: "Offline",
      source_url: "https://511.example.test/",
    })).toBeNull();
  });
});

describe('StormScope trust boundary',()=>{
 it.each(['https://127.0.0.1/internal','http://other.example/camera.json','//other.example/camera.json','../private.json','camera-shards/../../private.json','camera-shards/%2e%2e/private.json'])('rejects a registry shard that escapes the data directory: %s',(path)=>{
  expect(()=>parseStormScopeIndex({camera_schema_version:2,shards:[{id:'1',path,bbox:[-76,39,-75,40]}]})).toThrow();
 });
 it('never exposes unqualified registry HLS for automatic client loading',()=>{
  const camera=parseStormScopeCamera({id:42,lat:40,lon:-75,url:'https://video.example.test/live.m3u8',type:'hls',source:'dot',source_url:'https://511.example.test/camera/42',health:'healthy',state:'PA'});
  expect(camera?.playbackUrl).toBeNull();
  expect(camera?.videoAvailable).toBe(false);
  expect(camera?.sourceHref).toBe('https://511.example.test/camera/42');
 });
});
