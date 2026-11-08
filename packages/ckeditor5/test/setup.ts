import { afterEach } from "vitest";

import { destroyTrackedEditors } from "./editor-kit.js";
import { runTestCleanups } from "./globals-test-kit.js";

/**
 * Global test setup, registered via `setupFiles` in vitest.config.ts and run before/after every
 * spec. Owns the boilerplate specs used to repeat:
 *  - destroying every editor created through `createTestEditor()`;
 *  - running the per-test cleanups that specs queue with `registerTestCleanup()`.
 */

afterEach(async () => {
    await runTestCleanups();
    await destroyTrackedEditors();
});
