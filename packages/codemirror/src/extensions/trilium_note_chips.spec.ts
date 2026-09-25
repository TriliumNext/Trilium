import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFieldEditor, type FieldEditor } from "../field_editor.js";
import { type NoteChip, type NoteChipResolver, triliumNoteChips } from "./trilium_note_chips.js";

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

function build(doc: string, resolve: NoteChipResolver, extensions: Extension[] = []) {
    editor?.destroy();

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    editor = createFieldEditor({ parent, doc, extensions: [ triliumNoteChips(resolve), ...extensions ] });

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
