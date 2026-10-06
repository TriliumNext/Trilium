import { h, render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { AttachmentEditor, NoteEditor } from "../../../services/content_renderer";
import { ParentComponent } from "../../react/react_utils";
import AttachmentSaves, { NoteSaves, useAttachmentEditor, useNoteEditor } from "./attachment_saves";

const serverPost = vi.hoisted(() => vi.fn(async () => undefined));
const serverPut = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../services/server", () => ({
    default: { get: async () => [], post: serverPost, put: serverPut }
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

describe("NoteSaves", () => {
    function buildCodeNote(noteId: string, overrides: Partial<FNote> = {}) {
        return { noteId, type: "code", isContentAvailable: () => true, ...overrides } as FNote;
    }

    it("edits the notes whose content is available, except the note that shows them", () => {
        const saves = new NoteSaves(vi.fn(), "host", () => "host1");

        expect(saves.canEdit(buildCodeNote("code1"))).toBe(true);
        expect(saves.canEdit(buildCodeNote("text1", { type: "text" }))).toBe(true);
        expect(saves.canEdit(buildCodeNote("host1", { type: "text" }))).toBe(false);
        expect(saves.canEdit(buildCodeNote("locked", { isContentAvailable: () => false })))
            .toBe(false);
    });

    it("collects each note with its content, and keeps a change made while a save runs", () => {
        const scheduleUpdate = vi.fn();
        const saves = new NoteSaves(scheduleUpdate, "host");
        const first = buildCodeNote("code1");
        const second = buildCodeNote("code2");

        saves.scheduleSave(first, () => "one");
        saves.scheduleSave(second, () => "two");
        const sent = saves.collect();
        expect(sent).toStrictEqual([
            { note: first, content: "one" },
            { note: second, content: "two" }
        ]);
        expect(scheduleUpdate).toHaveBeenCalledTimes(2);

        saves.scheduleSave(first, () => "changed meanwhile");
        saves.markSaved(sent);
        expect(saves.getUnsavedContent("code1")).toBe("changed meanwhile");
        expect(saves.getUnsavedContent("code2")).toBeUndefined();
    });

    it("keeps a change made while a retry of an earlier save runs", () => {
        const saves = new NoteSaves(vi.fn(), "host");
        const note = buildCodeNote("code1");
        saves.scheduleSave(note, () => "first");
        const sent = saves.collect();
        saves.markSaved(sent);

        // The batch is retried, as after another note of it failed, while the note changes.
        saves.scheduleSave(note, () => "typed during the retry");
        saves.markSaved(sent);
        expect(saves.getUnsavedContent("code1")).toBe("typed during the retry");
    });

    it("tracks the save state of each note, and tells its listeners", async () => {
        const saves = new NoteSaves(vi.fn(), "host");
        const listener = vi.fn();
        const unsubscribe = saves.subscribeSaveState(listener);
        const first = buildCodeNote("code1");
        const second = buildCodeNote("code2");
        expect(saves.getSaveState("code1")).toBeUndefined();

        saves.scheduleSave(first, () => "one");
        saves.scheduleSave(second, () => "two");
        expect(saves.getSaveState("code1")).toBe("unsaved");
        expect(listener).toHaveBeenCalled();

        const seen: [ string, string | undefined ][] = [];
        await expect(saves.save(saves.collect(), async ({ note }) => {
            seen.push([ note.noteId, saves.getSaveState(note.noteId) ]);
            if (note.noteId === "code2") throw new Error("offline");
        })).rejects.toThrow("offline");
        expect(seen).toStrictEqual([ [ "code1", "saving" ], [ "code2", "saving" ] ]);
        expect(saves.getSaveState("code1")).toBe("saved");
        expect(saves.getSaveState("code2")).toBe("error");
        expect(saves.getUnsavedContent("code1")).toBeUndefined();

        // A change made while the note saves keeps it unsaved.
        await saves.save(saves.collect(), async () => {
            saves.scheduleSave(second, () => "newer");
        });
        expect(saves.getSaveState("code2")).toBe("unsaved");

        unsubscribe();
        listener.mockClear();
        saves.scheduleSave(first, () => "changed");
        expect(listener).not.toHaveBeenCalled();
    });
});

describe("useNoteEditor", () => {
    const code = { noteId: "code1", type: "code", isProtected: false } as FNote;
    const noteContext = { ntxId: "ntx1", setContextData: vi.fn() } as unknown as NoteContext;

    let component: Component;
    let editor: NoteEditor | undefined;
    function Probe() {
        editor = useNoteEditor(noteContext);
        return null;
    }

    it("saves each note on its own, before the note switches and once it goes away", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });

        editor?.scheduleSave(code, () => "first");
        await act(async () => {
            await component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(serverPut).toHaveBeenCalledExactlyOnceWith(
            "notes/code1/data", { content: "first" }, component.componentId);
        expect(editor?.getUnsavedContent("code1")).toBeUndefined();
        // The embed of the note shows its save state, not the indicator of the host note.
        expect(editor?.getSaveState("code1")).toBe("saved");
        expect(noteContext.setContextData).not.toHaveBeenCalled();

        editor?.scheduleSave(code, () => "second");
        editor?.release("code1");
        await act(() => render(null, container));
        expect(serverPut).toHaveBeenCalledTimes(2);
        expect(serverPut).toHaveBeenLastCalledWith(
            "notes/code1/data", { content: "second" }, component.componentId);
    });
});
