/**
 * Regression tests for https://github.com/TriliumNext/Trilium/issues/10575
 * ("on bigger notes. The content of the note tends to 'refresh'").
 *
 * When a big text note opens in auto-read-only mode and the user temporarily enables
 * editing, the `ReadOnlyText` widget stays mounted (hidden) behind the editor. It reads
 * the note content via `useNoteBlob(note, undefined, { reportLoadStateTo: noteContext })`:
 * because no componentId is passed, the WS echo of the user's *own* spaced-update save
 * (which carries the saving component's id) is misclassified as a foreign change. The
 * hidden widget then refetches the whole blob after every save and publishes
 * `contentLoad: "loading"` to the shared note context, which makes the note-detail
 * loading overlay cover the visible editor — the content "disappears and reappears"
 * while typing.
 *
 * These tests assert the *correct* behavior, so they are red while the bug exists and
 * become the regression suite once it is fixed:
 *  - an entity change originating from the widget's own component must trigger neither
 *    a blob refetch nor a `contentLoad` publish;
 *  - a foreign change may refetch, but a hidden widget must never publish `contentLoad`
 *    (the overlay would cover the editor the user is typing into).
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import ReadOnlyText from "./ReadOnlyText";

// Imported by ReadOnlyText only for its content styles; irrelevant (and heavy) in happy-dom.
vi.mock("@triliumnext/ckeditor5", () => ({}));

vi.stubGlobal("logError", vi.fn());
vi.stubGlobal("logInfo", vi.fn());

function setupHarness({ isVisible: initialIsVisible }: { isVisible: boolean }) {
    const note = buildNote({ title: "Big note", type: "text", content: "<p>hello</p>" });

    // Count blob fetches without changing what they resolve to.
    const originalGetBlob = note.getBlob.bind(note);
    const getBlobSpy = vi.fn(originalGetBlob);
    note.getBlob = getBlobSpy;

    const parent = new Component();
    const noteContext = new NoteContext("ro-ntx");

    // Record every contentLoad state published to the shared note context.
    const contentLoadStates: string[] = [];
    const originalSetContextData = noteContext.setContextData.bind(noteContext);
    noteContext.setContextData = ((key, value) => {
        if (key === "contentLoad" && value && typeof value === "object" && "state" in value) {
            contentLoadStates.push(String(value.state));
        }
        return originalSetContextData(key, value);
    }) as typeof noteContext.setContextData;

    const container = document.createElement("div");
    document.body.appendChild(container);

    async function mount(isVisible = initialIsVisible) {
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ReadOnlyText
                        note={note}
                        noteContext={noteContext}
                        ntxId={noteContext.ntxId}
                        parentComponent={parent}
                        viewScope={undefined}
                        isVisible={isVisible}
                    />
                </ParentComponent.Provider>,
                container
            );
        });
        // The blob resolves on a microtask after the first effect flush; a second act
        // cycle lets useNoteBlob's state update land and deliver the content.
        await act(async () => {});
    }

    async function fireContentChange(componentId: string) {
        const loadResults = new LoadResults([]);
        loadResults.addNoteContent(note.noteId, componentId);
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults });
        });
        await act(async () => {});
    }

    return { note, parent, noteContext, contentLoadStates, getBlobSpy, container, mount, fireContentChange };
}

describe("ReadOnlyText reacting to content changes (#10575)", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        if (cleanupContainer) {
            render(null, cleanupContainer);
            cleanupContainer.remove();
            cleanupContainer = undefined;
        }
    });

    it("loads and renders the content on mount, reporting the load state", async () => {
        const harness = setupHarness({ isVisible: true });
        cleanupContainer = harness.container;

        await harness.mount();

        expect(harness.container.textContent).toContain("hello");
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);
        // The initial fetch is exactly what the loading overlay exists for.
        expect(harness.contentLoadStates).toEqual([ "loading", "loaded" ]);
    });

    it("ignores the echo of a save made by its own component (no refetch, no overlay)", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1); // sanity: initial load only

        harness.contentLoadStates.length = 0;

        // The user types into EditableText in the same split; the WS echo of the spaced-update
        // save carries the shared parent component's id.
        await harness.fireContentChange(harness.parent.componentId);

        // The change originated here — refetching the whole blob is pure waste...
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);
        // ...and publishing "loading" makes the note-detail overlay cover the editor mid-typing.
        expect(harness.contentLoadStates).toEqual([]);
    });

    it("does not publish a load state while hidden, even for foreign changes", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        harness.contentLoadStates.length = 0;

        // A change from elsewhere (another split, another device via sync). A hidden widget
        // may refresh its content, but it must not drive the shared loading overlay.
        await harness.fireContentChange("ReactWrappedWidget-remote");

        expect(harness.contentLoadStates).not.toContain("loading");
    });

    it("catches up on skipped own-component changes when displayed again, but only then", async () => {
        const harness = setupHarness({ isVisible: false });
        cleanupContainer = harness.container;

        await harness.mount();
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);

        // Becoming visible without having missed anything must not refetch (the user just
        // toggles between read-only and editable without editing).
        await harness.mount(true);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1);

        // The user edits in the editable view (own-component echo while hidden)...
        await harness.mount(false);
        await harness.fireContentChange(harness.parent.componentId);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(1); // still skipped

        // ...and re-locks the note: the read-only view must not show stale content.
        await harness.mount(true);
        expect(harness.getBlobSpy).toHaveBeenCalledTimes(2);
    });
});

describe("ReadOnlyText ?bookmark= handling", () => {
    let cleanupContainer: HTMLElement | undefined;

    afterEach(() => {
        if (cleanupContainer) {
            render(null, cleanupContainer);
            cleanupContainer.remove();
            cleanupContainer = undefined;
        }
    });

    it("keeps the bookmark until the content renders, then expands the collapsible and consumes it", async () => {
        Element.prototype.scrollIntoView = vi.fn();
        const note = buildNote({
            title: "Collapsible note",
            type: "text",
            content:
                `<details class="trilium-collapsible"><summary>Hidden</summary>` +
                `<p><a id="deep-anchor"></a>target</p></details>`
        });
        const parent = new Component();
        const noteContext = new NoteContext("bm-ntx");
        noteContext.viewScope = { bookmark: "deep-anchor" };

        const container = document.createElement("div");
        document.body.appendChild(container);
        cleanupContainer = container;

        // First act cycle only: the blob resolves on a microtask after the first effect flush
        // (see setupHarness.mount), so this mounts with the content still loading.
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ReadOnlyText
                        note={note}
                        noteContext={noteContext}
                        ntxId={noteContext.ntxId}
                        parentComponent={parent}
                        viewScope={noteContext.viewScope}
                        isVisible={true}
                    />
                </ParentComponent.Provider>,
                container
            );
        });

        // The mount effect ran against an empty container — it must not consume the bookmark
        // yet, or the post-load pass has nothing left to reveal.
        expect(noteContext.viewScope?.bookmark).toBe("deep-anchor");

        // Second act cycle: the blob lands, the content commits, and the [blob] effect fires.
        await act(async () => {});

        const details = container.querySelector("details");
        expect(details?.open).toBe(true);
        expect(noteContext.viewScope?.bookmark).toBeUndefined();
    });
});
