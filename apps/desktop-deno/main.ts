/**
 * Trilium Notes — Deno Desktop prototype.
 *
 * Two modes, selected at startup:
 *
 * - **native** (default): trilium-core runs inside the Deno process with
 *   native SQLite (node:sqlite) and Deno providers; the webview hosts only
 *   the client. See shell_native.ts.
 * - **wasm** (TRILIUM_WASM=1): the untouched standalone stack (SQLite WASM +
 *   service worker) runs inside the webview; the Deno side only serves the
 *   bundle and provides persistence bridges. See shell_wasm.ts.
 *
 * Run with: deno task start (see README.md for prerequisites)
 */

if (Deno.env.get("TRILIUM_WASM") === "1") {
    console.log("[main] starting WASM shell");
    await import("./shell_wasm.ts");
} else {
    console.log("[main] starting native shell");
    await import("./shell_native.ts");
}
