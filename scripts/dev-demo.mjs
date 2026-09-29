import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nextCli = resolve(root, "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextCli, "dev", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    OGV_ROUTE_PLAN_FIXTURE: "1",
    OGV_CATALOG_FIXTURE: "1",
    OGV_WEATHER_FIXTURE: "1",
    OGV_GEOCODE_FIXTURE: "1",
    OGV_PLACES_FIXTURE: "1",
    NEXT_PUBLIC_OGV_BASEMAP: "openfreemap",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
