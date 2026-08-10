/**
 * Elects the one tab that owns the database.
 *
 * The database lives on the OPFS SAHPool VFS, which takes *exclusive* sync
 * access handles over its pool files — only one worker on the origin can hold
 * them. Worse, `createSyncAccessHandle` is exposed solely in a dedicated worker
 * (not in a SharedWorker, and a SharedWorker cannot spawn a nested worker to do
 * it either), so the owner has to be a dedicated worker belonging to some page.
 *
 * A Web Lock picks that page. The winner holds the lock for as long as it lives
 * and is the only tab that starts a worker; the others proxy their API calls to
 * it through the service worker. When the leader's tab closes, the browser
 * releases the lock automatically and a waiting tab is promoted — no heartbeat
 * or timeout to get wrong.
 */
const DB_LOCK_NAME = "trilium-standalone-db";

let leader = false;

/** True when this tab owns the database worker. */
export function isLeader(): boolean {
    return leader;
}

/**
 * Ask to own the database. `onElected` runs once this tab holds the lock, which
 * is immediately for the first tab and only on promotion for later ones.
 */
export function claimLeadership(onElected: () => void): void {
    // Web Locks is missing in some embedded WebViews. Those are single-window
    // Capacitor apps, so this tab is trivially the only possible owner.
    if (!navigator.locks?.request) {
        console.info("[Leader] Web Locks unavailable — assuming sole tab");
        promote(onElected);
        return;
    }

    void navigator.locks.request(DB_LOCK_NAME, { mode: "exclusive" }, () => {
        promote(onElected);

        // Never resolves: holding the lock for the lifetime of the tab is what
        // keeps other tabs from opening a second worker. The browser releases it
        // when the tab goes away.
        return new Promise<never>(() => {});
    });
}

function promote(onElected: () => void): void {
    leader = true;
    onElected();
}

/** Reset module state. Test-only. */
export function resetLeadershipForTesting(): void {
    leader = false;
}
