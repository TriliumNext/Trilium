import { getLog, getPlatform, utils, ws } from "@triliumnext/core";

/** Occurrences of the same message beyond this count within {@link THROTTLE_WINDOW_MS} are dropped. */
const MAX_REPORTS_PER_MESSAGE = 3;
const THROTTLE_WINDOW_MS = 60_000;
/**
 * Error messages routinely embed entity ids (`Note 'XvA0rKdu1238' doesn't exist.`), so a storm can produce
 * an unbounded number of distinct keys. Past this many tracked messages the whole table is dropped:
 * throttling is a flood guard, not an audit trail, and restarting the windows costs at most a few extra
 * log lines.
 */
const MAX_TRACKED_MESSAGES = 100;

/** A throw nothing caught. During startup it means the application never came up, so it stays fatal. */
export const UNCAUGHT_EXCEPTION = { label: "Uncaught exception", fatalDuringStartup: true };
/**
 * A rejected promise nobody awaited. Node's default is to promote these to uncaught exceptions, but
 * Trilium has always logged and carried on instead — a floating promise is usually incidental to whatever
 * the process is really doing, and the ones raised during startup have never prevented a working boot.
 * Keeping them non-fatal preserves that; the new part is only that they now reach the user once the
 * application is up.
 */
export const UNHANDLED_REJECTION = { label: "Unhandled promise rejection", fatalDuringStartup: false };

interface ProcessErrorKind {
    label: string;
    fatalDuringStartup: boolean;
}

const throttle = createErrorThrottle({
    maxPerMessage: MAX_REPORTS_PER_MESSAGE,
    windowMs: THROTTLE_WINDOW_MS,
    maxTrackedMessages: MAX_TRACKED_MESSAGES
});

let appReady = false;

/**
 * Installs the last-resort handlers for errors that escaped every other guard.
 *
 * Deferred work — a `setTimeout` callback, a floating promise — has no request to fail and no caller to
 * catch it, so without this a single throw from a background task takes the whole application down: the
 * server process dies, and Electron replaces the desktop app with a modal stack trace against minified
 * `main.mjs` offsets (see #10823). That is a wildly disproportionate outcome for work whose failure is
 * usually inconsequential, and it costs the user whatever unsaved state they had.
 *
 * Crashing therefore has to be a decision rather than the default, which is what {@link markAppReady}
 * draws the line for. Fatal errors are still fatal: they go through `platform.crash()` deliberately, from
 * a caller that knows continuing is pointless.
 *
 * Registering an `uncaughtException` listener also suppresses Electron's own handler, which bails out as
 * soon as the application has a listener of its own — so the desktop dialog stops appearing precisely
 * because we take responsibility for the error here.
 */
export function installProcessErrorHandlers() {
    process.on("uncaughtException", (error) => reportProcessError(UNCAUGHT_EXCEPTION, error));
    process.on("unhandledRejection", (reason) => reportProcessError(UNHANDLED_REJECTION, reason));
}

/**
 * Marks the point past which an escaped error is no longer fatal.
 *
 * Before this, an error means the application never became usable — a failed migration, an unreadable
 * database, a port that couldn't be bound — and limping on would only produce a broken app that misleads
 * the user about what state their data is in. After it, the application is running and serving clients,
 * so a failure in one background task is contained by definition.
 */
export function markAppReady() {
    appReady = true;
}

/**
 * Records an escaped error and decides what it costs: nothing more than a log entry and a toast once the
 * application is up, a deliberate crash while it is still starting.
 *
 * Exported for tests — production code reaches it through {@link installProcessErrorHandlers}.
 */
export function reportProcessError(kind: ProcessErrorKind, error: unknown) {
    try {
        const [message, stack] = utils.safeExtractMessageAndStackFromError(error);
        const decision = throttle.check(message, Date.now());

        if (!decision.report) {
            return;
        }

        const suppressionNotice = decision.lastBeforeSuppression
            ? ` (further occurrences of this error within ${THROTTLE_WINDOW_MS / 1000}s will not be reported)`
            : "";
        const description = `${kind.label}: ${message}${suppressionNotice}\n${stack ?? "(no stack trace available)"}`;

        logSafely(description);

        if (!appReady) {
            // No client is connected this early, so the log is the only channel available either way.
            if (kind.fatalDuringStartup) {
                getPlatform().crash(description);
            }
            return;
        }

        // The stack goes along for the user to copy into a bug report; the client keeps it behind a
        // details step so the notification itself stays readable.
        ws.sendMessageToAllClients({ type: "unhandled-error", message, stack });
    } catch (e: unknown) {
        // This is the handler of last resort, so a throw from inside it has nowhere left to go and would
        // terminate the process with an error about the error. Fall back to the console, and keep a
        // startup failure fatal even when the reporting path itself is what broke.
        console.error("Failed to report a process-level error:", e);

        if (!appReady && kind.fatalDuringStartup) {
            process.exit(1);
        }
    }
}

function logSafely(description: string) {
    // The console line goes out first and unconditionally: it is the only channel guaranteed to exist,
    // and terminal users would otherwise see nothing.
    console.error(description);

    try {
        getLog().error(description);
    } catch {
        // The log service may not be initialized yet — an escaped error during startup is exactly when
        // that happens — and this handler must never throw.
    }
}

interface ThrottleDecision {
    /** Whether this occurrence should be logged and surfaced at all. */
    report: boolean;
    /** `true` on the last reported occurrence before the message goes quiet for the rest of its window. */
    lastBeforeSuppression: boolean;
}

/**
 * Collapses repeats of the same error message so that a task failing in a loop costs a few log lines
 * rather than an unbounded flood of them (and a toast the user cannot dismiss faster than it reappears).
 *
 * Exported for tests; pure apart from the caller-supplied clock.
 */
export function createErrorThrottle({ maxPerMessage, windowMs, maxTrackedMessages }: {
    maxPerMessage: number;
    windowMs: number;
    maxTrackedMessages: number;
}) {
    const windows = new Map<string, { count: number; startedAtMs: number }>();

    return {
        check(message: string, nowMs: number): ThrottleDecision {
            const current = windows.get(message);

            if (!current || nowMs - current.startedAtMs >= windowMs) {
                if (windows.size >= maxTrackedMessages) {
                    windows.clear();
                }

                windows.set(message, { count: 1, startedAtMs: nowMs });

                return { report: true, lastBeforeSuppression: maxPerMessage <= 1 };
            }

            current.count++;

            return {
                report: current.count <= maxPerMessage,
                lastBeforeSuppression: current.count === maxPerMessage
            };
        }
    };
}
