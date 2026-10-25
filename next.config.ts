import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";
import { writeOfflineShellManifest } from "./scripts/offline-shell-manifest.mjs";

const shellBuildId = process.env.OGV_BUILD_ID?.trim() || process.env.NEXT_PUBLIC_OGV_SHELL_BUILD_ID || randomUUID();
if (!/^[a-zA-Z0-9_.-]+$/.test(shellBuildId)) throw new Error("OGV_BUILD_ID must be a URL-safe build identifier");
// Next reloads config in compiler workers. They inherit this generated ID so
// client code, Next's build ID and the post-compile asset manifest agree.
process.env.NEXT_PUBLIC_OGV_SHELL_BUILD_ID = shellBuildId;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  generateBuildId: () => shellBuildId,
  env: { NEXT_PUBLIC_OGV_SHELL_BUILD_ID: shellBuildId },
  compiler: {
    runAfterProductionCompile: async ({ distDir }) => {
      await writeOfflineShellManifest(distDir, shellBuildId);
    },
  },
  async headers() {
    return [{
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    }];
  },
};

export default nextConfig;
