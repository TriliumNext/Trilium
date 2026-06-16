import { ClassicEditor, CodeBlock, Essentials, Paragraph, _setModelData as setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CodeBlockLanguageDropdown from "./code_block_language_dropdown.js";

const LANGUAGES = [
    { language: "plaintext", label: "Plain text" },
    { language: "javascript", label: "JavaScript", class: "language-js" },
    { language: "python", label: "Python" }
];

interface DropdownButtonView {
    label: string | undefined;
}

interface ListItemView {
    children: {
        get(idx: number): ListButtonView;
    };
}

interface ListButtonView {
    _codeBlockLanguage?: string;
    isOn?: boolean;
    fire(event: string): void;
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
    buttonView: DropdownButtonView;
    panelView: {
        children: {
            get(idx: number): ListView | null;
        };
    };
    fire(event: string, data?: unknown): void;
}

function openDropdown(dropdown: DropdownView): ListView {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) {
        throw new Error("Dropdown panel did not render a list view after opening.");
    }
    return listView;
}

describe("CodeBlockLanguageDropdown", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, CodeBlockLanguageDropdown], {
            codeBlock: {
                languages: LANGUAGES.map(l => ({ ...l }))
            },
            toolbar: { items: ["codeBlockDropdown"] }
        });
    });

    it("registers the plugin", () => {
        expect(editor.plugins.get(CodeBlockLanguageDropdown)).toBeInstanceOf(CodeBlockLanguageDropdown);
    });

    it("registers the codeBlockDropdown component in the factory", () => {
        expect(editor.ui.componentFactory.has("codeBlockDropdown")).toBe(true);
    });

    it("creates a dropdown with one item per language", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);
        expect(listView.items.length).toBe(LANGUAGES.length);
    });

    it("is disabled when no code block is active", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        expect(dropdown.isEnabled).toBe(false);
    });

    it("is enabled when a code block is active", () => {
        setModelData(editor.model, "<codeBlock language=\"javascript\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        expect(dropdown.isEnabled).toBe(true);
    });

    it("shows the active language label on the button when inside a code block", () => {
        setModelData(editor.model, "<codeBlock language=\"javascript\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        expect(dropdown.buttonView.label).toBe("JavaScript");
    });

    it("shows undefined label when there is no active code block", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        expect(dropdown.buttonView.label).toBeUndefined();
    });

    it("assigns correct _codeBlockLanguage to each list item button", () => {
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        const button0 = listView.items.get(0).children.get(0);
        const button1 = listView.items.get(1).children.get(0);
        const button2 = listView.items.get(2).children.get(0);

        expect(button0._codeBlockLanguage).toBe("plaintext");
        expect(button1._codeBlockLanguage).toBe("javascript");
        expect(button2._codeBlockLanguage).toBe("python");
    });

    it("marks the currently-active language item as isOn", () => {
        setModelData(editor.model, "<codeBlock language=\"python\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // index 2 is python — should be active
        const pythonButton = listView.items.get(2).children.get(0);
        expect(pythonButton.isOn).toBe(true);

        // other language buttons should not be on
        const plaintextButton = listView.items.get(0).children.get(0);
        expect(plaintextButton.isOn).toBe(false);
    });

    it("executes the codeBlock command with the chosen language when a list item fires execute", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // Fire execute on the javascript item (index 1).
        const jsButton = listView.items.get(1).children.get(0);
        jsButton.fire("execute");

        // The model should now have a codeBlock with language="javascript".
        const root = editor.model.document.getRoot();
        const firstChild = root?.getChild(0);
        expect(firstChild?.is("element", "codeBlock")).toBe(true);
        expect(firstChild?.getAttribute("language")).toBe("javascript");
    });

    it("moves focus back to the editing view after executing a language change", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]</codeBlock>");
        const dropdown = editor.ui.componentFactory.create("codeBlockDropdown") as unknown as DropdownView;
        const listView = openDropdown(dropdown);

        // After executing, focus is restored to the editing view (no exception thrown).
        const jsButton = listView.items.get(1).children.get(0);
        expect(() => jsButton.fire("execute")).not.toThrow();
    });

    it("normalizes class-less language definitions by adding a language- prefix class", () => {
        // plaintext and python have no explicit class — should become language-plaintext / language-python
        setModelData(editor.model, "<codeBlock language=\"plaintext\">const x = 1;</codeBlock>");
        expect(editor.getData()).toContain("language-plaintext");
    });

    it("preserves an explicit class override (javascript uses language-js)", () => {
        setModelData(editor.model, "<codeBlock language=\"javascript\">const x = 1;</codeBlock>");
        expect(editor.getData()).toContain("language-js");
    });

    it("requires the CodeBlock plugin", () => {
        expect(CodeBlockLanguageDropdown.requires).toContain(CodeBlock);
    });
});
