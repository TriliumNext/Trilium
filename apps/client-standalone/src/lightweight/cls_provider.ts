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
            const result = callback();
            
            // If the result is a Promise, we need to handle cleanup after it resolves
            if (result && typeof result === 'object' && 'then' in result && 'catch' in result) {
                const promise = result as unknown as Promise<any>;
                return promise.finally(() => {
                    this.store = prev;
                }) as T;
            } else {
                // Synchronous result, clean up immediately
                this.store = prev;
                return result;
            }
        } catch (error) {
            // Always clean up on error (for synchronous errors)
            this.store = prev;
            throw error;
        }
    }
}
