import BuildHelper from "../../../scripts/build-utils";

const build = new BuildHelper("apps/server");

async function main() {
    // ESM so dynamic-import boundaries split into chunks/ that only load on first use; the
    // image worker below is spawned by its .cjs path and stays CJS.
    await build.buildBackend([ "src/main.ts" ], { format: "esm" });
    // Its own call so it lands beside the bundle rather than under a `services/` path: the pool
    // looks for it next to whatever is running, and desktop builds it the same way.
    await build.buildBackend([ "src/services/image_worker.ts" ]);
    await build.buildTesseractWorker("src/services/ocr/tesseract_worker.ts");

    // Copy assets
    build.copyServerAssets();
    // The healthcheck docker runs; the Dockerfiles point at it inside the image.
    build.copy("docker_healthcheck.sh", "docker_healthcheck.sh");

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3" ]);
    build.trimBetterSqlite3();
    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");
    build.copy("/packages/ckeditor5/src/theme/content_colors.css", "ckeditor5-content-colors.css");
    build.copy("/packages/ckeditor5/src/theme/multicolumn.css", "ckeditor5-multicolumn.css");

    build.buildFrontend();
}

main();
