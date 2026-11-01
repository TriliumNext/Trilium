import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import BuildHelper, { targetArch } from "../../../scripts/build-utils";
import originalPackageJson from "../package.json" with { type: "json" };

const build = new BuildHelper("apps/desktop");

async function main() {
    // The preload runs in Electron's sandboxed renderer, where the
    // import.meta.url shim's `require("node:url")` banner throws and aborts the
    // preload before it can expose `electronApi`. Build it without the shim
    // (it never references import.meta.url). Build it first so the main bundle,
    // built after, leaves the final meta.json.
    await build.buildBackend([ "src/preload.ts" ], { importMetaUrlShim: false });
    // ESM so dynamic-import boundaries split into chunks/ that only load on
    // first use; the preload above must stay CJS (sandboxed renderer) and the
    // image worker below is spawned by its .cjs path.
    await build.buildBackend([ "src/main.ts" ], { format: "esm" });
    // The image compression worker, which lives in the server it embeds. Built here too so the
    // desktop app can compress off-thread rather than falling back to doing it in the main process.
    await build.buildBackend([ "../server/src/services/image_worker.ts" ]);
    // The meeting transcription process, which transcription/worker_client.ts starts by its .cjs
    // path as an Electron utility process.
    await build.buildBackend([ "src/services/transcription/transcription_worker.ts" ]);
    await build.buildTesseractWorker("../server/src/services/ocr/tesseract_worker.ts");

    // Copy assets.
    build.copy("src/assets", "assets/");
    build.copyServerAssets();

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3" ]);
    // No musl build: Electron itself ships glibc-only Linux binaries.
    build.trimBetterSqlite3({ includeMusl: false });
    copySherpaOnnx();

    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");
    build.copy("/packages/ckeditor5/src/theme/content_colors.css", "ckeditor5-content-colors.css");
    build.copy("/packages/ckeditor5/src/theme/multicolumn.css", "ckeditor5-multicolumn.css");

    build.buildFrontend();

    generatePackageJson();
}

/**
 * Copies `sherpa-onnx-node`, which the meeting transcription worker loads, together with the
 * package holding its native addon for the target platform. That package is only an optional
 * dependency, so pnpm installs it just for the host's platform; CI installs the others it
 * packages for with `--cpu`. A target with no such package ships neither.
 */
function copySherpaOnnx() {
    const sherpaDir = join(build.rootDir, "node_modules", "sherpa-onnx-node");
    const sherpaPackageJson = readFileSync(join(sherpaDir, "package.json"), "utf-8");
    const { optionalDependencies } = JSON.parse(sherpaPackageJson);
    const platform = process.platform === "win32" ? "win" : process.platform;
    const platformPackage = `sherpa-onnx-${platform}-${targetArch()}`;
    if (!(platformPackage in optionalDependencies)) {
        console.warn(`sherpa-onnx has no ${platformPackage}; transcription is unavailable there.`);
        return;
    }
    if (!existsSync(join(build.rootDir, "node_modules", platformPackage))) {
        throw new Error(`${platformPackage} is not installed. Install the target architecture's `
            + `optional dependencies too: pnpm install --cpu=${process.arch},${targetArch()}`);
    }
    build.copyNodeModules([ "sherpa-onnx-node", platformPackage ]);
}

function generatePackageJson() {
    const { version, author, license, description, dependencies, devDependencies } = originalPackageJson;
    const packageJson = {
        name: "trilium",
        main: "main.mjs",
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
