import { _setModelData as setModelData, ClassicEditor, Code, Essentials, Paragraph, WidgetToolbarRepository } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CopyToClipboardButton from "./copy_to_clipboard_button.js";
import InlineCodeToolbar from "./inline_code_toolbar.js";

/** The toolbar definition shape we reach into (WidgetToolbarRepository keeps these private). */
interface ToolbarDefinition {
    getRelatedElement: (selection: unknown) => { is(type: string, name: string): boolean } | null;
}

describe("InlineCodeToolbar", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Code, CopyToClipboardButton, InlineCodeToolbar]);
    });

    it("loads the plugin successfully", () => {
        expect(editor.plugins.get(InlineCodeToolbar)).toBeInstanceOf(InlineCodeToolbar);
    });

    it("declares WidgetToolbarRepository and CopyToClipboardButton as required", () => {
        const requires = InlineCodeToolbar.requires;
        expect(requires).toContain(WidgetToolbarRepository);
        expect(requires).toContain(CopyToClipboardButton);
    });

    it("registers the inlineCode toolbar in the WidgetToolbarRepository", () => {
        expect(getInlineCodeDefinition()).toBeDefined();
    });

    // These exercise the plugin's actual getRelatedElement callback (registered in
    // WidgetToolbarRepository), rather than a re-implementation of the same walk — so a regression
    // in inline_code_toolbar.ts itself fails the suite.
    describe("getRelatedElement", () => {
        it("returns the <code> attribute element when the selection is inside inline code", () => {
            setModelData(editor.model, "<paragraph><$text code=\"true\">hello[]world</$text></paragraph>");

            const def = getInlineCodeDefinition();
            expect(def).toBeDefined();

            const related = def?.getRelatedElement(editor.editing.view.document.selection);
            expect(related).not.toBeNull();
            expect(related?.is("attributeElement", "code")).toBe(true);
        });

        it("walks up multiple ancestor levels (bold+code) to find the <code> element", () => {
            setModelData(editor.model, "<paragraph><$text bold=\"true\" code=\"true\">bold[]code</$text></paragraph>");

            const related = getInlineCodeDefinition()?.getRelatedElement(editor.editing.view.document.selection);
            expect(related?.is("attributeElement", "code")).toBe(true);
        });

        it("returns null when the selection is in plain text", () => {
            setModelData(editor.model, "<paragraph>plain[]text</paragraph>");

            const related = getInlineCodeDefinition()?.getRelatedElement(editor.editing.view.document.selection);
            expect(related).toBeNull();
        });

        it("returns null when the selection has no first position (null guard)", () => {
            const related = getInlineCodeDefinition()?.getRelatedElement({ getFirstPosition: () => null });
            expect(related).toBeNull();
        });
    });

    function getInlineCodeDefinition(): ToolbarDefinition | undefined {
        const repository = editor.plugins.get(WidgetToolbarRepository);
        const definitions = (repository as unknown as { _toolbarDefinitions: Map<string, ToolbarDefinition> })._toolbarDefinitions;
        return definitions?.get("inlineCode");
    }
});
