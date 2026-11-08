/**
 * Per-test teardowns for stubs that specs install on `globalThis`, run after every test by the
 * global `afterEach` in `setup.ts`, so specs need not restore them themselves.
 *
 * Lives outside `src/`, so it is excluded from both the production build and the 100% coverage
 * gate (see editor-kit.ts).
 */

const cleanups: Array<() => void | Promise<void>> = [];

/** Queue a teardown to run after the current test (LIFO), via runTestCleanups() in setup.ts. */
export function registerTestCleanup(cleanup: () => void | Promise<void>): void {
    cleanups.push(cleanup);
}

/** Run and clear all queued per-test cleanups, most-recently-registered first. */
export async function runTestCleanups(): Promise<void> {
    const pending = cleanups.splice(0).reverse();
    for (const cleanup of pending) {
        await cleanup();
    }
}
