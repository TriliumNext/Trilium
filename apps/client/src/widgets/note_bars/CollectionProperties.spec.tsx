import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type TabManager from "../../components/tab_manager";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import CollectionProperties from "./CollectionProperties";

describe("CollectionProperties", () => {
    it("focuses the view type switcher on its shortcut only for its own note context", async () => {
        const note = buildNote({ title: "Collection", type: "book" });
        const noteContext = new NoteContext("ntx-split-2");
        noteContext.noteId = note.noteId;
        const parent = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <CollectionProperties note={note} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
        const switcher = container.querySelector(".left-container button");
        expect(switcher).toBeTruthy();

        await parent.handleEvent("toggleRibbonTabBookProperties", { ntxId: "ntx-split-1" });
        expect(document.activeElement).not.toBe(switcher);

        await parent.handleEvent("toggleRibbonTabBookProperties", { ntxId: "ntx-split-2" });
        expect(document.activeElement).toBe(switcher);
    });

    it("opens every result with the terms the find bar looks for, as a single click does", async () => {
        const note = buildNote({
            id: "search1", title: "Search", type: "search",
            children: [ { id: "result1", title: "Kôň" }, { id: "result2", title: "Horse" } ]
        });
        note.highlightedTokens = [ "kon" ];
        vi.spyOn(server, "post").mockResolvedValue({
            results: [ { noteId: "result1", matchedTerms: [ "kôň" ] } ]
        });
        const openTab = vi.fn().mockResolvedValue(undefined);
        appContext.tabManager = { openTabWithNoteWithHoisting: openTab } as unknown as TabManager;

        const parent = new Component();
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={new NoteContext("ntx1")}>
                    <CollectionProperties note={note} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
        const button = container.querySelector<HTMLElement>(".right-container .icon-action");
        expect(button).toBeTruthy();
        await act(async () => {
            button?.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(server.post).toHaveBeenCalledWith("search-note/search1/result-details", {
            noteIds: [ "result1", "result2" ]
        });
        // A result without matched terms falls back to the query's tokens.
        expect(openTab.mock.calls).toEqual([
            [ "result1", { activate: false, viewScope: { searchTerms: [ "kôň" ] } } ],
            [ "result2", { activate: true, viewScope: { searchTerms: [ "kon" ] } } ]
        ]);
    });
});

const originalTabManager = appContext.tabManager;

afterEach(() => {
    appContext.tabManager = originalTabManager;
    vi.restoreAllMocks();
});
