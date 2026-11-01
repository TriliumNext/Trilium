import {
    _getViewData as getViewData, _setModelData as setModelData, type ButtonView, type ClassicEditor,
    type DropdownView, ListItemView, Paragraph, type ViewDocumentSelection, type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import InlineIcon from "./inline_icon.js";
import InlineIconToolbar from "./inline_icon_toolbar.js";

/** The shape of the repository's private register, where a definition can be read back. */
interface ToolbarDefinitions {
    _toolbarDefinitions: Map<string, {
        itemsConfig: string[];
        getRelatedElement: (selection: ViewDocumentSelection) => ViewElement | null;
    }>;
}

describe("InlineIconToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Paragraph, InlineIcon ]);
    });

    /** Puts one icon in the text and selects it, which is what the toolbar responds to. */
    function selectIcon(iconClass: string) {
        setModelData(
            editor.model,
            `<paragraph>Press [<inlineIcon iconClass="${iconClass}"></inlineIcon>]</paragraph>`
        );
    }

    /** What the note stores for that icon, which is where a transform ends up. */
    function storedIcon(iconClass: string) {
        return `<p>Press&nbsp;<span class="tn-icon ${iconClass}"></span></p>`;
    }

    function toolbarDefinition() {
        const repository = editor.plugins
            .get(WidgetToolbarRepository) as unknown as ToolbarDefinitions;

        return repository._toolbarDefinitions.get("inlineIcon");
    }

    /** The dropdown as the toolbar builds it, opened so that its list exists. */
    function openTransformDropdown() {
        const dropdown = editor.ui.componentFactory.create("iconTransform") as DropdownView;

        dropdown.render();
        dropdown.isOpen = true;

        return dropdown;
    }

    /** The list's buttons, with the labels and the mark on the transform in force. */
    function transformButtons(dropdown: DropdownView) {
        return Array.from(dropdown.listView?.items ?? [])
            .filter((item): item is ListItemView => item instanceof ListItemView)
            .map((item) => item.children.first as ButtonView);
    }

    it("loads beside the editing and UI parts", () => {
        expect(editor.plugins.get(InlineIconToolbar)).toBeInstanceOf(InlineIconToolbar);
        expect(InlineIconToolbar.pluginName).toBe("InlineIconToolbar");
        expect(InlineIconToolbar.requires).toContain(WidgetToolbarRepository);
    });

    it("registers one toolbar, and claims a selected icon but nothing else", () => {
        const definition = toolbarDefinition();
        const selection = editor.editing.view.document.selection;

        expect(definition?.itemsConfig).toEqual([ "changeIcon", "iconTransform" ]);

        selectIcon("bx bx-cog");
        expect(definition?.getRelatedElement(selection)?.hasClass("tn-icon")).toBe(true);

        setModelData(editor.model, "<paragraph>[Press] it</paragraph>");
        expect(definition?.getRelatedElement(selection)).toBeNull();
    });

    it("reports the transform the selected icon carries, and applies only to one", () => {
        const command = editor.commands.get("iconTransform");

        selectIcon("bx bx-cog");
        expect({ value: command?.value, isEnabled: command?.isEnabled })
            .toEqual({ value: null, isEnabled: true });

        selectIcon("bx bx-sidebar bx-flip-horizontal");
        expect(command?.value).toBe("bx-flip-horizontal");

        setModelData(editor.model, "<paragraph>[Press] it</paragraph>");
        expect({ value: command?.value, isEnabled: command?.isEnabled })
            .toEqual({ value: null, isEnabled: false });

        selectIcon("bx bx-cog");
        editor.enableReadOnlyMode("spec");
        expect(command?.isEnabled).toBe(false);
    });

    it("sets, replaces and clears the transform, keeping the pack's own classes", () => {
        selectIcon("bx bx-sidebar");

        editor.execute("iconTransform", { transform: "bx-flip-horizontal" });
        expect(editor.getData()).toBe(storedIcon("bx bx-sidebar bx-flip-horizontal"));

        // One transform replaces another rather than joining it: both set `transform` in the
        // stylesheet, so only the rule declared last would apply.
        editor.execute("iconTransform", { transform: "bx-rotate-90" });
        expect(editor.getData()).toBe(storedIcon("bx bx-sidebar bx-rotate-90"));

        editor.execute("iconTransform", { transform: null });
        expect(editor.getData()).toBe(storedIcon("bx bx-sidebar"));
    });

    it("redraws the icon being edited, which a plain downcast would not", () => {
        selectIcon("bx bx-sidebar");

        editor.execute("iconTransform", { transform: "bx-flip-vertical" });

        expect(getViewData(editor.editing.view, { withoutSelection: true }))
            .toContain("bx-flip-vertical");
    });

    it("offers upright and every transform, marking the one in force", () => {
        selectIcon("bx bx-sidebar bx-rotate-180");

        const buttons = transformButtons(openTransformDropdown());

        expect(buttons.map((button) => button.label)).toEqual([
            "No transform", "Rotate 90°", "Rotate 180°", "Rotate 270°",
            "Flip horizontally", "Flip vertically"
        ]);
        expect(buttons.filter((button) => button.isOn).map((button) => button.label))
            .toEqual([ "Rotate 180°" ]);
    });

    it("transforms the icon from the list and hands focus back to the text", () => {
        selectIcon("bx bx-sidebar");
        const focus = vi.spyOn(editor.editing.view, "focus");

        const buttons = transformButtons(openTransformDropdown());
        buttons.find((button) => button.label === "Flip horizontally")?.fire("execute");

        expect(editor.getData()).toBe(storedIcon("bx bx-sidebar bx-flip-horizontal"));
        expect(focus).toHaveBeenCalled();
    });

    it("disables the dropdown where no icon is selected", () => {
        setModelData(editor.model, "<paragraph>[]Press it</paragraph>");

        expect(openTransformDropdown().isEnabled).toBe(false);
    });

});
