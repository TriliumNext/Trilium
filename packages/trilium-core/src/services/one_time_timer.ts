import { getLog } from "./log.js";

const scheduledExecutions: Record<string, boolean> = {};

/**
 * Subsequent calls will not move the timer to the future. The first caller determines the time of execution.
 *
 * The good thing about synchronous better-sqlite3 is that this cannot interrupt transaction. The execution will be called
 * only outside of a transaction.
 */
function scheduleExecution(name: string, milliseconds: number, cb: () => void) {
    if (name in scheduledExecutions) {
        return;
    }

    scheduledExecutions[name] = true;

    setTimeout(() => {
        delete scheduledExecutions[name];

        try {
            cb();
        } catch (e: unknown) {
            // A synchronous throw here would surface as an uncaughtException and kill the process
            // (see #10549), so contain it — a scheduled maintenance task must never take the app down.
            const message = `Scheduled execution '${name}' failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`;
            try {
                getLog().error(message);
            } catch {
                // The log service may not be initialized yet; this handler must never throw.
                console.error(message);
            }
        }
    }, milliseconds);
}

export default {
    scheduleExecution
};
