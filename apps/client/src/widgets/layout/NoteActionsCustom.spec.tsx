import { describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
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

    it("opens the note type's help over the quick edit popup it stands in", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const note = buildNote({ title: "Diagram", type: "mermaid" });
        const container = renderInto(
            <ParentComponent.Provider value={new Component()}>
                <NoteActionsCustom note={note} ntxId="_popup-editor" noteContext={{ viewScope: { viewMode: "default" } } as NoteContext} />
            </ParentComponent.Provider>
        );

        const helpButton = container.querySelector<HTMLElement>("button.bx-help-circle");
        expect(helpButton).not.toBeNull();
        helpButton?.click();
        expect(triggerCommand).toHaveBeenCalledWith("openInNestedPopup", { noteIdOrPath: "_help_s1aBHPd79XYj" });
        triggerCommand.mockRestore();
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
