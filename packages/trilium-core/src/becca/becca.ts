"use strict";

import Becca from "./becca-interface.js";
import { getContext } from "../services/context.js";

/**
 * Registry of Becca instances keyed by database ID for multi-database mode.
 */
export const beccaInstances = new Map<string, Becca>();

const defaultBecca = new Becca();

/**
 * Returns the Becca instance for the current CLS execution context.
 * Falls back to defaultBecca when no context is active (startup, tests, server mode).
 */
export function getActiveBecca(): Becca {
    try {
        const dbId = getContext().get<string>("dbId");
        if (dbId) {
            const instance = beccaInstances.get(dbId);
            if (instance) return instance;
        }
    } catch {
        // No CLS context yet (startup, module-level code).
    }
    return defaultBecca;
}

/**
 * Proxy-based default export. All existing `import becca from "..."` code
 * continues to work unchanged — the proxy delegates to the context-appropriate
 * Becca instance transparently.
 */
const becca: Becca = new Proxy(defaultBecca, {
    get(_, prop, _receiver) {
        const instance = getActiveBecca();
        const value = (instance as any)[prop];
        if (typeof value === "function") {
            return value.bind(instance);
        }
        return value;
    },
    set(_, prop, value) {
        const instance = getActiveBecca();
        (instance as any)[prop] = value;
        return true;
    }
});

export default becca;
