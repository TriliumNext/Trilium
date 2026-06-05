import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------
// Stub the heavy SearchNoteList so the GOT_RESULTS branch renders identifiable, side-effect-free DOM
// (the real one pulls in IntersectionObserver / view-type resolution we don't want to exercise here).
vi.mock("./collections/NoteList", () => ({
    SearchNoteList: (props: Record<string, unknown>) => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((<div
            className="stub-search-note-list"
            data-media={String(props.media ?? "")}
            data-note-id={String((props.note as { noteId?: string } | undefined)?.noteId ?? "")}
            data-note-path={String(props.notePath ?? "")}
            data-ntx-id={String(props.ntxId ?? "")}
            data-tokens={JSON.stringify(props.highlightedTokens ?? null)}
        />) as any)
    )
}));

import type NoteContext from "../components/note_context";
import Component from "../components/component";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import { buildNote } from "../test/easy-froca";
import { NoteContextContext, ParentComponent } from "./react/react_utils";
import SearchResult from "./search_result";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

/** A minimal NoteContext exposing only the fields useNoteContext reads (note/notePath/ntxId). */
function makeContext(overrides: Partial<Record<string, unknown>> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/search1",
        viewScope: { viewMode: "default" },
        ...overrides
    } as unknown as NoteContext;
}

function renderResult(noteContext: NoteContext | null) {
    const root = document.createElement("div");
    container = root;
    document.body.appendChild(root);
    const parentComponent = new Component();
    parent = parentComponent;
    act(() => render((
        <ParentComponent.Provider value={parentComponent}>
            <NoteContextContext.Provider value={noteContext}>
                <SearchResult />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), root));
    return root;
}

function fire(name: string, data: unknown) {
    if (!parent) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => { (parent?.handleEventInChildren as any)(name, data); });
}

function buildSearchNote(opts: { id: string; searchResultsLoaded?: boolean; tokens?: string[]; children?: { id: string; title: string }[] }): FNote {
    const note = buildNote({ id: opts.id, title: "Search", type: "search", children: opts.children });
    note.searchResultsLoaded = opts.searchResultsLoaded;
    note.highlightedTokens = opts.tokens;
    return note;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
});

afterEach(() => {
    const current = container;
    if (current) {
        act(() => render(null, current));
        current.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

describe("SearchResult", () => {
    it("hides itself (no state) when the note is not a search note", () => {
        const note = buildNote({ id: "plain1", title: "Plain", type: "text" });
        const root = renderResult(makeContext({ note, notePath: "root/plain1" }));

        const widget = root.querySelector(".search-result-widget");
        expect(widget?.className).toContain("hidden-ext");
        // None of the three states are rendered.
        expect(root.querySelector(".no-items")).toBeNull();
        expect(root.querySelector(".stub-search-note-list")).toBeNull();
    });

    it("hides itself when there is no note at all", () => {
        const root = renderResult(makeContext({ note: undefined, notePath: undefined }));
        expect(root.querySelector(".search-result-widget")?.className).toContain("hidden-ext");
    });

    it("renders the not-executed placeholder with a search-now trigger button", () => {
        const note = buildSearchNote({ id: "search-ne", searchResultsLoaded: false });
        const root = renderResult(makeContext({ note, notePath: "root/search-ne" }));

        const widget = root.querySelector(".search-result-widget");
        expect(widget?.className).not.toContain("hidden-ext");

        const noItems = root.querySelector(".no-items");
        expect(noItems).not.toBeNull();
        // The "search now" button forwards the searchNotes trigger command.
        const button = noItems?.querySelector("button");
        expect(button?.getAttribute("data-trigger-command")).toBe("searchNotes");
        // The not-executed icon is used.
        expect(noItems?.querySelector("span.bx-file-find")).not.toBeNull();
        expect(root.querySelector(".stub-search-note-list")).toBeNull();
    });

    it("renders the no-results placeholder when the search ran but matched nothing", () => {
        const note = buildSearchNote({ id: "search-empty", searchResultsLoaded: true, children: [] });
        const root = renderResult(makeContext({ note, notePath: "root/search-empty" }));

        const noItems = root.querySelector(".no-items");
        expect(noItems).not.toBeNull();
        // No button (unlike the not-executed state) and the empty-rectangle icon.
        expect(noItems?.querySelector("button")).toBeNull();
        expect(noItems?.querySelector("span.bx-rectangle")).not.toBeNull();
        expect(root.querySelector(".stub-search-note-list")).toBeNull();
    });

    it("renders the note list with highlighted tokens when results are present", () => {
        const note = buildSearchNote({
            id: "search-hit",
            searchResultsLoaded: true,
            tokens: [ "alpha", "beta" ],
            children: [ { id: "child1", title: "C1" } ]
        });
        const root = renderResult(makeContext({ note, notePath: "root/search-hit", ntxId: "ntxA" }));

        const list = root.querySelector(".stub-search-note-list");
        expect(list).not.toBeNull();
        expect(list?.getAttribute("data-media")).toBe("screen");
        expect(list?.getAttribute("data-note-id")).toBe("search-hit");
        expect(list?.getAttribute("data-note-path")).toBe("root/search-hit");
        expect(list?.getAttribute("data-ntx-id")).toBe("ntxA");
        expect(list?.getAttribute("data-tokens")).toBe(JSON.stringify([ "alpha", "beta" ]));
        // The placeholder states must not be shown alongside results.
        expect(root.querySelector(".no-items")).toBeNull();
    });

    it("refreshes on searchRefreshed only for the matching ntxId", () => {
        const note = buildSearchNote({ id: "search-evt", searchResultsLoaded: false });
        const root = renderResult(makeContext({ note, notePath: "root/search-evt", ntxId: "ntxMatch" }));
        expect(root.querySelector(".no-items")).not.toBeNull();
        expect(root.querySelector(".stub-search-note-list")).toBeNull();

        // An event for a different context is ignored (still not-executed).
        note.searchResultsLoaded = true;
        note.highlightedTokens = [ "x" ];
        buildNote({ id: "evtChild", title: "EC" });
        const branchId = `${note.noteId}_evtChild`;
        note.addChild("evtChild", branchId, false);
        fire("searchRefreshed", { ntxId: "someoneElse" });
        expect(root.querySelector(".stub-search-note-list")).toBeNull();

        // Matching ntxId triggers a refresh which now finds results.
        fire("searchRefreshed", { ntxId: "ntxMatch" });
        const list = root.querySelector(".stub-search-note-list");
        expect(list).not.toBeNull();
        expect(list?.getAttribute("data-tokens")).toBe(JSON.stringify([ "x" ]));
    });

    it("refreshes on notesReloaded only when the note's id is included", () => {
        const note = buildSearchNote({ id: "search-reload", searchResultsLoaded: false });
        const root = renderResult(makeContext({ note, notePath: "root/search-reload" }));
        expect(root.querySelector(".no-items")).not.toBeNull();

        // Reload event not mentioning our note → no change.
        note.searchResultsLoaded = true;
        fire("notesReloaded", { noteIds: [ "unrelated" ] });
        // searchResultsLoaded is true now but children are empty → would be NO_RESULTS if refreshed.
        // Since the event was ignored, it's still the not-executed placeholder (button present).
        expect(root.querySelector(".no-items button")).not.toBeNull();

        // Reload event including our note → refresh to NO_RESULTS (no button).
        fire("notesReloaded", { noteIds: [ "search-reload", "other" ] });
        const noItems = root.querySelector(".no-items");
        expect(noItems).not.toBeNull();
        expect(noItems?.querySelector("button")).toBeNull();
    });
});
