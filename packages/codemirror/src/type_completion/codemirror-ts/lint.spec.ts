import { diagnosticCount, forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createEnv, SCRIPT_MIME_BACKEND, scriptPath } from "../index.js";
import { tsCategoryToSeverity, tsLinter } from "./lint.js";

// Loading TypeScript and the bundled lib.*.d.ts the first time is not instant.
const TIMEOUT = 30_000;

describe("tsLinter", () => {
    it("underlines the script's diagnostics in the editor, minus the ignored codes", async () => {
        const env = await createEnv(SCRIPT_MIME_BACKEND);
        const path = scriptPath(SCRIPT_MIME_BACKEND);
        const doc = "const count = 1;\ncount.toUpperCase();\nreturn;";
        env.updateFile(path, doc);
        // TS1108, a top-level `return`, is valid in a script note's function wrapper.
        const view = new EditorView({
            state: EditorState.create({ doc, extensions: tsLinter({ env, path, diagnosticCodesToIgnore: [ 1108 ] }) })
        });

        forceLinting(view);
        await expect.poll(() => diagnosticCount(view.state)).toBe(1);
        forEachDiagnostic(view.state, (diagnostic, from, to) => {
            expect(doc.slice(from, to)).toBe("toUpperCase");
            expect(diagnostic.severity).toBe("error");
        });
        view.destroy();
    }, TIMEOUT);
});

describe("tsCategoryToSeverity", () => {
    it("maps TypeScript's categories to CodeMirror's, and unreachable code to a warning", () => {
        const severity = (category: ts.DiagnosticCategory, code = 2322) => tsCategoryToSeverity({ category, code });

        expect(severity(ts.DiagnosticCategory.Error)).toBe("error");
        expect(severity(ts.DiagnosticCategory.Warning)).toBe("warning");
        expect(severity(ts.DiagnosticCategory.Message)).toBe("info");
        expect(severity(ts.DiagnosticCategory.Suggestion)).toBe("info");
        expect(severity(ts.DiagnosticCategory.Error, 7027)).toBe("warning");
    });
});
