import eventService, { type BeccaReloadedEvent } from "./events.js";
import { getLog } from "./log.js";
import { getDataKey } from "./protected_session.js";
import { getSql } from "./sql/index.js";

/** One committed entity change, as `applyEntityChanges()` consumes it. */
export interface EntityChangeRef {
    entityName: string;
    entityId: string;
    isErased: boolean;
}

/**
 * Receives what a read-only replica of becca needs to stay in step with this process. Calls arrive
 * in commit order, and each one describes rows that are already committed.
 *
 * - `onCommit` lists the entity changes of one committed transaction.
 * - `onReload` follows a full `becca_loader.load()`, after which the replica loads again too.
 * - `onProtectedSession` follows entering (with the data key) or leaving (`null`) the protected
 *   session. On leaving, becca loads again, and this call stands for that reload as well: the
 *   replica resets its key and loads, and receives no separate `onReload`.
 */
export interface BeccaReplicaSink {
    onCommit(changes: EntityChangeRef[]): void;
    onReload(): void;
    onProtectedSession(dataKey: Uint8Array | null): void;
}

let sink: BeccaReplicaSink | null = null;
let reloadPending = false;

export function setBeccaReplicaSink(replicaSink: BeccaReplicaSink | null) {
    sink = replicaSink;
    reloadPending = false;
}

export function getBeccaReplicaSink(): BeccaReplicaSink | null {
    return sink;
}

/**
 * Feeds one committed transaction to the sink. Called by `ws.sendTransactionEntityChangesToAllClients()`
 * after every outermost commit. A reload that happened inside the transaction is sent in place of
 * the changes, since the replica cannot read the reloaded rows before the commit.
 */
export function feedCommit(changes: EntityChangeRef[]) {
    if (!sink) {
        return;
    }

    if (reloadPending) {
        reloadPending = false;
        notify((target) => target.onReload());
        return;
    }

    if (changes.length > 0) {
        notify((target) => target.onCommit(changes));
    }
}

eventService.subscribe(eventService.BECCA_RELOADED, (event?: BeccaReloadedEvent) => {
    if (!sink || event?.cause === "leaveProtectedSession") {
        return;
    }

    if (getSql().isInTransaction()) {
        reloadPending = true;
        return;
    }

    reloadPending = false;
    notify((target) => target.onReload());
});

eventService.subscribe(eventService.ENTER_PROTECTED_SESSION, () => {
    const dataKey = getDataKey();
    notify((target) => target.onProtectedSession(dataKey ? Uint8Array.from(dataKey) : null));
});

eventService.subscribe(eventService.LEAVE_PROTECTED_SESSION, () => {
    notify((target) => target.onProtectedSession(null));
});

function notify(deliver: (target: BeccaReplicaSink) => void) {
    if (!sink) {
        return;
    }

    try {
        deliver(sink);
    } catch (e) {
        const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
        getLog().error(`Becca replica sink failed: ${detail}`);
    }
}
