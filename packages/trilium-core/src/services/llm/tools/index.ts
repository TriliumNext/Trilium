/**
 * LLM tools that wrap existing Trilium services.
 * These reuse the same logic as ETAPI without any HTTP overhead.
 */

export { attachmentTools } from "./attachment_tools.js";
export { attributeTools } from "./attribute_tools.js";
export { hierarchyTools } from "./hierarchy_tools.js";
export { iconTools } from "./icon_tools.js";
export { noteTools } from "./note_tools.js";
export { skillTools } from "./skill_tools.js";
export type { ToolDefinition } from "./tool_registry.js";
export { ToolRegistry } from "./tool_registry.js";

import { attachmentTools } from "./attachment_tools.js";
import { attributeTools } from "./attribute_tools.js";
import { hierarchyTools } from "./hierarchy_tools.js";
import { iconTools } from "./icon_tools.js";
import { noteTools } from "./note_tools.js";
import { drainToolRegistryLoaders } from "./registration.js";
import { skillTools } from "./skill_tools.js";
import type { ToolRegistry } from "./tool_registry.js";

/**
 * All tool registries, for consumers that need to iterate every tool (e.g. MCP).
 *
 * The skill sheets are listed here even though their markdown reaches each
 * runtime differently: the catalog is core's, and every host registers a reader
 * for it (see {@link ../skills.js}). What is still contributed from outside is
 * the help tools, which read the User Guide off disk — a guide the browser build
 * does not carry at all — so that registry arrives via
 * {@link registerToolRegistry} and standalone simply runs without it.
 */
export const allToolRegistries: ToolRegistry[] = [
    noteTools,
    attributeTools,
    attachmentTools,
    hierarchyTools,
    iconTools,
    skillTools
];

/**
 * Add a host-provided tool registry. Must be called before the first chat turn
 * or MCP tool listing, both of which read {@link allToolRegistries} eagerly.
 * Registering the same registry twice is a no-op, so a host that initialises
 * more than once (tests, Electron reloads) does not duplicate its tools.
 *
 * A host whose registry should stay out of the startup path registers a loader
 * with `registerToolRegistryLoader` (see `registration.js`) instead of calling
 * this directly.
 */
export function registerToolRegistry(registry: ToolRegistry) {
    if (!allToolRegistries.includes(registry)) {
        allToolRegistries.push(registry);
    }
}

let inFlightResolve: Promise<void> | null = null;

/**
 * Loads every host-registered lazy registry into {@link allToolRegistries}.
 * The chat pipeline and the MCP server call this at the start of their async
 * entry points, which is what lets `buildTools()` and other readers stay
 * synchronous: by the time they iterate the array, it is complete.
 *
 * Concurrent callers share one in-flight resolution. Draining the queue
 * empties it before the imports finish, so without the shared promise a
 * second first-use request would see nothing left to load and proceed
 * against a still-incomplete array.
 */
export function resolveToolRegistries(): Promise<void> {
    if (inFlightResolve) {
        return inFlightResolve;
    }

    // Draining before creating the promise keeps the empty case fully
    // synchronous. Routing it through the async closure below would let the
    // closure settle while its own creation is still being evaluated, and the
    // assignment would then store an already-settled promise that the
    // `finally` can never clear again.
    const loaders = drainToolRegistryLoaders();
    if (loaders.length === 0) {
        return Promise.resolve();
    }

    inFlightResolve = (async () => {
        try {
            for (const loader of loaders) {
                registerToolRegistry(await loader());
            }
        } finally {
            inFlightResolve = null;
        }
    })();
    return inFlightResolve;
}
