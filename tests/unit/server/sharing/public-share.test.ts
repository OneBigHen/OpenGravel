import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newShareId, newShareToken } from "@/domain/sharing/ids";
import { buildShareSnapshot, serializeShareSnapshot } from "@/domain/sharing/snapshot";
import { defaultPrivacyTrim } from "@/domain/sharing/privacy";
import type { ShareRecord } from "@/application/sharing/ports/share-repository";
import { SQLitePublicShareStore } from "@/server/sharing/public-share-store";
import { handlePublishShare, handleRevokeShare } from "@/server/sharing/public-share-handler";

const stores: SQLitePublicShareStore[] = [];
const record = (): ShareRecord => ({
  shareId: newShareId(), token: newShareToken(), state: "active", createdAt: "2026-09-30T00:00:00.000Z", revokedAt: null,
  snapshot: buildShareSnapshot({sourceRevision: 1, title: "Synthetic public ride", route: {segments: [[{lon: -75.4,lat: 40.1},{lon: -75.4,lat: 40.2},{lon: -75.4,lat: 40.3}]]}, summary: {distanceMeters: 22000,durationSeconds: 1800}, surface: {preference: "mostly-pavement",unknownSurfacePolicy: "allow-with-warning"}, provenance: "new",authorPseudonym: null}, defaultPrivacyTrim()),
});
function store() { const s = new SQLitePublicShareStore(":memory:"); stores.push(s); return s; }
function request(method: string, path: string, body?: unknown, cookie?: string, origin = "https://opengravel.test") {
  return new Request("https://opengravel.test"+path,{method,headers:{origin,"content-type":"application/json",...(cookie ? {cookie} : {})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
afterEach(()=>{ for(const s of stores.splice(0)) s.close(); });
describe("public share boundary",()=>{
 it("keeps the owner cookie Secure behind HTTPS termination",async()=>{
  const s=store(),r=record();
  const req = new Request("http://localhost:3200/api/shares",{method:"POST",headers:{host:"opengravel.test",origin:"https://opengravel.test","x-forwarded-proto":"https","content-type":"application/json"},body:JSON.stringify(r)});
  const response = await handlePublishShare(req,s);
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toContain("; Secure");
 });
 it("uses the browser Host when Next normalizes its internal URL",async()=>{
  const s=store(),r=record();
  const req = new Request("http://localhost:3298/api/shares", {method:"POST",headers:{host:"127.0.0.1:3298",origin:"http://127.0.0.1:3298","content-type":"application/json"},body:JSON.stringify(r)});
  expect((await handlePublishShare(req,s)).status).toBe(201);
 });
 it("rejects distance that contradicts the shared route geometry",async()=>{
  const s=store(),r=record();
  expect((await handlePublishShare(request("POST","/api/shares",{...r,snapshot:{...r.snapshot,distanceMeters:Number.MAX_VALUE}}),s)).status).toBe(400);
 });
 it("keeps snapshots and revocation across process-store reopening",async()=>{
  const directory = mkdtempSync(join(tmpdir(), "og-share-unit-"));
  const path = join(directory, "shares.sqlite"), r = record();
  let s = new SQLitePublicShareStore(path);
  try {
   const response = await handlePublishShare(request("POST", "/api/shares", r), s);
   const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
   s.close(); s = new SQLitePublicShareStore(path);
   expect(s.resolve(r.token)).toEqual({state:"active",output:serializeShareSnapshot(r.snapshot)});
   await handleRevokeShare(request("DELETE", "/api/shares/"+r.shareId, undefined, cookie), r.shareId, s);
   s.close(); s = new SQLitePublicShareStore(path);
   expect(s.resolve(r.token)).toEqual({state:"revoked"});
  } finally { s.close(); rmSync(directory, {recursive:true,force:true}); }
 });
 it("rejects oversized bodies and another owner's revocation capability",async()=>{
  const s=store(),r=record();
  expect((await handlePublishShare(request("POST","/api/shares", {...r,padding:"x".repeat(256*1024)}),s)).status).toBe(413);
  const original = await handlePublishShare(request("POST", "/api/shares", r), s);
  expect(original.status).toBe(201);
  const other = await handlePublishShare(request("POST", "/api/shares", record()), s);
  const cookie = other.headers.get("set-cookie")!.split(";")[0]!;
  expect((await handleRevokeShare(request("DELETE", "/api/shares/"+r.shareId, undefined, cookie), r.shareId, s)).status).toBe(404);
  expect(s.resolve(r.token).state).toBe("active");
 });
 it("publishes preview bytes for another browser without exposing owner handles",async()=>{
  const s=store(),r=record(); const response=await handlePublishShare(request("POST","/api/shares",r),s);
  expect(response.status).toBe(201); expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(s.resolve(r.token)).toEqual({state:"active",output:serializeShareSnapshot(r.snapshot)});
  expect(s.resolve(r.token)).not.toHaveProperty("shareId");
 });
 it("requires the owner's cookie to revoke, and serves no snapshot after revocation",async()=>{
  const s=store(),r=record(); const response=await handlePublishShare(request("POST","/api/shares",r),s);
  const cookie=response.headers.get("set-cookie")!.split(";")[0]!;
  expect((await handleRevokeShare(request("DELETE","/api/shares/"+r.shareId,undefined),r.shareId,s)).status).toBe(404);
  expect((await handleRevokeShare(request("DELETE","/api/shares/"+r.shareId,undefined,cookie),r.shareId,s)).status).toBe(200);
  expect(s.resolve(r.token)).toEqual({state:"revoked"});
 });
 it("cannot overwrite a snapshot or reanimate a revoked token",async()=>{
  const s=store(),r=record(); const response=await handlePublishShare(request("POST","/api/shares",r),s);
  const cookie=response.headers.get("set-cookie")!.split(";")[0]!;
  await handleRevokeShare(request("DELETE","/api/shares/"+r.shareId,undefined,cookie),r.shareId,s);
  expect((await handlePublishShare(request("POST","/api/shares",r,cookie),s)).status).toBe(409);
  expect(s.resolve(r.token)).toEqual({state:"revoked"});
 });
 it("rejects cross-origin publishing and revoke attempts",async()=>{
  const s=store(),r=record();
  expect((await handlePublishShare(request("POST","/api/shares",r,undefined,"https://evil.test"),s)).status).toBe(403);
  expect((await handleRevokeShare(request("DELETE","/api/shares/"+r.shareId,undefined,undefined,"https://evil.test"),r.shareId,s)).status).toBe(403);
 });
 it("rejects malformed coordinates and keeps fields outside the public allowlist out of storage",async()=>{
  const s=store(),r=record();
  const dirty={...r,snapshot:{...r.snapshot,home:"private",route:{segments:r.snapshot.route.segments.map(seg=>seg.map(p=>({...p,gpsTime:"private"})))}}};
  expect((await handlePublishShare(request("POST","/api/shares",dirty),s)).status).toBe(201);
  const resolved=s.resolve(r.token); expect(JSON.stringify(resolved)).not.toContain("private");
  expect((await handlePublishShare(request("POST","/api/shares",{...record(),snapshot:{...r.snapshot,route:{segments:[[{lon:400,lat:900},{lon:0,lat:0}]]}}}),s)).status).toBe(400);
 });
});
