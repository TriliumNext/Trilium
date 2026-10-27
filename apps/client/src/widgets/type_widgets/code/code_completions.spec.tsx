import { EditorSelection } from "@codemirror/state";
import VanillaCodeMirror, { type TypeCompletionEntry } from "@triliumnext/codemirror";
import { afterEach, describe, expect, it, vi } from "vitest";

import { codeCompletionAt, codeCompletions } from "./code_completions";
import type { CodeSnippet } from "./snippets";

describe("codeCompletionAt", () => {
    it("matches a /command where there are snippets, and an identifier or a member where there are type completions", () => {
        const both = { snippets: true, types: true };
        expect(codeCompletionAt("x = /hea", false, both)).toEqual({ kind: "snippets", from: 4, query: "hea" });
        expect(codeCompletionAt("a/b", false, both)).toMatchObject({ kind: "types", from: 2, query: "b" });
        expect(codeCompletionAt("/hea", false, { snippets: false, types: false })).toBe(null);

        expect(codeCompletionAt("const x = api.get", false, both)).toMatchObject({ kind: "types", from: 14, query: "get" });
        expect(codeCompletionAt("api.", false, both)).toMatchObject({ kind: "types", from: 4, query: "" });
        expect(codeCompletionAt("x = ", false, both)).toBe(null);
        expect(codeCompletionAt("x = ", true, both)).toEqual({ kind: "types", from: 4, query: "" });
        expect(codeCompletionAt("x = 12", false, both)).toBe(null);
        expect(codeCompletionAt("api.get", false, { snippets: true, types: false })).toBe(null);
    });
});

describe("codeCompletions", () => {
    let editor: VanillaCodeMirror | undefined;

    afterEach(() => {
        editor?.destroy();
        editor = undefined;
    });

    it("lists the type completions with the icon of their kind, asking the language service once per place", async () => {
        const completions: TypeCompletionEntry[] = [
            { label: "getNote", type: "method" },
            { label: "getNotes", type: "method" },
            { label: "log", type: "function" },
            { label: "dayjs" }
        ];
        const view = build([]);
        vi.spyOn(view, "hasTypeCompletions").mockReturnValue(true);
        const lookUp = vi.spyOn(view, "getTypeCompletions").mockResolvedValue(completions);

        type("api.");
        await vi.waitFor(() => expect(rows()).toEqual([ "getNote", "getNotes", "log", "dayjs" ]));
        expect(document.querySelector(".slash-command-menu [role=option] .bx-math")).not.toBe(null);
        expect(document.querySelector(".slash-command-menu [role=option] .bx-code-alt")).not.toBe(null);

        type("getN");
        await vi.waitFor(() => expect(rows()).toEqual([ "getNote", "getNotes" ]));
        expect(lookUp).toHaveBeenCalledOnce();

        await press("ArrowDown");
        await press("Enter");
        await vi.waitFor(() => expect(view.getText()).toBe("api.getNotes"));
    });

    it("asks the language service again for a member at the same column of another expression", async () => {
        const view = build([]);
        vi.spyOn(view, "hasTypeCompletions").mockReturnValue(true);
        const lookUp = vi.spyOn(view, "getTypeCompletions")
            .mockResolvedValueOnce([ { label: "log" } ])
            .mockResolvedValueOnce([ { label: "size" } ]);

        type("api.");
        await vi.waitFor(() => expect(rows()).toEqual([ "log" ]));

        type("log(\"x\");\nobj.");
        await vi.waitFor(() => expect(rows()).toEqual([ "size" ]));
        expect(lookUp).toHaveBeenCalledTimes(2);
    });

    it("lists the snippets after a /, and puts the content of the one picked in place of the command", async () => {
        const view = build([ { noteId: "s1", title: "Header", description: "Page header", content: "// header\n" } ]);

        type("x;\n/hea");
        await vi.waitFor(() => expect(rows()).toEqual([ "HeaderPage header" ]));
        await press("Enter");
        await vi.waitFor(() => expect(view.getText()).toBe("x;\n// header\n"));
    });

    it("opens as an identifier is typed, not as the caret moves onto one", async () => {
        const view = build([]);
        type("return x");
        vi.spyOn(view, "hasTypeCompletions").mockReturnValue(true);
        const lookUp = vi.spyOn(view, "getTypeCompletions").mockResolvedValue([ { label: "returns" } ]);

        view.dispatch({ selection: EditorSelection.cursor(6) });
        await press("Shift");
        expect(lookUp).not.toHaveBeenCalled();

        type("s");
        await vi.waitFor(() => expect(lookUp).toHaveBeenCalledOnce());
    });

    it("offers nothing in a read-only editor", async () => {
        const view = build([ { noteId: "s1", title: "Header", content: "// header\n" } ], true);
        vi.spyOn(view, "hasTypeCompletions").mockReturnValue(true);
        const lookUp = vi.spyOn(view, "getTypeCompletions");

        view.dispatch({ changes: { from: 0, insert: "/hea api." }, selection: EditorSelection.cursor(9) });
        await press(" ", { ctrlKey: true });
        expect(lookUp).not.toHaveBeenCalled();
    });

    function build(snippets: CodeSnippet[], readOnly = false) {
        const parent = document.createElement("div");
        document.body.append(parent);
        const view = new VanillaCodeMirror({ parent, readOnly });
        view.setNamedExtension("codeCompletions", codeCompletions(view, () => snippets));
        view.focus();
        editor = view;
        return view;
    }

    function type(inserted: string) {
        if (!editor) throw new Error("expected an editor");
        const at = editor.state.selection.main.head;
        editor.dispatch({ changes: { from: at, insert: inserted }, selection: EditorSelection.cursor(at + inserted.length) });
    }

    /** Presses a key, and lets the list render what it did before the next one. */
    async function press(key: string, init: KeyboardEventInit = {}) {
        editor?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
});

function rows() {
    return [ ...document.querySelectorAll(".slash-command-menu [role=option]") ].map((row) => row.textContent ?? "");
}
