const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const tagPattern = (key) =>
  new RegExp(`^[ \\t]*<tag\\s+k="${escapeRegExp(key)}"\\s+v="([^"]*)"\\s*\\/>\\r?\\n?`, "gm")

const readTag = (xml, key) => {
  const match = tagPattern(key).exec(xml)
  return match?.[1] ?? null
}

const removeTag = (xml, key) => xml.replace(tagPattern(key), "")

const addTag = (xml, key, value) => {
  const closingTag = xml.match(/^(\s*)<\/(node|way)>\s*$/m)
  if (!closingTag) {
    throw new Error("Expected a complete OSM node or way object")
  }

  const indentation = `${closingTag[1]}  `
  return xml.replace(
    /^(\s*)<\/(node|way)>\s*$/m,
    `${indentation}<tag k="${key}" v="${value}"/>\n$&`
  )
}

const incrementVersion = (xml) =>
  xml.replace(/(<(?:node|way)\b[^>]*\bversion=")(\d+)(")/, (_, prefix, version, suffix) =>
    `${prefix}${Number(version) + 1}${suffix}`
  )

/**
 * Projects OSM's motorcycle-specific access tags onto the keys consumed by
 * GraphHopper 11's car parser. Original motorcycle tags remain in the derived
 * extract for auditability.
 *
 * Conditional motorcycle access is deliberately blocked. GraphHopper's import
 * graph is static and cannot safely evaluate every time-of-day, seasonal, or
 * free-text condition at ride time.
 *
 * In addition to the motorcycle-specific access projection, this step
 * ingests the surface/smoothness/tracktype/maxweight/seasonal/access:conditional
 * tags so the build pipeline retains them on the way object even when no
 * motorcycle-specific tag is present. Those tags are preserved in place; only
 * `access:conditional` is mirrored to `motorcar:conditional` as `no` so the
 * static graph does not flag the way as always-open.
 */
export function normalizeMotorcycleObject(sourceXml) {
  const motorcycleAccess = readTag(sourceXml, "motorcycle")
  const conditionalAccess = readTag(sourceXml, "motorcycle:conditional")
  const motorcycleOneway = readTag(sourceXml, "oneway:motorcycle")
  const accessConditional = readTag(sourceXml, "access:conditional")
  const surface = readTag(sourceXml, "surface")
  const smoothness = readTag(sourceXml, "smoothness")
  const tracktype = readTag(sourceXml, "tracktype")
  const maxweight = readTag(sourceXml, "maxweight")
  const seasonal = readTag(sourceXml, "seasonal")

  const hasMotorcycleTag =
    motorcycleAccess !== null || conditionalAccess !== null || motorcycleOneway !== null
  const hasSurfaceTag =
    surface !== null ||
    smoothness !== null ||
    tracktype !== null ||
    maxweight !== null ||
    seasonal !== null ||
    accessConditional !== null

  if (!hasMotorcycleTag && !hasSurfaceTag) {
    throw new Error("OSM object has no supported motorcycle-specific tag")
  }

  let normalized = incrementVersion(sourceXml)

  if (motorcycleAccess !== null || conditionalAccess !== null) {
    normalized = removeTag(normalized, "motorcar")
    normalized = removeTag(normalized, "motorcar:conditional")
    normalized = addTag(
      normalized,
      "motorcar",
      conditionalAccess === null ? motorcycleAccess : "no"
    )
  }

  if (motorcycleOneway !== null) {
    normalized = removeTag(normalized, "oneway")
    normalized = addTag(normalized, "oneway", motorcycleOneway)
  }

  if (accessConditional !== null && motorcycleAccess === null && conditionalAccess === null) {
    normalized = removeTag(normalized, "motorcar:conditional")
    normalized = addTag(normalized, "motorcar:conditional", "no")
  }

  return normalized
}
