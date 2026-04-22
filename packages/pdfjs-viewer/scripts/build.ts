import { join } from "path";
import BuildHelper from "../../../scripts/build-utils";
import { build as esbuild } from "esbuild";
import { LOCALES } from "@triliumnext/commons";
import { watch } from "chokidar";
import { readFileSync, writeFileSync } from "fs";
import packageJson from "../package.json" with { type: "json " };

const build = new BuildHelper("packages/pdfjs-viewer");
const watchMode = process.argv.includes("--watch");

const LOCALE_MAPPINGS: Record<string, string> = {
    "es": "es-ES",
    "ga": "ga-IE",
    "hi": "hi-IN"
};

async function main() {
    // Copy the viewer files.
    for (const file of [ "viewer.css", "viewer.html", "viewer.mjs" ]) {
        build.copy(`viewer/${file}`, `web/${file}`);
    }
    patchCacheBuster(`${build.outDir}/web/viewer.html`);
    build.copy(`viewer/images`, `web/images`);
    build.copy(`viewer/wasm`, `web/wasm`);

    // Copy the custom files.
    await buildScript("web/custom.mjs");
    build.copy("src/custom.css", "web/custom.css");

    // Copy locales.
    const localeMappings = {};
    for (const locale of LOCALES) {
        if (locale.contentOnly || locale.devOnly) continue;
        const mappedLocale = LOCALE_MAPPINGS[locale.id] || locale.electronLocale.replace("_", "-");
        if (mappedLocale === "en") continue;
        const localePath = `${locale.id}/viewer.ftl`;
        build.copy(`viewer/locale/${mappedLocale}/viewer.ftl`, `web/locale/${localePath}`);
        localeMappings[locale.id] = localePath;
    }
    build.writeJson("web/locale/locale.json", localeMappings);

    // Copy pdfjs-dist files.
    for (const file of [ "pdf.mjs", "pdf.worker.mjs", "pdf.sandbox.mjs" ]) {
        build.copy(join("/node_modules/pdfjs-dist/build", file), join("build", file));
    }

    if (watchMode) {
        watchForChanges();
    }
}

async function buildScript(outPath: string) {
    await esbuild({
        entryPoints: [join(build.projectDir, "src/custom.ts")],
        tsconfig: join(build.projectDir, "tsconfig.app.json"),
        bundle: true,
        outfile: join(build.outDir, outPath),
        format: "esm",
        platform: "browser",
        minify: true,
    });
}

async function rebuildCustomFiles() {
    await buildScript("web/custom.mjs");
    build.copy("src/custom.css", "web/custom.css");
}

function patchCacheBuster(htmlFilePath: string) {
    const version = packageJson.version;
    console.log(`Versioned URLs: ${version}.`)
    let html = readFileSync(htmlFilePath, "utf-8");
    for (const file of [ "viewer.css", "custom.css" ]) {
        html = html.replace(
            `<link rel="stylesheet" href="${file}" />`,
            `<link rel="stylesheet" href="${file}?v=${version}" />`);
    }
    for (const file of [ "viewer.mjs", "custom.mjs", "../build/pdf.mjs" ]) {
        html = html.replace(
            `<script src="${file}" type="module"></script>`,
            `<script src="${file}?v=${version}" type="module"></script>`
        );
    }

    writeFileSync(htmlFilePath, html);

    // Also patch the worker source in viewer.mjs
    const viewerMjsPath = htmlFilePath.replace("viewer.html", "viewer.mjs");
    let viewerMjs = readFileSync(viewerMjsPath, "utf-8");
    viewerMjs = viewerMjs.replace(
        `value: "../build/pdf.worker.mjs"`,
        `value: "../build/pdf.worker.mjs?v=${version}"`
    );
    writeFileSync(viewerMjsPath, viewerMjs);
}

function watchForChanges() {
    console.log("Watching for changes in src directory...");
    const watcher = watch(join(build.projectDir, "src"), {
        persistent: true,
        ignoreInitial: true,
    });

    watcher.on("all", async (event, path) => {
        console.log(`File ${event}: ${path}`);
        console.log("Rebuilding...");
        try {
            await rebuildCustomFiles();
            console.log("Rebuild complete!");
        } catch (error) {
            console.error("Build failed:", error);
        }
    });
}

main();
