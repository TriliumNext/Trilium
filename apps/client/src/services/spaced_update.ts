import type { SaveState } from "../components/note_context";
import { getErrorMessage } from "./utils";

type Callback = () => Promise<void> | void;

export type StateCallback = (state: SaveState) => void;

type PrepareCallback<T> = () => T | Promise<T>;
type CommitCallback<T> = (data: T) => Promise<void> | void;

/**
 * Binds pending changes to the target they belong to (see #9614).
 *
 * A change scheduled while one binding is active is always *snapshotted* (via {@link SpacedUpdateBinding.prepare})
 * before the binding can be swapped to a different key, and the snapshot is committed together with the
 * `commit` closure that was current when it was taken. This makes it impossible for a pending change to be
 * persisted under a different target than the one it was made against, no matter when the save fires.
 */
export interface SpacedUpdateBinding<T> {
    /** Identity of the save target (e.g. a noteId). Pending changes never cross a key change. */
    key: string | null;
    /** Snapshots the live state that should be saved. May refuse by returning a value `commit` treats as a no-op. */
    prepare: PrepareCallback<T>;
    /** Persists a snapshot. Retries always reuse the closure that was current when the snapshot was taken. */
    commit: CommitCallback<T>;
}

interface PendingCommit<T> {
    data: T;
    commit: CommitCallback<T>;
}

const MAX_RETRY_DELAY = 60_000;

export default class SpacedUpdate<T = void> {
    private bindingKey: string | null;
    private prepare: PrepareCallback<T>;
    private commit: CommitCallback<T>;
    private lastUpdated: number;
    private changed: boolean;
    private updateInterval: number;
    private changeForbidden?: boolean;
    private stateCallback?: StateCallback;
    private lastState: SaveState = "saved";

    /**
     * Snapshots that have been taken but not successfully persisted yet, by binding key.
     * A newer snapshot for the same key supersedes the queued one. Entries survive failed
     * commits and are retried (with backoff) until they land — they are never dropped.
     */
    private pendingCommits = new Map<string | null, PendingCommit<T>>();
    /** Snapshots whose asynchronous `prepare` is still running — captured but not yet queued. */
    private pendingSnapshots = new Set<Promise<void>>();
    private drainPromise: Promise<void> | null = null;
    private debounceTimer?: ReturnType<typeof setTimeout>;
    private retryTimer?: ReturnType<typeof setTimeout>;
    private retryCount = 0;

    constructor(updaterOrBinding: Callback | SpacedUpdateBinding<T>, updateInterval = 1000, stateCallback?: StateCallback) {
        if (typeof updaterOrBinding === "function") {
            // Legacy single-callback mode: the updater reads live state and persists it in one
            // step, so there is nothing to snapshot and the binding key never changes.
            this.bindingKey = null;
            this.prepare = () => undefined as T;
            this.commit = () => updaterOrBinding();
        } else {
            this.bindingKey = updaterOrBinding.key;
            this.prepare = updaterOrBinding.prepare;
            this.commit = updaterOrBinding.commit;
        }

        this.lastUpdated = Date.now();
        this.changed = false;
        this.updateInterval = updateInterval;
        this.stateCallback = stateCallback;
    }

    scheduleUpdate() {
        if (!this.changeForbidden) {
            this.changed = true;
            this.onStateChanged("unsaved");
            this.armDebounceTimer();
        }
    }

    /**
     * Swaps the binding to a new target. If the key changes while a change is still pending,
     * the change is first snapshotted with the *previous* binding (and committed in the
     * background, addressed to the previous key), so it can never be saved under the new key.
     */
    rebind(key: string | null, prepare: PrepareCallback<T>, commit: CommitCallback<T>) {
        if (key !== this.bindingKey && this.changed) {
            const snapshotted = this.snapshotPending();
            const drainInBackground = () => {
                this.drain().catch(() => {
                    // Failures are logged in runDrain and retried; the snapshot stays addressed to the old key.
                });
            };

            if (snapshotted instanceof Promise) {
                // The old prepare() was already invoked synchronously, so swapping the binding
                // below cannot leak the pending change to the new key.
                snapshotted.then(drainInBackground, () => {});
            } else {
                drainInBackground();
            }
        }

        this.bindingKey = key;
        this.prepare = prepare;
        this.commit = commit;
    }

    /** Flushes the pending change (if any) and waits until all queued snapshots are persisted. */
    updateNowIfNecessary(): Promise<void> {
        return this.drain();
    }

    isAllSavedAndTriggerUpdate() {
        const allSaved = !this.changed
            && this.pendingCommits.size === 0
            && this.pendingSnapshots.size === 0
            && !this.drainPromise;

        this.updateNowIfNecessary().catch(() => {
            // Failures are logged in runDrain and retried.
        });

        return allSaved;
    }

    /**
     * Normally {@link scheduleUpdate()} would actually trigger the update only once per {@link updateInterval}. If the method is called 200 times within 20s, it will execute only 20 times.
     * Sometimes, if the updates are continuous this would cause a performance impact. Resetting the time ensures that the calls to the update have stopped before actually triggering an update.
     */
    resetUpdateTimer() {
        this.lastUpdated = Date.now();
    }

    /**
     * Sets the update interval for the spaced update.
     * @param interval The update interval in milliseconds.
     */
    setUpdateInterval(interval: number) {
        this.updateInterval = interval;
    }

    onStateChanged(state: SaveState) {
        if (state === this.lastState) return;

        this.stateCallback?.(state);
        this.lastState = state;
    }

    async allowUpdateWithoutChange(callback: Callback) {
        this.changeForbidden = true;

        try {
            await callback();
        } finally {
            this.changeForbidden = false;
        }
    }

    /**
     * Single debounce timer replacing the old 0-ms self-rescheduling loop: armed with the time
     * remaining until the interval elapses, re-armed if {@link resetUpdateTimer} pushed it back.
     */
    private armDebounceTimer() {
        if (this.debounceTimer) {
            return;
        }

        const delay = Math.max(1, this.updateInterval - (Date.now() - this.lastUpdated));
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;

            if (!this.changed) {
                return;
            }

            if (Date.now() - this.lastUpdated >= this.updateInterval) {
                this.drain().catch(() => {
                    // Failures are logged in runDrain and retried.
                });
            } else {
                this.armDebounceTimer();
            }
        }, delay);
    }

    /**
     * Snapshots the pending change with the *current* binding and queues it for commit.
     * Returns a promise only when `prepare` is asynchronous; in the synchronous case the
     * snapshot is queued before this method returns, so callers (notably the `beforeunload`
     * path) can rely on the commit starting synchronously within {@link drain}.
     */
    private snapshotPending(): void | Promise<void> {
        if (!this.changed) {
            return;
        }

        this.changed = false;
        this.lastUpdated = Date.now();

        const { bindingKey, commit } = this;
        const restoreOnError = (e: unknown): never => {
            this.changed = true;
            this.onStateChanged("error");
            // The debounce timer may have already fired and gone idle while the snapshot was
            // being captured; schedule a retry so the restored change is not stranded until
            // the next scheduleUpdate() call. Going through the retry timer (rather than the
            // debounce timer) gives persistent prepare() failures exponential backoff.
            this.scheduleRetry();
            throw e;
        };

        let result: T | Promise<T>;
        try {
            result = this.prepare();
        } catch (e) {
            return restoreOnError(e);
        }

        if (result instanceof Promise) {
            // Track the in-flight snapshot so drain() and isAllSavedAndTriggerUpdate() don't
            // consider everything saved before the snapshot has been queued for commit.
            const snapshot: Promise<void> = result
                .then(
                    (data) => {
                        this.pendingCommits.set(bindingKey, { data, commit });
                    },
                    restoreOnError
                )
                .finally(() => {
                    this.pendingSnapshots.delete(snapshot);
                });
            this.pendingSnapshots.add(snapshot);
            return snapshot;
        }

        this.pendingCommits.set(bindingKey, { data: result, commit });
    }

    private drain(): Promise<void> {
        if (this.drainPromise) {
            return this.drainPromise;
        }

        if (!this.changed && this.pendingCommits.size === 0 && this.pendingSnapshots.size === 0) {
            return Promise.resolve();
        }

        this.drainPromise = this.runDrain().finally(() => {
            this.drainPromise = null;
        });

        return this.drainPromise;
    }

    private async runDrain(): Promise<void> {
        while (true) {
            // Wait for snapshots that were started elsewhere (e.g. by rebind) to be queued.
            // Their failures restore the `changed` flag and are handled by the fold below.
            while (this.pendingSnapshots.size > 0) {
                await Promise.allSettled([ ...this.pendingSnapshots ]);
            }

            // Fold any pending change into the queue first, so a queued snapshot and a newer
            // pending change for the same key result in a single save, not two.
            const snapshotted = this.snapshotPending();
            if (snapshotted instanceof Promise) {
                await snapshotted;
            }

            if (this.pendingCommits.size === 0) {
                break;
            }

            this.onStateChanged("saving");

            let failed = false;
            let firstError: unknown;

            for (const key of [ ...this.pendingCommits.keys() ]) {
                const entry = this.pendingCommits.get(key);
                if (!entry) {
                    continue;
                }

                try {
                    await entry.commit(entry.data);

                    // Delete only if the entry was not superseded by a newer snapshot during the await.
                    if (this.pendingCommits.get(key) === entry) {
                        this.pendingCommits.delete(key);
                    }
                } catch (e) {
                    if (!failed) {
                        failed = true;
                        firstError = e;
                    }
                    logError(getErrorMessage(e));
                }
            }

            if (failed) {
                this.onStateChanged("error");
                this.scheduleRetry();
                throw firstError;
            }
        }

        // Reset the retry backoff only once everything has landed; resetting it on individual
        // successes would shorten the backoff of a still-failing sibling key.
        this.retryCount = 0;
        this.onStateChanged(this.changed ? "unsaved" : "saved");
    }

    private scheduleRetry() {
        if (this.retryTimer) {
            return;
        }

        const delay = Math.min(this.updateInterval * 2 ** this.retryCount, MAX_RETRY_DELAY);
        this.retryCount++;

        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.drain().catch(() => {
                // Failures are logged in runDrain and will be retried again.
            });
        }, delay);
    }
}
