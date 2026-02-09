import { ExecutionContext } from "@triliumnext/core";

/**
 * Browser execution context implementation.
 * 
 * Unlike the server (which uses cls-hooked for per-request isolation),
 * the browser is single-threaded with a single user and doesn't need
 * request-level isolation. We maintain a single persistent context
 * throughout the page lifetime.
 */
export default class BrowserExecutionContext implements ExecutionContext {
    private store: Map<string, any> = new Map();

    get<T = any>(key: string): T {
        return this.store.get(key);
    }

    set(key: string, value: any): void {
        this.store.set(key, value);
    }

    reset(): void {
        this.store.clear();
    }

    init<T>(callback: () => T): T {
        // In browser, we don't need per-request isolation.
        // Just execute the callback with the persistent context.
        // This allows fire-and-forget operations to access context.
        return callback();
    }
}
