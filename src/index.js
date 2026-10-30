// Public entry point for percent-encoding-lib.
//
// The library is deliberately tiny: two functions that convert between a
// JavaScript string and a URL-safe ASCII representation using byte-level
// percent escapes. Keeping the two functions in `core.js` and re-exporting
// them here means consumers get a stable import path while the internals
// stay easy to test in isolation.

export { encode, decode } from './core.js';
