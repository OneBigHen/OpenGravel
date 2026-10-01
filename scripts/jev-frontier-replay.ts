/** Node-only CLI. Input and labels are separate; output never copies unvalidated input. */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { jevFrontierJudgeFromEnv } from "../src/infrastructure/routing/jev-frontier-judge";
import {
  runJevFrontierReplay,
  validateJevReplayCase,
} from "../src/application/planner/jev-frontier-replay";
import {
  evaluateJevFrontierReplay,
  validateJevReplayLabels,
} from "../src/application/planner/jev-frontier-evaluation";

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      labels: { type: "string" },
      output: { type: "string" },
      seed: { type: "string" },
      repeats: { type: "string" },
      policy: { type: "string" },
      live: { type: "boolean", default: false },
      provider: { type: "string", default: "openrouter" },
    },
    strict: true,
  });
  if (!values.input || !values.output || !values.seed || !values.policy)
    throw Error(
      "Required: --input frozen.json --output result.json --seed experiment-id --policy thresholds.json [--labels labels.json] [--repeats 2] [--live]",
    );
  const input: unknown = JSON.parse(await readFile(values.input, "utf8"));
  const labels: unknown = values.labels
    ? JSON.parse(await readFile(values.labels, "utf8"))
    : [];
  const policy = JSON.parse(await readFile(values.policy, "utf8"));
  if (
    !Array.isArray(input) ||
    !input.every(validateJevReplayCase) ||
    !validateJevReplayLabels(labels)
  )
    throw Error("Invalid frozen cases or labels");
  if (!["openrouter", "typesafe"].includes(values.provider!))
    throw Error("Invalid Jev provider");
  const key =
    values.provider === "typesafe"
      ? process.env.JEV_API_KEY
      : process.env.OPENROUTER_API_KEY;
  if (
    values.live &&
    (!key?.trim() || process.env.OGV_JEV_FRONTIER_SHADOW !== "1")
  )
    throw Error(
      "Live Jev unavailable: requires the selected provider's key and OGV_JEV_FRONTIER_SHADOW=1",
    );
  // Explicit --live is an additional CLI gate; loading an environment file cannot enable calls.
  const judge = values.live
    ? jevFrontierJudgeFromEnv({
        ...process.env,
        OGV_JEV_FRONTIER_PROVIDER: values.provider,
      })
    : null;
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const records = [];
    for (const entry of input)
      records.push(
        await runJevFrontierReplay(
          entry,
          {
            judge,
            seed: values.seed,
            repeats: Number(values.repeats ?? 2),
            policy,
          },
          controller.signal,
        ),
      );
    const output = {
      schemaVersion: 1,
      mode: values.live ? "live" : "disabled",
      provider: values.provider,
      records,
      evaluation: evaluateJevFrontierReplay(records, labels),
    };
    await writeFile(values.output, JSON.stringify(output, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        output: values.output,
        caseCount: records.length,
        labelCount: labels.length,
        mode: output.mode,
        promotionReady: false,
      }),
    );
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
main().catch(() => {
  console.error(
    "Jev replay failed: check flags, compact input, label fingerprints/splits, policy, and live credential configuration. No routing state was changed.",
  );
  process.exitCode = 1;
});
