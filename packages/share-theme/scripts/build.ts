import path from "node:path";

import * as esbuild from "esbuild";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as sass from "sass";

const packageJson = process.env.npm_package_json;
if (!packageJson) {
    throw new Error("Run the build through pnpm, which sets npm_package_json.");
}
const rootDir = path.dirname(packageJson);

// Sass resolves relative paths on its own; bare specifiers such as
// "katex/src/styles/katex.scss" go through Node.
const nodeModulesImporter: sass.FileImporter<"sync"> = {
    findFileUrl(url) {
        if (url.startsWith(".") || url.startsWith("/")) {
            return null;
        }

        return pathToFileURL(createRequire(path.join(rootDir, "package.json")).resolve(url));
    }
};

// esbuild has no Sass support of its own. katex.scss needs it to build KaTeX's
// stylesheet without the woff and ttf faces.
const sassPlugin: esbuild.Plugin = {
    name: "sass",
    setup(build) {
        build.onLoad({ filter: /\.scss$/ }, (args) => ({
            contents: sass.compile(args.path, { importers: [nodeModulesImporter] }).css,
            loader: "css",
            resolveDir: path.dirname(args.path)
        }));
    }
};

const outDir = path.join(rootDir, "dist");

async function runBuild(watch: boolean) {
    const before = performance.now();

    // esbuild leaves its outdir as it found it, and every `pnpm install` writes an unminified
    // build there, so a minified release build would land beside those files and both sets would
    // be copied into the app.
    rmSync(outDir, { recursive: true, force: true });

    const opts: esbuild.BuildOptions = {
        entryPoints: [ { in: path.join(rootDir, "src", "index.ts"), out: "scripts" } ],
        bundle: true,
        splitting: true,
        outdir: outDir,
        format: "esm",
        target: ["chrome96"],
        loader: {
            ".png": "dataurl",
            ".gif": "dataurl",
            ".woff": "file",
            ".woff2": "file",
            ".ttf": "file",
            ".eot": "empty",
            ".svg": "empty",
            ".html": "text",
            ".css": "css"
        },
        plugins: [sassPlugin],
        logLevel: "info",
        metafile: true,
        minify: process.argv.includes("--minify")
    };
    if (watch) {
        const ctx = esbuild.context(opts);
        (await ctx).watch();
    } else {
        const result = await esbuild.build(opts);
        const after = performance.now();
        writeFileSync("meta.json", JSON.stringify(result.metafile, null, 2));
        console.log(`Build actually took ${(after - before).toFixed(2)}ms`);
    }
}

const watch = process.argv.includes("--watch");
runBuild(watch).catch(console.error);
