import { join } from "path";
import BuildContext from "./context";
import buildSwagger from "./swagger";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import buildDocs from "./build-docs";
import buildScriptApi from "./script-api";

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

    // Copy index file.
    cpSync(join(__dirname, "index.html"), join(context.baseDir, "index.html"));
}

main();
