import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Admonition from "./admonition.js";
import type AdmonitionCommand from "./admonition_command.js";
import { ADMONITION_TYPE_NAMES, type AdmonitionType } from "./admonition_command.js";
import AdmonitionUI, { getAdmonitionTitle } from "./admonition_ui.js";

// ---- Typed interfaces for the dropdown internals ----

interface ListButtonView {
    commandParam?: string;
    label?: string;
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

interface SplitDropdownView {
    isOpen: boolean;
    isEnabled: boolean;
    buttonView: SplitButtonView;
    panelView: { children: { get(idx: number): ListView | null } };
    fire(event: string, data?: unknown): void;
}

/**
 * Opens the dropdown to trigger the lazy panel population, then returns the ListView.
 * CKEditor's addListToDropdown defers adding the list until the panel is first opened.
 */
function openDropdown(dropdown: SplitDropdownView): ListView {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) {
        throw new Error("Dropdown panel did not render a list view after opening.");
    }
    return listView;
}

function createButton(editor: ClassicEditor): SplitDropdownView {
    return editor.ui.componentFactory.create("admonition") as unknown as SplitDropdownView;
}

describe("AdmonitionUI", () => {
    describe("with the editing plugin loaded", () => {
        let editor: ClassicEditor;
        let command: AdmonitionCommand;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph, Admonition]);
            command = editor.commands.get("admonition") as AdmonitionCommand;
        });

        it("registers the admonition split button", () => {
            const dropdown = createButton(editor);
            const button = dropdown.buttonView;

            expect(button).toBeInstanceOf(SplitButtonView);
            expect(button.label).toBe("Admonition");
            expect(button.icon).toContain("<svg");
            expect(button.isToggleable).toBe(true);
            expect(button.tooltip).toBe(true);
        });

        it("applies the previous choice when the split button itself is executed", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.execute("admonition", { forceValue: "tip" });
            editor.execute("admonition");

            const dropdown = createButton(editor);
            const focusSpy = vi.spyOn(editor.editing.view, "focus");

            dropdown.buttonView.fire("execute");

            expect(command.value).toBe("tip");
            expect(focusSpy).toHaveBeenCalled();
        });

        it("binds the split button isOn and the dropdown isEnabled to the command", () => {
            const dropdown = createButton(editor);

            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            expect(dropdown.buttonView.isOn).toBe(false);
            expect(dropdown.isEnabled).toBe(true);

            editor.execute("admonition", { forceValue: "note" });

            expect(dropdown.buttonView.isOn).toBe(true);
        });

        it("offers every admonition type in the dropdown", () => {
            const dropdown = createButton(editor);
            const listView = openDropdown(dropdown);

            expect(listView.items.length).toBe(ADMONITION_TYPE_NAMES.length);

            const items = [];
            for (let i = 0; i < listView.items.length; i++) {
                const button = listView.items.get(i).children.get(0);
                items.push({ type: button.commandParam, label: button.label });
            }

            // No dictionary is configured here, so `t()` renders the message id, which is the
            // English title.
            expect(items).toEqual([
                { type: "note", label: "Note" },
                { type: "tip", label: "Tip" },
                { type: "important", label: "Important" },
                { type: "caution", label: "Caution" },
                { type: "warning", label: "Warning" }
            ]);
        });


        it("applies the picked type when a dropdown item is executed", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            const dropdown = createButton(editor);
            const listView = openDropdown(dropdown);
            const focusSpy = vi.spyOn(editor.editing.view, "focus");
            const tipButton = listView.items.get(1).children.get(0);

            expect(tipButton.commandParam).toBe("tip");

            // List items delegate `execute` to the dropdown, which reads `evt.source.commandParam`.
            tipButton.fire("execute");

            expect(command.value).toBe("tip");
            expect(focusSpy).toHaveBeenCalled();
        });

        it("marks the dropdown item matching the current admonition type", () => {
            const dropdown = createButton(editor);
            const listView = openDropdown(dropdown);

            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            editor.execute("admonition", { forceValue: "tip" });

            expect(listView.items.get(1).children.get(0).isOn).toBe(true);
            expect(listView.items.get(0).children.get(0).isOn).toBe(false);
        });
    });

    describe("getAdmonitionTitle", () => {
        it("passes every type title through the translation function", () => {
            const translated = ADMONITION_TYPE_NAMES.map((type) => getAdmonitionTitle((message) => `xx:${message}`, type));

            expect(translated).toEqual([ "xx:Note", "xx:Tip", "xx:Important", "xx:Caution", "xx:Warning" ]);
        });

        it("returns an unrecognized type as-is, without translating it", () => {
            const translate = vi.fn();

            expect(getAdmonitionTitle(translate, "custom-unknown" as AdmonitionType)).toBe("custom-unknown");
            expect(translate).not.toHaveBeenCalled();
        });
    });

    describe("without the editing plugin", () => {
        it("still builds a button, with no command bindings and an empty dropdown", async () => {
            const editor = await createTestEditor([Essentials, Paragraph, AdmonitionUI]);

            expect(editor.commands.get("admonition")).toBeUndefined();

            const dropdown = createButton(editor);

            expect(dropdown.buttonView.label).toBe("Admonition");
            expect(openDropdown(dropdown).items.length).toBe(0);
        });
    });
});
