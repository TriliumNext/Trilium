import type { ScriptModuleSummary } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import {
    buildScriptModuleCompletions,
    isScriptModuleChange,
    MODULE_SPECIFIER_REGEX,
    scriptRuntimeFor
} from "./script_modules.js";

describe("script module completions", () => {
    it("offers one completion per specifier, naming the versions behind it", () => {
        const completions = buildScriptModuleCompletions([
            module("dayjs", "dayjs@1.11.10"),
            module("@scope/pkg", "@scope/pkg@2.0.0"),
            // The same package as both builds is still one specifier.
            module("dayjs", "dayjs@1.11.10", "node"),
            module("cheerio", "cheerio@1.1.2")
        ], "backend");

        expect(completions.map((c) => c.label)).toEqual([ "@scope/pkg", "cheerio", "dayjs" ]);
        expect(completions.map((c) => c.detail)).toEqual([ "@scope/pkg@2.0.0", "cheerio@1.1.2", "dayjs@1.11.10" ]);
    });

    it("lists both versions where a package is installed more than once", () => {
        const completions = buildScriptModuleCompletions([
            module("dayjs", "dayjs@1.11.10"),
            module("dayjs", "dayjs@1.9.0")
        ], "backend");

        expect(completions).toHaveLength(1);
        expect(completions[0].detail).toBe("dayjs@1.11.10, dayjs@1.9.0");
    });

    it("keeps a package installed only for Node.js out of a frontend note's list", () => {
        const installed = [
            module("sqlite", "sqlite@5.1.1", "node"),
            module("dayjs", "dayjs@1.11.10", "node"),
            module("dayjs", "dayjs@1.11.10"),
            module("cheerio", "cheerio@1.1.2")
        ];

        expect(buildScriptModuleCompletions(installed, "frontend").map((c) => c.label))
            .toEqual([ "cheerio", "dayjs" ]);
        expect(buildScriptModuleCompletions(installed, "backend").map((c) => c.label))
            .toEqual([ "cheerio", "dayjs", "sqlite" ]);
    });

    it("matches the specifier being typed, in either of the forms a script names one by", () => {
        for (const [ line, typed ] of [
            [ `const x = require("day`, "day" ],
            [ `require('`, "" ],
            [ `require( "@scope/pkg`, "@scope/pkg" ],
            [ `require("dayjs/plugin/utc`, "dayjs/plugin/utc" ],
            // A JSX render note writes an import instead.
            [ `import dayjs from "day`, "day" ],
            [ `import { load } from 'cheer`, "cheer" ],
            [ `import "side-eff`, "side-eff" ],
            [ `const x = await import("day`, "day" ]
        ]) {
            expect(MODULE_SPECIFIER_REGEX.exec(line)?.[1]).toBe(typed);
        }

        // Outside a specifier, and once the string is closed, there is nothing to complete.
        expect(MODULE_SPECIFIER_REGEX.test(`const x = "day`)).toBe(false);
        expect(MODULE_SPECIFIER_REGEX.exec(`require("dayjs") + "`)?.[1]).toBe("dayjs");
    });

    it("reads the runtime off the MIME type, and answers nothing for a note that is not a script", () => {
        expect(scriptRuntimeFor("application/javascript;env=backend")).toBe("backend");
        expect(scriptRuntimeFor("application/javascript;env=frontend")).toBe("frontend");
        expect(scriptRuntimeFor("text/jsx")).toBe("frontend");
        expect(scriptRuntimeFor("text/x-markdown")).toBeNull();
        expect(scriptRuntimeFor(undefined)).toBeNull();
    });

    it("reloads only when a package is installed or removed", () => {
        expect(isScriptModuleChange(loadResults([ "_scriptModules" ]))).toBe(true);
        expect(isScriptModuleChange(loadResults([ "root", "_hidden" ]))).toBe(false);
        expect(isScriptModuleChange(loadResults([]))).toBe(false);
    });
});

function module(name: string, spec: string, target: ScriptModuleSummary["target"] = "portable"): ScriptModuleSummary {
    return {
        noteId: `note_${spec}_${target}`,
        spec,
        name,
        target,
        providerId: "esm.sh",
        fileCount: 1,
        size: 100,
        dateModified: "2026-08-25 00:00:00.000Z"
    };
}

function loadResults(parentNoteIds: string[]) {
    return {
        getBranchRows: () => parentNoteIds.map((parentNoteId) => ({ parentNoteId }))
    } as unknown as Parameters<typeof isScriptModuleChange>[0];
}
