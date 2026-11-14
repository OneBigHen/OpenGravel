import { test } from "@playwright/test";
test("probe explore 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/explore");
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const rows: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > 321 && r.width > 0) {
        // skip if an ancestor clips horizontally
        let clipped = false;
        for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflowX !== "visible") { clipped = true; break; } }
        if (!clipped) rows.push(`${el.tagName}.${String(el.className).slice(0,60)} ${Math.round(r.left)}..${Math.round(r.right)} w=${Math.round(r.width)}`);
      }
    }
    return rows.slice(0, 25).join("\n");
  });
  console.log("PROBE\n" + out);
});
