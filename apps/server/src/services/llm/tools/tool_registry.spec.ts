import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const transactionalMock = vi.hoisted(() => vi.fn(<T>(cb: () => T) => cb()));

// toToolSet wraps mutating tools in sql.transactional; stub it to just run the
// callback so we can assert the wrapping happens without a real transaction.
vi.mock("../../sql.js", () => ({
    default: { transactional: transactionalMock }
}));

import { allToolRegistries } from "./index.js";
import { defineTools, ToolRegistry } from "./tool_registry.js";

describe("ToolRegistry", () => {
    const registry = defineTools({
        read_thing: {
            description: "read",
            inputSchema: z.object({ id: z.string() }),
            execute: ({ id }) => ({ id, read: true })
        },
        write_thing: {
            description: "write",
            inputSchema: z.object({ id: z.string() }),
            mutates: true,
            execute: ({ id }) => ({ id, written: true })
        }
    });

    it("defineTools returns a ToolRegistry", () => {
        expect(registry).toBeInstanceOf(ToolRegistry);
    });

    it("allToolRegistries aggregates every tool group as ToolRegistry instances", () => {
        expect(allToolRegistries.length).toBeGreaterThan(0);
        expect(allToolRegistries.every((r) => r instanceof ToolRegistry)).toBe(true);
        // Every registry yields at least one named tool.
        for (const reg of allToolRegistries) {
            expect([...reg].length).toBeGreaterThan(0);
        }
    });

    it("is iterable over [name, definition] pairs", () => {
        const names = [...registry].map(([name]) => name);
        expect(names).toEqual(["read_thing", "write_thing"]);
        const [, def] = [...registry][1];
        expect(def.mutates).toBe(true);
    });

    it("toToolSet exposes each tool with its description and inputSchema", () => {
        const set = registry.toToolSet();
        expect(Object.keys(set)).toEqual(["read_thing", "write_thing"]);
        expect(set.read_thing.description).toBe("read");
        expect(set.write_thing.inputSchema).toBeDefined();
    });

    it("toToolSet runs read-only tools directly and leaves mutating tools without execute (human-in-the-loop)", async () => {
        transactionalMock.mockClear();
        const set = registry.toToolSet();

        const readResult = await set.read_thing.execute!({ id: "r1" }, {} as any);
        expect(readResult).toEqual({ id: "r1", read: true });
        // Read-only tools are not transaction-wrapped.
        expect(transactionalMock).not.toHaveBeenCalled();

        // Mutating tools have no execute — the AI SDK emits a tool-call event
        // and the client must approve before execution.
        expect(set.write_thing.execute).toBeUndefined();
    });

    it("toToolSet with autoExecuteMutating wraps mutating tools in a transaction", async () => {
        transactionalMock.mockClear();
        const set = registry.toToolSet({ autoExecuteMutating: true });

        const writeResult = await set.write_thing.execute!({ id: "w1" }, {} as any);
        expect(writeResult).toEqual({ id: "w1", written: true });
        expect(transactionalMock).toHaveBeenCalledTimes(1);
    });
});
