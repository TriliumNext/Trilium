import { ExecutionContext } from "@triliumnext/core";

/**
 * Browser execution context implementation.
 * 
 * Handles per-request context isolation with support for fire-and-forget async operations
 * using a context stack and grace-period cleanup to allow unawaited promises to complete.
 */
export default class BrowserExecutionContext implements ExecutionContext {
    private contextStack: Map<string, any>[] = [];
    private cleanupTimers = new WeakMap<Map<string, any>, ReturnType<typeof setTimeout>>();
    private readonly CLEANUP_GRACE_PERIOD = 1000; // 1 second for fire-and-forget operations

    private getCurrentContext(): Map<string, any> {
        if (this.contextStack.length === 0) {
            throw new Error("ExecutionContext not initialized");
        }
        return this.contextStack[this.contextStack.length - 1];
    }

    get<T = any>(key: string): T {
        return this.getCurrentContext().get(key);
    }

    set(key: string, value: any): void {
        this.getCurrentContext().set(key, value);
    }

    reset(): void {
        this.contextStack = [];
    }

    init<T>(callback: () => T): T {
        const context = new Map<string, any>();
        this.contextStack.push(context);

        // Cancel any pending cleanup timer for this context
        const existingTimer = this.cleanupTimers.get(context);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.cleanupTimers.delete(context);
        }

        try {
            const result = callback();

            // If the result is a Promise
            if (result && typeof result === 'object' && 'then' in result && 'catch' in result) {
                const promise = result as unknown as Promise<any>;
                return promise.finally(() => {
                    this.scheduleContextCleanup(context);
                }) as T;
            } else {
                // For synchronous results, schedule delayed cleanup to allow fire-and-forget operations
                this.scheduleContextCleanup(context);
                return result;
            }
        } catch (error) {
            // Always clean up on error with grace period
            this.scheduleContextCleanup(context);
            throw error;
        }
    }

    private scheduleContextCleanup(context: Map<string, any>): void {
        const timer = setTimeout(() => {
            // Remove from stack if still present
            const index = this.contextStack.indexOf(context);
            if (index !== -1) {
                this.contextStack.splice(index, 1);
            }
            this.cleanupTimers.delete(context);
        }, this.CLEANUP_GRACE_PERIOD);

        this.cleanupTimers.set(context, timer);
    }
}
