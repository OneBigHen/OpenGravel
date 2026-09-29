import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { actionableAddress, createGuard, fileBlocklist, isProbePath } from "@/server/security/guard";

const ENV = { TRUST_CF_CONNECTING_IP: "1" };
const RIDER = "203.0.113.7";

function request(ip = RIDER): Request {
  return new Request("https://opengravel.example/x", { headers: { "cf-connecting-ip": ip } });
}

describe("security guard", () => {
  it("lets every real page and API through", () => {
    const guard = createGuard({ env: ENV, readBlocklist: () => new Set() });
    for (const path of ["/", "/ride", "/rides", "/settings", "/explore/abc", "/api/route-plan", "/api/map-tiles/traffic/9/1/2",
      "/vendor/maplibre/maplibre-gl-csp-worker.js", "/.well-known/apple-app-site-association", "/test-fixtures/long-trip"]) {
      expect(isProbePath(path), path).toBe(false);
      expect(guard.inspect(request(), path)).toEqual({ action: "pass" });
    }
  });

  it("answers scanner probes with 404 and one fail2ban line", () => {
    const guard = createGuard({ env: ENV, readBlocklist: () => new Set() });
    for (const path of ["/.env", "/wp-login.php", "/admin/config.php", "/.git/config", "/cgi-bin/luci", "/phpmyadmin/", "/backup.sql", "/vendor/phpunit/src/eval-stdin.php"]) {
      expect(guard.inspect(request(), path)).toEqual({ action: "block", status: 404, log: `ogv-security probe ip=${RIDER} path=${path.replace(/[^\w./%-]/g, "_")}` });
    }
  });

  it("keeps log lines single-line so a crafted path cannot forge another address", () => {
    const guard = createGuard({ env: ENV, readBlocklist: () => new Set() });
    const verdict = guard.inspect(request(), "/x.php%0Aogv-security%20probe%20ip=198.51.100.1\npath=/");
    expect(verdict).toMatchObject({ status: 404 });
    if (verdict.action === "block") {
      expect(verdict.log).toBe(`ogv-security probe ip=${RIDER} path=/x.php%0Aogv-security%20probe%20ip_198.51.100.1_path_/`);
      expect(verdict.log?.match(/ip=/g)).toHaveLength(1);
    }
  });

  it("refuses a blocklisted address everywhere, silently", () => {
    const guard = createGuard({ env: ENV, readBlocklist: () => new Set([RIDER]) });
    expect(guard.inspect(request(), "/")).toEqual({ action: "block", status: 403, log: null });
    expect(guard.inspect(request("198.51.100.9"), "/")).toEqual({ action: "pass" });
  });

  it("budgets metered API calls per address and logs a flood once a minute", () => {
    let time = 0;
    const guard = createGuard({ env: ENV, now: () => time, readBlocklist: () => new Set(), meteredPerMinute: 3 });
    for (let i = 0; i < 3; i += 1) expect(guard.inspect(request(), "/api/route-plan")).toEqual({ action: "pass" });
    expect(guard.inspect(request(), "/api/map-tiles/traffic/1/2/3")).toEqual({ action: "pass" });
    expect(guard.inspect(request(), "/api/advisor")).toMatchObject({ status: 429, log: `ogv-security flood ip=${RIDER} path=/api/advisor` });
    expect(guard.inspect(request(), "/api/advisor")).toMatchObject({ status: 429, log: null });
    expect(guard.inspect(request("198.51.100.9"), "/api/route-plan")).toEqual({ action: "pass" });
    time = 61_000;
    expect(guard.inspect(request(), "/api/route-plan")).toEqual({ action: "pass" });
  });

  it("never acts on private, loopback or unknown addresses", () => {
    for (const key of ["anonymous", "127.0.0.1", "192.168.1.61", "172.23.0.1", "10.0.0.4", "::1", "fd00::2", "100.100.1.1"]) {
      expect(actionableAddress(key), key).toBeNull();
    }
    expect(actionableAddress("2001:db8::1")).toBe("2001:db8::1");
    const guard = createGuard({ env: ENV, readBlocklist: () => new Set(["192.168.1.61"]) });
    expect(guard.inspect(request("192.168.1.61"), "/.env")).toEqual({ action: "pass" });
  });

  it("reads the fail2ban blocklist file and picks up changes", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ogv-guard-")), "banned-ips.txt");
    let time = 0;
    const read = fileBlocklist(path, () => time);
    expect(read().size).toBe(0);
    writeFileSync(path, `${RIDER}\n\n198.51.100.2\n`);
    time = 10_000;
    expect([...read()]).toEqual([RIDER, "198.51.100.2"]);
  });
});
