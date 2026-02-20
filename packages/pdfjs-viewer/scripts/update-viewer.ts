import { join } from "path";
import packageJson from "../package.json" with { type: "json" };
import fs from "fs/promises";
import * as yauzl from "yauzl";
import { createWriteStream } from "fs";
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
    yauzl.fromBuffer(Buffer.from(buffer), { lazyEntries: true }, (err, zip) => {
        zip.readEntry();
        zip.on("entry", (entry: yauzl.Entry) => {
            if (entry.fileName.endsWith("/") || !FILES_TO_COPY.some(prefix => entry.fileName.startsWith(prefix))) {
                // Directory entry or not in the list of files to copy, skip
                console.log("Skipping", entry.fileName);
                zip.readEntry();
                return;
            }

            const relativePath = entry.fileName.substring("web/".length);
            zip.openReadStream(entry, (err, readStream) => {
                if (err) {
                    console.error(`Failed to read ${entry.fileName} from zip:`, err);
                    return;
                }
                const outPath = join(__dirname, "../viewer", relativePath);
                const outStream = createWriteStream(outPath);
                readStream.pipe(outStream);
                outStream.on("finish", () => {
                    console.log(`Extracted ${relativePath} to ${outPath}`);
                });
            });
            zip.readEntry();
        });
        zip.on("end", async () => {
            console.log("Finished extracting pdfjs-dist files.");
            await patchViewerHTML();
        });
    });
};

async function patchViewerHTML() {
    const viewerPath = join(__dirname, "../viewer/viewer.html");
    let content = await fs.readFile(viewerPath, "utf-8");
    content = content.replace(`    <link rel="stylesheet" href="viewer.css" />`, `    <link rel="stylesheet" href="viewer.css" />\n    <link rel="stylesheet" href="custom.css" />`);
    content = content.replace(`  <script src="viewer.mjs" type="module"></script>`, `  <script src="custom.mjs" type="module"></script>\n  <script src="viewer.mjs" type="module"></script>`);
    await fs.writeFile(viewerPath, content, "utf-8");
}

main();
