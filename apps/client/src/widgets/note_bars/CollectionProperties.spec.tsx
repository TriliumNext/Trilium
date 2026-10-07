import { describe, expect, it } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
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
});
