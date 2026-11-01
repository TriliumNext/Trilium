/**
 * Entry point of the Tesseract.js worker bundle, which `tesseract_recognizer.ts` spawns by path.
 *
 * The engine loaders it bundles read their `.wasm` from the directory the bundle is in, so
 * `BuildHelper.buildTesseractWorker()` copies the engine builds next to it.
 */
import "tesseract.js/src/worker-script/node/index.js";
