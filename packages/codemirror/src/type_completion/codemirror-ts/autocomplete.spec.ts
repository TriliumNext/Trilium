import type { VirtualTypeScriptEnvironment } from "@typescript/vfs";
import type ts from "typescript";
import { describe, expect, it } from "vitest";

import { getAutocompletion } from "./autocomplete.js";

/** An environment whose language service answers every position with `info`. */
function answering(info: Partial<ts.CompletionInfo> | undefined) {
    return {
        languageService: { getCompletionsAtPosition: () => info }
    } as unknown as VirtualTypeScriptEnvironment;
}

function entry(name: string, kind: string, sortText: string, kindModifiers?: string) {
    return { name, kind, sortText, kindModifiers } as ts.CompletionEntry;
}

describe("getAutocompletion", () => {
    it("maps the language service's entries to completions, leaving out warnings and deprecated ones", async () => {
        const completions = await getAutocompletion({
            env: answering({
                entries: [
                    entry("getNote", "method", "11", ""),
                    entry("noteId", "member", "11", ""),
                    entry("Note", "alias", "15", ""),
                    entry("untyped", "", "15", ""),
                    entry("unranked", "var", "not a number"),
                    entry("typo", "warning", "15", ""),
                    entry("escape", "function", "15", "deprecated,declare")
                ]
            }),
            path: "/script.js",
            pos: 0
        });

        expect(completions).toEqual([
            { label: "getNote", type: "method", boost: -11 },
            { label: "noteId", type: "property", boost: -11 },
            { label: "Note", type: undefined, boost: -15 },
            { label: "untyped", type: undefined, boost: -15 },
            { label: "unranked", type: undefined, boost: 0 }
        ]);
    });

    it("offers nothing where the language service has nothing", async () => {
        expect(await getAutocompletion({ env: answering(undefined), path: "/script.js", pos: 0 })).toBe(null);
    });
});
