/**
 * The lazy half of the tool-registry seam, in a module of its own so hosts can
 * register at startup without loading the tool stack: `index.js` pulls every
 * core registry (and through `tool_registry.js` the AI SDK and zod) on import,
 * while this file needs only a type. A host registers a loader here; the first
 * chat turn or MCP request resolves it via `resolveToolRegistries()` in
 * `index.js`, and the registry's module loads then, not at startup.
 */

import type { ToolRegistry } from "./tool_registry.js";

/** Imports and returns a host's tool registry on first use. */
export type ToolRegistryLoader = () => Promise<ToolRegistry>;

const pendingLoaders: ToolRegistryLoader[] = [];

/**
 * Register a loader for a host-provided tool registry. Called once at startup;
 * registering again after a resolve (tests, an Electron reload) queues the
 * loader again, and the duplicate collapses when it resolves to the same
 * registry instance.
 */
export function registerToolRegistryLoader(loader: ToolRegistryLoader) {
    pendingLoaders.push(loader);
}

/** Hands the queued loaders to `resolveToolRegistries()`, emptying the queue. */
export function drainToolRegistryLoaders(): ToolRegistryLoader[] {
    return pendingLoaders.splice(0, pendingLoaders.length);
}
