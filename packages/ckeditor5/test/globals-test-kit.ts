/**
 * Helpers for the Trilium global stubs that several specs install on `globalThis` (the `glob`
 * bridge and `navigator.clipboard`). Each installer registers its own teardown, run after every
 * test by the global `afterEach` in `setup.ts`, so specs no longer need to delete/restore these
 * themselves.
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

/**
 * Install a mock Trilium `glob` on `globalThis` for the current test. Pass only the members the
 * spec needs (each typically a `vi.fn()`); the cast to the global `glob` type lives here so specs
 * don't repeat it. Returns the same object for convenient assertion access. Removed automatically
 * after the test.
 */
export function installGlobMock<T extends object>(glob: T): T {
    (globalThis as unknown as { glob: T }).glob = glob;
    registerTestCleanup(() => {
        delete (globalThis as { glob?: unknown }).glob;
    });
    return glob;
}

/**
 * Replace `navigator.clipboard` with the given mock for the current test, restoring the original
 * afterwards. Returns the mock for assertion access.
 */
export function mockClipboard<T extends object>(clipboard: T): T {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
    registerTestCleanup(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: original });
    });
    return clipboard;
}
