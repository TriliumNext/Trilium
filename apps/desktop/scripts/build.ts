import { writeFileSync } from "fs";
import { join } from "path";

import BuildHelper from "../../../scripts/build-utils";
import originalPackageJson from "../package.json" with { type: "json" };

const build = new BuildHelper("apps/desktop");

async function main() {
    await build.buildBackend([ "src/main.ts"]);

    // Copy assets.
    build.copy("src/assets", "assets/");
    build.copy("/apps/server/src/assets", "assets/");
    build.triggerBuildAndCopyTo("packages/share-theme", "share-theme/assets/");
    build.copy("/packages/share-theme/src/templates", "share-theme/templates/");

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3", "bindings", "file-uri-to-path", "@electron/remote" ]);
    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");

    build.buildFrontend();

    generatePackageJson();
}

function generatePackageJson() {
    const { version, author, license, description, dependencies, devDependencies } = originalPackageJson;
    const packageJson = {
        name: "trilium",
        main: "main.cjs",
        version, author, license, description,
        dependencies: {
            "better-sqlite3": dependencies["better-sqlite3"],
        },
        devDependencies: {
            electron: devDependencies.electron
        },
        config: {
            forge: "../electron-forge/forge.config.ts"
        }
    };
    writeFileSync(join(build.outDir, "package.json"), JSON.stringify(packageJson, null, "\t"), "utf-8");
}

main();
