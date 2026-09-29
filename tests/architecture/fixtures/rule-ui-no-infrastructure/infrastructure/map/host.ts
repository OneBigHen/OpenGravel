// Fixture: a stand-in for the concrete map host, so the relative escape from
// `../ui/escapes-to-infrastructure.ts` resolves to a real module inside this
// fixture's `infrastructure/` layer. The scanner compares resolved paths, and a
// path that resolves to nothing would prove nothing.
export function createMapLibreHost(): string {
  return "host";
}
