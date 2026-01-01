import BuildHelper from "../../../scripts/build-utils";

const build = new BuildHelper("apps/server");

async function main() {
    await build.buildBackend([ "src/main.ts", "src/docker_healthcheck.ts" ])

    // Copy assets
    build.copy("src/assets", "assets/");
    build.triggerBuildAndCopyTo("packages/share-theme", "share-theme/assets/");
    build.copy("/packages/share-theme/src/templates", "share-theme/templates/");

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3", "bindings", "file-uri-to-path" ]);
    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");

    // Integrate the client.
    build.triggerBuildAndCopyTo("apps/client", "public/");
    build.deleteFromOutput("public/webpack-stats.json");

    // pdf.js
    build.triggerBuildAndCopyTo("packages/pdfjs-viewer", "pdfjs-viewer");
}

main();
