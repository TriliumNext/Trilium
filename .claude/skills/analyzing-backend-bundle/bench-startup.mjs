// Times spawn -> first HTTP response for a backend bundle, N runs, and prints
// the median. The caller supplies the TRILIUM_* environment; TRILIUM_PORT is
// also the probe target.
//
//   env $ENV node bench-startup.mjs <bundle.mjs|bundle.cjs> [runs=5]
import { spawn } from "node:child_process";
import http from "node:http";

const [bundle, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? "5");
const port = process.env.TRILIUM_PORT;

function probe() {
    return new Promise((resolve) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on("error", () => resolve(false));
    });
}

const times = [];
for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const arg = bundle.endsWith(".mjs")
        ? ["--input-type=module", "-e", `import(${JSON.stringify("file://" + bundle)})`]
        : ["-e", `require(${JSON.stringify(bundle)})`];
    const child = spawn(process.execPath, arg, { stdio: "ignore", env: process.env });
    for (;;) {
        if (await probe()) break;
        await new Promise((r) => setTimeout(r, 25));
    }
    const elapsed = performance.now() - start;
    times.push(elapsed);
    child.kill("SIGKILL");
    await new Promise((r) => child.on("exit", r));
    await new Promise((r) => setTimeout(r, 500));
    console.error(`  run ${i + 1}: ${elapsed.toFixed(0)} ms`);
}
times.sort((a, b) => a - b);
console.log(`median ${times[Math.floor(times.length / 2)].toFixed(0)} ms, min ${times[0].toFixed(0)}, max ${times[times.length - 1].toFixed(0)}`);
