// Fixture: Rule A — `~/` is not a configured alias in this repo, so a guarded
// layer treats it as unresolvable instead of silently ignoring it.
// @ts-expect-error -- fixture: `~/` never resolves; the scanner must still flag it.
import "~/ui/thing";
