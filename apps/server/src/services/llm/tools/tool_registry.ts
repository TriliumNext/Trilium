/**
 * Lightweight wrapper around AI tool definitions that carries extra metadata
 * (e.g. `mutates`) while remaining compatible with the Vercel AI SDK ToolSet.
 *
 * Each tool module calls `defineTools({ ... })` to declare its tools.
 * Consumers can then:
 * - iterate over entries with `for (const [name, def] of registry)` (MCP)
 * - convert to an AI SDK ToolSet with `registry.toToolSet()` (LLM chat)
 */

import { tool } from "ai";
import type { z } from "zod";
import type { ToolSet } from "ai";

/**
 * Type constraint that rejects Promises at compile time.
 * Works by requiring `then` to be void if present - Promises have `then: Function`.
 */
type NotAPromise<T> = T & { then?: void };

interface MutatingToolDefinition {
    description: string;
    inputSchema: z.ZodType;
    /** Marks this tool as modifying data (needs CLS + transaction wrapping). */
    mutates: true;
    /**
     * Execute the tool synchronously. Must NOT be async because better-sqlite3
     * transactions are synchronous and would commit before awaits complete.
     */
    execute: (args: any) => NotAPromise<object>;
}

interface ReadOnlyToolDefinition {
    description: string;
    inputSchema: z.ZodType;
    mutates?: false;
    /** Execute the tool synchronously. Kept sync for consistency with MCP. */
    execute: (args: any) => NotAPromise<object>;
}

export type ToolDefinition = MutatingToolDefinition | ReadOnlyToolDefinition;

/**
 * A named collection of tool definitions that can be iterated or converted
 * to an AI SDK ToolSet.
 */
export class ToolRegistry implements Iterable<[string, ToolDefinition]> {
    constructor(private readonly tools: Record<string, ToolDefinition>) {}

    /** Iterate over `[name, definition]` pairs. */
    [Symbol.iterator](): Iterator<[string, ToolDefinition]> {
        return Object.entries(this.tools)[Symbol.iterator]();
    }

    /**
     * Convert to an AI SDK ToolSet for use with the LLM chat providers.
     * Read-only tools are given an `execute` function so the AI SDK auto-runs them.
     * Mutating tools are registered WITHOUT `execute` so the SDK emits a tool-call
     * event but does NOT auto-execute — the client must approve first.
     * (CLS context is provided by the route handler.)
     */
    toToolSet(): ToolSet {
        const set: ToolSet = {};
        for (const [name, def] of this) {
            if (def.mutates) {
                // No execute → AI SDK emits tool-call but doesn't auto-execute (human-in-the-loop)
                set[name] = tool({
                    description: def.description,
                    inputSchema: def.inputSchema
                });
            } else {
                set[name] = tool({
                    description: def.description,
                    inputSchema: def.inputSchema,
                    execute: def.execute
                });
            }
        }
        return set;
    }

    /** Return the names of all mutating tools in this registry. */
    getMutatingToolNames(): string[] {
        return [...this].filter(([, def]) => def.mutates).map(([name]) => name);
    }
}

/**
 * Define a group of tools with metadata.
 *
 * ```ts
 * export const noteTools = defineTools({
 *     search_notes: { description: "...", inputSchema: z.object({...}), execute: (args) => {...} },
 *     create_note: { description: "...", inputSchema: z.object({...}), mutates: true, execute: (args) => {...} },
 * });
 * ```
 *
 * Note: All tools MUST have synchronous execute functions (no async/await)
 * because better-sqlite3 transactions are synchronous and MCP expects sync results.
 */
export function defineTools(tools: Record<string, ToolDefinition>): ToolRegistry {
    return new ToolRegistry(tools);
}
