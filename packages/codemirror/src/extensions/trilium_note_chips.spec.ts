import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFieldEditor, type FieldEditor } from "../field_editor.js";
import { findWikilinkNoteIds, type NoteChip, type NoteChipOptions, type NoteChipResolver, triliumNoteChips } from "./trilium_note_chips.js";

let editor: FieldEditor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

const TOLKIEN: NoteChip = { title: "Tolkien", icon: "bx bx-user" };

describe("triliumNoteChips", () => {
    it("draws a resolved id as a chip without changing what the query holds", () => {
        const parent = build("~author.noteId = abc123", () => TOLKIEN);

        const chip = parent.querySelector(".cm-note-chip");
        expect(chip?.textContent).toBe("Tolkien");
        expect(chip?.getAttribute("title")).toBe("abc123");
        expect(chip?.querySelector(".cm-note-chip-icon")?.className).toContain("bx bx-user");

        // The chip stands over the id; the query is still run with the id itself.
        expect(editor?.state.doc.toString()).toBe("~author.noteId = abc123");
        expect(parent.textContent).not.toContain("abc123");
    });

    it("steps the caret over a chip rather than into it", () => {
        const view = editorFor(build("~author.noteId = abc123", () => TOLKIEN));
        const idStart = "~author.noteId = ".length;

        view.dispatch({ selection: EditorSelection.cursor(idStart) });
        view.dispatch({ selection: view.moveByChar(view.state.selection.main, true) });

        // A character step from the chip's near edge lands past its far edge, not inside it.
        expect(view.state.selection.main.head).toBe(view.state.doc.length);
    });

    it("leaves the id as text when it names no note, and asks only once", () => {
        const resolve = vi.fn<NoteChipResolver>(() => null);
        const parent = build("~author.noteId = gone", resolve);

        expect(parent.querySelector(".cm-note-chip")).toBe(null);
        expect(parent.textContent).toContain("gone");

        editorFor(parent).dispatch({ changes: { from: 0, insert: "#book " } });
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("draws the chip once a note asked for asynchronously arrives", async () => {
        const parent = build("~author.noteId = abc123", () => Promise.resolve(TOLKIEN));

        expect(parent.querySelector(".cm-note-chip")).toBe(null);

        await vi.waitFor(() => expect(parent.querySelector(".cm-note-chip")?.textContent).toBe("Tolkien"));
        expect(editor?.state.doc.toString()).toBe("~author.noteId = abc123");
    });

    it("asks for a note once while the answer is still on its way", async () => {
        let answer = (chip: NoteChip) => { void chip; };
        const resolve = vi.fn<NoteChipResolver>(() => new Promise<NoteChip>((settle) => { answer = settle; }));
        const parent = build("~author.noteId = abc123", resolve);

        // The rebuild this edit triggers waits on the answer already asked for.
        editorFor(parent).dispatch({ changes: { from: 0, insert: "#book " } });
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(parent.querySelector(".cm-note-chip")).toBe(null);

        answer(TOLKIEN);
        await vi.waitFor(() => expect(parent.querySelector(".cm-note-chip")?.textContent).toBe("Tolkien"));
    });

    it("leaves the id as text when looking the note up fails", async () => {
        const redrawn = vi.fn();
        const resolve = vi.fn<NoteChipResolver>(() => Promise.reject(new Error("offline")));
        const parent = build("~author.noteId = abc123", resolve, [ EditorView.updateListener.of(redrawn) ]);

        // The failure redraws the field rather than reaching the editor as an unhandled rejection.
        await vi.waitFor(() => expect(redrawn).toHaveBeenCalled());
        expect(parent.querySelector(".cm-note-chip")).toBe(null);
        expect(parent.textContent).toContain("abc123");
        // Recorded the way a missing note is, so the redraw asks nothing more.
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("asks only once for a missing note whose lookup settles to undefined", async () => {
        const redrawn = vi.fn();
        const resolve = vi.fn(() => Promise.resolve(undefined)) as unknown as NoteChipResolver;
        const parent = build("~author.noteId = gone", resolve, [ EditorView.updateListener.of(redrawn) ]);

        await vi.waitFor(() => expect(redrawn).toHaveBeenCalled());
        await new Promise((settle) => setTimeout(settle, 20));
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(parent.textContent).toContain("gone");
    });

    it("keeps a drawn chip across an edit elsewhere in the query", () => {
        const parent = build("~author.noteId = abc123", () => TOLKIEN);
        const chip = parent.querySelector(".cm-note-chip");
        expect(chip).not.toBe(null);

        editorFor(parent).dispatch({ changes: { from: editorFor(parent).state.doc.length, insert: " #book" } });

        // The rebuilt widget equals the one already drawn, so its element is reused rather than replaced.
        expect(parent.querySelector(".cm-note-chip")).toBe(chip);
    });

    it("keeps the field usable when the resolver throws", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
            const view = editorFor(build("~author.noteId = abc123", () => { throw new Error("offline"); }));
            view.dispatch({ selection: EditorSelection.cursor(0) });

            // No chip and no atomic range to step over, so the caret moves a character at a time.
            expect(view.moveByChar(view.state.selection.main, true).head).toBe(1);
            expect(parentOf(view).querySelector(".cm-note-chip")).toBe(null);
            expect(logged).toHaveBeenCalled();
        } finally {
            logged.mockRestore();
        }
    });

    it("reads only a noteId comparison, leaving id-shaped words of the query alone", () => {
        const resolve = vi.fn<NoteChipResolver>(() => TOLKIEN);
        const parent = build("abc123 #book = abc123 ~author.title = abc123", resolve);

        expect(parent.querySelectorAll(".cm-note-chip").length).toBe(0);
        expect(resolve).not.toHaveBeenCalled();

        // Quoted or not, the value of a `noteId` comparison is one.
        expect(build(`note.noteId = "abc123"`, resolve).querySelectorAll(".cm-note-chip").length).toBe(1);
    });
});

describe("triliumNoteChips over Markdown's note links", () => {
    const WIKILINKS: NoteChipOptions = { find: findWikilinkNoteIds, revealAtSelection: true };

    /** A Markdown editor over `doc`, its syntax tree parsed, the caret at `caret`. */
    function buildMarkdown(doc: string, caret = 0) {
        const parent = build(doc, () => TOLKIEN, [ markdown() ], WIKILINKS);
        const view = editorFor(parent);
        ensureSyntaxTree(view.state, doc.length);
        view.dispatch({ selection: EditorSelection.cursor(caret) });
        return { parent, view };
    }

    it("draws each link as one chip, leaving the text and the links in code alone", () => {
        const { parent, view } = buildMarkdown("See [[abc123]] and `[[code1]]`, or [[ bad ]].\n\n```\n[[block1]]\n```");

        const chips = [ ...parent.querySelectorAll(".cm-note-chip") ];
        expect(chips.map((chip) => chip.getAttribute("title"))).toEqual([ "abc123" ]);
        expect(parent.textContent).toContain("See Tolkien and");
        expect(parent.textContent).not.toContain("[[abc123]]");
        expect(parent.textContent).toContain("[[code1]]");
        expect(parent.textContent).toContain("[[block1]]");
        expect(view.state.doc.toString()).toContain("[[abc123]]");
    });

    it("shows the link's text while the selection touches it, and lets the caret into it", () => {
        const { parent, view } = buildMarkdown("See [[abc123]] here", 0);
        expect(parent.querySelector(".cm-note-chip")).not.toBe(null);

        // At its edge, the link shows as text, and a step goes into it rather than over it.
        view.dispatch({ selection: EditorSelection.cursor(4) });
        expect(parent.querySelector(".cm-note-chip")).toBe(null);
        expect(parent.textContent).toContain("[[abc123]]");
        expect(view.moveByChar(view.state.selection.main, true).head).toBe(5);

        // A selection across it shows it too, and one away from it draws the chip again.
        view.dispatch({ selection: EditorSelection.range(0, 17) });
        expect(parent.querySelector(".cm-note-chip")).toBe(null);
        view.dispatch({ selection: EditorSelection.cursor(18) });
        expect(parent.querySelector(".cm-note-chip")?.textContent).toBe("Tolkien");
    });
});

function build(doc: string, resolve: NoteChipResolver, extensions: Extension[] = [], options?: NoteChipOptions) {
    editor?.destroy();

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    editor = createFieldEditor({ parent, doc, extensions: [ ...extensions, triliumNoteChips(resolve, options) ] });

    return parent;
}

function editorFor(parent: HTMLElement): FieldEditor {
    if (!editor || !parent.contains(editor.dom)) {
        throw new Error("The editor was not built into this element.");
    }

    return editor;
}

function parentOf(view: FieldEditor): HTMLElement {
    const parent = view.dom.parentElement;
    if (!parent) {
        throw new Error("The editor was not built into an element.");
    }

    return parent;
}
