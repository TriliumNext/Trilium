import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import {
    type AttachmentEditor, bindAttachmentEditor, type NoteEditor
} from "../../../services/content_renderer";
import { recordReplacedBlob } from "../../../services/note_save";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { ParentComponent } from "../../react/react_utils";
import AttachmentSaves, {
    InlineSourceSaves, NoteSaves, useAttachmentEditor, useNoteEditor
} from "./attachment_saves";

const serverPost = vi.hoisted(() => vi.fn(async () => undefined));
const serverPut = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../services/server", () => ({
    default: {
        get: async () => [], post: serverPost, postWithSilentErrors: serverPost, put: serverPut
    }
}));

const frocaNotes = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock("../../../services/froca", () => ({ default: { notes: frocaNotes } }));

beforeEach(() => {
    vi.clearAllMocks();
    for (const noteId of [ "note1", "code1" ]) {
        frocaNotes[noteId] = {};
    }
});

const drawing = {
    attachmentId: "drawing1",
    ownerId: "note1",
    role: "file",
    mime: "application/vnd.excalidraw+json",
    title: "Canvas.excalidraw"
} as FAttachment;

function setUp() {
    const update = { scheduleUpdate: vi.fn(), resetUpdateTimer: vi.fn() };
    const saves = new AttachmentSaves(() => update);
    saves.setNoteId("note1");
    return { saves, update };
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
        const { saves, update } = setUp();
        let content = "first";

        saves.scheduleSave(drawing, () => content);
        content = "second";

        expect(update.scheduleUpdate).toHaveBeenCalledOnce();
        expect(saves.getUnsavedContent("drawing1")).toBe("second");
        expect(saves.collect()).toStrictEqual([ {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content: "second"
        } ]);
    });

    it("keeps the blob that the attachment had at the first change that is not saved", () => {
        const { saves } = setUp();

        saves.scheduleSave({ ...drawing, blobId: "read" } as FAttachment, () => "first");
        saves.scheduleSave({ ...drawing, blobId: "newer" } as FAttachment, () => "second");
        // Another split of this window saved its own drawing over the same blob.
        recordReplacedBlob("drawing1", "read", "theirs");
        expect(saves.collect()).toStrictEqual([ {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content: "second",
            blobId: "read"
        } ]);
    });

    it("postpones the save of the note, also through the editor of one attachment", () => {
        const { saves, update } = setUp();

        saves.postponeSave();
        bindAttachmentEditor(saves, drawing).postponeSave?.();

        expect(update.resetUpdateTimer).toHaveBeenCalledTimes(2);
        expect(update.scheduleUpdate).not.toHaveBeenCalled();
    });

    it("keeps a change made while a save runs, and reports only the last change saved", () => {
        const { saves } = setUp();
        const onSaved = vi.fn();
        saves.scheduleSave(drawing, () => "saved", onSaved);
        const sent = saves.collect();

        saves.scheduleSave(drawing, () => "changed meanwhile", onSaved);
        saves.markSaved(sent);
        expect(saves.getUnsavedContent("drawing1")).toBe("changed meanwhile");
        expect(onSaved).not.toHaveBeenCalled();

        saves.markSaved(saves.collect());
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
        expect(saves.collect()).toStrictEqual([]);
        expect(onSaved.mock.calls).toStrictEqual([ [ "changed meanwhile" ] ]);
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

    it("drops the changes when it saves another note, and reports the last one saved after", () => {
        const { saves } = setUp();
        const onSaved = vi.fn();
        saves.scheduleSave(drawing, () => "first", onSaved);

        saves.setNoteId("note1");
        expect(saves.getUnsavedContent("drawing1")).toBe("first");

        // The previous note saves both changes in the background after the switch.
        const first = saves.collect();
        saves.scheduleSave(drawing, () => "second", onSaved);
        const second = saves.collect();
        saves.setNoteId("note2");
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();

        saves.markSaved(first);
        saves.markSaved(second);
        saves.markSaved(second);
        expect(onSaved.mock.calls).toStrictEqual([ [ "second" ] ]);
    });

    it("drops the changes that a revision keeps instead", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "discarded");

        saves.discard();
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
        expect(saves.collect()).toEqual([]);
        expect(saves.canEdit(drawing)).toBe(true);
    });

    it("drops the changes and tells its listeners once another version loads", () => {
        const { saves } = setUp();
        const listener = vi.fn();
        const unsubscribed = vi.fn();
        saves.subscribeVersionLoaded(listener);
        saves.subscribeVersionLoaded(unsubscribed)();
        saves.scheduleSave(drawing, () => "mine");

        saves.loadOtherVersion();
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
        expect(listener).toHaveBeenCalledOnce();
        expect(unsubscribed).not.toHaveBeenCalled();
    });
});

describe("useAttachmentEditor", () => {
    const note = { noteId: "note1", isProtected: false } as FNote;
    const noteContext = { ntxId: "ntx1", setContextData: vi.fn() } as unknown as NoteContext;

    function savedRequest(content: string, base: { blobId?: string; keepOther?: boolean } = {}) {
        return [ "notes/note1/attachments", {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content,
            ...base
        }, component.componentId, { silentConflict: true } ] as const;
    }

    let component: Component;
    let editor: AttachmentEditor | undefined;
    function Probe() {
        editor = useAttachmentEditor(note, noteContext);
        return null;
    }

    afterEach(() => {
        vi.useRealTimers();
    });

    it("saves on its own before the note switches, and once the content goes away", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        expect(editor?.canEdit(drawing)).toBe(true);
        // Its saves send this component ID, so a drawing can skip the changes they report.
        expect(editor?.componentId).toBe(component.componentId);
        expect(editor && bindAttachmentEditor(editor, drawing).componentId)
            .toBe(component.componentId);

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

    it("drops the changes to a note deleted before they save", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });

        editor?.scheduleSave(drawing, () => "first");
        delete frocaNotes.note1;
        await act(async () => {
            await component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(serverPost).not.toHaveBeenCalled();
        expect(editor?.getUnsavedContent("drawing1")).toBeUndefined();
        expect(noteContext.setContextData).toHaveBeenLastCalledWith("saveState", { state: "saved" });
        await act(() => render(null, container));
    });

    it("saves once the changes pause for a second, or 10 s after the first one", async () => {
        vi.useFakeTimers();
        serverPost.mockClear();
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        // A stroke every 400 ms, which the drawing reports as it ends.
        let strokes = 0;
        const write = async (count: number) => {
            for (let i = 0; i < count; i++) {
                const content = `stroke ${++strokes}`;
                editor?.postponeSave();
                editor?.scheduleSave(drawing, () => content);
                await vi.advanceTimersByTimeAsync(400);
            }
        };

        await write(5);
        expect(serverPost).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(serverPost).toHaveBeenCalledExactlyOnceWith(...savedRequest("stroke 5"));

        await write(24);
        expect(serverPost).toHaveBeenCalledOnce();
        await write(2);
        expect(serverPost).toHaveBeenCalledTimes(2);

        await act(() => render(null, container));
    });

    it("asks on a conflict, keeps this version, and bases the next save on its own", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        const read = { ...drawing, blobId: "read" } as FAttachment;
        rejectWithConflict();
        serverPost.mockResolvedValueOnce(
            { attachmentId: "drawing1", title: "Canvas.excalidraw", blobId: "mine" } as never);
        const showPersistent = vi.spyOn(toast, "showPersistent");

        editor?.scheduleSave(read, () => "first");
        void component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        await vi.waitFor(() => expect(showPersistent).toHaveBeenCalled());
        expect(serverPost).toHaveBeenCalledExactlyOnceWith(
            ...savedRequest("first", { blobId: "read" }));
        await act(async () => {
            showPersistent.mock.calls[0][0].buttons?.[0].onClick({ dismissToast: () => {} });
            await vi.waitFor(() => expect(editor?.getUnsavedContent("drawing1")).toBeUndefined());
        });
        expect(serverPost).toHaveBeenLastCalledWith(
            ...savedRequest("first", { blobId: "theirs", keepOther: true }));

        // `froca` still holds the blob that the change was read at.
        editor?.scheduleSave(read, () => "second");
        await act(async () => {
            await component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(serverPost).toHaveBeenLastCalledWith(
            ...savedRequest("second", { blobId: "mine" }));
        await act(() => render(null, container));
    });

    it("keeps its version as a revision when the user loads the other one", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        rejectWithConflict();
        server.get = vi.fn(async () => ({ blobId: "noteBlob", content: "<p>note</p>" })) as
            typeof server.get;
        serverPost.mockResolvedValueOnce({ revisionId: "r", isKept: true } as never);
        const showPersistent = vi.spyOn(toast, "showPersistent");
        const versionLoaded = vi.fn();
        editor?.subscribeVersionLoaded?.(versionLoaded);

        const read = { ...drawing, blobId: "read" } as FAttachment;
        editor?.scheduleSave(read, () => "mine");
        void component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        await vi.waitFor(() => expect(showPersistent).toHaveBeenCalled());
        expect(versionLoaded).not.toHaveBeenCalled();
        editor?.scheduleSave(read, () => "drawn while asked");
        await act(async () => {
            showPersistent.mock.calls[0][0].buttons?.[1].onClick({ dismissToast: () => {} });
            await vi.waitFor(() => expect(serverPost).toHaveBeenCalledTimes(2));
        });
        expect(serverPost).toHaveBeenLastCalledWith("notes/note1/revisions/draft",
            expect.objectContaining({
                content: "<p>note</p>",
                attachments: [ savedRequest("drawn while asked", { blobId: "read" })[1] ]
            }), component.componentId);
        await vi.waitFor(() => expect(editor?.getUnsavedContent("drawing1")).toBeUndefined());
        expect(versionLoaded).toHaveBeenCalledOnce();
        await act(() => render(null, container));
    });

    /** Rejects the next save of an attachment, which another writer saved at the blob `theirs`. */
    function rejectWithConflict() {
        serverPost.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "noteBlob", type: "text", mime: "text/html",
            isVersioned: true,
            attachments: [
                { attachmentId: "drawing1", title: "Canvas.excalidraw", blobId: "theirs" }
            ]
        }) as never);
    }
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

    it("takes a change for a save, and tells the editor that records it", () => {
        const saves = new NoteSaves(vi.fn(), "host");
        const hooks = {
            onDataTaken: vi.fn(), dataSaved: vi.fn(), resolveConflict: vi.fn(() => false)
        };
        saves.scheduleSave(buildCodeNote("code1"), () => "typed", undefined, hooks);

        expect(saves.takeUnsavedContent("code1")).toBe("typed");
        expect(hooks.onDataTaken).toHaveBeenCalledOnce();
        expect(saves.takeUnsavedContent("code2")).toBeUndefined();
        expect(hooks.onDataTaken).toHaveBeenCalledOnce();
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

    it("bases a note on its blob at its first change, and loads another version", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        const note = {
            noteId: "code1", type: "code", mime: "text/plain", blobId: "first", isProtected: false
        } as FNote;
        serverPut.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "theirs", type: "code", mime: "text/plain",
            isVersioned: true
        }) as never);
        const get = vi.fn(async () => ({ blobId: "theirs", content: "theirs" }));
        server.get = get as typeof server.get;
        const kept = { revisionId: "r", isKept: true, isFragment: false };
        serverPost.mockResolvedValueOnce(kept as never);
        const showPersistent = vi.spyOn(toast, "showPersistent");
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);

        editor?.scheduleSave(note, () => "mine");
        editor?.scheduleSave({ ...note, blobId: "later" } as FNote, () => "mine, more");
        void component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        await vi.waitFor(() => expect(showPersistent).toHaveBeenCalled());
        expect(serverPut).toHaveBeenCalledExactlyOnceWith("notes/code1/data", {
            content: "mine, more", attachments: undefined,
            base: { blobId: "first", type: "code", mime: "text/plain" }, keepOther: undefined
        }, component.componentId, { silentConflict: true });

        const question = showPersistent.mock.calls[0][0];
        await act(async () => {
            question.buttons?.[1].onClick({ dismissToast: () => {} });
            await vi.waitFor(() => expect(trigger).toHaveBeenCalledWith(
                "refreshEmbeddedNote", { noteId: "code1" }));
        });
        expect(serverPost).toHaveBeenCalledExactlyOnceWith("notes/code1/revisions/draft",
            expect.objectContaining({ content: "mine, more", type: "code" }),
            component.componentId);
        expect(editor?.getUnsavedContent("code1")).toBeUndefined();
        await act(() => render(null, container));
    });

    it("drops a save queued while it asks once the other version loads", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        const note = {
            noteId: "code1", type: "code", mime: "text/plain", blobId: "first", isProtected: false
        } as FNote;
        serverPut.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "theirs", type: "code", mime: "text/plain",
            isVersioned: true
        }) as never);
        const get = vi.fn(async () => ({ blobId: "theirs", content: "theirs" }));
        server.get = get as typeof server.get;
        const kept = { revisionId: "r", isKept: true, isFragment: false };
        serverPost.mockResolvedValueOnce(kept as never);
        const showPersistent = vi.spyOn(toast, "showPersistent");
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);

        editor?.scheduleSave(note, () => "mine");
        void component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        await vi.waitFor(() => expect(showPersistent).toHaveBeenCalled());
        // Typed while it asks, then queued by the guard of the window.
        editor?.scheduleSave(note, () => "mine, more");
        const guards = appContext.beforeUnloadListeners
            .filter((listener): listener is () => boolean => typeof listener === "function");
        expect(guards.map((guard) => guard())).toEqual([ false ]);
        // A save that waits for the user is neither sent again nor waited for.
        let saved: string | undefined = "waiting";
        void editor?.saveNow?.("code1").then((content) => {
            saved = content;
        });
        await vi.waitFor(() => expect(saved).toBeUndefined());
        expect(serverPut).toHaveBeenCalledOnce();

        const question = showPersistent.mock.calls[0][0];
        await act(async () => {
            question.buttons?.[1].onClick({ dismissToast: () => {} });
            await vi.waitFor(() => expect(trigger).toHaveBeenCalledWith(
                "refreshEmbeddedNote", { noteId: "code1" }));
        });
        await act(async () => {
            await editor?.saveNow?.("code1");
        });
        expect(serverPost).toHaveBeenCalledExactlyOnceWith("notes/code1/revisions/draft",
            expect.objectContaining({ content: "mine, more" }), component.componentId);
        expect(serverPut).toHaveBeenCalledOnce();
        await act(() => render(null, container));
    });

    it("bases a note on the version that its embed shows, or that it saved last", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        const note = {
            noteId: "code1", type: "code", mime: "text/plain", blobId: "newer", isProtected: false
        } as FNote;
        const savedBase = () => (serverPut.mock.lastCall as unknown[] | undefined)?.[1];
        const saveNow = async () => {
            let saved: string | undefined;
            await act(async () => {
                saved = await editor?.saveNow?.("code1");
            });
            return saved;
        };

        // Another split of this window saved over the version that the embed still shows.
        recordReplacedBlob("code1", "shown", "newer");
        editor?.setLoadedVersion?.("code1", "shown", "shown content");
        serverPut.mockResolvedValueOnce({ blobId: "mine1", attachments: [] } as never);
        editor?.scheduleSave(note, () => "mine");
        expect(await saveNow()).toBe("mine");
        expect(savedBase()).toMatchObject({ base: { blobId: "shown" } });

        // A change before the embed loads its own save is based on that save.
        serverPut.mockResolvedValueOnce({ blobId: "mine2", attachments: [] } as never);
        editor?.scheduleSave(note, () => "mine, more");
        expect(await saveNow()).toBe("mine, more");
        expect(savedBase()).toMatchObject({ base: { blobId: "mine1" } });

        // A version that the embed loads is the base of the next change.
        editor?.setLoadedVersion?.("code1", "loaded", "loaded content");
        expect(await saveNow()).toBe("loaded content");
        serverPut.mockRejectedValueOnce("offline" as never);
        editor?.scheduleSave(note, () => "again");
        expect(await saveNow()).toBeUndefined();
        expect(savedBase()).toMatchObject({ base: { blobId: "loaded" } });
        await act(() => render(null, container));
    });

    it("saves the changes to a note that `saveNoteChanges` names", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });

        editor?.scheduleSave(code, () => "first");
        await act(async () => {
            await component.handleEvent("saveNoteChanges", { noteId: "other" });
        });
        expect(serverPut).not.toHaveBeenCalled();
        await act(async () => {
            await component.handleEvent("saveNoteChanges", { noteId: "code1" });
        });
        expect(serverPut).toHaveBeenCalledExactlyOnceWith(
            "notes/code1/data", { content: "first" }, component.componentId);
        expect(editor?.getUnsavedContent("code1")).toBeUndefined();
        await act(() => render(null, container));
    });

    it("lets the editor of a note bring its changes onto another writer's version", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });
        const note = {
            noteId: "code1", type: "code", mime: "text/plain", blobId: "first", isProtected: false
        } as FNote;
        serverPut.mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "theirs", type: "code", mime: "text/plain",
            isVersioned: true
        }) as never);
        server.get = vi.fn(async () => ({ blobId: "theirs", content: "theirs" })) as
            typeof server.get;
        const showPersistent = vi.spyOn(toast, "showPersistent");
        const hooks = {
            onDataTaken: vi.fn(), dataSaved: vi.fn(), resolveConflict: vi.fn(() => true)
        };

        editor?.scheduleSave(note, () => "mine", undefined, hooks);
        await act(async () => {
            await editor?.saveNow?.("code1");
        });
        expect(hooks.resolveConflict).toHaveBeenCalledExactlyOnceWith(
            { blobId: "theirs", content: "theirs" });
        expect(showPersistent).not.toHaveBeenCalled();
        expect(serverPut).toHaveBeenLastCalledWith("notes/code1/data", expect.objectContaining({
            content: "mine", base: { blobId: "theirs", type: "code", mime: "text/plain" }
        }), component.componentId, { silentConflict: true });
        // Read for the first save and for the one sent again.
        expect(hooks.onDataTaken).toHaveBeenCalledTimes(2);
        expect(hooks.dataSaved).toHaveBeenCalledOnce();
        expect(editor?.getUnsavedContent("code1")).toBeUndefined();
        await act(() => render(null, container));
    });

    it("drops the change to a note deleted before it saves", async () => {
        component = new Component();
        const container = document.createElement("div");
        await act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(Probe, {})), container);
        });

        editor?.scheduleSave(code, () => "first");
        delete frocaNotes.code1;
        await act(async () => {
            await component.handleEvent("beforeNoteSwitch", { noteContext } as never);
        });
        expect(serverPut).not.toHaveBeenCalled();
        expect(editor?.getUnsavedContent("code1")).toBeUndefined();
        expect(editor?.getSaveState("code1")).toBe("saved");
        await act(() => render(null, container));
    });

    it("edits the notes that its embeds show, except the note of its context", async () => {
        component = new Component();
        const container = document.createElement("div");
        let hostEditor: NoteEditor | undefined;
        function HostProbe({ context }: { context: NoteContext | null }) {
            hostEditor = useNoteEditor(context);
            return null;
        }
        const show = (context: NoteContext | null) => act(() => {
            render(h(ParentComponent.Provider, { value: component }, h(HostProbe, { context })),
                container);
        });
        const host = { noteId: "host1", isContentAvailable: () => true } as FNote;
        const embedded = { noteId: "code1", isContentAvailable: () => true } as FNote;

        await show({ ...noteContext, noteId: "host1" } as NoteContext);
        expect(hostEditor?.canEdit(host)).toBe(false);
        expect(hostEditor?.canEdit(embedded)).toBe(true);

        await show(null);
        expect(hostEditor?.canEdit(host)).toBe(true);
        await act(() => render(null, container));
    });
});

describe("InlineSourceSaves", () => {
    it("schedules a save for a held write, and makes the writes still held on flush", () => {
        const scheduleUpdate = vi.fn();
        const saves = new InlineSourceSaves(scheduleUpdate);
        const made: string[] = [];
        // Holds a write that, like an inline source, leaves `saves` once made.
        const hold = (text: string) => {
            const write = () => {
                saves.delete(write);
                made.push(text);
            };
            saves.add(write);
            return write;
        };

        hold("a");
        const written = hold("b");
        written();
        expect(scheduleUpdate).toHaveBeenCalledTimes(2);

        saves.flush();
        saves.flush();
        expect(made).toEqual([ "b", "a" ]);
    });
});
