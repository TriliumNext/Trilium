import { useCallback, useEffect, useRef, useState } from "preact/hooks";

interface SmoothStreamingOptions {
    /** Baseline reveal rate in characters per second when the buffer is small. */
    baseCharsPerSecond?: number;
    /**
     * Maximum time (seconds) we let the displayed text lag behind the target.
     * When the backlog implies a higher rate than the baseline to stay within
     * this window, the reveal speeds up.
     */
    maxBacklogSeconds?: number;
}

/** Minimum time between displayed-text state commits (see the cadence cap in `tick`). */
const MIN_COMMIT_INTERVAL_MS = 40;

export interface SmoothStreamingHandle {
    /** The smoothed prefix of the appended target text — render this. */
    displayedText: string;
    /** Add a chunk to the target buffer; it will be revealed gradually. */
    append: (delta: string) => void;
    /** Reveal everything still buffered immediately and stop animating. */
    drain: () => void;
    /** Wipe target and displayed text (start of a new streaming session). */
    reset: () => void;
}

/**
 * Smooths bursty token-streamed text into a steady character-by-character
 * reveal driven by `requestAnimationFrame`. Providers tend to push SSE chunks
 * in irregular bursts (a few tokens at a time, then a pause); applying this
 * hook to the visible text turns that jitter into a consistent typewriter
 * cadence without sacrificing throughput — if the source races ahead, the
 * reveal rate adapts upward to drain the backlog within `maxBacklogSeconds`.
 */
export function useSmoothStreaming(options: SmoothStreamingOptions = {}): SmoothStreamingHandle {
    const { baseCharsPerSecond = 80, maxBacklogSeconds = 0.5 } = options;

    const [displayedText, setDisplayedText] = useState("");

    const targetRef = useRef("");
    const displayedLenRef = useRef(0);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef(0);

    const tick = useCallback(() => {
        // Stop as soon as there's nothing left to reveal, instead of spinning rAF for up to
        // MIN_COMMIT_INTERVAL_MS after the stream has drained.
        const backlog = targetRef.current.length - displayedLenRef.current;
        if (backlog <= 0) {
            rafRef.current = null;
            return;
        }

        const now = performance.now();

        // Cap the commit cadence: every setDisplayedText re-renders the whole chat tree, and
        // rAF fires at display refresh rate (up to 144 Hz). ~25 commits/s still reads as a
        // smooth typewriter (the reveal rate is time-based, so throughput is unaffected).
        if (now - lastTickRef.current < MIN_COMMIT_INTERVAL_MS) {
            rafRef.current = requestAnimationFrame(tick);
            return;
        }

        const dt = (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;

        // With a small backlog the baseline cadence dominates (calm, readable);
        // with a large backlog we accelerate so the lag stays bounded.
        const rate = Math.max(baseCharsPerSecond, backlog / maxBacklogSeconds);
        const charsToAdd = Math.max(1, Math.floor(rate * dt));
        const newLen = Math.min(targetRef.current.length, displayedLenRef.current + charsToAdd);

        displayedLenRef.current = newLen;
        setDisplayedText(targetRef.current.slice(0, newLen));

        rafRef.current = requestAnimationFrame(tick);
    }, [baseCharsPerSecond, maxBacklogSeconds]);

    const ensureRunning = useCallback(() => {
        if (rafRef.current != null) return;
        lastTickRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
    }, [tick]);

    const append = useCallback((delta: string) => {
        if (!delta) return;
        targetRef.current += delta;
        ensureRunning();
    }, [ensureRunning]);

    const drain = useCallback(() => {
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (displayedLenRef.current !== targetRef.current.length) {
            displayedLenRef.current = targetRef.current.length;
            setDisplayedText(targetRef.current);
        }
    }, []);

    const reset = useCallback(() => {
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        targetRef.current = "";
        displayedLenRef.current = 0;
        setDisplayedText("");
    }, []);

    useEffect(() => () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    }, []);

    return { displayedText, append, drain, reset };
}
