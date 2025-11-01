import { join } from "path";
import BuildContext from "./context";
import buildSwagger from "./swagger";
import { existsSync, mkdirSync, rmSync } from "fs";
import buildDocs from "./build-docs";

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
}

main();
