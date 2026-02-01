import BuildHelper from "../../../scripts/build-utils";

const build = new BuildHelper("apps/build-docs");

async function main() {
    // Build the CLI and other TypeScript files
    await build.buildBackend([
        "src/cli.ts",
        "src/main.ts",
        "src/build-docs.ts",
        "src/swagger.ts",
        "src/script-api.ts",
        "src/context.ts"
    ]);

    // Copy HTML template
    build.copy("src/index.html", "index.html");

    // Copy node modules dependencies if needed
    build.copyNodeModules([ "better-sqlite3", "bindings", "file-uri-to-path" ]);
}

main();
