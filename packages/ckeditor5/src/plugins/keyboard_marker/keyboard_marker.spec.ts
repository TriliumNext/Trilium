import { _getViewData as getViewData, _setModelData as setModelData, ButtonView, ClassicEditor, GeneralHtmlSupport, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Kbd from "./keyboard_marker.js";
import KbdEditing from "./keyboard_marker_editing.js";
import KbdUI from "./keyboard_marker_ui.js";

describe("Kbd", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Paragraph, Kbd]);
    });

    it("loads the glue plugin and its editing/UI parts", () => {
        expect(editor.plugins.get(Kbd)).toBeInstanceOf(Kbd);
        expect(editor.plugins.get(KbdEditing)).toBeInstanceOf(KbdEditing);
        expect(editor.plugins.get(KbdUI)).toBeInstanceOf(KbdUI);
        expect(Kbd.pluginName).toBe("Kbd");
    });

    it("allows the kbd attribute on text and marks it as formatting", () => {
        expect(editor.model.schema.checkAttribute("$text", "kbd")).toBe(true);

        // Regression guard: kbd is a discrete inline token, so pressing Enter must NOT
        // carry the formatting onto the next paragraph (mirrors inline `code`, unlike bold/italic).
        expect(editor.model.schema.getAttributeProperties("kbd")).toEqual({
            isFormatting: true,
            copyOnEnter: false
        });
    });

    it("downcasts the kbd attribute to a plain <kbd> in the data and disables spellcheck only while editing", () => {
        setModelData(editor.model, "<paragraph>[Ctrl]</paragraph>");

        editor.execute("kbd");

        expect(editor.getData()).toBe("<p><kbd>Ctrl</kbd></p>");
        expect(getViewData(editor.editing.view, { withoutSelection: true }))
            .toBe(`<p><kbd spellcheck="false">Ctrl</kbd></p>`);
    });

    it("upcasts a <kbd> element back to the kbd attribute, with or without spellcheck", () => {
        editor.setData("<p>Press <kbd>Ctrl</kbd>.</p>");
        expect(editor.getData()).toBe("<p>Press <kbd>Ctrl</kbd>.</p>");

        // Notes saved before the attribute moved to the editing view normalize to a plain <kbd>.
        editor.setData(`<p>Press <kbd spellcheck="false">Ctrl</kbd>.</p>`);
        expect(editor.getData()).toBe("<p>Press <kbd>Ctrl</kbd>.</p>");
    });

    it("registers the toolbar button bound to the command", () => {
        const button = editor.ui.componentFactory.create("kbd") as unknown as ButtonView;
        const command = editor.commands.get("kbd");

        expect(button.isToggleable).toBe(true);
        expect(button.isOn).toBe(false);

        button.fire("execute");

        expect(command?.value).toBe(true);
    });
});

describe("Kbd under the shipped General HTML Support configuration", () => {
    // `textNoteHtmlSupportEnabled` ships off, which leaves GHS with an empty allow-list. A plain
    // <kbd> has to be claimed by the plugin itself, or nothing models it and the element is lost on
    // the note's next save — the Markdown docs under `docs/` write <kbd> without any attribute.
    it("keeps a plain <kbd> the docs store", async () => {
        const editor = await createTestEditor([Paragraph, Kbd, GeneralHtmlSupport], {
            htmlSupport: { allow: [] }
        });

        editor.setData("<p>Press <kbd>Ctrl</kbd> + <kbd>R</kbd>.</p>");

        expect(editor.getData()).toBe("<p>Press <kbd>Ctrl</kbd> + <kbd>R</kbd>.</p>");
    });
});
