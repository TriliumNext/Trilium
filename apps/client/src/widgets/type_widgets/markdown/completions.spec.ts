import type { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import type { MimeType } from "@triliumnext/commons";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import mime_types from "../../../services/mime_types.js";
import type { TypeWidgetProps } from "../type_widget";
import { buildCodeFenceOptions, buildTaskItemInsert, codeFenceCompletionSource, isClosingFence, parseCodeFencePrefix, useSlashCommands } from "./completions.js";

// The hook's two asynchronous sources of menu entries, stubbed so mounting it needs no server.
vi.mock("../code/snippets", async (importOriginal) => ({
    ...await importOriginal<typeof import("../code/snippets")>(),
    useCodeSnippets: () => ({ current: [] })
}));
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: () => Promise.resolve([]) }));

describe("buildTaskItemInsert", () => {
    it("prepends a bullet when not already in a list item", () => {
        expect(buildTaskItemInsert(" ", false)).toBe("- [ ] ");
        expect(buildTaskItemInsert("x", false)).toBe("- [x] ");
        expect(buildTaskItemInsert("/", false)).toBe("- [/] ");
    });

    it("reuses an existing '- ' bullet to avoid a doubled marker", () => {
        expect(buildTaskItemInsert(" ", true)).toBe("[ ] ");
        expect(buildTaskItemInsert("x", true)).toBe("[x] ");
        expect(buildTaskItemInsert("/", true)).toBe("[/] ");
    });
});

describe("parseCodeFencePrefix", () => {
    it("matches a bare fence opener", () => {
        expect(parseCodeFencePrefix("```")).toEqual({ langStart: 3, typed: "" });
    });

    it("captures the partial language token after the backticks", () => {
        expect(parseCodeFencePrefix("```js")).toEqual({ langStart: 3, typed: "js" });
        expect(parseCodeFencePrefix("```c++")).toEqual({ langStart: 3, typed: "c++" });
    });

    it("accounts for leading indentation in langStart", () => {
        expect(parseCodeFencePrefix("    ```py")).toEqual({ langStart: 7, typed: "py" });
    });

    it("handles fences longer than three backticks", () => {
        expect(parseCodeFencePrefix("`````")).toEqual({ langStart: 5, typed: "" });
    });

    it("rejects non-fence text", () => {
        expect(parseCodeFencePrefix("``")).toBeNull();           // too few backticks
        expect(parseCodeFencePrefix("text ```js")).toBeNull();   // not at line start
        expect(parseCodeFencePrefix("```js ")).toBeNull();       // language already finished (trailing space)
    });
});

describe("isClosingFence", () => {
    function lineStart(doc: string, lineNumber: number): number {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return state.doc.line(lineNumber).from;
    }

    function check(doc: string, lineNumber: number): boolean {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return isClosingFence(state, state.doc.line(lineNumber).from);
    }

    it("treats the first fence line of a block as an opener", () => {
        expect(check("```js\ncode\n```", 1)).toBe(false);
    });

    it("treats the terminating fence line as a closer", () => {
        expect(check("```js\ncode\n```", 3)).toBe(true);
    });

    it("treats a new fence after a closed block as an opener", () => {
        // The second block's opener must still offer completions.
        expect(check("```js\ncode\n```\n\n```py\nmore\n```", 5)).toBe(false);
    });

    it("does not flag a plain line as a closing fence", () => {
        expect(check("just a paragraph", 1)).toBe(false);
        // Referencing lineStart keeps the helper used and documents the offset math.
        expect(lineStart("```js\ncode\n```", 3)).toBe(11);
    });
});

describe("buildCodeFenceOptions", () => {
    afterEach(() => vi.restoreAllMocks());

    const mime = (over: Partial<MimeType>): MimeType => ({
        title: "T", mime: "text/x", enabled: true, mdLanguageCode: "x", ...over
    } as MimeType);

    it("emits one option per enabled language, skipping disabled, code-less and duplicate entries", () => {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue([
            mime({ mdLanguageCode: "js", title: "JavaScript" }),
            mime({ mdLanguageCode: "py", title: "Python", enabled: false }),  // disabled → skipped
            mime({ mdLanguageCode: undefined, title: "No code" }),            // no language code → skipped
            mime({ mdLanguageCode: "js", title: "JS again" })                 // duplicate code → skipped
        ]);

        expect(buildCodeFenceOptions()).toEqual([{ label: "js", detail: "JavaScript" }]);
    });
});

describe("codeFenceCompletionSource", () => {
    afterEach(() => vi.restoreAllMocks());

    function context(doc: string, pos: number): CompletionContext {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return { state, pos } as CompletionContext;
    }

    function withLanguages(...codes: string[]) {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue(
            codes.map((code) => ({ title: code, mime: `text/${code}`, enabled: true, mdLanguageCode: code }) as MimeType)
        );
    }

    it("offers the enabled languages right after a fence opener, anchored at the language token", () => {
        withLanguages("js", "py");
        const result = codeFenceCompletionSource(context("```", 3));
        expect(result?.from).toBe(3); // line.from (0) + langStart (3)
        expect(result?.options.map((o) => o.label)).toEqual([ "js", "py" ]);
    });

    it("returns null when the line is not a fence opener", () => {
        withLanguages("js");
        expect(codeFenceCompletionSource(context("plain text", 5))).toBeNull();
    });

    it("returns null on a closing fence, so only openers get language completions", () => {
        withLanguages("js");
        // Cursor on the terminating ``` of `\`\`\`js\ncode\n\`\`\`` — line 3 starts at offset 11.
        expect(codeFenceCompletionSource(context("```js\ncode\n```", 14))).toBeNull();
    });

    it("returns null on a valid opener when no languages are enabled", () => {
        withLanguages(); // none enabled → no options
        expect(codeFenceCompletionSource(context("```", 3))).toBeNull();
    });
});

describe("useSlashCommands", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Mounts the hook against an editor that only records what it is asked to register. */
    function mount() {
        const setCompletionSource = vi.fn();
        const editorView = { setCompletionSource } as unknown as VanillaCodeMirror;

        function Probe() {
            useSlashCommands({} as TypeWidgetProps["parentComponent"], editorView, {} as FNote);
            return null;
        }

        act(() => render(h(Probe, {}), container));
        return setCompletionSource;
    }

    it("contributes both sources to the editor's shared aggregate", () => {
        const setCompletionSource = mount();

        expect(setCompletionSource.mock.calls.map(([ name ]) => name)).toEqual([ "slashCommands", "markdownCodeFence" ]);
        for (const [ , source ] of setCompletionSource.mock.calls) expect(source).toBeTypeOf("function");
    });

    it("withdraws both sources on unmount, so a later editor does not inherit them", () => {
        const setCompletionSource = mount();
        setCompletionSource.mockClear();

        act(() => render(null, container));

        expect(setCompletionSource.mock.calls).toEqual([ [ "slashCommands", null ], [ "markdownCodeFence", null ] ]);
    });
});
