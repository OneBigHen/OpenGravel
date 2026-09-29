export function selectBestRoute(candidateIds: readonly string[]): string | null {
  return candidateIds[0] ?? null;
}
