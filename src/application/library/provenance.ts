import type { RideRecord } from "@/application/persistence/ride-repository";

export type LibraryRideType =
  | "planned"
  | "imported"
  | "recorded"
  | "catalog-derivative"
  | "shared-derivative";

export function libraryTypeForRecord(record: RideRecord): LibraryRideType {
  if (record.derivedFrom?.kind === "catalog") return "catalog-derivative";
  if (record.derivedFrom?.kind === "shared") return "shared-derivative";
  switch (record.document.provenance.type) {
    case "import":
      return "imported";
    case "recorded":
    case "recreated-from-track":
      return "recorded";
    default:
      return "planned";
  }
}

export function libraryTypeLabel(type: LibraryRideType): string {
  switch (type) {
    case "planned":
      return "Planned";
    case "imported":
      return "Imported";
    case "recorded":
      return "Recorded";
    case "catalog-derivative":
      return "Catalog derivative";
    case "shared-derivative":
      return "Shared derivative";
  }
}
