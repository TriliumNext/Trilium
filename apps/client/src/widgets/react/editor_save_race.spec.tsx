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
import { deferred } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import FBlob from "../../entities/fblob";
import type FNote from "../../entities/fnote";
import LoadResults from "../../services/load_results";
import server from "../../services/server";
import type SpacedUpdate from "../../services/spaced_update";
import { buildNote } from "../../test/easy-froca";
import { type SavedData, useEditorSpacedUpdate } from "./hooks";
import { noteSavedDataStore } from "./NoteStore";
import { ParentComponent } from "./react_utils";

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

let currentSpacedUpdate: SpacedUpdate<SavedData | undefined> | undefined;

/** Stand-in for EditableText: `editor.content` plays the role of the live CKEditor document. */
function FakeEditor({ note, noteContext, editor }: {
    note: FNote;
    noteContext: NoteContext | null;
    editor: { content: string };
}) {
    currentSpacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "text",
        getData: () => ({ content: editor.content }),
        onContentChange(newContent) {
            editor.content = newContent;
        }
    });
    return null;
}

function getSpacedUpdate(): SpacedUpdate<SavedData | undefined> {
    if (!currentSpacedUpdate) {
        throw new Error("Harness was not rendered yet");
    }
    return currentSpacedUpdate;
}

function setupEditorHarness({ withParent = false } = {}) {
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

    const editor = { content: "" };
    const puts: { url: string; content: string }[] = [];
    server.put = vi.fn(async (url: string, data: { content: string }) => {
        puts.push({ url, content: data.content });
        return {};
    }) as typeof server.put;

    const container = document.createElement("div");
    document.body.appendChild(container);

    const parent = withParent ? new Component() : null;
    const noteContext = withParent ? new NoteContext("test-ntx") : null;

    async function show(note: FNote) {
        await act(async () => {
            const editorEl = <FakeEditor note={note} noteContext={noteContext} editor={editor} />;
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

    it("keeps unsaved changes when another editor saves the note, and reloads an editor without any", async () => {
        const harness = setupEditorHarness({ withParent: true });
        cleanupContainer = harness.container;
        const { noteA, editor, parent, show } = harness;
        await show(noteA);
        const savedElsewhere = async (content: string) => {
            noteA.getBlob = async () => new FBlob({
                blobId: `blob-${content}`,
                content,
                contentLength: content.length,
                dateModified: "",
                utcDateModified: ""
            });
            const loadResults = new LoadResults([]);
            loadResults.addNoteContent(noteA.noteId, "another-editor");
            await act(async () => {
                await parent?.handleEvent("entitiesReloaded", { loadResults });
            });
            await vi.advanceTimersByTimeAsync(20);
        };

        editor.content = "AAA typed here";
        getSpacedUpdate().scheduleUpdate();
        await savedElsewhere("AAA typed elsewhere");
        expect(editor.content).toBe("AAA typed here");

        await vi.advanceTimersByTimeAsync(1500);
        await savedElsewhere("AAA typed elsewhere again");
        expect(editor.content).toBe("AAA typed elsewhere again");
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
            .mockImplementation(async (url: string) => ({ content: `<p>${url}</p>` }));
        const put = vi.spyOn(server, "put").mockResolvedValue({});
        const { editor, parent, cleanup } = await showBlockEditor(note, "a:b");
        const url = `notes/${note.noteId}/blocks`;

        expect(editor.content).toBe(`<p>${url}?block=a%3Ab</p>`);
        expect(noteSavedDataStore.get(note.noteId)).toBeUndefined();

        editor.content = "<p>Edited</p>";
        editor.block = "a:n";
        getSpacedUpdate().scheduleUpdate();
        await vi.advanceTimersByTimeAsync(1500);
        expect(put).toHaveBeenLastCalledWith(
            `${url}?block=a%3Ab`, { content: "<p>Edited</p>" }, parent.componentId
        );
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
        expect(put).toHaveBeenLastCalledWith(
            `${url}?block=a%3An`, { content: "<p>Edited again</p>" }, parent.componentId
        );
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
});

/** Renders an editor of the blocks of `note` that `block` points at. */
async function showBlockEditor(note: FNote, block: string) {
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
            }
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
