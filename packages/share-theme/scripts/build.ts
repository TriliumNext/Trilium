import path from "node:path";
// import {fileURLToPath} from "node:url";

import dotenv from "dotenv";
import * as esbuild from "esbuild";
import { writeFileSync } from "node:fs";


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


async function runBuild(watch: boolean) {
    const before = performance.now();
    const opts: esbuild.BuildOptions = {
        entryPoints: entryPoints,
        bundle: true,
        splitting: true,
        outdir: path.join(rootDir, "dist"),
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
