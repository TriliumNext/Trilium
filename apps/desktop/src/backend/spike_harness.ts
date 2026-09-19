import { app, MessageChannelMain, utilityProcess } from "electron";
import { appendFileSync, writeFileSync } from "fs";
import path from "path";

import dataDirs from "@triliumnext/server/src/services/data_dir.js";

import type { BackendToMain, PortRequest, PortResponse } from "./protocol_types.js";

/**
 * Headless probe for the out-of-process backend. Forks `backend_process.ts`,
 * drives real API requests over a `MessagePort`, and records how long the main
 * process is unavailable while the backend is busy.
 *
 * Spike scaffolding: no window, no renderer. `main.ts` is untouched, so the
 * normal desktop build still dispatches through `protocol.handle`.
 */
const HEARTBEAT_INTERVAL_MS = 10;

const pending = new Map<number, (response: PortResponse) => void>();
let nextRequestId = 1;
let heartbeatGaps: number[] = [];
let heartbeat: NodeJS.Timeout | undefined;

// Electron on Windows is a GUI-subsystem binary whose stdout does not reach the
// parent console, so progress goes to a file beside the results.
// Both land in the gitignored data dir rather than next to the source.
const ARTIFACT_DIR = path.resolve(dataDirs.TRILIUM_DATA_DIR);
const LOG_PATH = path.join(ARTIFACT_DIR, "spike-harness.log");

function note(line: string) {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
}

run().catch((err) => {
    note(`FAILED ${err instanceof Error ? err.stack : String(err)}`);
    app.exit(1);
});

async function run() {
    writeFileSync(LOG_PATH, "");
    note("harness start");
    await app.whenReady();
    note("app ready");

    const results: Record<string, unknown> = {};

    // Today's architecture, measured on this machine in this run: the same
    // synchronous spin on main's own thread, which is what dispatching through
    // `protocol.handle` does.
    results.inMainBaseline3s = await probeInMain(3000);
    note(`[spike] in-main baseline: main max stall ${(results.inMainBaseline3s as { maxStallMs: number }).maxStallMs}ms`);

    const bootStarted = Date.now();

    const child = utilityProcess.fork(path.join(__dirname, "backend_process.ts"), [], {
        stdio: "inherit",
        execArgv: [ "--import", "tsx" ],
        env: { ...process.env, NODE_OPTIONS: "--import tsx" }
    });

    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "renderer-port" }, [ port1 ]);
    port2.on("message", (event) => {
        const response = event.data as PortResponse;
        pending.get(response.id)?.(response);
        pending.delete(response.id);
    });
    port2.start();

    const ready = new Promise<Record<string, string>>((resolve, reject) => {
        child.on("message", (message: BackendToMain) => {
            if (message.type === "ready") {
                resolve(message.optionSnapshot);
            } else if (message.type === "crash") {
                reject(new Error(message.message));
            }
        });
        child.on("exit", (code) => reject(new Error(`backend exited with ${code}`)));
    });

    const optionSnapshot = await ready;
    results.bootMs = Date.now() - bootStarted;
    results.optionSnapshot = optionSnapshot;
    note(`[spike] backend ready in ${results.bootMs}ms`);

    // Does the real thing answer over the port at all?
    const tree = await request(port2, "GET", "/api/tree");
    results.tree = { status: tree.status, bytes: tree.body.length };
    const appInfo = await request(port2, "GET", "/api/app-info");
    results.appInfo = { status: appInfo.status, body: decode(appInfo).slice(0, 120) };
    note(`[spike] /api/tree -> ${tree.status} (${tree.body.length} bytes)`);

    // Baseline round-trip, so the blocking numbers below have something to sit against.
    const latencies: number[] = [];
    for (let i = 0; i < 200; i++) {
        const started = performance.now();
        await request(port2, "GET", "/api/app-info");
        latencies.push(performance.now() - started);
    }
    latencies.sort((a, b) => a - b);
    results.roundTrip = {
        meanMs: +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2),
        p50Ms: +latencies[100].toFixed(2),
        p99Ms: +latencies[198].toFixed(2)
    };

    // The artificial delay: a synchronous, non-yielding spin inside the backend
    // process, which is what a VACUUM or a flat-text search over a large
    // database looks like from main's point of view.
    results.synthetic3s = await probeBlocking(port2, "/api/spike/busy?ms=3000");

    // And the real thing.
    results.realVacuum = await probeBlocking(port2, "/api/database/vacuum-database", "POST");

    const out = path.join(ARTIFACT_DIR, "spike-results.json");
    writeFileSync(out, JSON.stringify(results, null, 2));
    note(`[spike] wrote ${out}`);
    note(JSON.stringify(results, null, 2));
    app.exit(0);
}

/**
 * Runs one long request while sampling main-process availability. The gap
 * recorded by a 10ms timer is time main's JS thread could not run — the same
 * thread that routes OS input to the renderer and serves `trilium-app://`.
 */
async function probeBlocking(port: Electron.MessagePortMain, url: string, method = "GET") {
    startHeartbeat();
    const started = performance.now();
    const response = await request(port, method, url);
    const durationMs = performance.now() - started;
    const availability = stopHeartbeat();
    note(`[spike] ${method} ${url} -> ${response.status} in ${durationMs.toFixed(0)}ms, main max stall ${availability.maxStallMs}ms`);
    return { url, status: response.status, durationMs: +durationMs.toFixed(0), ...availability };
}

/**
 * The baseline: an identical synchronous spin on the main process' own thread,
 * which is where today's `protocol.handle` dispatch runs the backend. The
 * heartbeat cannot fire while it spins, so the recorded stall is the whole
 * duration.
 */
async function probeInMain(ms: number) {
    startHeartbeat();
    const started = performance.now();
    const until = Date.now() + ms;
    let sink = 0;
    while (Date.now() < until) {
        for (let i = 0; i < 2000; i++) {
            sink += Math.sqrt(sink + i + 1);
        }
    }
    const durationMs = performance.now() - started;
    // The blocked interval only records its overshoot once the loop runs again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { durationMs: +durationMs.toFixed(0), sink: Math.round(sink), ...stopHeartbeat() };
}

function request(port: Electron.MessagePortMain, method: string, url: string): Promise<PortResponse> {
    const id = nextRequestId++;
    const message: PortRequest = {
        id,
        method,
        url: `http://localhost${url}`,
        headers: [ [ "accept", "application/json" ] ]
    };
    return new Promise((resolve) => {
        pending.set(id, resolve);
        port.postMessage(message);
    });
}

function decode(response: PortResponse): string {
    return new TextDecoder().decode(response.body);
}

function startHeartbeat() {
    heartbeatGaps = [];
    let last = Date.now();
    heartbeat = setInterval(() => {
        const now = Date.now();
        heartbeatGaps.push(now - last);
        last = now;
    }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
    clearInterval(heartbeat);
    const stalls = heartbeatGaps.map((gap) => Math.max(0, gap - HEARTBEAT_INTERVAL_MS));
    return {
        maxStallMs: stalls.length ? Math.max(...stalls) : 0,
        stallsOver100ms: stalls.filter((stall) => stall > 100).length
    };
}
