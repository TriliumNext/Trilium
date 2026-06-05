import { MetadataResponse, NoteSizeResponse, SubtreeSizeResponse } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// `isExperimentalFeatureEnabled("new-layout")` is captured at module load (NoteInfoTab's `isNewLayout`),
// so mock the feature module rather than trying to flip it at runtime. Default = false (legacy layout),
// which renders the created/modified rows.
vi.mock("../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));

import Component from "../../components/component";
import froca from "../../services/froca";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { flush, makeLoadResults, renderHook } from "../../test/render-hook";
import { ParentComponent } from "../react/react_utils";
import NoteInfoTab, { NoteSizeWidget, useNoteMetadata } from "./NoteInfoTab";

// --- Render helper for the full component (needs the ParentComponent provider for useTriliumEvent) -

let container: HTMLDivElement | undefined;
let parent: Component;

function renderTab(note: Parameters<typeof NoteInfoTab>[0]["note"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteInfoTab note={note} />
            </ParentComponent.Provider>,
            container
        );
    });
    return container;
}

const metadata: MetadataResponse = {
    dateCreated: "2024-01-02 03:04:05.000+0000",
    utcDateCreated: "2024-01-02 03:04:05.000Z",
    dateModified: "2024-02-03 04:05:06.000+0000",
    utcDateModified: "2024-02-03 04:05:06.000Z"
};

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    parent = new Component();
    vi.clearAllMocks();
    vi.useRealTimers();
});

afterEach(async () => {
    await act(async () => {});
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
});

// --- Full component -------------------------------------------------------------------------------

describe("NoteInfoTab component", () => {
    it("renders nothing inside the widget when note is null", () => {
        const get = vi.fn(async () => undefined);
        Object.assign(server, { get });

        const root = renderTab(null);
        const widget = root.querySelector(".note-info-widget");
        expect(widget).not.toBeNull();
        // No note → no info rows at all.
        expect(root.querySelectorAll(".note-info-item").length).toBe(0);
        expect(root.querySelector(".note-info-id")).toBeNull();
        // refresh() short-circuits when there is no note, so metadata is never requested.
        expect(get).not.toHaveBeenCalled();
    });

    it("renders id/type/mime/size rows and created+modified for a note (legacy layout)", async () => {
        const note = buildNote({ id: "note1", title: "Note 1", type: "code" });
        const get = vi.fn(async (url: string) => {
            if (url === "notes/note1/metadata") return metadata;
            return undefined;
        });
        Object.assign(server, { get });

        const root = renderTab(note);
        await flush();

        expect(root.querySelector(".note-info-id")?.textContent).toBe("note1");
        expect(root.querySelector(".note-info-type")?.textContent).toBe("code");
        // mime is "text/html" from buildNote.
        expect(root.querySelector(".note-info-mime")?.textContent).toBe("(text/html)");
        // Legacy layout shows created + modified rows in addition to id/type/size.
        expect(root.querySelectorAll(".note-info-item").length).toBe(5);

        // Metadata dates are formatted (non-empty) once the server.get resolves.
        const selectable = [ ...root.querySelectorAll(".selectable-text") ].map(e => e.textContent ?? "");
        // created + modified date cells should be present and formatted (contain a digit).
        const dateCells = selectable.filter(t => /\d/.test(t) && t !== "note1");
        expect(dateCells.length).toBeGreaterThanOrEqual(2);

        expect(get).toHaveBeenCalledWith("notes/note1/metadata");
    });

    it("hides the mime span when the note has no mime", () => {
        const note = buildNote({ id: "n2", title: "No Mime" });
        // Force an empty mime to hit the falsy branch.
        Object.defineProperty(note, "mime", { value: "", configurable: true });
        Object.assign(server, { get: vi.fn(async () => undefined) });

        const root = renderTab(note);
        expect(root.querySelector(".note-info-type")?.textContent).toBe("text");
        expect(root.querySelector(".note-info-mime")).toBeNull();
    });

    it("shows the calculate link before sizes are requested, then computes sizes on click", async () => {
        const note = buildNote({ id: "n3", title: "Sized" });
        const noteSize: NoteSizeResponse = { noteSize: 2048 };
        const subtreeSize: SubtreeSizeResponse = { subTreeNoteCount: 3, subTreeSize: 5120 };
        const get = vi.fn(async (url: string) => {
            if (url === "notes/n3/metadata") return metadata;
            if (url === "stats/note-size/n3") return noteSize;
            if (url === "stats/subtree-size/n3") return subtreeSize;
            return undefined;
        });
        Object.assign(server, { get });

        const root = renderTab(note);
        await flush();

        // Before requesting: the calculate link is shown, no subtree size yet.
        const link = root.querySelector("a.tn-link");
        expect(link).not.toBeNull();
        expect(root.querySelector(".subtree-size")).toBeNull();

        // Click the calculate link → schedules a setTimeout(0) which fetches size + subtree size.
        await act(async () => {
            (link as HTMLElement | null)?.click();
        });
        await flush();
        // Give the setTimeout(0) inside requestSizeInfo a chance to settle.
        await flush();

        expect(get).toHaveBeenCalledWith("stats/note-size/n3");
        expect(get).toHaveBeenCalledWith("stats/subtree-size/n3");
        // The note size should be rendered (2048 B → 2 KiB).
        expect(root.querySelector(".note-size")?.textContent).toContain("KiB");
        // subtreeSize count > 1 → subtree-size span renders.
        expect(root.querySelector(".subtree-size")).not.toBeNull();
        // After sizes resolve, the calculate link disappears.
        expect(root.querySelector("a.tn-link")).toBeNull();
    });
});

// --- NoteSizeWidget (presentational branches) -----------------------------------------------------

describe("NoteSizeWidget", () => {
    function renderWidget(props: Omit<Parameters<typeof NoteSizeWidget>[0], never>) {
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(<NoteSizeWidget {...props} />, container));
        return container;
    }

    it("shows the calculate link when not loading and no sizes are present", () => {
        const requestSizeInfo = vi.fn();
        const root = renderWidget({
            isLoading: false,
            noteSizeResponse: undefined,
            subtreeSizeResponse: undefined,
            requestSizeInfo
        });
        const link = root.querySelector("a.tn-link");
        expect(link).not.toBeNull();
        expect(root.querySelector(".bx-loader")).toBeNull();
        (link as HTMLElement | null)?.click();
        expect(requestSizeInfo).toHaveBeenCalledTimes(1);
    });

    it("shows the loading spinner and hides the calculate link while loading", () => {
        const root = renderWidget({
            isLoading: true,
            noteSizeResponse: undefined,
            subtreeSizeResponse: undefined,
            requestSizeInfo: vi.fn()
        });
        // While loading the calculate link is suppressed and the spinner is shown.
        expect(root.querySelector("a.tn-link")).toBeNull();
        expect(root.querySelector(".bx-loader")).not.toBeNull();
    });

    it("renders note size and omits subtree-size when count is 1", () => {
        const root = renderWidget({
            isLoading: false,
            noteSizeResponse: { noteSize: 0 },
            subtreeSizeResponse: { subTreeNoteCount: 1, subTreeSize: 0 },
            requestSizeInfo: vi.fn()
        });
        // sizes present → no calculate link.
        expect(root.querySelector("a.tn-link")).toBeNull();
        expect(root.querySelector(".note-size")?.textContent).toBe("0 B");
        // count === 1 → subtree-size span is omitted.
        expect(root.querySelector(".subtree-size")).toBeNull();
    });

    it("renders subtree-size when count is greater than 1", () => {
        const root = renderWidget({
            isLoading: false,
            noteSizeResponse: { noteSize: 100 },
            subtreeSizeResponse: { subTreeNoteCount: 5, subTreeSize: 4096 },
            requestSizeInfo: vi.fn()
        });
        expect(root.querySelector(".subtree-size")).not.toBeNull();
    });
});

// --- useNoteMetadata hook -------------------------------------------------------------------------

describe("useNoteMetadata", () => {
    it("fetches metadata for a note and exposes it", async () => {
        const note = buildNote({ id: "h1", title: "Hooked" });
        const get = vi.fn(async (url: string) => {
            if (url === "notes/h1/metadata") return metadata;
            return undefined;
        });
        Object.assign(server, { get });

        const h = renderHook(() => useNoteMetadata(note), { parent });
        await flush();

        expect(get).toHaveBeenCalledWith("notes/h1/metadata");
        expect(h.result.current.metadata).toEqual(metadata);
        expect(h.result.current.isLoading).toBe(false);
        expect(h.result.current.noteSizeResponse).toBeUndefined();
        expect(h.result.current.subtreeSizeResponse).toBeUndefined();
    });

    it("does not request metadata when there is no note", async () => {
        const get = vi.fn(async () => undefined);
        Object.assign(server, { get });

        const h = renderHook(() => useNoteMetadata(null), { parent });
        await flush();

        expect(get).not.toHaveBeenCalled();
        expect(h.result.current.metadata).toBeUndefined();
    });

    it("requestSizeInfo is a no-op when there is no note", async () => {
        const get = vi.fn(async () => undefined);
        Object.assign(server, { get });

        const h = renderHook(() => useNoteMetadata(null), { parent });
        await flush();

        await act(async () => {
            h.result.current.requestSizeInfo();
        });
        await flush();

        expect(h.result.current.isLoading).toBe(false);
        expect(get).not.toHaveBeenCalled();
    });

    it("requestSizeInfo fetches note + subtree sizes and clears the loading flag", async () => {
        const note = buildNote({ id: "h2", title: "Sizer" });
        const noteSize: NoteSizeResponse = { noteSize: 1024 };
        const subtreeSize: SubtreeSizeResponse = { subTreeNoteCount: 2, subTreeSize: 2048 };
        const get = vi.fn(async (url: string) => {
            if (url === "notes/h2/metadata") return metadata;
            if (url === "stats/note-size/h2") return noteSize;
            if (url === "stats/subtree-size/h2") return subtreeSize;
            return undefined;
        });
        Object.assign(server, { get });

        const h = renderHook(() => useNoteMetadata(note), { parent });
        await flush();

        await act(async () => {
            h.result.current.requestSizeInfo();
        });
        await flush();
        await flush();

        expect(get).toHaveBeenCalledWith("stats/note-size/h2");
        expect(get).toHaveBeenCalledWith("stats/subtree-size/h2");
        expect(h.result.current.noteSizeResponse).toEqual(noteSize);
        expect(h.result.current.subtreeSizeResponse).toEqual(subtreeSize);
        expect(h.result.current.isLoading).toBe(false);
    });

    it("debounced-refreshes when entitiesReloaded reports this note as reloaded", async () => {
        const note = buildNote({ id: "h3", title: "Reloaded" });
        const get = vi.fn(async (url: string) => {
            if (url === "notes/h3/metadata") return metadata;
            return undefined;
        });
        Object.assign(server, { get });

        vi.useFakeTimers();
        const h = renderHook(() => useNoteMetadata(note, 50), { parent });
        // initial refresh effect.
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        get.mockClear();

        // Fire entitiesReloaded → the handler schedules a debounced refresh.
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ reloadedNoteIds: [ "h3" ] })
        });
        // Advance past the debounce window so the trailing call fires.
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });

        expect(get).toHaveBeenCalledWith("notes/h3/metadata");
        vi.useRealTimers();
    });

    it("debounced-refreshes when entitiesReloaded reports this note's content reloaded", async () => {
        const note = buildNote({ id: "h4", title: "ContentReloaded" });
        const get = vi.fn(async (url: string) => {
            if (url === "notes/h4/metadata") return metadata;
            return undefined;
        });
        Object.assign(server, { get });

        vi.useFakeTimers();
        const h = renderHook(() => useNoteMetadata(note, 50), { parent });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        get.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ contentReloadedNoteIds: [ "h4" ] })
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });

        expect(get).toHaveBeenCalledWith("notes/h4/metadata");
        vi.useRealTimers();
    });

    it("ignores entitiesReloaded for an unrelated note", async () => {
        const note = buildNote({ id: "h5", title: "Untouched" });
        const get = vi.fn(async (url: string) => {
            if (url === "notes/h5/metadata") return metadata;
            return undefined;
        });
        Object.assign(server, { get });

        vi.useFakeTimers();
        const h = renderHook(() => useNoteMetadata(note, 50), { parent });
        await act(async () => { await vi.runOnlyPendingTimersAsync(); });
        get.mockClear();

        // A different note reloaded → no refresh.
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ reloadedNoteIds: [ "other" ] })
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(100); });

        expect(get).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
