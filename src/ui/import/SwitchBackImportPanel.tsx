"use client";

import { useRef, useState } from "react";
import type { ImportServicePort, SwitchBackImportBatchReport } from "@/application/import/import-service";

export interface SwitchBackImportPanelProps {
  readonly service: ImportServicePort;
  readonly onImported?: () => Promise<void> | void;
}

function resultLabel(status: SwitchBackImportBatchReport["files"][number]["status"]): string {
  if (status === "imported") return "imported";
  if (status === "already-imported") return "already imported";
  return "skipped";
}

export function SwitchBackImportPanel({ service, onImported }: SwitchBackImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SwitchBackImportBatchReport | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  function reset(): void {
    setFiles([]);
    setBusy(false);
    setRefreshWarning(null);
    setReport(null);
    if (inputRef.current !== null) inputRef.current.value = "";
  }

  async function importSelected(): Promise<void> {
    if (files.length === 0 || busy) return;
    const selectedFiles = files;
    setBusy(true);
    setRefreshWarning(null);
    try {
      const result = await service.importSwitchBackBatch(selectedFiles);
      setReport(result);
      setFiles([]);
      if (result.importedCount > 0) {
        try {
          await onImported?.();
        } catch {
          setRefreshWarning("The rides were imported, but the library view could not refresh yet.");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="og-import og-switchback-import" aria-labelledby="switchback-import-title">
      <div className="og-import__header">
        <div>
          <p className="og-eyebrow">OpenGravel / Bring saved rides</p>
          <h2 id="switchback-import-title">Import older saved rides</h2>
          {report === null ? (
            <p>
              For saved rides from older OpenGravel (SwitchBack) versions, export GPX Track or Track + Waypoints, then select them together here. For other GPX files, use the uploader above.
              Route and cue exports do not include the dense saved route line. The source rides stay unchanged.
            </p>
          ) : null}
        </div>
        {report !== null ? <button type="button" className="og-secondary" onClick={reset}>Import another batch</button> : null}
      </div>

      {report === null ? (
        <>
          <label className="og-import__dropzone" htmlFor="switchback-gpx-files">
            <span>Choose older saved-ride GPX tracks</span>
            <small>Track and Track + Waypoints exports · select multiple files · maximum 10 MB each</small>
            <input
              ref={inputRef}
              id="switchback-gpx-files"
              type="file"
              accept=".gpx,application/gpx+xml"
              multiple
              aria-label="SwitchBack GPX files"
              disabled={busy}
              onChange={(event) => {
                setFiles(Array.from(event.currentTarget.files ?? []));
                setReport(null);
              }}
            />
          </label>
          {files.length > 0 ? (
            <div className="og-switchback-import__selected" aria-label="Selected SwitchBack files">
              <strong>{files.length} {files.length === 1 ? "file" : "files"} selected</strong>
              <ul>{files.map((file, index) => <li key={`${index}-${file.name}`}>{file.name}</li>)}</ul>
            </div>
          ) : null}
          {busy ? <p role="status" className="og-import__progress">Importing each GPX and saving its source data…</p> : null}
          <div className="og-import__choice-actions">
            <button type="button" className="og-primary" disabled={files.length === 0 || busy} onClick={() => void importSelected()}>
              {busy ? "Importing…" : "Import selected rides"}
            </button>
          </div>
        </>
      ) : (
        <section
          className="og-import__success"
          role="status"
          data-testid="switchback-import-report"
          data-result={report.files.some((result) => result.status === "skipped") ? "partial" : "complete"}
        >
          <div className="og-switchback-import__result-copy">
            <strong>Imported {report.importedCount} of {report.totalCount} rides</strong>
            <p>Each source file was handled independently. The original files and full GPX tracks stay with imported rides.</p>
          </div>
          <h3 className="og-switchback-import__report-title">Batch report</h3>
          <ul className="og-switchback-import__report-items">
            {report.files.map((result, index) => (
              <li key={`${result.filename}-${index}`} data-file-result={result.status}>
                <div className="og-switchback-import__file-line">
                  <strong>{result.title}</strong>
                  <span aria-hidden="true">→</span>
                  <span>{resultLabel(result.status)}</span>
                </div>
                {result.reason === null ? null : <p>{result.reason}</p>}
                {result.warnings.length === 0 ? null : (
                  <ul aria-label={`Notes for ${result.title}`}>
                    {result.warnings.map((warning, warningIndex) => <li key={`${warningIndex}-${warning}`}>{warning}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {refreshWarning === null ? null : <p className="og-import__warning" role="status">{refreshWarning}</p>}
        </section>
      )}
    </section>
  );
}
