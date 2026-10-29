import {
    _setModelData as setModelData, ButtonView, ClassicEditor, Essentials, Paragraph, Widget
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { CODE_VIEW_COMMAND_NAME } from "./content_embed.js";
import ExtendedCodeBlock, {
    EXTENDED_CODE_BLOCK_BUTTON, INSERT_EXTENDED_CODE_BLOCK_COMMAND, insertExtendedCodeBlock
} from "./extended_code_block.js";

describe("ExtendedCodeBlock", () => {
    function createEditor() {
        return createTestEditor([ Essentials, Paragraph, Widget, ExtendedCodeBlock ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ], loadInline: vi.fn() }
        });
    }

    function createButton(editor: ClassicEditor) {
        const button = editor.ui.componentFactory.create(EXTENDED_CODE_BLOCK_BUTTON);
        if (!(button instanceof ButtonView)) throw new Error("Expected a button.");
        return button;
    }

    it("inserts an empty block of the box size Full from its button, and focuses", async () => {
        const editor = await createEditor();
        setModelData(editor.model, "<paragraph>a[]</paragraph>");
        const button = createButton(editor);
        const focus = vi.spyOn(editor.editing.view, "focus");

        expect([ button.label, button.isEnabled ]).toEqual([ "Extended code block", true ]);
        expect(button.icon).toContain("<svg");
        button.fire("execute");

        expect(editor.getData()).toBe(`<p>a</p><pre class="extended-code-block"`
            + ` data-box-size="full" data-hide-title="true" data-editable="true">`
            + `<code class="language-text-plain"></code></pre>`);
        expect(focus).toHaveBeenCalled();

        editor.enableReadOnlyMode("spec");
        expect(button.isEnabled).toBe(false);
        expect(editor.commands.get(INSERT_EXTENDED_CODE_BLOCK_COMMAND)?.isEnabled).toBe(false);
    });

    it("gives a new block the language that was set last", async () => {
        const editor = await createEditor();
        editor.setData(`<pre class="extended-code-block">`
            + `<code class="language-text-plain">x</code></pre>`);
        const embed = editor.model.document.getRoot()?.getChild(0);
        if (!embed?.is("element")) throw new Error("Expected an embed.");
        editor.model.change((writer) => writer.setSelection(embed, "on"));
        editor.execute(CODE_VIEW_COMMAND_NAME, { language: "text/x-python" });
        // A language removed from an embed leaves the last one.
        editor.model.change((writer) => writer.removeAttribute("language", embed));

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        insertExtendedCodeBlock(editor);

        expect(editor.getData()).toContain(`<code class="language-text-x-python"></code>`);
    });
});
