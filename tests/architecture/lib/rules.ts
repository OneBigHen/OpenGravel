import path from "node:path";

import { DYNAMIC_SPECIFIER, type BoundaryRule } from "./scan";

/** Stable rule identifiers; tests, fixtures and CI logs key off these. */
export const RULE_IDS = {
  domainFrameworkFree: "rule-a-domain-framework-free",
  uiNoProviderImports: "rule-b-ui-no-provider-imports",
  mapNoStateMutation: "rule-c-map-no-state-mutation",
  advisorNoStateMutation: "rule-d-advisor-no-state-mutation",
  providerNoUiDecision: "rule-e-provider-no-ui-decision",
  layerDirection: "layer-direction-domain-never-imports-application",
  /**
   * The 4.0 map-host review's boundary (finding 8). Not lettered `F`: the letters
   * A–E are the architecture contract's own rules, and the contract's rule F
   * (async commit fencing) is still unenforceable and reserved in the note below.
   */
  uiNoInfrastructure: "rule-ui-no-infrastructure-imports",
} as const;

/*
 * Rules that are not statically enforceable yet, and why:
 *
 * - Rule F (async commit fencing): becomes enforceable when the planning
 *   controller lands (Wave 2.3); there is no async commit path to fence today.
 * - Rule G (no large geometry in history): enforced with the geometry waves,
 *   when raw payloads can reach a snapshot; VNX-004 and the `GeometryRef`-only
 *   history shapes are the interim guarantee.
 * - Rule I (optional-provider absence): covered by the CI environment, which
 *   runs without provider credentials — not by a static scan of these files.
 */

/**
 * Rule A denylist (OGV-ARC-004, contracts/architecture-rules.md).
 *
 * Matched against the raw specifier so `react/jsx-runtime`, `next/font`,
 * `zustand/vanilla` and `posthog-js` are all rejected while lookalikes such as
 * `reactivity-utils` and `date-fns` are not.
 */
export const DENIED_DOMAIN_IMPORT_PATTERNS: readonly RegExp[] = [
  /^react(?:-dom)?(?:\/|$)/,
  /^next(?:\/|$)/,
  /^zustand(?:\/|$)/,
  /^mapbox-gl(?:\/|$)/,
  /^maplibre-gl(?:\/|$)/,
  /^dexie(?:\/|$)/,
  /^posthog(?:-|\/|$)/,
];

/** Rule B (OGV-ARC-002): provider SDK/helper names that never belong in UI code. */
export const DENIED_UI_PROVIDER_SPECIFIER_PATTERN =
  /graphhopper|valhalla|tomtom/i;

/**
 * The map renderer package (4.0 review finding 8), matched against the whole
 * specifier so the stylesheet import counts: `maplibre-gl/dist/maplibre-gl.css`
 * is the renderer's own file, and importing it from `src/ui` puts the concrete
 * renderer back in the UI layer just as surely as importing the factory does.
 */
export const RENDERER_PACKAGE_PATTERN = /^maplibre-gl(?:\/|$)/;

/**
 * Rules C/D module denylist, expressed as patterns rather than literals:
 *
 * - `/(^|\/)stores?\//`        any `store/` or `stores/` module segment
 * - `/ride[-_.]?document[-_.]?store/i`  rideDocumentStore / ride-document-store
 * - `/planner[-_.]?controller/i`        plannerController / planner-controller
 * - `/route[-_.]?selection|select[-_.]?route/i`  route-selection helpers (Rule D)
 * - store-setter bindings anywhere in the import declaration, i.e. a
 *   `set|update|mutate|apply|reset` verb followed by `Ride` and one of
 *   `Document|Intent|Route|Selection`, plus `applyCommand`/`dispatchCommand`
 *   (see `STORE_SETTER_BINDING_PATTERN`)
 */
export const STORE_MODULE_PATTERN = /(^|\/)stores?\//i;
export const RIDE_STORE_MODULE_PATTERN = /ride[-_.]?document[-_.]?store/i;
export const PLANNER_CONTROLLER_PATTERN = /planner[-_.]?controller/i;
export const ROUTE_SELECTION_MODULE_PATTERN =
  /route[-_.]?selection|select[-_.]?route/i;
/**
 * Store-mutation binding names, matched against the WHOLE declaration (a
 * multiline `import {` block included).
 *
 * This is a heuristic, not a contract: it covers the vnext verb vocabulary
 * (`setRideIntent`, `updateRideDocument`, ...) plus the generic command
 * executors `applyCommand`/`dispatchCommand`. It deliberately does not chase
 * every neutral name (`commit`, `dispatchRideIntent`), because two renames can
 * always evade a name list — the enforceable boundary is the port ownership in
 * {@link ROUTE_SELECTION_MODULE_PATTERN} and the application/domain imports,
 * and this list only catches the sloppy cases.
 */
export const STORE_SETTER_BINDING_PATTERN =
  /\b(?:(?:set|update|mutate|apply|reset)Ride(?:Document|Intent|Route|Selection)\w*|applyCommand|dispatchCommand)\b/;

/** Layers a domain module may never reach (02-ARCHITECTURE-CONTRACT §7). */
export const DOMAIN_FORBIDDEN_LAYERS = [
  "ui",
  "infrastructure",
  "application",
  "app",
] as const;

/** Layers a provider adapter may never reach (Rule E). */
export const PROVIDER_FORBIDDEN_LAYERS = ["ui", "app"] as const;

/**
 * Application port path segments: the only `src/application/**` modules a
 * provider adapter may import. Named by segment so the boundary stays explicit
 * when ports move.
 */
export const APPLICATION_PORT_SEGMENTS: readonly string[] = [
  "/route-provider",
  "/ports/",
  "/geocoding-ports",
];

/**
 * Local-looking specifiers this repository does not configure. `@/` is the one
 * real alias; `~/` and `#` have no resolver, so a guarded layer reports them
 * instead of treating an unresolved `null` as "not a layer edge".
 */
const UNCONFIGURED_LOCAL_ALIAS_PREFIXES: readonly string[] = ["~/", "#"];

/**
 * Fail-closed dynamic import guard: a guarded layer may not call `import()` with
 * anything but a string literal, because the scanner cannot resolve the target
 * and the boundary would be unverifiable.
 */
function unverifiableDynamicImportReason(
  owner: string,
  specifier: string,
): string | null {
  return specifier === DYNAMIC_SPECIFIER
    ? `${owner} may not use a non-literal dynamic import (unverifiable-dynamic-import)`
    : null;
}

function unresolvableLocalSpecifierReason(specifier: string): string | null {
  return UNCONFIGURED_LOCAL_ALIAS_PREFIXES.some((prefix) =>
    specifier.startsWith(prefix),
  )
    ? `"${specifier}" is not a resolvable local specifier (unresolvable-local-specifier)`
    : null;
}

/** Specifier-level guards every guarded layer applies before its own checks. */
function guardedSpecifierReason(owner: string, specifier: string): string | null {
  return (
    unverifiableDynamicImportReason(owner, specifier) ??
    unresolvableLocalSpecifierReason(specifier)
  );
}

const HTTP_URL_LITERAL_PATTERN = /https?:\/\/[^\s]+/i;

/**
 * Rule B: an http(s) URL string literal whose host names a routing provider is
 * a direct provider dependency even when no module is imported. Only the host
 * is matched, so ordinary copy mentioning a provider by name is untouched —
 * comments are masked out before this runs.
 */
export function providerUrlLiteralReason(literal: string): string | null {
  const url = HTTP_URL_LITERAL_PATTERN.exec(literal)?.[0];
  if (url === undefined) return null;
  const host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return DENIED_UI_PROVIDER_SPECIFIER_PATTERN.test(host)
    ? `UI/app copy must not embed a routing-provider URL: "${literal}" (provider-url-literal)`
    : null;
}

function isApplicationPort(
  specifier: string,
  resolvedTarget: string | null,
): boolean {
  const candidates =
    resolvedTarget === null ? [specifier] : [specifier, resolvedTarget];
  return candidates.some((candidate) =>
    APPLICATION_PORT_SEGMENTS.some((segment) => candidate.includes(segment)),
  );
}

type DenylistEntry = {
  readonly pattern: RegExp;
  readonly label: string;
};

const STATE_MUTATION_DENYLIST: readonly DenylistEntry[] = [
  { pattern: STORE_MODULE_PATTERN, label: "a state store module" },
  { pattern: RIDE_STORE_MODULE_PATTERN, label: "the ride document store" },
  { pattern: PLANNER_CONTROLLER_PATTERN, label: "the planner controller" },
];

const ADVISOR_DENYLIST: readonly DenylistEntry[] = [
  ...STATE_MUTATION_DENYLIST,
  { pattern: ROUTE_SELECTION_MODULE_PATTERN, label: "a route-selection module" },
];

/** True when `candidate` is `dir` itself or lives under it. */
export function isInsideOrEqual(candidate: string, dir: string): boolean {
  const relative = path.relative(dir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function layerDir(sourceRoot: string, layerPath: string): string {
  return path.join(sourceRoot, ...layerPath.split("/"));
}

function aliasTargets(specifier: string, layerPath: string): boolean {
  if (!specifier.startsWith("@/")) return false;
  const target = specifier.slice(2);
  return target === layerPath || target.startsWith(`${layerPath}/`);
}

function targetsLayer(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
  layerPath: string,
): boolean {
  if (aliasTargets(specifier, layerPath)) return true;
  return (
    resolvedTarget !== null &&
    isInsideOrEqual(resolvedTarget, layerDir(sourceRoot, layerPath))
  );
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function firstDeniedReason(
  denylist: readonly DenylistEntry[],
  specifier: string,
): DenylistEntry | undefined {
  return denylist.find((entry) => entry.pattern.test(specifier));
}

/** Rule A (OGV-ARC-004): framework-free domain, no cross-layer edges. */
export function domainForbiddenReason(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
): string | null {
  const guarded = guardedSpecifierReason("domain", specifier);
  if (guarded !== null) return guarded;
  if (DENIED_DOMAIN_IMPORT_PATTERNS.some((pattern) => pattern.test(specifier))) {
    return `domain must stay framework-free: "${specifier}" is a framework/runtime package`;
  }
  const layer = DOMAIN_FORBIDDEN_LAYERS.find((candidate) =>
    targetsLayer(sourceRoot, specifier, resolvedTarget, candidate),
  );
  if (layer !== undefined) {
    return `domain must not import the ${layer} layer: "${specifier}"`;
  }
  const escapesDomain =
    isRelativeSpecifier(specifier) &&
    resolvedTarget !== null &&
    !isInsideOrEqual(resolvedTarget, layerDir(sourceRoot, "domain"));
  return escapesDomain ? `relative import escapes src/domain: "${specifier}"` : null;
}

/** Rule B (OGV-ARC-002): UI and app never reach routing providers or their URLs. */
export function uiForbiddenReason(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
): string | null {
  const guarded = guardedSpecifierReason("UI", specifier);
  if (guarded !== null) return guarded;
  if (DENIED_UI_PROVIDER_SPECIFIER_PATTERN.test(specifier)) {
    return `UI must not import a routing provider SDK or helper: "${specifier}"`;
  }
  return targetsLayer(
    sourceRoot,
    specifier,
    resolvedTarget,
    "infrastructure/routing",
  )
    ? `UI must not import src/infrastructure/routing: "${specifier}"`
    : null;
}

/** Rule C (OGV-ARC-003): map infrastructure never touches ride state. */
export function mapInfrastructureForbiddenReason(
  specifier: string,
  declaration: string,
): string | null {
  const guarded = guardedSpecifierReason("map infrastructure", specifier);
  if (guarded !== null) return guarded;
  const denied = firstDeniedReason(STATE_MUTATION_DENYLIST, specifier);
  if (denied !== undefined) {
    return `map infrastructure must not import ${denied.label}: "${specifier}"`;
  }
  return STORE_SETTER_BINDING_PATTERN.test(declaration)
    ? `map infrastructure must not import a ride-state setter: "${specifier}"`
    : null;
}

/** Rule D (OGV-ARC-008): advisors propose; they never mutate or select. */
export function advisorForbiddenReason(
  specifier: string,
  declaration: string,
): string | null {
  const guarded = guardedSpecifierReason("advisor infrastructure", specifier);
  if (guarded !== null) return guarded;
  const denied = firstDeniedReason(ADVISOR_DENYLIST, specifier);
  if (denied !== undefined) {
    return `advisor infrastructure must not import ${denied.label}: "${specifier}"`;
  }
  return STORE_SETTER_BINDING_PATTERN.test(declaration)
    ? `advisor infrastructure must not import a ride-state setter: "${specifier}"`
    : null;
}

/**
 * UI → infrastructure (4.0 review finding 8; 02-ARCHITECTURE-CONTRACT §7).
 *
 * `src/ui` renders a port, never a renderer. The concrete MapLibre host, its
 * stylesheet and the storage adapters are wired at the composition root
 * (`src/app/PlannerClient.tsx`), which is the sanctioned seam — so this rule needs
 * no allowlist: UI imports *zero* infrastructure modules, and the app layer is free
 * to import as many as the composition needs.
 *
 * The rule exists because the previous arrangement had a seam with no enforcement:
 * `PlannerMap` took a `MapHostFactory` prop *and* defaulted it to
 * `createMapLibreHost`, which made the port real for a test and decorative for the
 * scanner.
 */
export function uiInfrastructureForbiddenReason(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
): string | null {
  const guarded = guardedSpecifierReason("UI", specifier);
  if (guarded !== null) return guarded;
  if (RENDERER_PACKAGE_PATTERN.test(specifier)) {
    return `UI must not import the map renderer package: "${specifier}" (the renderer and its stylesheet belong to the composition root)`;
  }
  return targetsLayer(sourceRoot, specifier, resolvedTarget, "infrastructure")
    ? `UI must not import src/infrastructure: "${specifier}" (the composition root owns that seam)`
    : null;
}

/** Rule E (OGV-ARC-008): provider adapters never import the decision layers. */
export function routingForbiddenReason(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
): string | null {
  const layer = PROVIDER_FORBIDDEN_LAYERS.find((candidate) =>
    targetsLayer(sourceRoot, specifier, resolvedTarget, candidate),
  );
  if (layer !== undefined) {
    return `provider adapters must not import src/${layer}: "${specifier}"`;
  }
  const reachesApplication = targetsLayer(
    sourceRoot,
    specifier,
    resolvedTarget,
    "application",
  );
  return reachesApplication && !isApplicationPort(specifier, resolvedTarget)
    ? `provider adapters may import src/application only through a port module: "${specifier}" (provider-imports-decision-policy)`
    : null;
}

/** Layer direction (02-ARCHITECTURE-CONTRACT §7): domain never imports application. */
export function layerDirectionForbiddenReason(
  sourceRoot: string,
  specifier: string,
  resolvedTarget: string | null,
): string | null {
  return targetsLayer(sourceRoot, specifier, resolvedTarget, "application")
    ? `domain must not import application: "${specifier}"`
    : null;
}

/** Assembles the enforceable boundary rules for one source root. */
export function buildBoundaryRules(sourceRoot: string): BoundaryRule[] {
  return [
    {
      id: RULE_IDS.domainFrameworkFree,
      description:
        "OGV-ARC-004 — src/domain is framework-free and imports no other layer",
      appliesTo: (file) => isInsideOrEqual(file, layerDir(sourceRoot, "domain")),
      forbidden: (specifier, resolvedTarget) =>
        domainForbiddenReason(sourceRoot, specifier, resolvedTarget),
    },
    {
      id: RULE_IDS.uiNoProviderImports,
      description:
        "OGV-ARC-002 — src/ui and src/app import no routing adapter, no provider SDK and no provider URL",
      appliesTo: (file) =>
        isInsideOrEqual(file, layerDir(sourceRoot, "ui")) ||
        isInsideOrEqual(file, layerDir(sourceRoot, "app")),
      forbidden: (specifier, resolvedTarget) =>
        uiForbiddenReason(sourceRoot, specifier, resolvedTarget),
      forbiddenLiteral: providerUrlLiteralReason,
    },
    {
      id: RULE_IDS.mapNoStateMutation,
      description:
        "OGV-ARC-003 — src/infrastructure/map imports no store, controller or ride-state setter",
      appliesTo: (file) =>
        isInsideOrEqual(file, layerDir(sourceRoot, "infrastructure/map")),
      forbidden: (specifier, _resolvedTarget, declaration) =>
        mapInfrastructureForbiddenReason(specifier, declaration),
    },
    {
      id: RULE_IDS.advisorNoStateMutation,
      description:
        "OGV-ARC-008 — src/infrastructure/advisor imports no store setter and no route selection",
      appliesTo: (file) =>
        isInsideOrEqual(file, layerDir(sourceRoot, "infrastructure/advisor")),
      forbidden: (specifier, _resolvedTarget, declaration) =>
        advisorForbiddenReason(specifier, declaration),
    },
    {
      id: RULE_IDS.providerNoUiDecision,
      description:
        "OGV-ARC-008 — src/infrastructure/routing imports neither src/ui nor src/app",
      appliesTo: (file) =>
        isInsideOrEqual(file, layerDir(sourceRoot, "infrastructure/routing")),
      forbidden: (specifier, resolvedTarget) =>
        routingForbiddenReason(sourceRoot, specifier, resolvedTarget),
    },
    {
      id: RULE_IDS.uiNoInfrastructure,
      description:
        "4.0 review finding 8 — src/ui imports no src/infrastructure module and no renderer package; the composition root (src/app) owns that seam",
      appliesTo: (file) => isInsideOrEqual(file, layerDir(sourceRoot, "ui")),
      forbidden: (specifier, resolvedTarget) =>
        uiInfrastructureForbiddenReason(sourceRoot, specifier, resolvedTarget),
    },
    {
      id: RULE_IDS.layerDirection,
      description:
        "02-ARCHITECTURE-CONTRACT §7 — domain never resolves into application",
      appliesTo: (file) => isInsideOrEqual(file, layerDir(sourceRoot, "domain")),
      forbidden: (specifier, resolvedTarget) =>
        layerDirectionForbiddenReason(sourceRoot, specifier, resolvedTarget),
    },
  ];
}
