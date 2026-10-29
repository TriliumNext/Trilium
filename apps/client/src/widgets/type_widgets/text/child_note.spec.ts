import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import appContext from "../../../components/app_context";
import noteCreate from "../../../services/note_create";
import {
    buildChildNoteHost, type ChildNoteParent, createChildNote, openChildNote
} from "./child_note";

describe("child notes", () => {
    const parent = (ntxId: string) => ({ notePath: "root/parent", isProtected: true, ntxId });
    let createNote: MockInstance<typeof noteCreate.createNote>;
    let triggerCommand: MockInstance<typeof appContext.triggerCommand>;

    beforeEach(() => {
        createNote = vi.spyOn(noteCreate, "createNote")
            .mockResolvedValue({ note: { noteId: "child" }, branch: null } as never);
        triggerCommand = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("creates an untitled child of the open note, and opens it to be named", async () => {
        let openParent: ChildNoteParent | undefined = parent("ntx-1");
        const host = buildChildNoteHost(() => openParent);

        expect(await host.create()).toBe("root/parent/child");
        expect(createNote).toHaveBeenCalledExactlyOnceWith("root/parent", {
            title: undefined, activate: false, isProtected: true
        });

        host.open("root/parent/child");
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("openInPopup", {
            noteIdOrPath: "root/parent/child", showNoteTypeSwitcher: true, selectTitle: true
        });

        openParent = parent("_popup-editor");
        host.open("root/parent/child");
        expect(triggerCommand).toHaveBeenLastCalledWith(
            "openInNestedPopup", expect.objectContaining({ noteIdOrPath: "root/parent/child" })
        );

        openParent = undefined;
        expect(await host.create()).toBeUndefined();
        expect(createNote).toHaveBeenCalledOnce();
    });

    it("resolves to no path when the note is not created", async () => {
        createNote.mockResolvedValue({ note: null, branch: undefined } as never);

        expect(await buildChildNoteHost(() => parent("ntx-1")).create()).toBeUndefined();
    });

    it("creates a named child note, and opens it on its content", async () => {
        expect(await createChildNote(parent("ntx-1"), "Named")).toBe("root/parent/child");
        expect(createNote).toHaveBeenCalledExactlyOnceWith("root/parent", {
            title: "Named", activate: false, isProtected: true
        });

        openChildNote("root/parent/child", "ntx-1", { selectTitle: false });
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("openInPopup", {
            noteIdOrPath: "root/parent/child", showNoteTypeSwitcher: true, selectTitle: false
        });
    });
});
