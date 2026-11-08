import {
    _setModelData as setModelData, ButtonView, ClassicEditor, Essentials, type ModelElement,
    Paragraph, Widget
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { CODE_VIEW_COMMAND_NAME } from "./content_embed.js";
import ExtendedCodeBlock, {
    EXTENDED_CODE_BLOCK_BUTTON, EXTENDED_CODE_BLOCK_COPY_BUTTON, INSERT_EXTENDED_CODE_BLOCK_COMMAND,
    insertExtendedCodeBlock
} from "./extended_code_block.js";
import { INSERT_INLINE_EMBED_COMMAND } from "./inline_source.js";

describe("ExtendedCodeBlock", () => {
    function createEditor() {
        return createTestEditor([ Essentials, Paragraph, Widget, ExtendedCodeBlock ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ], loadInline: vi.fn() }
        });
    }

    function createButton(editor: ClassicEditor, name = EXTENDED_CODE_BLOCK_BUTTON) {
        const button = editor.ui.componentFactory.create(name);
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

    it("gives a new block the language that was set last on a code block", async () => {
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
        editor.execute(INSERT_INLINE_EMBED_COMMAND, { language: "mermaid", source: "" });
        insertExtendedCodeBlock(editor);

        expect(editor.getData()).toContain(`<code class="language-text-x-python"></code>`);
    });

    it("copies the code of the selected block as the code block copy button does", async () => {
        const copy = vi.fn();
        let flushInline = () => {};
        const plugins = [ Essentials, Paragraph, Widget, ExtendedCodeBlock ];
        const editor = await createTestEditor(plugins, {
            clipboard: { copy },
            contentEmbed: {
                inlineLanguages: [ "mermaid" ],
                loadInline: vi.fn(),
                flushInline: () => flushInline()
            }
        });
        editor.setData(`<pre class="extended-code-block">`
            + `<code class="language-text-x-python">print(1)</code></pre>`
            + `<pre><code class="language-mermaid">graph LR;</code></pre>`);
        const root = editor.model.document.getRoot();
        const [ codeBlock, diagram ] = Array.from(root?.getChildren() ?? []);
        if (!codeBlock?.is("element") || !diagram?.is("element")) {
            throw new Error("Expected embeds.");
        }
        const select = (embed: ModelElement) => {
            editor.model.change((writer) => writer.setSelection(embed, "on"));
            editor.ui.update();
        };
        const button = createButton(editor, EXTENDED_CODE_BLOCK_COPY_BUTTON);
        const legacyButton = createButton(editor, "copyToClipboard");

        select(codeBlock);
        expect([ button.label, button.icon, button.isVisible ])
            .toEqual([ legacyButton.label, legacyButton.icon, true ]);
        // The host writes the code typed last when the copy asks for it.
        flushInline = () => editor.model.change((writer) => {
            writer.setAttribute("source", "print(2)", codeBlock);
        });
        button.fire("execute");
        expect(copy).toHaveBeenCalledExactlyOnceWith("print(2)");

        select(diagram);
        expect(button.isVisible).toBe(false);

        // An empty block copies nothing, as an empty code block does.
        flushInline = () => {};
        setModelData(editor.model, `[<contentEmbed language="text-x-python"></contentEmbed>]`);
        button.fire("execute");
        expect(copy).toHaveBeenCalledOnce();
    });
});
