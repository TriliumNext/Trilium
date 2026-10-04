import { h, render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor } from "../../../services/content_renderer";
import { ParentComponent } from "../../react/react_utils";
import AttachmentSaves, { useAttachmentEditor } from "./attachment_saves";

const serverPost = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../services/server", () => ({
    default: { get: async () => [], post: serverPost }
}));

const drawing = {
    attachmentId: "drawing1",
    ownerId: "note1",
    role: "file",
    mime: "application/vnd.excalidraw+json",
    title: "Canvas.excalidraw"
} as FAttachment;

function setUp() {
    const scheduleUpdate = vi.fn();
    const saves = new AttachmentSaves(scheduleUpdate);
    saves.setNoteId("note1");
    return { saves, scheduleUpdate };
}

describe("AttachmentSaves", () => {
    it("edits only the attachments of the note it saves", () => {
        const { saves } = setUp();

        expect(saves.canEdit(drawing)).toBe(true);
        expect(saves.canEdit({ ...drawing, ownerId: "note2" } as FAttachment)).toBe(false);

        saves.setNoteId(undefined);
        expect(saves.canEdit(drawing)).toBe(false);
    });

    it("schedules a save and reads the content when the note saves", () => {
        const { saves, scheduleUpdate } = setUp();
        let content = "first";

        saves.scheduleSave(drawing, () => content);
        content = "second";

        expect(scheduleUpdate).toHaveBeenCalledOnce();
        expect(saves.getUnsavedContent("drawing1")).toBe("second");
        expect(saves.collect()).toStrictEqual([ {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content: "second"
        } ]);
    });

    it("keeps a change made while a save runs", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "saved");
        const sent = saves.collect();

        saves.scheduleSave(drawing, () => "changed meanwhile");
        saves.markSaved(sent);
        expect(saves.getUnsavedContent("drawing1")).toBe("changed meanwhile");

        saves.markSaved(saves.collect());
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
        expect(saves.collect()).toStrictEqual([]);
    });

    it("ignores a save of other data", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "unsaved");

        saves.markSaved(undefined);
        saves.markSaved([ { role: "image", title: "x", mime: "image/png", content: "" } ]);

        expect(saves.getUnsavedContent("drawing1")).toBe("unsaved");
    });

    it("reads the content of a released editor once, and keeps it until the note saves", () => {
        const { saves } = setUp();
        const getContent = vi.fn(() => "last state");
        saves.scheduleSave(drawing, getContent);

        saves.release("drawing1");
        saves.release("unknown");

        expect(getContent).toHaveBeenCalledOnce();
        expect(saves.getUnsavedContent("drawing1")).toBe("last state");
        expect(saves.collect()[0].content).toBe("last state");
        expect(getContent).toHaveBeenCalledOnce();
    });

    it("drops the changes when it saves another note", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "unsaved");

        saves.setNoteId("note1");
        expect(saves.getUnsavedContent("drawing1")).toBe("unsaved");

        saves.setNoteId("note2");
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
    });
});

describe("useAttachmentEditor", () => {
    const note = { noteId: "note1", isProtected: false } as FNote;
    const noteContext = { ntxId: "ntx1", setContextData: vi.fn() } as unknown as NoteContext;

    function savedRequest(content: string) {
        return [ "notes/note1/attachments", {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content
        }, component.componentId ];
    }

    let component: Component;
    let editor: AttachmentEditor | undefined;
    function Probe() {
        editor = useAttachmentEditor(note, noteContext);
        return null;
    }

    it("saves on its own before the note switches, and once the content goes away", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        expect(editor?.canEdit(drawing)).toBe(true);

        editor?.scheduleSave(drawing, () => "first");
        await act(async () => {
            await component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(serverPost).toHaveBeenCalledExactlyOnceWith(...savedRequest("first"));
        expect(editor?.getUnsavedContent("drawing1")).toBeUndefined();
        expect(noteContext.setContextData).toHaveBeenLastCalledWith("saveState", { state: "saved" });

        editor?.scheduleSave(drawing, () => "second");
        editor?.release("drawing1");
        // Sent at once, not once the timer of the spaced update runs out.
        await act(() => render(null, container));
        expect(serverPost).toHaveBeenCalledTimes(2);
        expect(serverPost).toHaveBeenLastCalledWith(...savedRequest("second"));
    });
});
