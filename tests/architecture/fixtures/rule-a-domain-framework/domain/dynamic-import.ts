// Fixture: Rule A — a guarded layer cannot verify the target of a non-literal
// dynamic import, so the scanner emits `<dynamic>` and the rule fails closed.
export async function loadFramework(): Promise<unknown> {
  return import(`re${"act"}`);
}
