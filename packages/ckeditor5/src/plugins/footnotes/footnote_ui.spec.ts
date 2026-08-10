import { _setModelData as setModelData, ClassicEditor, Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { seedFootnotes } from "../../../test/footnotes-kit.js";
import { COMMANDS, TOOLBAR_COMPONENT_NAME } from "./constants.js";
import FootnoteUI from "./footnote_ui.js";
import Footnotes from "./footnotes.js";

interface ListButtonView {
    commandParam?: number | string;
    label?: string;
    fire(event: string): void;
}

interface ListItemView {
    children: { get(idx: number): ListButtonView };
}

interface ListView {
    items: { length: number; get(idx: number): ListItemView };
}

interface FootnoteDropdownView {
    isOpen: boolean;
    isEnabled: boolean;
    class: string;
    buttonView: SplitButtonView;
    listView?: ListView & { element: HTMLElement | null };
}

function createDropdown(editor: ClassicEditor): FootnoteDropdownView {
    return editor.ui.componentFactory.create(TOOLBAR_COMPONENT_NAME) as unknown as FootnoteDropdownView;
}

function openDropdown(dropdown: FootnoteDropdownView): ListView {
    dropdown.isOpen = true;
    // Each open builds a fresh ListView; `dropdown.listView` is the live one, whereas
    // `panelView.children` still holds the emptied lists from previous opens.
    const listView = dropdown.listView;
    if (!listView) {
        throw new Error("Dropdown did not render a list view after opening.");
    }
    return listView;
}

describe("FootnoteUI", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Footnotes]);
    });

    it("declares its plugin name", () => {
        expect(FootnoteUI.pluginName).toBe("FootnoteUI");
    });

    it("registers a split button with the footnote icon", () => {
        const dropdown = createDropdown(editor);

        expect(dropdown.buttonView).toBeInstanceOf(SplitButtonView);
        expect(dropdown.buttonView.label).toBe("Footnote");
        expect(dropdown.buttonView.icon).toContain("<svg");
        expect(dropdown.buttonView.tooltip).toBe(true);
        expect(dropdown.buttonView.isToggleable).toBe(true);
        expect(dropdown.class).toBe("ck-tn-dropdown");
    });

    it("inserts a new footnote when the split button itself is executed", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const dropdown = createDropdown(editor);
        const executeSpy = vi.spyOn(editor, "execute");
        const focusSpy = vi.spyOn(editor.editing.view, "focus");

        dropdown.buttonView.fire("execute");

        expect(executeSpy).toHaveBeenCalledWith(COMMANDS.insertFootnote, { footnoteIndex: 0 });
        expect(focusSpy).toHaveBeenCalled();
    });

    it("binds the button and dropdown to the command", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const dropdown = createDropdown(editor);

        expect(dropdown.isEnabled).toBe(true);
        expect(dropdown.buttonView.isOn).toBe(false);
    });

    describe("the dropdown list", () => {
        it("offers only 'New footnote' when the document has no footnotes", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const listView = openDropdown(createDropdown(editor));

            expect(listView.items.length).toBe(1);
            expect(listView.items.get(0).children.get(0).label).toBe("New footnote");
            expect(listView.items.get(0).children.get(0).commandParam).toBe(0);
        });

        it("lists every existing footnote after the 'New footnote' entry", () => {
            seedFootnotes(editor, 2);
            const listView = openDropdown(createDropdown(editor));

            expect(listView.items.length).toBe(3);
            expect(listView.items.get(1).children.get(0).label).toBe("Insert footnote 1");
            expect(listView.items.get(1).children.get(0).commandParam).toBe("1");
            expect(listView.items.get(2).children.get(0).label).toBe("Insert footnote 2");
        });

        it("rebuilds the list on each open, picking up newly added footnotes", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const dropdown = createDropdown(editor);

            expect(openDropdown(dropdown).items.length).toBe(1);

            dropdown.isOpen = false;
            editor.execute(COMMANDS.insertFootnote, { footnoteIndex: 0 });

            expect(openDropdown(dropdown).items.length).toBe(2);
        });

        it("detaches the list element when the dropdown closes", () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");
            const dropdown = createDropdown(editor);
            openDropdown(dropdown);

            dropdown.isOpen = false;

            expect(dropdown.listView?.element?.parentNode ?? null).toBeNull();
        });

        it("inserts a reference to the picked footnote when a list item is executed", () => {
            seedFootnotes(editor, 1);
            const dropdown = createDropdown(editor);
            const listView = openDropdown(dropdown);
            const executeSpy = vi.spyOn(editor, "execute");
            const focusSpy = vi.spyOn(editor.editing.view, "focus");

            listView.items.get(1).children.get(0).fire("execute");

            expect(executeSpy).toHaveBeenCalledWith(COMMANDS.insertFootnote, { footnoteIndex: "1" });
            expect(focusSpy).toHaveBeenCalled();
        });
    });

    describe("failure modes", () => {
        it("throws when the insert command is not registered", async () => {
            const bare = await createTestEditor([Essentials, Paragraph, FootnoteUI]);

            expect(() => bare.ui.componentFactory.create(TOOLBAR_COMPONENT_NAME)).toThrow("Command not found.");
        });

        it("throws when building the list without a document root", () => {
            const ui = editor.plugins.get(FootnoteUI);
            const originalGetRoot = editor.model.document.getRoot.bind(editor.model.document);
            editor.model.document.getRoot = (() => null) as typeof editor.model.document.getRoot;

            try {
                expect(() => ui.getDropdownItemsDefinitions()).toThrow("Document has no root element.");
            } finally {
                editor.model.document.getRoot = originalGetRoot;
            }
        });
    });
});
