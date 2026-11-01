// Downloads the prebuilt sherpa-onnx WebAssembly build and the Silero VAD model into `vendor/`.
//
// The build comes from k2-fsa's VAD + ASR demo space, the only browser build of the recognizer
// they publish. It bakes a Chinese model into a preloaded `.data` package; the loader call is
// patched to an empty package, since the page writes its own models into the virtual FS.
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SPACE = "https://huggingface.co/spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc/resolve/9d5fc71d88ab1222ed1af2274fb194592af48455";
const VAD_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";
const GLUE = "sherpa-onnx-wasm-main-vad-asr.js";
const VENDOR_DIR = join(import.meta.dirname, "vendor");

await mkdir(VENDOR_DIR, { recursive: true });
for (const file of [ GLUE, "sherpa-onnx-wasm-main-vad-asr.wasm", "sherpa-onnx-asr.js", "sherpa-onnx-vad.js" ]) {
    await download(`${SPACE}/${file}`, join(VENDOR_DIR, file));
}
await download(VAD_URL, join(VENDOR_DIR, "silero_vad.onnx"));

const gluePath = join(VENDOR_DIR, GLUE);
const glue = await readFile(gluePath, "utf8");
const patched = glue.replace(/loadPackage\(\{"files":\[.*?\],"remote_package_size":\d+\}\)/, `loadPackage({"files":[],"remote_package_size":0})`);
if (patched === glue) {
    throw new Error(`The data package loader was not found in ${GLUE}.`);
}
await writeFile(gluePath, patched);
console.log("Done.");

async function download(url, destination) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`${url}: HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}
