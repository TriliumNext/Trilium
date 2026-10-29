import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import appContext from "../../../components/app_context";
import noteCreate from "../../../services/note_create";
import { createChildNote, insertChildNote, openChildNote } from "./child_note";

describe("child notes", () => {
    const editor = { execute: vi.fn() };
    const parent = (ntxId: string) => ({ notePath: "root/parent", isProtected: true, ntxId });
    const insert = (ntxId: string) =>
        insertChildNote(editor as unknown as CKTextEditor, parent(ntxId));
    let createNote: MockInstance<typeof noteCreate.createNote>;
    let triggerCommand: MockInstance<typeof appContext.triggerCommand>;

    beforeEach(() => {
        editor.execute.mockClear();
        createNote = vi.spyOn(noteCreate, "createNote")
            .mockResolvedValue({ note: { noteId: "child" }, branch: null } as never);
        triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("links to a new child note and opens it to be named, nested in a popup", async () => {
        await insert("ntx-1");

        expect(createNote).toHaveBeenCalledExactlyOnceWith("root/parent", {
            title: undefined, activate: false, isProtected: true
        });
        expect(editor.execute)
            .toHaveBeenCalledExactlyOnceWith("referenceLink", { href: "#root/parent/child" });
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("openInPopup", {
            noteIdOrPath: "root/parent/child", showNoteTypeSwitcher: true, selectTitle: true
        });

        await insert("_popup-editor");
        expect(triggerCommand).toHaveBeenLastCalledWith(
            "openInNestedPopup", expect.objectContaining({ noteIdOrPath: "root/parent/child" })
        );
    });

    it("links and opens nothing when the note is not created", async () => {
        createNote.mockResolvedValue({ note: null, branch: undefined } as never);

        await insert("ntx-1");

        expect(editor.execute).not.toHaveBeenCalled();
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("creates a named child note, and opens it on its content", async () => {
        expect(await createChildNote(parent("ntx-1"), "Named")).toBe("root/parent/child");
        expect(createNote).toHaveBeenCalledExactlyOnceWith("root/parent", {
            title: "Named", activate: false, isProtected: true
        });

        openChildNote("root/parent/child", parent("ntx-1"), { selectTitle: false });
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("openInPopup", {
            noteIdOrPath: "root/parent/child", showNoteTypeSwitcher: true, selectTitle: false
        });
    });
});
