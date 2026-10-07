import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import NoteTitleActions from "./NoteTitleActions";

// The attribute grid has a spec of its own; here one cell is enough for the section to show.
vi.mock("../PromotedAttributes", () => ({
    usePromotedAttributeData: () => [ [ { uniqueId: "cell" } ], () => {} ],
    PromotedAttributesContent: () => <div className="promoted-attributes-stub" />
}));
vi.mock("../NoteDetail", () => ({
    getExtendedWidgetType: async () => "text",
    checkFullHeight: () => true
}));
vi.mock("./NoteTypeSwitcher", () => ({ default: () => null }));

describe("NoteTitleActions", () => {
    it("toggles the promoted attributes on their shortcut only for its own note context", async () => {
        const note = buildNote({ title: "Text", type: "text" });
        const noteContext = new NoteContext("ntx-split-2");
        noteContext.noteId = note.noteId;
        noteContext.viewScope = { viewMode: "default" };
        const parent = new Component();
        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(
                <ParentComponent.Provider value={parent}>
                    <NoteContextContext.Provider value={noteContext}>
                        <NoteTitleActions />
                    </NoteContextContext.Provider>
                </ParentComponent.Provider>
            );
        });
        const expanded = () => container?.querySelector("[aria-expanded]")?.getAttribute("aria-expanded");
        expect(expanded()).toBe("false");

        await act(async () => { await parent.handleEvent("toggleRibbonTabPromotedAttributes", { ntxId: "ntx-split-1" }); });
        expect(expanded()).toBe("false");

        await act(async () => { await parent.handleEvent("toggleRibbonTabPromotedAttributes", { ntxId: "ntx-split-2" }); });
        expect(expanded()).toBe("true");
    });
});
