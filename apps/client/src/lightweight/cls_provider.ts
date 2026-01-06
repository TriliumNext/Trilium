import { ExecutionContext } from "@triliumnext/core";

export default class BrowserExecutionContext implements ExecutionContext {
    private store: Map<string, any> | null = null;

    get<T = any>(key: string): T | undefined {
        return this.store?.get(key);
    }

    set(key: string, value: any): void {
        if (!this.store) {
            throw new Error("ExecutionContext not initialized");
        }
        this.store.set(key, value);
    }

    reset(): void {
        this.store = null;
    }

    init<T>(callback: () => T): T {
        // Create a fresh context for this request
        const prev = this.store;
        this.store = new Map();

        try {
            return callback();
        } finally {
            // Always clean up
            this.store = prev;
        }
    }
}
