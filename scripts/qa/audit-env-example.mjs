import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const scanRoots = ["src", "apps", "scripts", "infra"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const ignoredDirectories = new Set(["node_modules", ".next", "dist", "build", "coverage", "public", "fixtures"]);

const builtIns = new Set(["NODE_ENV", "CI", "GITHUB_SHA"]);

function looksLikeDeploymentKey(value) {
  return /^[A-Z][A-Z0-9_]{1,}$/.test(value);
}

async function filesUnder(directory) {
  const absolute = path.join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(relative));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

function deploymentKeysFromSource(source) {
  const keys = new Set();

  // Parse real reads, not comments or documentation strings. Resolve simple
  // process.env aliases and destructuring as well as injected `env` objects.
  const tree = ts.createSourceFile("env-scan.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const aliases = new Set(["env"]);
  const constants = new Map();
  // Existing dependency-injection boundaries that wrap an environment record.
  // Arbitrary settings.env objects are not deployment configuration.
  const envOwners = new Set(["process", "deps", "dependencies", "context", "options"]);
  function isEnv(node) {
    return node && (ts.isIdentifier(node) && aliases.has(node.text) ||
      ts.isPropertyAccessExpression(node) && node.name.text === "env" &&
      ts.isIdentifier(node.expression) && envOwners.has(node.expression.text) ||
      // `deps.env ?? process.env`: an injected record with the process fallback.
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      (isEnv(node.left) || isEnv(node.right)) ||
      ts.isParenthesizedExpression(node) && isEnv(node.expression));
  }
  function declarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isEnv(node.initializer)) aliases.add(node.name.text);
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        constants.set(node.name.text, node.initializer.text);
        // Exported config names may be imported by their reader in another file.
        if (node.name.text.endsWith("_ENV") && looksLikeDeploymentKey(node.initializer.text)) keys.add(node.initializer.text);
      }
    }
    ts.forEachChild(node, declarations);
  }
  declarations(tree);
  function visit(node) {
    let key;
    // Adapter descriptors declare their dynamic credential read by name.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "requiresKey" && ts.isStringLiteral(node.initializer)) key = node.initializer.text;
    if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) key = node.name.text;
    if (ts.isElementAccessExpression(node) && isEnv(node.expression)) {
      const argument = node.argumentExpression;
      if (ts.isStringLiteral(argument)) key = argument.text;
      else if (ts.isIdentifier(argument)) key = constants.get(argument.text);
    }
    if (key && looksLikeDeploymentKey(key)) keys.add(key);
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && isEnv(node.initializer)) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && looksLikeDeploymentKey(name.text)) keys.add(name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);

  // Template-derived camera origin prefixes are real deployment keys but do
  // not appear as complete literals in source.
  if (source.includes("TRAFFIC_CAMERA_ALLOWED_ORIGINS_")) {
    for (const state of ["PA", "NJ", "NY", "DE", "MD", "VA", "WV"]) {
      keys.add(`TRAFFIC_CAMERA_ALLOWED_ORIGINS_${state}`);
    }
  }
  if (source.includes("TRAFFIC_CAMERA_METADATA_ORIGINS_")) {
    for (const state of ["PA", "NJ", "NY", "DE", "MD", "VA", "WV"]) {
      keys.add(`TRAFFIC_CAMERA_METADATA_ORIGINS_${state}`);
    }
  }

  return keys;
}

function documentedKeys(example) {
  const keys = new Set();
  for (const line of example.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match && looksLikeDeploymentKey(match[1])) keys.add(match[1]);
  }
  return keys;
}

const rootConfigs = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name)))
  .map((entry) => entry.name);
const files = [...rootConfigs, ...(await Promise.all(scanRoots.map(filesUnder))).flat()]
  .filter((file) => file !== "scripts/qa/audit-env-example.mjs");
const used = new Map();

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  for (const key of deploymentKeysFromSource(source)) {
    if (builtIns.has(key)) continue;
    const locations = used.get(key) ?? [];
    locations.push(file);
    used.set(key, locations);
  }
}

const example = await readFile(path.join(root, ".env.example"), "utf8");
const documented = documentedKeys(example);
const stale = [...documented].filter((key) => !used.has(key) && !builtIns.has(key)).sort();
const missing = [...used.keys()].filter((key) => !documented.has(key)).sort();

console.log(`Environment contract: ${used.size} source keys, ${documented.size} documented keys.`);

if (missing.length > 0) {
  console.error("\nUndocumented production environment keys:");
  for (const key of missing) {
    console.error(`- ${key}: ${[...new Set(used.get(key) ?? [])].join(", ")}`);
  }
  process.exitCode = 1;
} else {
  console.log("All recognized production environment keys are represented in .env.example.");
}

if (stale.length > 0) {
  console.error("\nStale documented environment keys (remove or reconcile source reads):");
  for (const key of stale) console.error(`- ${key}`);
  process.exitCode = 1;
}
