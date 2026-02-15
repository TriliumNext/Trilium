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

main();
