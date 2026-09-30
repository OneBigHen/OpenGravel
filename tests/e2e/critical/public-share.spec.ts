import { expect, test } from "@playwright/test";
import { buildShareSnapshot, serializeShareSnapshot } from "@/domain/sharing/snapshot";
import { defaultPrivacyTrim } from "@/domain/sharing/privacy";
import { newShareId, newShareToken } from "@/domain/sharing/ids";

// Independently exercise the public reader without paying for an unrelated map
// planning setup. share.spec.ts retains the complete author/preview/publish flow.
test("another browser reads exact snapshot bytes and the owner reclaims revoke after reload",async ({page,browser,baseURL})=>{
 const token=newShareToken(),shareId=newShareId();
 const snapshot=buildShareSnapshot({sourceRevision:1,title:"Synthetic public ride",route:{segments:[[{lon:-75.4,lat:40.1},{lon:-75.4,lat:40.2},{lon:-75.4,lat:40.3}]]},summary:{distanceMeters:22000,durationSeconds:1800},surface:{preference:"mixed",unknownSurfacePolicy:"allow-with-warning"},provenance:"new",authorPseudonym:null},defaultPrivacyTrim());
 const response=await page.request.post(`${baseURL}/api/shares`,{headers:{origin:baseURL!},data:{shareId,token,state:"active",snapshot}});
 expect(response.status()).toBe(201);
 const link=`${baseURL}/share/${token}`;
 const reader=await browser.newContext();
 try {
  const sharedPage=await reader.newPage();
  await sharedPage.goto(link);
  await expect(sharedPage.getByRole("heading",{name:"Synthetic public ride"})).toBeVisible();
  await expect(sharedPage.getByRole("button",{name:"Revoke this link"})).toHaveCount(0);
  await sharedPage.getByText("Shared data",{exact:true}).click();
  await expect(sharedPage.getByTestId("public-share-payload")).toHaveText(serializeShareSnapshot(snapshot));
  expect(await (await reader.request.get(`${baseURL}/api/shares/resolve/${token}`)).text()).toBe(serializeShareSnapshot(snapshot));
  await expect(sharedPage.getByText(/Ride time: 30 minutes/)).toBeVisible();
  await page.route("https://outside.test/message",route=>route.fulfill({contentType:"text/html",body:`<a href="${link}">Open copied ride</a>`}));
  await page.goto("https://outside.test/message");
  await page.getByRole("link",{name:"Open copied ride"}).click();
  await page.reload();
  await page.getByRole("button",{name:"Revoke this link"}).click();
  await expect(page.getByRole("heading",{name:"This link has been revoked"})).toBeVisible();
  await sharedPage.reload();
  await expect(sharedPage.getByRole("heading",{name:"This link has been revoked"})).toBeVisible();
  expect((await reader.request.get(`${baseURL}/api/shares/resolve/${token}`)).status()).toBe(410);
 } finally { await reader.close(); }
});
