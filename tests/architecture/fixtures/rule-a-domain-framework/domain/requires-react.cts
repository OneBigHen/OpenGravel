// eslint-disable-next-line @typescript-eslint/no-require-imports -- fixture: the guard must catch CommonJS requires.
const framework = require("react");

// Fixture: Rule A — a CommonJS `require("react")` is the same boundary breach
// as a static import.
export = framework;
