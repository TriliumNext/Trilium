import { ExecutionContext } from "@triliumnext/core";

/**
 * Browser execution context.
 *
 * The browser has no `AsyncLocalStorage`, so scopes are tracked on a stack. That model holds
 * because the worker keeps at most one *asynchronous* scope live at a time: `dbLock` gives an
 * async route exclusive use of the connection, and a synchronous scope cannot be interleaved at
 * all. What the stack owes in return is LIFO discipline — a scope ends when its callback does,
 * and ending it uncovers the one it was opened inside.
 */
export default class BrowserExecutionContext implements ExecutionContext {
    private stack: Map<string, any>[] = [];

    get<T = any>(key: string): T | undefined {
        return this.current()?.get(key);
    }

    set(key: string, value: any): void {
        const current = this.current();

        if (!current) {
            throw new Error("ExecutionContext not initialized");
        }

        current.set(key, value);
    }

    reset(): void {
        this.stack = [];
    }

    init<T>(callback: () => T): T {
        // A nested scope starts from a copy of the enclosing one, as it does on the server:
        // `routes/api/llm.ts` opens one while its request is still on the stack and reads the
        // request's componentId and hoistedNoteId through it. Writes land on the copy.
        const enclosing = this.current();
        const scope = enclosing ? new Map(enclosing) : new Map<string, any>();
        this.stack.push(scope);

        let result: T;

        try {
            result = callback();
        } catch (error) {
            this.end(scope);
            throw error;
        }

        if (isThenable(result)) {
            return result.finally(() => this.end(scope)) as T;
        }

        this.end(scope);

        return result;
    }

    private current(): Map<string, any> | undefined {
        return this.stack[this.stack.length - 1];
    }

    /**
     * Ends `scope`, which is the top of the stack unless an asynchronous scope opened inside it is
     * still running. Matched by identity so that one outliving its parent removes the right entry.
     */
    private end(scope: Map<string, any>) {
        const at = this.stack.lastIndexOf(scope);

        if (at !== -1) {
            this.stack.splice(at, 1);
        }
    }
}

function isThenable(value: unknown): value is Promise<unknown> {
    const candidate = value as { then?: unknown; finally?: unknown } | null;

    return typeof candidate?.then === "function" && typeof candidate.finally === "function";
}
