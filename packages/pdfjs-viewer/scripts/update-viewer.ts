import { join, dirname } from "path";
import packageJson from "../package.json" with { type: "json" };
import fs from "fs/promises";
import * as yauzl from "yauzl";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
const version = packageJson.devDependencies["pdfjs-dist"];
const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-dist.zip`;

const FILES_TO_COPY = [
    "web/images/",
    "web/locale/",
    "web/viewer.css",
    "web/viewer.html",
    "web/viewer.mjs",
    "web/wasm/"
];

async function main() {
    console.log(`Downloading pdfjs-dist v${version} from ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download pdfjs-dist from ${url}: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const zip = await yauzl.fromBufferPromise(Buffer.from(buffer));
    for await (const entry of zip.eachEntry()) {
        if (entry.fileName.endsWith("/") || !FILES_TO_COPY.some(prefix => entry.fileName.startsWith(prefix))) {
            // Directory entry or not in the list of files to copy, skip
            console.log("Skipping", entry.fileName);
            continue;
        }

        const relativePath = entry.fileName.substring("web/".length);
        const outPath = join(__dirname, "../viewer", relativePath);
        await fs.mkdir(dirname(outPath), { recursive: true });
        const readStream = await zip.openReadStreamPromise(entry);
        await pipeline(readStream, createWriteStream(outPath));
        console.log(`Extracted ${relativePath} to ${outPath}`);
    }

    console.log("Finished extracting pdfjs-dist files.");
    await patchViewerHTML();
};

async function patchViewerHTML() {
    const viewerPath = join(__dirname, "../viewer/viewer.html");
    let content = await fs.readFile(viewerPath, "utf-8");
    content = content.replace(`    <link rel="stylesheet" href="viewer.css" />`, `    <link rel="stylesheet" href="viewer.css" />\n    <link rel="stylesheet" href="custom.css" />`);
    content = content.replace(`  <script src="viewer.mjs" type="module"></script>`, `  <script src="custom.mjs" type="module"></script>\n  <script src="viewer.mjs" type="module"></script>`);
    await fs.writeFile(viewerPath, content, "utf-8");
}

main();
