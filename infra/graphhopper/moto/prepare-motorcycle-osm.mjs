#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeMotorcycleObject } from "./lib/motorcycle-osm.mjs"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(process.argv[2] ?? join(projectRoot, "data/pennsylvania-latest.osm.pbf"))
const outputPath = resolve(process.argv[3] ?? join(projectRoot, "data/pennsylvania-motorcycle.osm.pbf"))

if (sourcePath === outputPath) {
  throw new Error("Source and derived motorcycle extract paths must differ")
}

mkdirSync(dirname(outputPath), { recursive: true })
const workingDirectory = mkdtempSync(join(dirname(outputPath), ".motorcycle-osm-"))
const matchesPath = join(workingDirectory, "motorcycle-tags.osm")
const changesPath = join(workingDirectory, "motorcycle-normalization.osc")
const pendingOutputPath = join(workingDirectory, "motorcycle.osm.pbf")

try {
  execFileSync(
    "osmium",
    [
      "tags-filter",
      "-R",
      "-f",
      "osm",
      "-o",
      matchesPath,
      sourcePath,
      "n/motorcycle",
      "n/motorcycle:conditional",
      "w/motorcycle",
      "w/motorcycle:conditional",
      "w/oneway:motorcycle"
    ],
    { stdio: "inherit" }
  )

  const matchesXml = readFileSync(matchesPath, "utf8")
  const objects = [...matchesXml.matchAll(/<(?:node|way)\b[\s\S]*?<\/(?:node|way)>/g)]
    .map(([objectXml]) => normalizeMotorcycleObject(objectXml))

  if (objects.length === 0) {
    throw new Error("No motorcycle-specific OSM objects were found in the source extract")
  }

  writeFileSync(
    changesPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="OpenGravel motorcycle normalizer">\n  <modify>\n${objects.join("\n")}\n  </modify>\n</osmChange>\n`
  )

  execFileSync(
    "osmium",
    [
      "apply-changes",
      "--generator",
      "OpenGravel motorcycle normalizer",
      "-o",
      pendingOutputPath,
      sourcePath,
      changesPath
    ],
    { stdio: "inherit" }
  )

  renameSync(pendingOutputPath, outputPath)
  console.log(`Prepared ${objects.length} motorcycle-specific OSM objects in ${outputPath}`)
} finally {
  rmSync(workingDirectory, { force: true, recursive: true })
}
