/**
 * Opt-in main-thread instrumentation for tracking down UI stalls.
 *
 * Recording is off by default and every entry point costs one boolean check when off, so call
 * sites can sit in hot paths (per-card renders, per-cell formatting) without being paid for in
 * normal use. Drive it from the devtools console:
 *
 * ```js
 * triliumPerf.enable();     // start recording; also logs every long task as it happens
 * triliumPerf.report();     // print what has been gathered so far
 * triliumPerf.reset();      // clear the counters, keep recording
 * triliumPerf.disable();
 * triliumPerf.components(); // census the widget tree, for hunting leaked widgets
 * ```
 *
 * Spans additionally land on the User Timing track via `performance.measure()`, so a DevTools
 * performance capture shows them lined up against the long tasks they explain.
 *
 * Nothing calls into this by default, and that is deliberate rather than an oversight: instrument
 * whatever is being investigated for as long as it takes to answer the question, then take the call
 * sites back out. Adding the first `perfSpan()` or `perfCount()` anywhere is what pulls this module
 * into the bundle, which is also what puts `triliumPerf` on `window` -- so there is nothing to arm
 * beyond the call site itself.
 */

interface Counter {
    calls: number;
    totalMs: number;
    maxMs: number;
}

/** Closing a span that was never opened, because recording is off. */
const NOOP_SPAN = () => 0;

/**
 * A main-thread block this long counts as a stall. Matches the Long Tasks API's own threshold, so
 * the two detectors below report comparable numbers.
 */
const STALL_THRESHOLD_MS = 50;

let enabled = false;
let recordingStartedAt = 0;
let longTaskObserver: PerformanceObserver | undefined;
let stallFrameHandle: number | undefined;
const counters = new Map<string, Counter>();

export function isPerfRecording() {
    return enabled;
}

/**
 * Opens a span. Call the returned function to close it, which records the elapsed time under
 * `label`, emits a matching `performance.measure()` entry, and returns the elapsed milliseconds.
 *
 * Prefer that returned number over the STALL lines for "what did this one operation cost": a stall
 * is the gap between animation frames, so on a saturated main thread it reports the whole
 * contiguous busy period and lumps however many operations fell inside it together.
 *
 * Returns a no-op when recording is off, so the caller does not need to branch.
 */
export function perfSpan(label: string): () => number {
    if (!enabled) {
        return NOOP_SPAN;
    }

    const start = performance.now();
    return () => {
        const end = performance.now();
        const duration = end - start;
        record(label, duration);

        try {
            // Same clock as performance.now(), so the span lands where it actually happened.
            performance.measure(label, { start, end });
        } catch (e) {
            // A measure() that the browser rejects must not take the instrumented code down.
        }

        return duration;
    };
}

/** Records `count` occurrences of `label` without timing them. */
export function perfCount(label: string, count = 1) {
    if (!enabled) {
        return;
    }

    record(label, 0, count);
}

/** Times a synchronous call and returns its result untouched. */
export function perfTime<T>(label: string, fn: () => T): T {
    if (!enabled) {
        return fn();
    }

    const start = performance.now();
    try {
        return fn();
    } finally {
        record(label, performance.now() - start);
    }
}

/** Logs a one-off event, stamped with how far into the recording it happened. */
export function perfLog(label: string, detail?: Record<string, unknown>) {
    if (!enabled) {
        return;
    }

    const at = (performance.now() - recordingStartedAt).toFixed(0);
    console.log(`[perf +${at}ms] ${label}`, detail ?? "");
}

function record(label: string, durationMs: number, count = 1) {
    let counter = counters.get(label);
    if (!counter) {
        counter = { calls: 0, totalMs: 0, maxMs: 0 };
        counters.set(label, counter);
    }

    counter.calls += count;
    counter.totalMs += durationMs;
    counter.maxMs = Math.max(counter.maxMs, durationMs);
}

function enable() {
    if (enabled) {
        return;
    }

    enabled = true;
    recordingStartedAt = performance.now();
    counters.clear();

    startStallDetection();

    console.log("[perf] recording. triliumPerf.report() to print, triliumPerf.disable() to stop.");
}

function disable() {
    enabled = false;
    longTaskObserver?.disconnect();
    longTaskObserver = undefined;

    if (stallFrameHandle !== undefined) {
        cancelAnimationFrame(stallFrameHandle);
        stallFrameHandle = undefined;
    }

    console.log("[perf] stopped.");
}

/**
 * Starts reporting main-thread stalls, preferring the Long Tasks API and falling back to watching
 * for late animation frames where it is missing.
 *
 * The fallback exists because only Chromium implements the `longtask` entry type, and
 * `observe({ entryTypes })` drops an unrecognized type with nothing but a console warning rather
 * than throwing — so on Firefox the observer silently reports nothing at all, which reads as "no
 * stalls happened" instead of "this browser cannot see them".
 */
function startStallDetection() {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                reportStall(entry.startTime, entry.duration);
            }
        });
        longTaskObserver.observe({ entryTypes: [ "longtask" ] });
        console.log("[perf] stalls: Long Tasks API.");
        return;
    }

    console.log("[perf] stalls: animation-frame watchdog (this browser has no Long Tasks API).");
    watchForLateFrames();
}

/**
 * Approximates long tasks by measuring the gap between animation frames: work that blocks the main
 * thread pushes the next frame out by roughly its own duration.
 *
 * Less precise than the Long Tasks API -- it cannot see a block that lands while the page is not
 * painting, and it charges the gap to the frame boundary rather than to the task -- but it is
 * enough to time a stall and line it up against the spans around it.
 */
function watchForLateFrames() {
    let previousFrameAt = performance.now();

    const onFrame = () => {
        if (!enabled) {
            return;
        }

        const now = performance.now();
        const gap = now - previousFrameAt;
        if (gap >= STALL_THRESHOLD_MS) {
            reportStall(previousFrameAt, gap);
        }

        previousFrameAt = now;
        stallFrameHandle = requestAnimationFrame(onFrame);
    };

    stallFrameHandle = requestAnimationFrame(onFrame);
}

function reportStall(startTime: number, durationMs: number) {
    record("stall", durationMs);
    const at = (startTime - recordingStartedAt).toFixed(0);
    console.log(`[perf +${at}ms] STALL ${durationMs.toFixed(0)}ms`);
}

function reset() {
    counters.clear();
    recordingStartedAt = performance.now();
}

function report() {
    const elapsed = performance.now() - recordingStartedAt;
    const rows = [ ...counters.entries() ]
        .sort((a, b) => b[1].totalMs - a[1].totalMs || b[1].calls - a[1].calls)
        .map(([ label, { calls, totalMs, maxMs } ]) => ({
            label,
            calls,
            "total (ms)": +totalMs.toFixed(1),
            "avg (ms)": +(totalMs / calls).toFixed(3),
            "max (ms)": +maxMs.toFixed(1)
        }));

    console.log(`[perf] ${(elapsed / 1000).toFixed(1)}s recorded`);
    console.table(rows);
}

/** The parts of a `Component` the census reads, so that this module doesn't have to import one. */
interface CensusComponent {
    children: CensusComponent[];
    /** Handlers registered by `useTriliumEvent`. Private on the component, hence the local shape. */
    listeners: Record<string, Set<unknown>> | null;
}

let previousCensus = new Map<string, number>();

/**
 * Prints how many components are reachable from the root of the widget tree, and how many React
 * event handlers they hold, broken down by class and by event.
 *
 * For hunting leaks of the "the tab was closed but its widgets kept handling events" kind: take a
 * reading, open and close a few tabs, take another. The `since last` column is what matters --
 * anything that doesn't come back down stayed in the tree. `NoteWrapperWidget` should always equal
 * the number of open splits.
 *
 * Independent of `enable()`: it walks live state rather than anything that had to be recorded.
 */
function components() {
    const root = window.glob?.appContext as unknown as CensusComponent | undefined;
    if (!root) {
        console.log("[perf] no appContext to walk (is the app still starting up?).");
        return;
    }

    const counts = new Map<string, number>();
    let total = 0;
    let handlers = 0;

    function count(key: string, by: number) {
        counts.set(key, (counts.get(key) ?? 0) + by);
    }

    (function walk(component: CensusComponent) {
        total++;
        count(`class ${component.constructor.name}`, 1);

        for (const [ eventName, listeners ] of Object.entries(component.listeners ?? {})) {
            handlers += listeners.size;
            count(`event ${eventName}`, listeners.size);
        }

        component.children.forEach(walk);
    })(root);

    const rows = [ ...counts.entries() ]
        .map(([ what, count ]) => ({ what, count, "since last": count - (previousCensus.get(what) ?? 0) }))
        .sort((a, b) => b["since last"] - a["since last"] || b.count - a.count);

    // Anything gone since the last reading has no row of its own, so surface it as a negative one.
    for (const [ what, count ] of previousCensus) {
        if (!counts.has(what)) {
            rows.push({ what, count: 0, "since last": -count });
        }
    }

    previousCensus = counts;

    console.log(`[perf] ${total} components, ${handlers} React handlers reachable from the root`);
    console.table(rows);
}

const triliumPerf = { enable, disable, reset, report, components };
export default triliumPerf;

window.triliumPerf = triliumPerf;
