"use client";

import { formatDistance as formatMiles } from "@/application/planner/measurements";
import { useEffect, useMemo, useRef, useState } from "react";

import { MAX_FILE_BYTES } from "@/application/import/limits";
import {
  ImportFlowError,
  type ImportBreadcrumbOutcome,
  type ImportFileOptions,
  type ImportOutcome,
  type ImportServicePort,
} from "@/application/import/import-service";
import { importBreadcrumbCandidates, type ImportBreadcrumbCandidate } from "@/application/import/import-breadcrumb";
import type { ImportFile } from "@/application/import/import-artifact";
import type { Coordinate } from "@/domain/ride/types";
import type { ImportProgress, ParsedImport, ParsedImportTrack } from "@/application/import/types";
import { emitTelemetry } from "@/ui/telemetry/emit-telemetry";

export interface ImportPanelProps {
  readonly service: ImportServicePort;
  readonly onImported?: (outcome: ImportOutcome | ImportBreadcrumbOutcome) => Promise<void> | void;
  readonly onOpenInPlanner?: (outcome: ImportOutcome | ImportBreadcrumbOutcome) => Promise<void> | void;
  readonly gapToleranceMeters?: number;
  /**
   * `quiet` drops the card's own heading and drop zone: the page that hosts it
   * already offers the words and the button, so only the flow is left here.
   */
  readonly chrome?: "full" | "quiet";
  /**
   * A file the page picked or dropped itself. It starts the flow once; the page
   * clears it again through `onInitialFileHandled`.
   */
  readonly initialFile?: File | null;
  readonly onInitialFileHandled?: () => void;
}

type ImportPanelPhase =
  | "idle"
  | "parsing"
  | "chooser"
  | "options"
  | "importing"
  | "success"
  /** A file with no track: only its waypoints or route can be opened. */
  | "breadcrumb"
  | "breadcrumb-saving"
  | "breadcrumb-saved";
type ImportChoice = "separate" | "combine";

const ERROR_LABELS: Readonly<Record<ImportFlowError["code"], string>> = {
  "invalid-file": "Unsupported route file",
  "too-large": "File is too large",
  "archive-guard": "Archive safety limit reached",
  "malformed-xml": "Malformed route XML",
  "no-usable-geometry": "No usable geometry",
  "selection-required": "Track selection required",
  "unsupported-source-shape": "Unsupported SwitchBack export",
  "option-unavailable": "Import option unavailable",
  "read-failed": "File could not be read",
  "persist-failed": "Import could not be saved",
};

function asImportFile(file: File): ImportFile {
  return file;
}

function distanceMeters(first: Coordinate, second: Coordinate): number {
  const radians = (value: number) => value * Math.PI / 180;
  const firstLat = radians(first.lat);
  const secondLat = radians(second.lat);
  const dLat = secondLat - firstLat;
  const dLon = radians(second.lon - first.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
}

function trackPoints(track: ParsedImportTrack): readonly Coordinate[] {
  return track.segments.flatMap((segment) => segment);
}

function trackDistance(track: ParsedImportTrack): number {
  return track.segments.reduce((total, segment) => {
    let distance = total;
    for (let index = 1; index < segment.length; index += 1) distance += distanceMeters(segment[index - 1]!, segment[index]!);
    return distance;
  }, 0);
}

function trackDurationSeconds(track: ParsedImportTrack): number | null {
  const values = track.timestamps.flatMap((segment) => segment).filter((value): value is string => value !== null);
  if (values.length < 2) return null;
  const first = Date.parse(values[0]!);
  const last = Date.parse(values.at(-1)!);
  return Number.isFinite(first) && Number.isFinite(last) && last >= first ? (last - first) / 1000 : null;
}

function formatDistance(value: number): string {
  return formatMiles(value);
}

function formatDuration(value: number | null): string {
  if (value === null) return "Time unknown";
  return `${Math.round(value / 60)} min estimated from timestamps`;
}

function errorDetails(error: unknown): { readonly code: ImportFlowError["code"]; readonly reason: string } {
  if (error instanceof ImportFlowError) return { code: error.code, reason: error.reason };
  if (error instanceof Error && /cancel/i.test(error.message)) return { code: "read-failed", reason: "Import cancelled. No ride or artifact was saved." };
  return { code: "persist-failed", reason: "The route file could not be imported. No partial ride was saved." };
}

function progressText(progress: ImportProgress | null): string {
  if (progress === null) return "Preparing import…";
  if (progress.phase === "complete") return `Parsed ${progress.points.toLocaleString()} points across ${progress.tracks} track${progress.tracks === 1 ? "" : "s"}.`;
  return `Parsing ${progress.points.toLocaleString()} points…`;
}

function previewPoints(track: ParsedImportTrack, allTracks: readonly ParsedImportTrack[]): string {
  const all = allTracks.flatMap(trackPoints);
  const minLon = Math.min(...all.map((point) => point.lon));
  const maxLon = Math.max(...all.map((point) => point.lon));
  const minLat = Math.min(...all.map((point) => point.lat));
  const maxLat = Math.max(...all.map((point) => point.lat));
  const lonRange = Math.max(maxLon - minLon, 0.000001);
  const latRange = Math.max(maxLat - minLat, 0.000001);
  return trackPoints(track).map((point) => `${8 + ((point.lon - minLon) / lonRange) * 144},${40 - ((point.lat - minLat) / latRange) * 32}`).join(" ");
}

function TrackPreview({ track, tracks, selected, onToggle }: {
  readonly track: ParsedImportTrack;
  readonly tracks: readonly ParsedImportTrack[];
  readonly selected: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="og-import__track" data-selected={selected}>
      <label className="og-import__track-select">
        <input type="checkbox" aria-label={`Select ${track.name}`} checked={selected} onChange={onToggle} />
        <span>
          <strong>{track.name}</strong>
          <small>{trackPoints(track).length.toLocaleString()} points · {formatDistance(trackDistance(track))} · {formatDuration(trackDurationSeconds(track))}</small>
        </span>
      </label>
      <svg className="og-import__preview" viewBox="0 0 160 48" role="img" aria-label={`${track.name} track preview`}>
        {track.segments.map((segment, index) => (
          <polyline key={`${track.name}-${index}`} points={previewPoints({ ...track, segments: [segment] }, tracks)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </li>
  );
}

/** The source's own name, else what the points are, never an invented place. */
function breadcrumbSourceLabel(candidate: ImportBreadcrumbCandidate): string {
  const name = candidate.name.trim();
  if (name !== "") return name;
  return candidate.source === "waypoints" ? "GPX waypoints" : "Imported points";
}

function breadcrumbCounts(candidate: ImportBreadcrumbCandidate): string {
  const waypoints = `${candidate.waypointCount} waypoint${candidate.waypointCount === 1 ? "" : "s"}`;
  return candidate.thinned
    ? `${waypoints} · thinned from ${candidate.sourcePointCount.toLocaleString()} points`
    : waypoints;
}

function BreadcrumbCandidateRow({ candidate, selected, onSelect }: {
  readonly candidate: ImportBreadcrumbCandidate;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const label = breadcrumbSourceLabel(candidate);
  return (
    <li className="og-import__track" data-selected={selected}>
      <label className="og-import__track-select">
        <input
          type="radio"
          name="og-import-breadcrumb"
          aria-label={`Open ${label} as a breadcrumb`}
          checked={selected}
          onChange={onSelect}
        />
        <span>
          <strong>{label}</strong>
          <small>{breadcrumbCounts(candidate)}</small>
        </span>
      </label>
    </li>
  );
}

export function ImportPanel({
  service,
  onImported,
  onOpenInPlanner,
  gapToleranceMeters = 25,
  chrome = "full",
  initialFile,
  onInitialFileHandled,
}: ImportPanelProps) {
  const quiet = chrome === "quiet";
  const [phase, setPhase] = useState<ImportPanelPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [choice, setChoice] = useState<ImportChoice | null>(null);
  const [routeOption, setRouteOption] = useState<"follow" | "route-along">("follow");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<{ readonly code: ImportFlowError["code"]; readonly reason: string } | null>(null);
  const [warning, setWarning] = useState<{ readonly code: "refresh-failed"; readonly reason: string } | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [breadcrumbOutcome, setBreadcrumbOutcome] = useState<ImportBreadcrumbOutcome | null>(null);
  const [breadcrumbCandidateId, setBreadcrumbCandidateId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const operationRef = useRef(0);
  const handledInitialFile = useRef<File | null>(null);

  const selectedTracks = useMemo(
    () => parsed === null ? [] : parsed.tracks.filter((_, index) => selected.has(index)),
    [parsed, selected],
  );
  const selectionDecision = useMemo(
    () => parsed === null
      ? { canCombine: false, reason: null }
      : service.evaluateTrackSelection(parsed, [...selected].sort((a, b) => a - b), gapToleranceMeters),
    [parsed, selected, service, gapToleranceMeters],
  );
  const canCombine = selectionDecision.canCombine;
  const breadcrumbCandidates = useMemo(
    () => parsed === null ? [] : importBreadcrumbCandidates(parsed),
    [parsed],
  );
  /** The single selected track, when the rider may open that one as a breadcrumb. */
  const selectedTrackBreadcrumb = useMemo(() => {
    if (parsed === null || selectedTracks.length !== 1) return null;
    const trackIndex = parsed.tracks.indexOf(selectedTracks[0]!);
    return breadcrumbCandidates.find((candidate) => candidate.trackIndex === trackIndex) ?? null;
  }, [parsed, selectedTracks, breadcrumbCandidates]);
  /**
   * The ways this file's points can become a breadcrumb here: its own `<wpt>`
   * list (names kept) and, when exactly one track is selected, that track.
   */
  const breadcrumbChoices = useMemo(() => {
    if (parsed === null) return [];
    return [
      ...breadcrumbCandidates.filter((candidate) => candidate.source === "waypoints"),
      ...(selectedTrackBreadcrumb === null ? [] : [selectedTrackBreadcrumb]),
    ];
  }, [parsed, breadcrumbCandidates, selectedTrackBreadcrumb]);
  const chosenBreadcrumb = breadcrumbChoices.find((candidate) => candidate.id === breadcrumbCandidateId)
    ?? breadcrumbChoices[0]
    ?? null;

  function reset(): void {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase("idle");
    setFile(null);
    setParsed(null);
    setSelected(new Set());
    setChoice(null);
    setRouteOption("follow");
    setProgress(null);
    setError(null);
    setWarning(null);
    setOutcome(null);
    setBreadcrumbOutcome(null);
    setBreadcrumbCandidateId(null);
  }

  async function previewFile(nextFile: File): Promise<void> {
    reset();
    if (nextFile.size > MAX_FILE_BYTES) {
      setError({ code: "too-large", reason: `This file is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB import limit.` });
      setPhase("idle");
      return;
    }
    operationRef.current += 1;
    const operation = operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setFile(nextFile);
    setParsed(null);
    setSelected(new Set());
    setChoice(null);
    setRouteOption("follow");
    setError(null);
    setWarning(null);
    setProgress(null);
    setOutcome(null);
    setBreadcrumbOutcome(null);
    setBreadcrumbCandidateId(null);
    setPhase("parsing");
    try {
      const preview = await service.previewFile(asImportFile(nextFile), {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (operation !== operationRef.current) return;
      setParsed(preview.parsed);
      setSelected(new Set(preview.parsed.tracks.map((_, index) => index)));
      // The first breadcrumb candidate is the default choice, so no id needs to
      // be stored here; the panel derives it from the parsed file.
      setPhase(preview.parsed.tracks.length === 0 ? "breadcrumb" : "chooser");
    } catch (caught: unknown) {
      if (operation !== operationRef.current) return;
      setError(errorDetails(caught));
      setPhase("idle");
    }
  }

  // A file chosen or dropped by the hosting page starts the same preview a
  // choice in the drop zone would. Keyed on the file, never on a render.
  useEffect(() => {
    if (initialFile === null || initialFile === undefined) return;
    if (handledInitialFile.current === initialFile) return;
    handledInitialFile.current = initialFile;
    void previewFile(initialFile);
    onInitialFileHandled?.();
    // previewFile is redefined on every render; this runs for a new file only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile, onInitialFileHandled]);

  function setSelection(index: number, value: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (value) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function choose(nextChoice: ImportChoice): void {
    setChoice(nextChoice);
    setPhase("options");
  }

  async function importSelected(): Promise<void> {
    if (file === null || selectedTracks.length === 0) return;
    operationRef.current += 1;
    const operation = operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setProgress(null);
    setError(null);
    setWarning(null);
    setPhase("importing");
    const options: ImportFileOptions = {
      trackRoute: routeOption,
      trackIndices: [...selected].sort((a, b) => a - b),
      ...(choice === "combine" ? { combine: true } : {}),
      ...(choice === "separate" ? { importSeparately: true } : {}),
      gapToleranceMeters,
      signal: controller.signal,
      onProgress: setProgress,
    };
    try {
      const nextOutcome = await service.importFile(asImportFile(file), options);
      if (operation !== operationRef.current) return;
      setOutcome(nextOutcome);
      setPhase("success");
      try {
        emitTelemetry("import_completed", { source: "import" });
        await onImported?.(nextOutcome);
      } catch {
        // The import itself is already durable; a library refresh failure must
        // not rewrite a successful import into an error or invite a duplicate.
        setWarning({ code: "refresh-failed", reason: "The ride was imported, but the library view could not refresh yet." });
      }
    } catch (caught: unknown) {
      if (operation !== operationRef.current) return;
      setError(errorDetails(caught));
      setPhase("options");
    }
  }

  /**
   * Opens one source in the file as an authored breadcrumb route. It is a real
   * saved ride, not a preview: the points stay editable, snappable and
   * followable, and the legs are straight until the rider says otherwise.
   */
  async function openAsBreadcrumb(candidateId: string): Promise<void> {
    if (file === null) return;
    operationRef.current += 1;
    const operation = operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBreadcrumbCandidateId(candidateId);
    setError(null);
    setWarning(null);
    setProgress(null);
    setPhase("breadcrumb-saving");
    try {
      const nextOutcome = await service.importFileAsBreadcrumb(asImportFile(file), {
        candidateId,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (operation !== operationRef.current) return;
      setBreadcrumbOutcome(nextOutcome);
      setPhase("breadcrumb-saved");
      try {
        emitTelemetry("import_completed", { source: "import" });
        await onImported?.(nextOutcome);
      } catch {
        setWarning({ code: "refresh-failed", reason: "The breadcrumb was saved, but the library view could not refresh yet." });
      }
    } catch (caught: unknown) {
      if (operation !== operationRef.current) return;
      setError(errorDetails(caught));
      setPhase(parsed !== null && parsed.tracks.length > 0 ? "chooser" : "breadcrumb");
    }
  }

  return (
    <section
      className={quiet ? "og-import og-import--quiet" : "og-import"}
      aria-labelledby={quiet ? undefined : "og-import-title"}
    >
      {quiet ? (
        // During a parse or a save the flow already offers the way out below.
        phase === "idle" || phase === "parsing" || phase === "importing" || phase === "breadcrumb-saving" ? null : (
          <div className="og-import__quiet-head">
            <button type="button" className="og-secondary" onClick={reset}>Start over</button>
          </div>
        )
      ) : (
        <div className="og-import__header">
          <div>
            <p className="og-eyebrow">OpenGravel / Bring a ride</p>
            <h2 id="og-import-title">Upload your GPX ride</h2>
            <p>Choose a GPX from any route planner or GPS device. KML and KMZ work too. Rides are saved privately in this browser; sharing with the group is a separate choice.</p>
          </div>
          {phase !== "idle" ? <button type="button" className="og-secondary" onClick={reset}>Start over</button> : null}
        </div>
      )}

      {quiet ? null : (
        <label
          className="og-import__dropzone"
          htmlFor="og-import-file"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files[0];
            if (dropped !== undefined) void previewFile(dropped);
          }}
        >
          <input
            ref={fileInputRef}
            id="og-import-file"
            className="sr-only"
            type="file"
            aria-label="Import GPX, KML, or KMZ"
            accept=".gpx,.kml,.kmz"
            onChange={(event) => {
              const nextFile = event.target.files?.[0];
              if (nextFile !== undefined) void previewFile(nextFile);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              // A native file input already opens the picker on Enter/Space;
              // prevent that so the dialog never opens twice.
              event.preventDefault();
              fileInputRef.current?.click();
            }}
          />
          <span>Choose a GPX, KML, or KMZ file</span>
          <small>or drop it here · max {MAX_FILE_BYTES / (1024 * 1024)} MB</small>
          {file === null ? null : (
            <small className="og-import__file-name" data-testid="import-file-name">
              Selected file: <strong>{file.name}</strong>
            </small>
          )}
        </label>
      )}

      {error !== null ? (
        <section className="og-import__error" role="alert" data-error-code={error.code}>
          <strong>{ERROR_LABELS[error.code]}</strong>
          <p>{error.reason}</p>
        </section>
      ) : null}

      {warning !== null ? (
        <section className="og-import__warning" role="status" data-warning-code={warning.code}>
          <strong>Import saved; library refresh pending</strong>
          <p>{warning.reason}</p>
        </section>
      ) : null}

      {phase === "parsing" || phase === "importing" || phase === "breadcrumb-saving" ? (
        <section className="og-import__progress" aria-live="polite">
          <p role="status">
            {phase === "parsing"
              ? "Reading and parsing in a worker…"
              : phase === "importing"
              ? "Saving your imported ride…"
              : "Saving your breadcrumb route…"}
          </p>
          <progress max={1} value={progress?.phase === "complete" ? 1 : undefined} />
          <small>{progressText(progress)}</small>
          <button type="button" className="og-secondary" onClick={reset}>Cancel import</button>
        </section>
      ) : null}

      {parsed !== null && phase === "breadcrumb" ? (
        <section className="og-import__chooser" aria-labelledby="og-import-breadcrumb-title">
          <div className="og-import__chooser-head">
            <div>
              <h3 id="og-import-breadcrumb-title">No track in this file</h3>
              <p>
                These are waypoints or a route, not a recorded line. Open them as a breadcrumb:
                one waypoint per point, straight legs between them. Nothing here says the legs
                follow a road or a trail.
              </p>
            </div>
            <div className="og-import__selection-actions">
              <button type="button" className="og-secondary" onClick={reset}>Choose another file</button>
            </div>
          </div>
          <ul className="og-import__tracks" aria-label="Points that can become a breadcrumb">
            {breadcrumbChoices.map((candidate) => (
              <BreadcrumbCandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={chosenBreadcrumb?.id === candidate.id}
                onSelect={() => setBreadcrumbCandidateId(candidate.id)}
              />
            ))}
          </ul>
          <div className="og-import__choice-actions">
            <button
              type="button"
              className="og-primary"
              disabled={chosenBreadcrumb === null}
              onClick={() => { if (chosenBreadcrumb !== null) void openAsBreadcrumb(chosenBreadcrumb.id); }}
            >
              Open as breadcrumb
            </button>
            {chosenBreadcrumb === null ? null : (
              <small>
                {chosenBreadcrumb.waypointCount} waypoints saved to My rides; you can drag, rename or snap them there.
              </small>
            )}
          </div>
        </section>
      ) : null}

      {parsed !== null && (phase === "chooser" || phase === "options") ? (
        <section className="og-import__chooser" aria-labelledby="og-import-tracks-title">
          <div className="og-import__chooser-head">
            <div>
              <h3 id="og-import-tracks-title">Choose tracks</h3>
              <p>Source segments and gaps stay separate. OpenGravel never draws a straight connector and calls it a road.</p>
            </div>
            <div className="og-import__selection-actions">
              <button type="button" className="og-secondary" onClick={() => setSelected(new Set(parsed.tracks.map((_, index) => index)))}>Select all</button>
              <button type="button" className="og-secondary" onClick={() => setSelected(new Set())}>Select none</button>
            </div>
          </div>
          <ul className="og-import__tracks" aria-label="Imported tracks">
            {parsed.tracks.map((track, index) => (
              <TrackPreview key={`${track.name}-${index}`} track={track} tracks={parsed.tracks} selected={selected.has(index)} onToggle={() => setSelection(index, !selected.has(index))} />
            ))}
          </ul>
          {selectedTracks.length > 1 && !canCombine ? (
            <p className="og-import__warning">The selected tracks have a gap larger than {gapToleranceMeters} m. Import them separately; no connector will be created.</p>
          ) : null}
          {breadcrumbChoices.length === 0 ? null : (
            <div className="og-import__breadcrumb">
              <p>
                <strong>Or open points as a breadcrumb.</strong> Straight legs between waypoints,
                not roads: useful for a line you want to edit or follow offline.
              </p>
              <ul className="og-import__tracks" aria-label="Points that can become a breadcrumb">
                {breadcrumbChoices.map((candidate) => (
                  <BreadcrumbCandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    selected={chosenBreadcrumb?.id === candidate.id}
                    onSelect={() => setBreadcrumbCandidateId(candidate.id)}
                  />
                ))}
              </ul>
              <button
                type="button"
                className="og-secondary"
                disabled={chosenBreadcrumb === null}
                onClick={() => { if (chosenBreadcrumb !== null) void openAsBreadcrumb(chosenBreadcrumb.id); }}
              >
                Open as breadcrumb
              </button>
            </div>
          )}
          {phase === "chooser" ? (
            <div className="og-import__choice-actions">
              <button type="button" className="og-primary" disabled={selectedTracks.length === 0} onClick={() => choose("separate")}>Import separately</button>
              <button type="button" className="og-secondary" disabled={!canCombine} title={!canCombine ? "Only adjacent selected tracks within the gap tolerance can be one ride." : undefined} onClick={() => choose("combine")}>Import as one ride</button>
              {!canCombine && selectedTracks.length > 1 ? <small>{selectionDecision.reason}</small> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {phase === "options" ? (
        <section className="og-import__options" aria-labelledby="og-import-options-title">
          <h3 id="og-import-options-title">Save this ride to My rides</h3>
          <p className="og-import__semantic-note">Follow keeps the imported geometry as the source of truth. Routing along roads would be a new route and may deviate from the file.</p>
          <fieldset>
            <legend>Import meaning</legend>
            <label><input type="radio" name="import-route-option" value="follow" checked={routeOption === "follow"} onChange={() => setRouteOption("follow")} /> <strong>Follow original track</strong> <span>(default)</span></label>
            <label><input type="radio" name="import-route-option" value="route-along" checked={routeOption === "route-along"} onChange={() => setRouteOption("route-along")} /> <strong>Route along roads</strong> <span>Builds with imported anchors; the road route may deviate from the original.</span></label>
          </fieldset>
          <div className="og-import__choice-actions">
            <button type="button" className="og-primary" disabled={selectedTracks.length === 0} onClick={() => void importSelected()}>{choice === "combine" ? "Import as one ride" : "Import selected tracks"}</button>
            <button type="button" className="og-secondary" onClick={() => setPhase("chooser")}>Back to track choices</button>
          </div>
        </section>
      ) : null}

      {phase === "breadcrumb-saved" && breadcrumbOutcome !== null ? (
        <section className="og-import__success" role="status" data-testid="breadcrumb-import-result">
          <h3>Breadcrumb saved</h3>
          <p>
            {breadcrumbOutcome.candidate.waypointCount} waypoints added to My rides. Legs are straight
            lines between waypoints, not roads: check access and conditions before you follow it.
          </p>
          {breadcrumbOutcome.warnings.length > 0 ? (
            <div>
              <strong>Warnings kept with this breadcrumb</strong>
              <ul>{breadcrumbOutcome.warnings.map((note) => <li key={note}>{note}</li>)}</ul>
            </div>
          ) : <p>No import warnings.</p>}
          {onOpenInPlanner !== undefined ? (
            <button type="button" className="og-primary" onClick={() => void onOpenInPlanner(breadcrumbOutcome)}>
              Open in planner
            </button>
          ) : null}
        </section>
      ) : null}

      {phase === "success" && outcome !== null ? (
        <section className="og-import__success" role="status">
          <h3>Import complete</h3>
          <p>{outcome.namedRides.length} ride{outcome.namedRides.length === 1 ? "" : "s"} added to your library. Your original file stays available for download. To add a ride to the group listing, choose “Share with everyone” on its saved card.</p>
          {outcome.warnings.length > 0 ? (
            <div>
              <strong>Warnings kept with this import</strong>
              <ul>{outcome.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : <p>No import warnings.</p>}
          {onOpenInPlanner !== undefined ? <button type="button" className="og-primary" onClick={() => void onOpenInPlanner(outcome)}>Open in planner</button> : null}
        </section>
      ) : null}
    </section>
  );
}
