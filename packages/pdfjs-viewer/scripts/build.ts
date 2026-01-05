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
    "es": "es-ES"
};

async function main() {
    // Copy the viewer files.
    for (const file of [ "viewer.css", "viewer.html", "viewer.mjs" ]) {
        build.copy(`viewer/${file}`, `web/${file}`);
    }
    patchCacheBuster(`${build.outDir}/web/viewer.html`);
    build.copy(`viewer/images`, `web/images`);

    // Copy the custom files.
    await buildScript("web/custom.mjs");
    build.copy("src/custom.css", "web/custom.css");

    // Copy locales.
    const localeMappings = {};
    for (const locale of LOCALES) {
        if (locale.id === "en" || locale.contentOnly || locale.devOnly) continue;
        const mappedLocale = LOCALE_MAPPINGS[locale.electronLocale] || locale.electronLocale.replace("_", "-");
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
    html = html.replace(
        `<link rel="stylesheet" href="custom.css" />`,
        `<link rel="stylesheet" href="custom.css?v=${version}" />`);
    html = html.replace(
        `<script src="custom.mjs" type="module"></script>`,
        `<script src="custom.mjs?v=${version}" type="module"></script>`
    );

    writeFileSync(htmlFilePath, html);
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
