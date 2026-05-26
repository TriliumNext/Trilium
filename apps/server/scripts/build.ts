import BuildHelper from "../../../scripts/build-utils";

const build = new BuildHelper("apps/server");

async function main() {
    await build.buildBackend([ "src/main.ts", "src/docker_healthcheck.ts" ])

    // Copy assets
    build.copy("src/assets", "assets/");
    // schema.sql lives in trilium-core but is loaded at server startup. The
    // bundled main.cjs can't `require.resolve("@triliumnext/core/...")` in
    // Docker (no workspace symlinks in the image), so we copy the file
    // alongside the server's own assets and read it via RESOURCE_DIR at
    // runtime. See main.ts.
    build.copy("/packages/trilium-core/src/assets/schema.sql", "assets/schema.sql");
    // The integration test database fixture is loaded into memory when
    // TRILIUM_INTEGRATION_TEST=memory is set (used by e2e tests against the
    // packaged server). Same require.resolve issue as schema.sql in
    // bundled environments — copy it into the bundle so it's reachable.
    build.copy("/packages/trilium-core/src/test/fixtures/document.db", "assets/test/document.db");
    build.triggerBuildAndCopyTo("packages/share-theme", "share-theme/assets/");
    build.copy("/packages/share-theme/src/templates", "share-theme/templates/");

    // Copy node modules dependencies
    build.copyNodeModules([ "better-sqlite3", "bindings", "file-uri-to-path" ]);
    build.copy("/node_modules/ckeditor5/dist/ckeditor5-content.css", "ckeditor5-content.css");

    build.buildFrontend();
}

main();
