import type { Environment } from "vitest/environments";

/**
 * A Vitest environment shaped like the dedicated Web Worker core runs in under standalone:
 * modules resolve with the `browser` export condition, as Vite bundles the worker, and the global
 * scope is Node's, which lacks `window`, `document` and `DOMParser` as a worker does. A dependency
 * whose browser build needs a page's DOM fails here as it fails in production, where happy-dom
 * would hide it.
 */
export default {
    name: "web-worker",
    viteEnvironment: "client",
    setup(global) {
        global.self = global;
        return {
            teardown() {
                delete global.self;
            }
        };
    }
} satisfies Environment;
