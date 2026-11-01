import { ClassicEditor, Essentials, Paragraph, _setModelData as setModelData } from "ckeditor5";
import Admonition from "./admonition.js";
import { ADMONITION_TYPE_NAMES } from "./admonition_command.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import AdmonitionTypeDropdown from "./admonition_type_dropdown.js";

// ---- Typed interfaces for the dropdown internals ----

interface ListButtonView {
    commandParam?: string;
    label?: string;
    class?: string;
    isOn?: boolean;
    fire(event: string): void;
}

interface ListItemView {
    children: {
        get(idx: number): ListButtonView;
    };
}

interface ListView {
    items: {
        length: number;
        get(idx: number): ListItemView;
    };
}

interface DropdownView {
    isOpen: boolean;
    isEnabled: boolean;
    buttonView: { label: string; withText: boolean };
    panelView: { children: { get(idx: number): ListView | null } };
    fire(event: string, data?: unknown): void;
}

/**
 * Opens the dropdown to trigger the lazy panel population, then returns the ListView.
 * CKEditor's addListToDropdown defers adding the list until the panel is first opened.
 */
function openDropdown(dropdown: DropdownView): ListView {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) {
        throw new Error("Dropdown panel did not render a list view after opening.");
    }
    return listView;
}

// ---- Helper: place the selection inside the first admonition in the model ----

function selectInsideFirstAdmonition(editor: ClassicEditor): void {
    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            return;
        }
        const aside = root.getChild(0);
        if (!aside || !aside.is("element")) {
            return;
        }
        const para = aside.getChild(0);
        if (!para || !para.is("element")) {
            return;
        }
        writer.setSelection(writer.createPositionAt(para, 0));
    });
}

describe("AdmonitionTypeDropdown", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Admonition, AdmonitionTypeDropdown], {
            toolbar: { items: ["admonitionTypeDropdown"] }
        });
    });

    it("loads the plugin", () => {
        expect(editor.plugins.get(AdmonitionTypeDropdown)).toBeInstanceOf(AdmonitionTypeDropdown);
    });

    it("registers the admonitionTypeDropdown component in the factory", () => {
        expect(editor.ui.componentFactory.has("admonitionTypeDropdown")).toBe(true);
    });

    it("requires the Admonition plugin", () => {
        expect(AdmonitionTypeDropdown.requires).toContain(Admonition);
    });

    it("creates a dropdown view with withText set on the button", () => {
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        expect(dropdown.buttonView.withText).toBe(true);
    });

    it("dropdown is disabled when not inside an admonition (command.value is false)", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const command = editor.commands.get("admonition") as { value: unknown };
        expect(command.value).toBe(false);
        expect(dropdown.isEnabled).toBe(false);
    });

    it("dropdown is enabled when inside an admonition (command.value is truthy)", () => {
        editor.setData('<aside class="admonition note"><p>Hello</p></aside>');
        selectInsideFirstAdmonition(editor);
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const command = editor.commands.get("admonition") as { value: unknown };
        expect(command.value).not.toBe(false);
        expect(dropdown.isEnabled).toBe(true);
    });

    it("button label is empty string when command.value is false", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const command = editor.commands.get("admonition") as { value: unknown };
        expect(command.value).toBe(false);
        expect(dropdown.buttonView.label).toBe("");
    });

    it("button label shows the type title when inside an admonition", () => {
        editor.setData('<aside class="admonition note"><p>Hello</p></aside>');
        selectInsideFirstAdmonition(editor);
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const command = editor.commands.get("admonition") as { value: string };
        expect(command.value).toBe("note");
        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // title.
        expect(dropdown.buttonView.label).toBe("Note");
    });

    it("button label falls back to the raw value for unknown admonition types", () => {
        // Sets an admonitionType value that has no title, so the untranslated-fallback path of
        // `getAdmonitionTitle()` is exercised.
        editor.setData('<aside class="admonition note"><p>Hello</p></aside>');
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (!root) {
                return;
            }
            const aside = root.getChild(0);
            if (!aside || !aside.is("element")) {
                return;
            }
            writer.setAttribute("admonitionType", "custom-unknown" as unknown as string, aside);
            const para = aside.getChild(0);
            if (!para || !para.is("element")) {
                return;
            }
            writer.setSelection(writer.createPositionAt(para, 0));
        });

        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        // "custom-unknown" has no title, so the label falls back to the raw value.
        expect(dropdown.buttonView.label).toBe("custom-unknown");
    });

    it("dropdown panel contains one titled list item per admonition type", () => {
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        expect(listView.items.length).toBe(ADMONITION_TYPE_NAMES.length);

        const items = [];
        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            items.push({ type: button.commandParam, label: button.label });
        }

        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // title.
        expect(items).toEqual([
            { type: "note", label: "Note" },
            { type: "tip", label: "Tip" },
            { type: "important", label: "Important" },
            { type: "caution", label: "Caution" },
            { type: "warning", label: "Warning" }
        ]);
    });

    it("each list item has the correct CSS classes", () => {
        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            const type = button.commandParam;
            if (type) {
                expect(button.class).toContain("ck-tn-admonition-option");
                expect(button.class).toContain(`ck-tn-admonition-${type}`);
            }
        }
    });

    it("list item isOn is true when command.value matches the type", () => {
        editor.setData('<aside class="admonition tip"><p>Hello</p></aside>');
        selectInsideFirstAdmonition(editor);

        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        const command = editor.commands.get("admonition") as { value: unknown };
        expect(command.value).toBe("tip");

        let tipButton: ListButtonView | null = null;
        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button.commandParam === "tip") {
                tipButton = button;
                break;
            }
        }

        expect(tipButton).not.toBeNull();
        expect(tipButton?.isOn).toBe(true);
    });

    it("list item isOn is false for types not matching the current command.value", () => {
        editor.setData('<aside class="admonition tip"><p>Hello</p></aside>');
        selectInsideFirstAdmonition(editor);

        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        for (let i = 0; i < listView.items.length; i++) {
            const button = listView.items.get(i).children.get(0);
            if (button.commandParam !== "tip") {
                expect(button.isOn).toBe(false);
            }
        }
    });

    it("executes the admonition command with the selected type when a list item fires execute", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const spy = vi.spyOn(editor, "execute");

        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // Fire execute on the first item — should be "note".
        const firstButton = listView.items.get(0).children.get(0);
        expect(firstButton.commandParam).toBe("note");

        firstButton.fire("execute");

        expect(spy).toHaveBeenCalledWith("admonition", { forceValue: "note" });
    });

    it("focuses the editor view after a dropdown item executes", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const focusSpy = vi.spyOn(editor.editing.view, "focus");

        const dropdown = editor.ui.componentFactory.create("admonitionTypeDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        const firstButton = listView.items.get(0).children.get(0);
        firstButton.fire("execute");

        expect(focusSpy).toHaveBeenCalled();
    });
});
