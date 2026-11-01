/**
 * Finds the frames of a Chromium trace in which a script forced style or layout and the frame
 * computed it more than once. A frame needs at most one pass of each: a script that reads the
 * layout after another one wrote to the DOM only moves that pass earlier, and only a write after
 * the read makes the frame do it again. Frames whose extra pass no script forced, such as one after
 * a `ResizeObserver` callback, don't count.
 */
export function findThrashingFrames(traceEvents: TraceEvent[]): FrameReport {
    const threads = new Map<string, TraceEvent[]>();
    const rendererMainThreads = new Set(traceEvents
        .filter((event) => event.ph === "M" && event.name === "thread_name"
            && event.args?.name === "CrRendererMain")
        .map(threadKey));
    for (const event of traceEvents) {
        if (event.ph !== "X" && event.ph !== "I" && event.ph !== "i") continue;
        const key = threadKey(event);
        if (!rendererMainThreads.has(key)) continue;
        let events = threads.get(key);
        if (!events) threads.set(key, events = []);
        events.push(event);
    }

    let frameCount = 0;
    const thrashing: ThrashingFrame[] = [];
    for (const events of threads.values()) {
        events.sort((a, b) => a.ts - b.ts);
        for (const task of events.filter((event) => event.name === "RunTask" && event.dur)) {
            const end = task.ts + (task.dur ?? 0);
            const inside = events.slice(
                findFirstAtOrAfter(events, task.ts),
                findFirstAtOrAfter(events, end + 1)
            );
            if (!inside.some((event) => event.name === "BeginMainThreadFrame")) continue;
            frameCount++;

            const passes = inside.filter(isPassWithWork).map(describePass);
            const styleCount = passes.filter((pass) => pass.name === "UpdateLayoutTree").length;
            const layoutCount = passes.length - styleCount;
            const isForced = passes.some((pass) => pass.forcedBy);
            if (isForced && (styleCount > 1 || layoutCount > 1)) {
                thrashing.push({ durationMs: (task.dur ?? 0) / 1000, passes });
            }
        }
    }

    return { frameCount, thrashing };
}

/** Lists each script that forced a pass in a thrashing frame, the most frequent first. */
export function summarizeThrashing({ frameCount, thrashing }: FrameReport) {
    const forcers = new Map<string, number>();
    for (const frame of thrashing) {
        for (const pass of frame.passes) {
            if (pass.forcedBy) forcers.set(pass.forcedBy, (forcers.get(pass.forcedBy) ?? 0) + 1);
        }
    }

    const lines = [ ...forcers ]
        .sort((a, b) => b[1] - a[1])
        .map(([ forcedBy, count ]) => `  ${count}× ${forcedBy}`);
    return [
        `${thrashing.length} of ${frameCount} frames computed style or layout more than once.`,
        "Passes forced by:",
        ...lines
    ].join("\n");
}

export interface TraceEvent {
    name: string;
    ph: string;
    pid: number;
    tid: number;
    ts: number;
    dur?: number;
    args?: {
        name?: string;
        elementCount?: number;
        beginData?: {
            dirtyObjects?: number;
            stackTrace?: StackFrame[];
        };
    };
}

export interface FrameReport {
    frameCount: number;
    thrashing: ThrashingFrame[];
}

export interface ThrashingFrame {
    durationMs: number;
    passes: Pass[];
}

interface Pass {
    name: string;
    /** The innermost script frame that forced the pass, or nothing for the frame's own pass. */
    forcedBy?: string;
}

interface StackFrame {
    functionName: string;
    url: string;
    lineNumber: number;
}

function threadKey(event: TraceEvent) {
    return `${event.pid}:${event.tid}`;
}

function findFirstAtOrAfter(events: TraceEvent[], ts: number) {
    let low = 0;
    let high = events.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (events[middle].ts < ts) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** Style passes that restyle no element and layout passes with nothing dirty cost nothing. */
function isPassWithWork(event: TraceEvent) {
    if (event.ph !== "X") return false;
    if (event.name === "UpdateLayoutTree") return (event.args?.elementCount ?? 1) > 0;
    if (event.name === "Layout") return (event.args?.beginData?.dirtyObjects ?? 1) > 0;
    return false;
}

function describePass(event: TraceEvent): Pass {
    const stack = event.args?.beginData?.stackTrace;
    if (!stack?.length) return { name: event.name };

    return { name: event.name, forcedBy: stack.slice(0, 3).map(describeStackFrame).join(" < ") };
}

function describeStackFrame({ functionName, url, lineNumber }: StackFrame) {
    const file = url.split("/").pop()?.split("?")[0] ?? url;
    // Trace line numbers start at 0.
    return `${functionName || "(anonymous)"} (${file}:${lineNumber + 1})`;
}
