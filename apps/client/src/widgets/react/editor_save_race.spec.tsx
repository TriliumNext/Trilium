/**
 * Synthetic reproduction of https://github.com/TriliumNext/Trilium/issues/9614
 * ("Notes being overwritten with another note").
 *
 * The save pipeline in `useEditorSpacedUpdate` does not bind the content snapshot
 * (`getData()`, which reads the live editor) to the note it was loaded from. Editor
 * components are reused across note switches (NoteDetailWrapper is keyed by note
 * *type*), and the new note's content arrives only after an async blob fetch. Any
 * save that fires in that window writes the previous note's content under the new
 * note's id.
 *
 * These tests assert the *correct* behavior, so they are red while the bug exists
 * and become the regression suite once it is fixed. The fake "editor" is a plain
 * content holder standing in for CKEditor; note B's blob is a controllable deferred
 * standing in for a slow blob fetch (remote server / PWA).
 */
import type { SavedAttachmentRow } from "@triliumnext/commons";
import { deferred } from "@triliumnext/commons/src/lib/utils.js";
import { render, type RefObject } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FBlob from "../../entities/fblob";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import LoadResults from "../../services/load_results";
import type { NoteSaver, SaveData } from "../../services/note_save";
import server from "../../services/server";
import type SpacedUpdate from "../../services/spaced_update";
import toast from "../../services/toast";
import { buildNote } from "../../test/easy-froca";
import { type SavedData, useEditorSpacedUpdate, useNoteSaver } from "./hooks/editor";
import { noteSavedDataStore } from "./NoteStore";
import { ParentComponent } from "./react_utils";

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

let currentSpacedUpdate: SpacedUpdate<SavedData | undefined> | undefined;

/**
 * Stand-in for EditableText: `editor.content` plays the role of the live CKEditor document, and
 * `editor.attachments` the drawings changed in it.
 */
function FakeEditor({ note, noteContext, editor, shownRef }: {
    note: FNote;
    noteContext: NoteContext | null;
    editor: FakeEditorState;
    shownRef?: RefObject<Element | null>;
}) {
    currentSpacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "text",
        shownRef,
        getData: () => ({
            content: editor.content,
            ...(editor.attachments ? { attachments: editor.attachments } : {})
        }),
        onContentChange(newContent) {
            editor.content = newContent;
        },
        discardChanges() {
            editor.attachments = undefined;
        }
    });
    return null;
}

interface FakeEditorState {
    content: string;
    attachments?: SavedAttachmentRow[];
}

function getSpacedUpdate(): SpacedUpdate<SavedData | undefined> {
    if (!currentSpacedUpdate) {
        throw new Error("Harness was not rendered yet");
    }
    return currentSpacedUpdate;
}

function setupEditorHarness({ withParent = false, withShownRef = false } = {}) {
    const noteA = buildNote({ title: "Note A", type: "text", content: "AAA" });
    const noteB = buildNote({ title: "Note B", type: "text", content: "BBB" });

    // Note B's content stays "in flight" (slow server) until the test resolves it.
    const blobB = new FBlob({
        blobId: `blob-${noteB.noteId}`,
        content: "BBB",
        contentLength: 3,
        dateModified: new Date().toISOString(),
        utcDateModified: new Date().toISOString()
    });
    const pendingBlobB = deferred<FBlob>();
    noteB.getBlob = () => pendingBlobB;

    const editor: FakeEditorState = { content: "" };
    const puts: { url: string; content: string }[] = [];
    server.put = vi.fn(async (url: string, data: { content: string }) => {
        puts.push({ url, content: data.content });
        return {};
    }) as typeof server.put;

    const container = document.createElement("div");
    document.body.appendChild(container);

    const parent = withParent ? new Component() : null;
    const noteContext = withParent ? new NoteContext("test-ntx") : null;
    const shownRef = withShownRef ? { current: container } : undefined;

    async function show(note: FNote) {
        await act(async () => {
            const editorEl = (
                <FakeEditor
                    note={note} noteContext={noteContext} editor={editor} shownRef={shownRef}
                />
            );
            render(
                parent ? <ParentComponent.Provider value={parent}>{editorEl}</ParentComponent.Provider> : editorEl,
                container
            );
        });
        // Let the blob-load effect's `allowUpdateWithoutChange` settle (it re-enables
        // scheduling on a microtask), without crossing the 1s save debounce.
        await vi.advanceTimersByTimeAsync(20);
    }

    function putsTo(note: FNote) {
        return puts.filter((p) => p.url === `notes/${note.noteId}/data`);
    }

    return { noteA, noteB, pendingBlobB, blobB, editor, puts, putsTo, container, parent, noteContext, show };
}

describe("note switch save race (#9614)", () => {
    let cleanupContainer: HTMLElement | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        currentSpacedUpdate = undefined;
    });

    afterEach(() => {
        if (cleanupContainer) {
            render(null, cleanupContainer);
            cleanupContainer.remove();
            cleanupContainer = undefined;
        }
        vi.useRealTimers();
    });

    it("does not save the previous note's content under the next note when switching while an edit is pending (quick-edit popup path)", async () => {
        const harness = setupEditorHarness();
        cleanupContainer = harness.container;
        const { noteA, noteB, editor, putsTo, show } = harness;

        await show(noteA);
        expect(editor.content).toBe("AAA"); // sanity: note A's content reached the editor

        // The user types into note A; the save is debounced by SpacedUpdate (1s).
        editor.content = "AAA edited";
        getSpacedUpdate().scheduleUpdate();

        // Within the debounce window, the quick-edit popup swaps to note B
        // (PopupEditor creates a fresh NoteContext whose beforeNoteSwitch event
        // reaches no listeners, so nothing flushes or clears the pending change).
        // B's blob fetch is still in flight, so the editor still holds A's content.
        await show(noteB);

        // The debounce elapses while note B's content is still loading.
        await vi.advanceTimersByTimeAsync(1500);

        // Note B must never receive note A's content.
        expect(putsTo(noteB)).toEqual([]);

        // The pending edit belongs to note A and must not be lost.
        expect(putsTo(noteA)).toContainEqual({ url: `notes/${noteA.noteId}/data`, content: "AAA edited" });
    });

    it("does not attribute keystrokes typed right after an in-tab switch to the new note while the editor still shows the old note's content", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, noteB, editor, putsTo, parent, noteContext, show } = harness;
        if (!parent || !noteContext) {
            throw new Error("Harness misconfigured");
        }

        await show(noteA);
        expect(editor.content).toBe("AAA");

        // The user types into note A...
        editor.content = "AAA edited";
        getSpacedUpdate().scheduleUpdate();

        // ...then clicks note B in the tree. NoteContext.setNote fires beforeNoteSwitch
        // (which the editor hook handles by flushing), then proceeds with the switch.
        await parent.handleEvent("beforeNoteSwitch", { noteContext });
        await show(noteB);

        // The flush saved note A correctly — that part works.
        expect(putsTo(noteA)).toContainEqual({ url: `notes/${noteA.noteId}/data`, content: "AAA edited" });

        // The user starts typing immediately, while the editor still displays note A's
        // content under note B's title (B's blob fetch is still in flight).
        editor.content = "AAA edited plus keystrokes meant for B";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);

        // Note B must not be overwritten with note A's content + the new keystrokes.
        expect(putsTo(noteB)).toEqual([]);

    });

    it("loads the next note even when keystrokes typed over the previous one wait for a save", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, noteB, editor, pendingBlobB, blobB, show } = harness;

        await show(noteA);
        await show(noteB);
        editor.content = "AAA plus keystrokes meant for B";
        getSpacedUpdate().scheduleUpdate();

        // Note B's content arrives within the debounce of the save.
        await act(async () => {
            pendingBlobB.resolve(blobB);
        });
        await vi.advanceTimersByTimeAsync(20);
        expect(editor.content).toBe("BBB");
    });

    it("drops a change to a note deleted before it saves, so the window can still close", async () => {
        const harness = setupEditorHarness();
        cleanupContainer = harness.container;
        const { noteA, editor, show } = harness;
        await show(noteA);
        const put = vi.fn(async () => {
            throw new Error(`Note '${noteA.noteId}' is not available for change!`);
        });
        server.put = put as typeof server.put;

        editor.content = "AAA edited";
        getSpacedUpdate().scheduleUpdate();
        delete froca.notes[noteA.noteId];
        await vi.advanceTimersByTimeAsync(1500);

        expect(put).not.toHaveBeenCalled();
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(true);
    });

    it("keeps unsaved changes when another editor saves the note, and reloads an editor without any", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, parent, show } = harness;
        await show(noteA);

        editor.content = "AAA typed here";
        getSpacedUpdate().scheduleUpdate();
        await reportSave(parent, noteA, "another-editor", "AAA typed elsewhere");
        expect(editor.content).toBe("AAA typed here");

        await vi.advanceTimersByTimeAsync(1500);
        await reportSave(parent, noteA, "another-editor", "AAA typed elsewhere again");
        expect(editor.content).toBe("AAA typed elsewhere again");
    });

    it("saves its pending changes when asked to for its note, not for another", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, noteB, editor, parent, putsTo, show } = harness;
        if (!parent) throw new Error("Harness misconfigured");
        await show(noteA);

        editor.content = "AAA typed here";
        getSpacedUpdate().scheduleUpdate();
        await parent.handleEvent("saveNoteChanges", { noteId: noteB.noteId });
        expect(putsTo(noteA)).toEqual([]);

        await parent.handleEvent("saveNoteChanges", { noteId: noteA.noteId });
        expect(putsTo(noteA)).toEqual([
            { url: `notes/${noteA.noteId}/data`, content: "AAA typed here" }
        ]);
        expect(getSpacedUpdate().hasUnsavedChanges()).toBe(false);
    });

    it("drops a save made elsewhere while hidden once a later save here replaces it", async () => {
        const resizeCallbacks: (() => void)[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            constructor(callback: () => void) {
                resizeCallbacks.push(callback);
            }
            observe() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        const harness = setupEditorHarness({ withParent: true, withShownRef: true });
        cleanupContainer = harness.container;
        const { noteA, editor, parent, container, putsTo, show } = harness;
        const showContainer = async () => {
            container.style.display = "";
            await act(async () => {
                for (const callback of resizeCallbacks) callback();
            });
        };

        try {
            await show(noteA);
            editor.content = "AAA typed here";
            getSpacedUpdate().scheduleUpdate();
            container.style.display = "none";
            await reportSave(parent, noteA, "another-editor", "AAA typed elsewhere");
            await vi.advanceTimersByTimeAsync(1500);
            expect(putsTo(noteA)).toContainEqual({
                url: `notes/${noteA.noteId}/data`, content: "AAA typed here"
            });
            await reportSave(parent, noteA, parent?.componentId ?? "");
            await showContainer();
            expect(editor.content).toBe("AAA typed here");

            container.style.display = "none";
            await reportSave(parent, noteA, "another-editor", "AAA typed elsewhere again");
            expect(editor.content).toBe("AAA typed here");
            await showContainer();
            expect(editor.content).toBe("AAA typed elsewhere again");
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
        }
    });

    it("awaits async event handlers registered by React components (the contract NoteContext.setNote relies on)", async () => {
        const parent = new Component();
        let flushed = false;
        parent.registerHandler("beforeNoteSwitch", async () => {
            // The real handler (the editor's save flush) suspends across a full network
            // round trip; two chained awaits are the minimal stand-in for "takes longer
            // than the single microtask that `await handleEvent(...)` burns".
            await Promise.resolve();
            await Promise.resolve();
            flushed = true;
        });

        // NoteContext.setNote does `await this.triggerEvent("beforeNoteSwitch", ...)`
        // expecting all handlers (including the editor's save flush) to have completed.
        await parent.handleEvent("beforeNoteSwitch", { noteContext: new NoteContext("contract-ntx") });

        expect(flushed).toBe(true);
    });
});

describe("saving over a version that changed elsewhere", () => {
    let cleanupContainer: HTMLElement | undefined;
    let showPersistent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        currentSpacedUpdate = undefined;
        showPersistent = vi.spyOn(toast, "showPersistent").mockImplementation(() => {});
        vi.spyOn(toast, "closePersistent").mockImplementation(() => {});
        server.post = vi.fn(async () => (
            { revisionId: "kept", isKept: true, isFragment: false }
        )) as typeof server.post;
    });

    afterEach(() => {
        if (cleanupContainer) {
            render(null, cleanupContainer);
            cleanupContainer.remove();
            cleanupContainer = undefined;
        }
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    function rejectWithVersionConflict() {
        const put = vi.fn(async () => {
            throw JSON.stringify({
                reason: "version", message: "", blobId: "theirs", type: "text", mime: "text/html",
                isVersioned: true
            });
        });
        server.put = put as typeof server.put;
        return put;
    }

    function getQuestion() {
        return showPersistent.mock.calls.map(([ options ]) => options)
            .find((options) => options.id.startsWith("save-conflict-"));
    }

    it("pauses the save until the user loads the other version, and the window asks", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, parent, show } = harness;
        await show(noteA);
        const { blobId } = await noteA.getBlob() ?? { blobId: "" };
        const put = rejectWithVersionConflict();
        const get = vi.fn(async () => ({ blobId: "theirs", content: "AAA theirs" }));
        server.get = get as typeof server.get;

        editor.content = "AAA mine";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/data`,
            expect.objectContaining({
                content: "AAA mine", base: { blobId, type: "text", mime: "text/html" }
            }), parent?.componentId, { silentConflict: true });
        expect(getQuestion()).toBeDefined();

        // A conflict is not retried, and stays unsaved for the guard of the window.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(put).toHaveBeenCalledOnce();
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(false);

        getQuestion()?.buttons?.[1].onClick({ dismissToast: () => {} });
        await vi.advanceTimersByTimeAsync(20);
        expect(server.post).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ content: "AAA mine", type: "text" }), parent?.componentId);
        expect(editor.content).toBe("AAA theirs");
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(true);
    });

    it("drops a save queued while it asks once the user loads the other version", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, show } = harness;
        await show(noteA);
        const put = rejectWithVersionConflict();
        server.get = vi.fn(async () => (
            { blobId: "theirs", content: "AAA theirs" }
        )) as typeof server.get;

        editor.content = "AAA mine";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(getQuestion()).toBeDefined();
        // Typed while it asks, then queued by the guard of the window.
        editor.content = "AAA more";
        getSpacedUpdate().scheduleUpdate();
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(false);

        getQuestion()?.buttons?.[1].onClick({ dismissToast: () => {} });
        await vi.advanceTimersByTimeAsync(1500);
        expect(server.post).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ content: "AAA more" }), expect.anything());
        expect(put).toHaveBeenCalledOnce();
        expect(editor.content).toBe("AAA theirs");
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(true);
    });

    it("drops the drawing changes it kept once the user loads the other version", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, show } = harness;
        await show(noteA);
        rejectWithVersionConflict();
        server.get = vi.fn(async () => (
            { blobId: "theirs", content: "AAA theirs" }
        )) as typeof server.get;
        const drawing: SavedAttachmentRow = {
            attachmentId: "drawing1", blobId: "drawing-blob", role: "file", title: "Canvas",
            mime: "application/vnd.excalidraw+json", content: "{}"
        };

        editor.attachments = [ drawing ];
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        getQuestion()?.buttons?.[1].onClick({ dismissToast: () => {} });
        await vi.advanceTimersByTimeAsync(20);
        expect(server.post).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ attachments: [ drawing ] }), expect.anything());

        // The next edit saves the text alone.
        const put = vi.fn(async () => ({ blobId: "mine" }));
        server.put = put as typeof server.put;
        editor.content = "AAA theirs, edited";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/data`,
            expect.objectContaining({ content: "AAA theirs, edited", attachments: undefined }),
            expect.anything(), { silentConflict: true });
    });

    it("keeps the changes as a revision once the editor shows another note", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, noteB, editor, show } = harness;
        await show(noteA);
        rejectWithVersionConflict();

        editor.content = "AAA mine";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(getQuestion()).toBeDefined();
        expect(server.post).not.toHaveBeenCalled();

        await show(noteB);
        expect(server.post).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ content: "AAA mine" }), expect.anything());
    });

    it("keeps a queued save as a revision when the type of the note changed under it", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, show, putsTo } = harness;
        await show(noteA);
        const post = vi.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ revisionId: "kept", isKept: true, isFragment: false });
        server.post = post as typeof server.post;

        editor.content = "AAA edited";
        getSpacedUpdate().scheduleUpdate();
        // The note is converted elsewhere, and the conversion reaches the client first.
        noteA.type = "code";
        noteA.mime = "text/x-markdown";
        await vi.advanceTimersByTimeAsync(1500);
        expect(putsTo(noteA)).toEqual([]);
        expect(post).toHaveBeenCalledOnce();
        // The draft leaves the queue only once the server has kept it.
        expect(getSpacedUpdate().hasUnsavedChanges()).toBe(true);

        await vi.advanceTimersByTimeAsync(5000);
        expect(post).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenLastCalledWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ content: "AAA edited", type: "text", mime: "text/html" }),
            expect.anything());
        expect(getSpacedUpdate().hasUnsavedChanges()).toBe(false);
    });

    it("leaves a save that waits for the user alone, until its tab closes", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, parent, noteContext, show } = harness;
        if (!parent || !noteContext) throw new Error("Harness misconfigured");
        await show(noteA);
        const put = rejectWithVersionConflict();

        editor.content = "AAA mine";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(getQuestion()).toBeDefined();

        // Neither a save of the note nor a switch of the tab waits for the answer.
        const settled: string[] = [];
        void Promise.resolve(parent.handleEvent("saveNoteChanges", { noteId: noteA.noteId }))
            .then(() => settled.push("saveNoteChanges"));
        void Promise.resolve(parent.handleEvent("beforeNoteSwitch", { noteContext }))
            .then(() => settled.push("beforeNoteSwitch"));
        await vi.advanceTimersByTimeAsync(20);
        expect([ ...settled ].sort()).toEqual([ "beforeNoteSwitch", "saveNoteChanges" ]);
        expect(put).toHaveBeenCalledOnce();
        expect(server.post).not.toHaveBeenCalled();

        const { ntxId } = noteContext;
        if (!ntxId) throw new Error("Harness misconfigured");
        void parent.handleEvent("beforeNoteContextRemove", { ntxIds: [ ntxId ] });
        await vi.advanceTimersByTimeAsync(20);
        expect(server.post).toHaveBeenCalledExactlyOnceWith(`notes/${noteA.noteId}/revisions/draft`,
            expect.objectContaining({ content: "AAA mine" }), parent.componentId);
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(true);
    });

    it("keeps the draft of a note it left, and loads nothing into the note it shows", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, noteB, pendingBlobB, blobB, editor, show } = harness;
        await show(noteA);
        rejectWithVersionConflict();
        server.get = vi.fn(async () => (
            { blobId: "theirs", content: "AAA theirs" }
        )) as typeof server.get;
        const post = vi.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValue({ revisionId: "kept", isKept: true, isFragment: false });
        server.post = post as typeof server.post;

        editor.content = "AAA mine";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        getQuestion()?.buttons?.[1].onClick({ dismissToast: () => {} });
        await vi.advanceTimersByTimeAsync(20);
        expect(post).toHaveBeenCalledOnce();

        // The editor shows note B before the draft of note A is sent again.
        pendingBlobB.resolve(blobB);
        await show(noteB);
        expect(editor.content).toBe("BBB");
        await vi.advanceTimersByTimeAsync(5000);

        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1]).toStrictEqual(post.mock.calls[0]);
        expect(editor.content).toBe("BBB");
        expect(noteSavedDataStore.get(noteA.noteId)).toBe("AAA theirs");
        expect(getSpacedUpdate().isAllSavedAndTriggerUpdate()).toBe(true);
    });
});

describe("editing some blocks of a note", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        currentSpacedUpdate = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("reads and replaces the blocks, then the blocks that the last save held", async () => {
        const note = buildNote({ title: "Blocks", type: "text", content: "<p>Whole</p>" });
        const read = vi.spyOn(server, "getWithSilentNotFound")
            .mockImplementation(async (url: string) => ({ content: `<p>${url}</p>`, hash: url }));
        const put = vi.spyOn(server, "put").mockResolvedValue({ hash: "saved", attachments: [] });
        const { editor, parent, cleanup } = await showBlockEditor(note, "a:b");
        const url = `notes/${note.noteId}/blocks`;

        expect(editor.content).toBe(`<p>${url}?block=a%3Ab</p>`);
        expect(noteSavedDataStore.get(note.noteId)).toBeUndefined();

        // Each save is based on the hash of the blocks as read, and names the blocks it leaves.
        editor.content = "<p>Edited</p>";
        editor.block = "a:n";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).toHaveBeenLastCalledWith(`${url}?block=a%3Ab`, {
            content: "<p>Edited</p>", base: { hash: `${url}?block=a%3Ab` }, block: "a:n"
        }, parent.componentId, { silentConflict: true });
        expect(noteSavedDataStore.get(note.noteId)).toBeUndefined();

        const loadResults = new LoadResults([]);
        loadResults.addNoteContent(note.noteId, "another-editor");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
        });
        await vi.advanceTimersByTimeAsync(20);
        expect(read).toHaveBeenLastCalledWith(`${url}?block=a%3An`);
        expect(editor.content).toBe(`<p>${url}?block=a%3An</p>`);

        editor.content = "<p>Edited again</p>";
        editor.block = undefined;
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).toHaveBeenLastCalledWith(`${url}?block=a%3An`, {
            content: "<p>Edited again</p>", base: { hash: `${url}?block=a%3An` }
        }, parent.componentId, { silentConflict: true });
        cleanup();
    });

    it("saves nothing when the blocks cannot be read", async () => {
        const note = buildNote({ title: "Missing blocks", type: "text", content: "<p>Whole</p>" });
        vi.spyOn(server, "getWithSilentNotFound").mockRejectedValue(new Error("Not found"));
        const put = vi.spyOn(server, "put").mockResolvedValue({});
        const { editor, cleanup } = await showBlockEditor(note, "a:b");

        editor.content = "<p>Typed</p>";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).not.toHaveBeenCalled();
        cleanup();
    });

    it("keeps the blocks as a revision, and loads the other version of them", async () => {
        const note = buildNote({ title: "Changed blocks", type: "text", content: "<p>Whole</p>" });
        vi.spyOn(server, "getWithSilentNotFound")
            .mockResolvedValue({ content: "<p>Mine</p>", hash: "h0", note: "<p>Whole</p>" });
        const put = vi.spyOn(server, "put").mockRejectedValue(JSON.stringify(
            { reason: "version", hash: "h1", isVersioned: true, attachments: [] }));
        const get = vi.spyOn(server, "get")
            .mockResolvedValue({ content: "<p>Theirs</p>", hash: "h1", note: "<p>Theirs</p>" });
        const post = vi.spyOn(server, "post")
            .mockResolvedValue({ revisionId: "kept", isKept: true, isFragment: true });
        const showPersistent = vi.spyOn(toast, "showPersistent").mockImplementation(() => {});
        vi.spyOn(toast, "closePersistent").mockImplementation(() => {});
        const dataSaved = vi.fn();
        const { editor, parent, cleanup } = await showBlockEditor(note, "a:b", dataSaved);

        editor.content = "<p>Edited</p>";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        const question = showPersistent.mock.calls.map(([ options ]) => options)
            .find((options) => options.id.startsWith("save-conflict-"));
        question?.buttons?.[1].onClick({ dismissToast: () => {} });
        await vi.advanceTimersByTimeAsync(20);

        expect(put).toHaveBeenCalledOnce();
        expect(post).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/revisions/draft`,
            expect.objectContaining({ fragment: {
                content: "<p>Edited</p>", block: "a:b", base: { note: "<p>Whole</p>", hash: "h0" }
            } }), parent.componentId);
        expect(get).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/blocks?block=a%3Ab`);
        expect(editor.content).toBe("<p>Theirs</p>");
        expect(dataSaved).not.toHaveBeenCalled();
        cleanup();
    });
});

describe("useNoteSaver", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("asks the user when its editor cannot bring changes onto the other version", async () => {
        const note = buildNote({ title: "Not rebased", type: "text", content: "<p>0</p>" });
        const put = vi.spyOn(server, "put").mockRejectedValueOnce(JSON.stringify({
            reason: "version", message: "", blobId: "theirs", type: "text", mime: "text/html",
            isVersioned: true
        })).mockResolvedValue({ blobId: "mine", attachments: [] });
        const get = vi.spyOn(server, "get")
            .mockResolvedValue({ blobId: "theirs", content: "<p>theirs</p>" });
        const showPersistent = vi.spyOn(toast, "showPersistent").mockImplementation(() => {});
        vi.spyOn(toast, "closePersistent").mockImplementation(() => {});
        let saver: NoteSaver<SaveData> | undefined;
        function Probe() {
            saver = useNoteSaver<SaveData>({
                getLatestData: () => undefined, loadVersion: vi.fn()
            });
            return null;
        }
        const parent = new Component();
        const container = document.createElement("div");
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}><Probe /></ParentComponent.Provider>,
                container
            );
        });
        saver?.setBase({ noteId: note.noteId, blobId: "b0", type: "text", mime: "text/html" });

        const saving = saver?.saveNote(note, { content: "<p>mine</p>" });
        await vi.waitFor(() => expect(saver?.isAsking()).toBe(true));
        expect(get).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/blob`);
        expect(put).toHaveBeenCalledOnce();

        const question = showPersistent.mock.calls.map(([ options ]) => options)
            .find((options) => options.id.startsWith("save-conflict-"));
        question?.buttons?.[0].onClick({ dismissToast: () => {} });
        expect(await saving).toStrictEqual({ content: "<p>mine</p>" });
        expect(put).toHaveBeenLastCalledWith(`notes/${note.noteId}/data`, expect.objectContaining({
            base: { blobId: "theirs", type: "text", mime: "text/html" }, keepOther: true
        }), parent.componentId, { silentConflict: true });
        await act(() => render(null, container));
    });
});

/** Reports a save of `note` by `componentId`, which reads back as `content` when it is given. */
async function reportSave(
    parent: Component | null, note: FNote, componentId: string, content?: string
) {
    if (content !== undefined) {
        note.getBlob = async () => new FBlob({
            blobId: `blob-${content}`,
            content,
            contentLength: content.length,
            dateModified: "",
            utcDateModified: ""
        });
    }
    const loadResults = new LoadResults([]);
    loadResults.addNoteContent(note.noteId, componentId);
    await act(async () => {
        await parent?.handleEvent("entitiesReloaded", { loadResults });
    });
    await vi.advanceTimersByTimeAsync(20);
}

/** Renders an editor of the blocks of `note` that `block` points at. */
async function showBlockEditor(
    note: FNote, block: string, dataSaved?: (savedData: SavedData) => void
) {
    const editor: { content: string; block: string | undefined } = { content: "", block };
    const parent = new Component();
    const container = document.createElement("div");
    document.body.appendChild(container);

    function BlockEditor() {
        currentSpacedUpdate = useEditorSpacedUpdate({
            note,
            noteContext: null,
            noteType: "text",
            block,
            getData: () => ({ content: editor.content, block: editor.block }),
            onContentChange(newContent) {
                editor.content = newContent;
            },
            dataSaved
        });
        return null;
    }

    await act(async () => {
        render(
            <ParentComponent.Provider value={parent}><BlockEditor /></ParentComponent.Provider>,
            container
        );
    });
    await vi.advanceTimersByTimeAsync(20);

    const cleanup = () => {
        render(null, container);
        container.remove();
    };
    return { editor, parent, cleanup };
}
