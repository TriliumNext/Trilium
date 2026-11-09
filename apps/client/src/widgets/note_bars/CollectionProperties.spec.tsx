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
import { bookPropertiesConfig } from "./collection-properties-config";
import CollectionProperties, { CollectionControls } from "./CollectionProperties";

describe("CollectionProperties", () => {
    it("leaves the nesting depth to the properties dialogs, out of every settings dropdown", () => {
        for (const { properties } of Object.values(bookPropertiesConfig)) {
            const bindsDepth = properties.some((property) =>
                "bindToLabel" in property && property.bindToLabel === "maxNestingDepth");
            expect(bindsDepth).toBe(false);
        }
    });

    it("puts the view's left controls after the view type switcher and the settings", () => {
        const note = buildNote({ title: "Collection", type: "book" });
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <CollectionProperties note={note} leftChildren={<span className="view-control" />} />
            </ParentComponent.Provider>
        );

        const left = container.querySelector(".left-container");
        expect(left?.children.length).toBeGreaterThan(1);
        expect(left?.lastElementChild?.className).toBe("view-control");
    });

    it("leaves out the view type switcher and the settings where `CollectionControls` says so", () => {
        const note = buildNote({ title: "Collection", type: "book" });
        const render = (controls: { viewTypeSwitcher: boolean; viewOptions: boolean }) => renderInto(
            <ParentComponent.Provider value={new Component()}>
                <CollectionControls.Provider value={controls}>
                    <CollectionProperties note={note} leftChildren={<span className="view-control" />} />
                </CollectionControls.Provider>
            </ParentComponent.Provider>
        );
        const shown = (container: HTMLElement) => ({
            switcher: !!container.querySelector(".left-container .dropdown-toggle:not(.bx-cog)"),
            settings: !!container.querySelector(".left-container .bx-cog")
        });

        expect(shown(render({ viewTypeSwitcher: true, viewOptions: true })))
            .toStrictEqual({ switcher: true, settings: true });
        expect(shown(render({ viewTypeSwitcher: false, viewOptions: true })))
            .toStrictEqual({ switcher: false, settings: true });
        const neither = render({ viewTypeSwitcher: false, viewOptions: false });
        expect(shown(neither)).toStrictEqual({ switcher: false, settings: false });
        expect(neither.querySelector(".left-container .view-control")).not.toBeNull();
    });

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
