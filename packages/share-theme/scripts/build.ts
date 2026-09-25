import path from "node:path";
// import {fileURLToPath} from "node:url";

import dotenv from "dotenv";
import * as esbuild from "esbuild";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as sass from "sass";


// const fileURL = fileURLToPath(import.meta.url);
// let baseDir = path.dirname(fileURL);
// if (fileURL.includes("esrun-")) baseDir = path.join(baseDir, "..", "..", "scripts");
// const rootDir = path.join(baseDir, "..");
// console.log(process.env.npm_package_json);
const rootDir = path.dirname(process.env.npm_package_json!);

dotenv.config();

const modules = ["scripts", "styles"];
const entryPoints: {in: string, out: string}[] = [];

function makeEntry(mod: string) {
    let entrypoint: string;
    switch (mod) {
        case "styles":
            entrypoint = "index.css";
            break;
        case "scripts":
            entrypoint = "index.ts";
            break;
        default:
            throw new Error(`Unknown module type ${mod}.`);
    }

    return {
        "in": path.join(rootDir, "src", mod, entrypoint),
        "out": mod
    };
}

const modulesRequested = process.argv.filter(a => a.startsWith("--module="));
for (const mod of modulesRequested) {
    const module = mod?.replace("--module=", "") ?? "";
    if (modules.includes(module)) entryPoints.push(makeEntry(module));
}

if (!entryPoints.length) for (const mod of modules) entryPoints.push(makeEntry(mod));


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
    // be copied into the app. A partial build must not clean: `--module=` builds one of the two
    // entry points and would otherwise delete the other's output.
    if (!modulesRequested.length) {
        rmSync(outDir, { recursive: true, force: true });
    }

    const opts: esbuild.BuildOptions = {
        entryPoints: entryPoints,
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
