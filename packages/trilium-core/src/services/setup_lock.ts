import type { SetupOperation } from "@triliumnext/commons";

import { ConflictError } from "../errors.js";
import { getLog } from "./log.js";

/**
 * Lets one setup operation at a time create the database.
 *
 * The setup screen is reachable by anyone who can reach an uninitialized instance, and nothing stops
 * a second browser tab, a second phone, or an impatient double click from starting a second one. The
 * operations all end in the same place: creating a document, pulling one from a sync server, or
 * restoring one from a backup, each of which builds the database from nothing.
 *
 * Running two of those at once is not slow, it is destructive: a restore that spent an hour receiving
 * a file would be overwritten by a "create new document" started in another tab a moment before it
 * finished, and neither side would report anything wrong.
 *
 * So the second one is refused rather than queued. Queuing would run it *after* the first, which for
 * operations that each wipe what came before is the same accident with extra waiting.
 *
 * @module
 */

let running: SetupOperation | null = null;
const holds = new Set<SetupOperation>();

/**
 * Runs `work` as the one setup operation, refusing to start while another is under way.
 *
 * The lock is held for as long as `work` runs, which for a restore is the whole of it: the request
 * that started it returns long before, and the client follows the rest by polling.
 *
 * @throws ConflictError when another operation, or a hold taken by {@link holdSetup}, has the lock.
 */
export async function withSetupLock<T>(operation: SetupOperation, work: () => Promise<T>): Promise<T> {
    requireIdle(operation);
    running = operation;
    getLog().info(`Setup operation '${operation}' started.`);

    try {
        return await work();
    } finally {
        running = null;
        getLog().info(`Setup operation '${operation}' finished.`);
    }
}

/**
 * Reserves setup for an operation that has not started yet, e.g. a backup being uploaded before it
 * can be restored. Refuses for the same reason {@link withSetupLock} does, and is released by the
 * returned function however the operation ends.
 */
export function holdSetup(operation: SetupOperation): () => void {
    requireIdle(operation);
    if (holds.has(operation)) {
        throw new ConflictError(`Setup is already reserved for '${operation}'.`);
    }

    holds.add(operation);

    return () => holds.delete(operation);
}

/** What setup is busy with, or `null` when it is not. For reporting, never for deciding. */
export function getRunningSetupOperation(): SetupOperation | null {
    return running ?? [ ...holds ][0] ?? null;
}

/**
 * Deciding and taking must not be separated: two requests that both looked first and took second
 * would both proceed, which is the whole thing this exists to prevent.
 *
 * An operation's own hold does not stand in its way. A hold is taken *for* the operation that later
 * runs — an upload reserving setup for the restore it is going to feed — so treating it as a rival
 * would have the reservation refuse the very thing it was reserving for. The hold outlives the run
 * and keeps setup reserved across a second attempt, e.g. after a passphrase turned out to be wrong.
 */
function requireIdle(operation: SetupOperation): void {
    const blocking = running && running !== operation
        ? running
        : [ ...holds ].find((held) => held !== operation);

    if (blocking) {
        throw new ConflictError(
            `Cannot start '${operation}': setup is already busy with '${blocking}'.`
        );
    }

    // Two runs of the same operation are still two runs, and the second must not join the first.
    if (running) {
        throw new ConflictError(`Cannot start '${operation}': it is already running.`);
    }
}
