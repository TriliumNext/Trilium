/** Called with how far along an operation is, from 0 (nothing done) to 1 (complete). */
export type ProgressCallback = (progress: number) => void;

/** Shortest gap between two progress reports, unless the caller asks for a different one. */
export const DEFAULT_PROGRESS_INTERVAL_MS = 250;

/** The progress options every entry point in this module accepts. */
export interface ProgressOptions {
    /**
     * Called with the progress of the payload, from 0 to 1, at most once every
     * {@link ProgressOptions.progressIntervalMs}, and always once more with exactly 1 once the
     * operation has finished.
     *
     * A position needs something to be a fraction of, so progress below 1 is only reported when the
     * size of the database is known. A callback that throws is ignored: reporting on a backup is
     * never a reason to fail one.
     *
     * A report of 1 is not itself a report of success. It says the last of the payload has gone
     * past, which on both paths happens before the destination has taken it, so a failure can still
     * follow one. The resolved promise is what says the container is written or unwrapped.
     */
    onProgress?: ProgressCallback;
    /** Shortest gap between reports. Defaults to {@link DEFAULT_PROGRESS_INTERVAL_MS}. */
    progressIntervalMs?: number;
}

/**
 * Rate-limits progress reports to at most one per interval.
 *
 * Throttled rather than debounced: a container streams from beginning to end without ever pausing,
 * so a debounce would hold every report back until there was nothing left to report. The interval is
 * measured against the clock as the bytes go past rather than driven by a timer, so an operation
 * that fails leaves nothing behind holding the event loop open.
 */
export class ProgressReporter {

    #reportedAt = Number.NEGATIVE_INFINITY;

    constructor(
        /** What the position is a fraction of, or 0 when the size is not known. */
        private readonly total: number,
        private readonly callback: ProgressCallback,
        private readonly intervalMs: number
    ) {}

    /** Reports being `bytes` into the total, unless the last report was too recent for another. */
    at(bytes: number): void {
        if (this.total <= 0) {
            return;
        }

        const now = Date.now();
        if (now - this.#reportedAt < this.intervalMs) {
            return;
        }

        this.#reportedAt = now;
        // Clamped: an input can have grown past the size that was measured before it was opened.
        this.#emit(Math.min(1, bytes / this.total));
    }

    /** Reports completion, whatever was reported before it and however recently. */
    complete(): void {
        this.#emit(1);
    }

    #emit(progress: number): void {
        try {
            this.callback(progress);
        } catch {
            // Deliberately swallowed, see `onProgress`.
        }
    }

}

/** Builds the reporter for one operation, or `null` when the caller asked for no progress. */
export function createProgressReporter(
    total: number,
    options: ProgressOptions
): ProgressReporter | null {
    if (!options.onProgress) {
        return null;
    }

    return new ProgressReporter(
        total,
        options.onProgress,
        options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS
    );
}
