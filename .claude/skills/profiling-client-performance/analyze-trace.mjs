#!/usr/bin/env node
/**
 * Analyzes a Chrome DevTools performance trace (Performance panel -> download, `.json` or
 * `.json.gz`) recorded from Trilium's client, desktop app included.
 *
 * Use it to find *which subsystem* is burning the main thread before instrumenting anything. It
 * reads a production build just as well as a dev one, which `debug_perf` cannot: no source changes,
 * no rebuild, and it works on a trace someone else recorded.
 *
 *   node analyze-trace.mjs <trace> [summary|profile|spikes|timeline] [options]
 *
 * A 90 MB trace needs a bigger heap than the default:
 *   node --max-old-space-size=8192 analyze-trace.mjs trace.json profile
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [ , , tracePath, command = "summary", ...rest ] = process.argv;

if (!tracePath) {
    console.error("usage: analyze-trace.mjs <trace.json|.json.gz> [summary|profile|spikes|timeline]");
    process.exit(1);
}

const events = loadTrace(tracePath);
const threads = describeThreads(events);
const renderer = pickBusiestRenderer(events, threads);

switch (command) {
    case "summary": summary(); break;
    case "profile": profile(numeric(rest, 25)); break;
    case "spikes": spikes(numeric(rest, 150)); break;
    case "timeline": timeline(numeric(rest, 100)); break;
    default:
        console.error(`unknown command "${command}"`);
        process.exit(1);
}

function loadTrace(path) {
    const raw = readFileSync(path);
    const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
    const parsed = JSON.parse(text);

    return Array.isArray(parsed) ? parsed : parsed.traceEvents;
}

/** Process and thread names, so a pid/tid can be reported as "Renderer / CrRendererMain". */
function describeThreads(events) {
    const processNames = new Map();
    const threadNames = new Map();

    for (const e of events) {
        if (e.name === "process_name") processNames.set(e.pid, e.args?.name);
        if (e.name === "thread_name") threadNames.set(`${e.pid}/${e.tid}`, e.args?.name);
    }

    return { processNames, threadNames, describe: (pid, tid) => `${processNames.get(pid) ?? "?"} / ${threadNames.get(`${pid}/${tid}`) ?? "?"}` };
}

function runTasks(events) {
    return events.filter((e) => e.ph === "X" && e.name === "RunTask" && e.dur > 0);
}

/**
 * The renderer's main thread, which is where client work lands.
 *
 * Picked by busy time among threads named CrRendererMain rather than by raw busy time overall: the
 * GPU process's vsync thread is busy for the entire trace by design and would always win.
 */
function pickBusiestRenderer(events, { threadNames }) {
    const busy = new Map();

    for (const task of runTasks(events)) {
        const key = `${task.pid}/${task.tid}`;
        if (threadNames.get(key) !== "CrRendererMain") continue;
        busy.set(key, (busy.get(key) ?? 0) + task.dur);
    }

    const [ key ] = [ ...busy.entries() ].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!key) return null;

    const [ pid, tid ] = key.split("/").map(Number);
    return { pid, tid, busyUs: busy.get(key) };
}

function summary() {
    const tasks = runTasks(events);
    const start = Math.min(...tasks.map((t) => t.ts));
    const end = Math.max(...tasks.map((t) => t.ts + t.dur));

    console.log(`trace span: ${((end - start) / 1e6).toFixed(1)}s over ${events.length} events\n`);

    const busy = new Map();
    for (const task of tasks) {
        const key = `${task.pid}/${task.tid}`;
        busy.set(key, (busy.get(key) ?? 0) + task.dur);
    }

    console.log("=== busy time per thread ===");
    for (const [ key, dur ] of [ ...busy.entries() ].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        const [ pid, tid ] = key.split("/").map(Number);
        console.log(`${(dur / 1000).toFixed(0).padStart(8)}ms  ${threads.describe(pid, tid)}`);
    }

    if (!renderer) {
        console.log("\nNo CrRendererMain thread found.");
        return;
    }

    const share = (renderer.busyUs / (end - start)) * 100;
    console.log(`\nrenderer main thread ${(renderer.busyUs / 1000).toFixed(0)}ms busy (${share.toFixed(0)}% of the trace)`);
    if (share > 60) {
        console.log("  Saturated. Individual stall durations conflate whatever fell inside one busy period.");
    }

    reportLongTasks(tasks, start);
}

/**
 * Long tasks with the gap from the previous one, which is what exposes a recurring beat: a steady
 * gap points at a timer or a debounce, an erratic one at something the user is driving.
 */
function reportLongTasks(tasks, start) {
    const long = tasks
        .filter((t) => t.pid === renderer.pid && t.tid === renderer.tid && t.dur > 50000)
        .sort((a, b) => a.ts - b.ts);

    console.log(`\n=== ${long.length} tasks over 50ms ===`);
    long.slice(0, 40).forEach((task, index) => {
        const gap = index ? `${((task.ts - long[index - 1].ts) / 1000).toFixed(0)}ms` : "-";
        console.log(`  @${((task.ts - start) / 1000).toFixed(0).padStart(7)}ms  ${(task.dur / 1000).toFixed(0).padStart(5)}ms   gap ${gap}`);
    });
}

/**
 * Reconstructs the renderer's V8 sampling profile from its Profile/ProfileChunk events.
 *
 * Keyed on pid *and* id: every process numbers its profiles from the same sequence, so keying on id
 * alone silently merges the browser process's profile into the renderer's and attributes main-process
 * frames to page code.
 */
function buildProfile(pid) {
    const profile = { nodes: new Map(), samples: [], deltas: [], startTime: 0 };

    for (const e of events) {
        if (e.pid !== pid) continue;

        if (e.name === "Profile" && e.args?.data) {
            profile.startTime = e.args.data.startTime;
        } else if (e.name === "ProfileChunk" && e.args?.data) {
            const cpuProfile = e.args.data.cpuProfile ?? {};
            for (const node of cpuProfile.nodes ?? []) profile.nodes.set(node.id, node);
            profile.samples.push(...(cpuProfile.samples ?? []));
            profile.deltas.push(...(e.args.data.timeDeltas ?? []));
        }
    }

    const parents = new Map();
    for (const [ id, node ] of profile.nodes) {
        if (node.parent != null) parents.set(id, node.parent);
        for (const child of node.children ?? []) if (!parents.has(child)) parents.set(child, id);
    }

    const label = (id) => {
        const frame = profile.nodes.get(id)?.callFrame;
        if (!frame) return "?";
        return `${frame.functionName || "(anon)"} @ ${(frame.url ?? "").split("/").pop()}:${frame.lineNumber + 1}`;
    };

    return { ...profile, parents, label, stackOf: (id) => {
        const stack = [];
        for (let cur = id, guard = 0; cur != null && guard < 60; cur = parents.get(cur), guard++) stack.push(label(cur));
        return stack;
    } };
}

/** Walks the profile once, yielding [timestampUs, nodeId, durationUs] per sample. */
function* walkSamples(profile) {
    let ts = profile.startTime;
    for (let i = 0; i < profile.samples.length; i++) {
        ts += profile.deltas[i] ?? 0;
        yield [ ts, profile.samples[i], profile.deltas[i] ?? 0 ];
    }
}

function profile(topN) {
    const profile = buildProfile(renderer.pid);
    if (!profile.samples.length) {
        console.log("No CPU profile in this trace. Record with the Performance panel's default settings.");
        return;
    }

    console.log(`renderer profile: ${profile.samples.length} samples, ${profile.nodes.size} nodes\n`);

    const self = new Map();
    for (const [ , id, dur ] of walkSamples(profile)) self.set(id, (self.get(id) ?? 0) + dur);

    const ranked = [ ...self.entries() ].sort((a, b) => b[1] - a[1]);

    console.log("=== self time (where the CPU actually was) ===");
    for (const [ id, dur ] of ranked.slice(0, topN)) {
        console.log(`${(dur / 1000).toFixed(1).padStart(9)}ms  ${profile.label(id)}`);
    }

    // Total time folds each sample into every distinct frame above it, so a dispatcher that is never
    // itself on-CPU still shows the cost of everything it calls.
    const total = new Map();
    for (const [ id, dur ] of self) {
        for (const frame of new Set(profile.stackOf(id))) total.set(frame, (total.get(frame) ?? 0) + dur);
    }

    console.log("\n=== total time (self plus everything called) ===");
    for (const [ frame, dur ] of [ ...total.entries() ].sort((a, b) => b[1] - a[1]).slice(0, topN)) {
        console.log(`${(dur / 1000).toFixed(1).padStart(9)}ms  ${frame}`);
    }

    console.log("\n=== stacks of the heaviest frames ===");
    for (const [ id, dur ] of ranked.slice(0, 5)) {
        console.log(`\n  ${(dur / 1000).toFixed(1)}ms self`);
        for (const frame of profile.stackOf(id).slice(0, 18)) console.log(`      ${frame}`);
    }
}

/** Aggregates self time inside the long tasks only, which is what a stutter is made of. */
function spikes(thresholdMs) {
    const profile = buildProfile(renderer.pid);
    const tasks = runTasks(events)
        .filter((t) => t.pid === renderer.pid && t.tid === renderer.tid && t.dur > thresholdMs * 1000);

    if (!tasks.length) {
        console.log(`No tasks over ${thresholdMs}ms on the renderer main thread.`);
        return;
    }

    const inside = (ts) => tasks.some((t) => ts >= t.ts && ts <= t.ts + t.dur);
    const self = new Map();
    const stacks = new Map();
    let sampled = 0;

    for (const [ ts, id, dur ] of walkSamples(profile)) {
        if (!inside(ts)) continue;
        sampled += dur;
        const frame = profile.label(id);
        self.set(frame, (self.get(frame) ?? 0) + dur);
        if (!stacks.has(frame)) stacks.set(frame, profile.stackOf(id));
    }

    console.log(`=== inside ${tasks.length} tasks over ${thresholdMs}ms (${(sampled / 1000).toFixed(0)}ms sampled) ===`);
    for (const [ frame, dur ] of [ ...self.entries() ].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`\n${(dur / 1000).toFixed(1)}ms  ${frame}`);
        for (const parent of stacks.get(frame).slice(1, 12)) console.log(`      ${parent}`);
    }
}

function timeline(bucketMs) {
    const tasks = runTasks(events).filter((t) => t.pid === renderer.pid && t.tid === renderer.tid);
    const start = Math.min(...tasks.map((t) => t.ts));
    const bucketUs = bucketMs * 1000;
    const buckets = new Map();

    for (const task of tasks) {
        const bucket = Math.floor((task.ts - start) / bucketUs);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + task.dur);
    }

    console.log(`=== renderer main thread, ${bucketMs}ms buckets (one # = ${(bucketMs / 30).toFixed(1)}ms busy) ===`);
    for (let i = 0; i <= Math.max(...buckets.keys()); i++) {
        const ms = (buckets.get(i) ?? 0) / 1000;
        const bar = "#".repeat(Math.min(60, Math.round(ms / (bucketMs / 30))));
        console.log(`${((i * bucketMs) / 1000).toFixed(1).padStart(7)}s ${String(Math.round(ms)).padStart(4)}ms ${bar}`);
    }
}

function numeric(args, fallback) {
    const value = Number(args[0]);
    return Number.isFinite(value) ? value : fallback;
}
