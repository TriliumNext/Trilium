import { ExecutionContext } from "@triliumnext/core";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import type { EventEmitter } from "events";

type Listener = (...args: unknown[]) => unknown;
type AddOrRemove = (event: string, listener: Listener) => unknown;

const storage = new AsyncLocalStorage<Map<string, unknown>>();

export default class AsyncLocalStorageExecutionContext implements ExecutionContext {

    get<T = any>(key: string): T | undefined {
        return storage.getStore()?.get(key) as T | undefined;
    }

    set(key: string, value: any): void {
        const store = storage.getStore();

        if (!store) {
            throw new Error("No context available. cls.init() must be called first.");
        }

        store.set(key, value);
    }

    reset(): void {
        storage.disable();
    }

    init<T>(callback: () => T): T {
        // A nested scope starts from a copy of the enclosing one. `routes/api/llm.ts` opens one
        // while its request is still on the stack and reads the request's componentId and
        // hoistedNoteId through it. Writes land on the copy, leaving the enclosing scope alone.
        const enclosing = storage.getStore();

        return storage.run(enclosing ? new Map(enclosing) : new Map(), callback);
    }

}

const ADD_METHODS = ["addListener", "on", "prependListener"];
const REMOVE_METHODS = ["removeListener", "off"];
const BOUND_LISTENERS = Symbol("boundListeners");

/**
 * Runs listeners added to `emitter` in the context that was active when they were added.
 *
 * {@link AsyncLocalStorage} already covers a listener whose emit descends from the scope that added
 * it. It does not cover one the socket raises on its own — a client aborting mid-response — and
 * both route handlers and `#customRequestHandler` scripts add listeners there that write notes. A
 * write needs a context to record its entity change against, and `set()` throws without one.
 *
 * `once()` and `prependOnceListener()` are deliberately absent from {@link ADD_METHODS}: Node
 * routes both through `on()` and `prependListener()`, so patching them would wrap a listener twice.
 */
export function bindEmitter(emitter: EventEmitter) {
    const target = emitter as unknown as Record<string | symbol, unknown>;

    if (target[BOUND_LISTENERS]) {
        return;
    }

    // Node removes a listener by identity, so the wrapper that replaced one has to be findable
    // again from whatever `removeListener()` is handed.
    const wrappers = new WeakMap<Listener, Listener>();
    Object.defineProperty(emitter, BOUND_LISTENERS, { value: wrappers });

    for (const method of ADD_METHODS) {
        patch(target, method, (add, event, listener) => {
            const wrapper = bindListener(listener);
            wrappers.set(listener, wrapper);

            return add(event, wrapper);
        });
    }

    for (const method of REMOVE_METHODS) {
        patch(target, method, (remove, event, listener) => (
            remove(event, wrappers.get(listener) ?? listener)
        ));
    }
}

/** Replaces one of `target`'s listener methods, leaving a non-function listener untouched. */
function patch(
    target: Record<string | symbol, unknown>,
    method: string,
    apply: (call: AddOrRemove, event: string, listener: Listener) => unknown
) {
    const original = target[method];

    if (typeof original !== "function") {
        return;
    }

    const invoke = original as Listener;
    const call: AddOrRemove = (event, listener) => invoke.call(target, event, listener);

    target[method] = (event: string, listener: Listener) => (
        typeof listener === "function" ? apply(call, event, listener) : call(event, listener)
    );
}

function bindListener(listener: Listener): Listener {
    const wrapper: Listener = storage.getStore()
        ? AsyncResource.bind(listener)
        // Nothing is active, so give the listener a scope of its own rather than none. Declared as
        // a `function` so the emitter still arrives as `this`, which express's own listeners read.
        : AsyncResource.bind(function (this: unknown, ...args: unknown[]) {
            return storage.run(new Map(), () => listener.apply(this, args));
        });

    // `once()` hands `on()` a wrapper of its own. Carrying the innermost listener through keeps
    // `removeListener(originalListener)` and `listeners()` reporting what the caller passed.
    const innermost = (listener as { listener?: Listener }).listener ?? listener;
    Object.defineProperty(wrapper, "listener", { value: innermost, configurable: true });

    return wrapper;
}
