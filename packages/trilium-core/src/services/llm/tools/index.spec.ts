import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { allToolRegistries, resolveToolRegistries } from "./index.js";
import { registerToolRegistryLoader } from "./registration.js";
import { defineTools, type ToolRegistry } from "./tool_registry.js";

function makeRegistry(name: string): ToolRegistry {
    return defineTools({
        [name]: {
            description: "test tool",
            inputSchema: z.object({}),
            execute: () => ({ ok: true })
        }
    });
}

describe("resolveToolRegistries", () => {
    const added: ToolRegistry[] = [];

    afterEach(() => {
        // allToolRegistries is a module singleton; leave it as this spec found it.
        for (const registry of added.splice(0, added.length)) {
            const index = allToolRegistries.indexOf(registry);
            if (index >= 0) {
                allToolRegistries.splice(index, 1);
            }
        }
    });

    it("loads a registered loader into allToolRegistries once", async () => {
        const registry = makeRegistry("once_tool");
        added.push(registry);
        registerToolRegistryLoader(async () => registry);

        await resolveToolRegistries();
        expect(allToolRegistries).toContain(registry);

        // A drained loader is gone; resolving again must not duplicate.
        await resolveToolRegistries();
        expect(allToolRegistries.filter((r) => r === registry)).toHaveLength(1);
    });

    it("makes a concurrent caller wait for the in-flight load instead of returning early", async () => {
        const registry = makeRegistry("race_tool");
        added.push(registry);
        let release: (r: ToolRegistry) => void = () => {};
        registerToolRegistryLoader(() => new Promise((resolve) => {
            release = resolve;
        }));

        // The first call drains the queue and blocks on the loader; the second
        // arrives while the queue is already empty — the shape of two
        // overlapping first-use chat/MCP requests.
        const first = resolveToolRegistries();
        const second = resolveToolRegistries();

        let secondSettled = false;
        void second.then(() => {
            secondSettled = true;
        });
        await new Promise((r) => setTimeout(r, 10));
        expect(secondSettled).toBe(false);
        expect(allToolRegistries).not.toContain(registry);

        release(registry);
        await Promise.all([first, second]);
        expect(allToolRegistries).toContain(registry);
    });

    it("picks up a loader registered after an earlier resolve completed", async () => {
        const early = makeRegistry("early_tool");
        const late = makeRegistry("late_tool");
        added.push(early, late);

        registerToolRegistryLoader(async () => early);
        await resolveToolRegistries();

        registerToolRegistryLoader(async () => late);
        await resolveToolRegistries();

        expect(allToolRegistries).toContain(early);
        expect(allToolRegistries).toContain(late);
    });
});
