import { describe, expect, it } from "vitest";

import { requireHostModule } from "./host_require.js";

describe("requireHostModule", () => {
    it("loads a module the host has", () => {
        expect(requireHostModule("node:querystring")).toBeDefined();
    });

    it("says a module is missing without reciting Trilium's own module graph", () => {
        let message = "";
        try {
            requireHostModule("axioss");
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }

        expect(message).toContain("Module 'axioss' could not be loaded");
        expect(message).toContain("Install it from Script modules");
        // The name a script wrote is what went wrong; Node's answer is a page of Trilium internals.
        expect(message).not.toContain("Require stack");
        expect(message).not.toContain("Cannot find module");
        expect(message).not.toContain("trilium-core");
    });

    it("keeps the cause, so what the host said is still there for a log", () => {
        try {
            requireHostModule("axioss");
            expect.unreachable("should have thrown");
        } catch (e) {
            expect((e as Error).cause).toBeInstanceOf(Error);
            expect(String(((e as Error).cause as Error).message)).toContain("Cannot find module");
        }
    });

    it("refuses a blocked built-in however it is spelled", () => {
        for (const blocked of [ "fs", "node:fs", "fs/promises", "child_process" ]) {
            expect(() => requireHostModule(blocked), blocked).toThrow(/blocked for security/);
        }
    });

    it("waives the blocklist for a build that was installed to use it", () => {
        expect(requireHostModule("node:path", { allowBlocked: true })).toBeDefined();
    });
});
