/**
 * Entry module behind the `officeparser` alias in vite.config.mts. It loads the
 * package's Node ESM entry instead of the prebuilt `browser` monolith — the monolith
 * inlines pdfjs-dist for PDF parsing (unused here), which alone is ~2.2 MB of the
 * ~2.7 MB bundle. The Buffer polyfill import must stay first: ES module evaluation
 * order guarantees it runs before any officeparser code.
 */
import "./buffer_polyfill.js";

export * from "../../../../node_modules/officeparser/dist/index.mjs";
