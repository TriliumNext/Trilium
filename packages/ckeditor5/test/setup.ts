import { afterEach, beforeEach } from "vitest";

import { destroyTrackedEditors } from "./editor-kit.js";
import { runTestCleanups } from "./globals-test-kit.js";

/**
 * Global test setup, registered via `setupFiles` in vitest.config.ts and run before/after every
 * spec. Owns the boilerplate specs used to repeat:
 *  - a constant `$` (jQuery) passthrough that several plugins' converters call;
 *  - destroying every editor created through `createTestEditor()`;
 *  - running per-test cleanups queued by the globals kit (glob / clipboard stubs).
 */
beforeEach(() => {
    (globalThis as unknown as { $: (value: unknown) => unknown }).$ = (value) => value;
});

afterEach(async () => {
    await runTestCleanups();
    await destroyTrackedEditors();
});
