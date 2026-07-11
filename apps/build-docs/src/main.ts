import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

import buildDocs from "./build-docs";
import BuildContext from "./context";
import buildScriptApi from "./script-api";
import buildSwagger from "./swagger";

const context: BuildContext = {
    gitRootDir: join(__dirname, "../../../"),
    baseDir: join(__dirname, "../../../site")
};

async function main() {
    // Clean input dir.
    if (existsSync(context.baseDir)) {
        rmSync(context.baseDir, { recursive: true });
    }
    mkdirSync(context.baseDir);

    // Start building.
    await buildDocs(context);
    buildSwagger(context);
    buildScriptApi(context);

    // Copy index and 404 files.
    cpSync(join(__dirname, "index.html"), join(context.baseDir, "index.html"));
    cpSync(join(context.baseDir, "user-guide/404.html"), join(context.baseDir, "404.html"));
}

// Note: forcing process.exit() because importing notes via the core triggers
// fire-and-forget async work in `notes.ts#downloadImages` (a 5s setTimeout that
// re-schedules itself via `asyncPostProcessContent`), which keeps the libuv
// event loop alive forever even after main() completes.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error building documentation:", error);
        process.exit(1);
    });
