/**
 * The desktop app's entry point, which the packaged `package.json` names as `main`.
 *
 * It turns on Node's compile cache before `main.ts` and its static imports are compiled, which only
 * a module loaded ahead of them can do: compiling them is the larger part of what the main process
 * spends before Electron's `ready`. It imports nothing else of Trilium's, so the main bundle loads
 * exactly as it would without it.
 */
import { app } from "electron";
import { enableCompileCache, flushCompileCache } from "node:module";
import path from "node:path";

enableCompileCache(getCompileCacheDir());

// Node writes the cache when the process exits, which a process that is killed never does. Once
// the first page has loaded, the main process has compiled what a start needs.
app.once("web-contents-created", (_event, webContents) => {
    webContents.once("did-finish-load", () => flushCompileCache());
});

await import("./main.js");

/**
 * The cache is keyed by each file's content and the Node version, so every instance can share one.
 * `main.ts` names the Electron data directory after the port, which is not known before the config
 * is read, so the cache sits next to it; a portable install keeps it inside its own.
 */
function getCompileCacheDir() {
    if (process.env.TRILIUM_ELECTRON_DATA_DIR) {
        return path.join(path.resolve(process.env.TRILIUM_ELECTRON_DATA_DIR), "compile-cache");
    }

    return path.join(app.getPath("appData"), "trilium-compile-cache");
}
