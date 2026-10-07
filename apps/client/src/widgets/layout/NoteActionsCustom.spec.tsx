import { describe, expect, it } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import { ViewScope } from "../../services/link";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import NoteActionsCustom from "./NoteActionsCustom";

describe("NoteActionsCustom", () => {
    it("offers to copy an image reference only for content it can show, in the note's own view", () => {
        expect(renderCopyButton({})).not.toBeNull();
        expect(renderCopyButton({ isProtected: true })).toBeNull();
        expect(renderCopyButton({}, { viewMode: "attachments" })).toBeNull();
    });

    function renderCopyButton({ isProtected = false }: { isProtected?: boolean }, viewScope: ViewScope = { viewMode: "default" }) {
        const note = buildNote({ title: "Diagram", type: "mermaid" });
        note.isProtected = isProtected;
        const noteContext = { viewScope } as NoteContext;

        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <NoteActionsCustom note={note} ntxId="ntx" noteContext={noteContext} />
            </ParentComponent.Provider>
        );
        return container.querySelector("button.bx-copy");
    }
});
