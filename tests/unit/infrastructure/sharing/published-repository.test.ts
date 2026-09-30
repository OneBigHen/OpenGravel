import { describe, expect, it, vi } from "vitest";
import { MemoryShareRepository } from "@/application/sharing/memory-share-repository";
import { createPublishedShareRepository } from "@/infrastructure/storage/published-share-repository";
import { createShareService } from "@/application/sharing/share-commands";
import { buildShareSnapshot } from "@/domain/sharing/snapshot";
import { defaultPrivacyTrim } from "@/domain/sharing/privacy";
import { newCommandId } from "@/domain/ride/ids";

const snapshot = () => buildShareSnapshot({sourceRevision:1,title:"Synthetic",route:{segments:[[{lon:0,lat:1},{lon:0,lat:2}]]},summary:null,surface:{preference:"mixed",unknownSurfacePolicy:"allow-with-warning"},provenance:"new",authorPseudonym:null},defaultPrivacyTrim());
describe("published repository storage failures", () => {
 it("keeps a successful public link and revocation available when IndexedDB is full",async()=>{
  const local = new MemoryShareRepository();
  vi.spyOn(local,"save").mockRejectedValue(new Error("Quota exceeded"));
  vi.spyOn(local,"revoke").mockRejectedValue(new Error("Quota exceeded"));
  const request = vi.fn().mockResolvedValue(new Response(null,{status:201}));
  const svc = createShareService({repository:createPublishedShareRepository(local,request),linkBase:"https://opengravel.test"});
  const published = await svc.dispatch({type:"share.publish",commandId:newCommandId(),source:"rider",label:"Publish",payload:{snapshot:snapshot()}});
  expect(published.ok && published.kind).toBe("published");
  if(!published.ok || published.kind!=="published") throw new Error("Publish failed");
  const revoked = await svc.dispatch({type:"share.revoke",commandId:newCommandId(),source:"rider",label:"Revoke",payload:{shareId:published.record.shareId}});
  expect(revoked.ok && revoked.kind).toBe("revoked");
  expect((await svc.resolve(published.record.token)).state).toBe("revoked");
 });
 it("does not claim publication when the server refuses it",async()=>{
  const local = new MemoryShareRepository(), save=vi.spyOn(local,"save");
  const request = vi.fn().mockResolvedValue(Response.json({message:"At capacity"},{status:429}));
  const svc = createShareService({repository:createPublishedShareRepository(local,request),linkBase:"https://opengravel.test"});
  await expect(svc.dispatch({type:"share.publish",commandId:newCommandId(),source:"rider",label:"Publish",payload:{snapshot:snapshot()}})).rejects.toThrow("At capacity");
  expect(save).not.toHaveBeenCalled();
 });
});
