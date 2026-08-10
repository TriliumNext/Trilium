/**
 * Serialises route handlers against the worker's single SQLite connection.
 *
 * Most routes run inside the *synchronous* `getSql().transactional()`, which is
 * atomic on its own: single-threaded JS cannot interleave another request into
 * the middle of it. Those need no coordination.
 *
 * The exception is `createAsyncRoute` (imports and friends), which holds a
 * transaction open across `await` points via `transactionalAsync`. While such a
 * transaction is open:
 *
 * - a second async route would issue `BEGIN IMMEDIATE` inside the open
 *   transaction, which SQLite rejects; and
 * - a synchronous route would be folded into it as a SAVEPOINT (see the nesting
 *   branch in `sql_provider.ts`), so an unrelated request's writes would be
 *   rolled back if the import later failed.
 *
 * Both hazards predate multi-tab support — one tab already issues concurrent
 * requests — but a second tab makes them far likelier, so the worker now gates
 * on this lock. Shared (synchronous) work keeps a zero-overhead fast path and
 * only becomes asynchronous while an exclusive holder is actually active.
 */
export class DbLock {
    private exclusive: Promise<void> | null = null;

    /** True while an async-transaction holder is active. */
    get isLocked(): boolean {
        return this.exclusive !== null;
    }

    /**
     * Run `fn` with exclusive access to the connection. Other exclusive work and
     * any shared work queue behind it.
     */
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        while (this.exclusive) {
            await this.exclusive;
        }

        let release: () => void = () => {};
        this.exclusive = new Promise<void>((resolve) => {
            release = resolve;
        });

        try {
            return await fn();
        } finally {
            this.exclusive = null;
            release();
        }
    }

    /**
     * Run `fn`, first waiting for any exclusive holder to finish.
     *
     * Returns `fn`'s value directly when the lock is free so the common path
     * stays synchronous; returns a promise only when it has to wait.
     */
    runShared<T>(fn: () => T): T | Promise<T> {
        if (!this.exclusive) {
            return fn();
        }

        return (async () => {
            while (this.exclusive) {
                await this.exclusive;
            }
            return fn();
        })();
    }
}

/** The worker owns exactly one SQLite connection, so one lock covers it. */
export const dbLock = new DbLock();
