import { MIME_TYPE_AUTO } from "@triliumnext/commons/src/lib/mime_type.js";
import {
    _getModelData as getModelData, _setModelData as setModelData, Alignment, ButtonView,
    ClassicEditor, CodeBlock, Essentials, List, type ModelElement, Paragraph, Widget
} from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { CODE_VIEW_COMMAND_NAME } from "./content_embed.js";
import ExtendedCodeBlock, { EXTENDED_CODE_BLOCK_COPY_BUTTON } from "./extended_code_block.js";

describe("ExtendedCodeBlock", () => {
    function createButton(editor: ClassicEditor, name: string) {
        const button = editor.ui.componentFactory.create(name);
        if (!(button instanceof ButtonView)) throw new Error("Expected a button.");
        return button;
    }

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

    it("leaves the code blocks of CKEditor alone unless it replaces them", async () => {
        const detectLanguage = vi.fn(async () => "text-x-python");
        const editor = await createTestEditor([
            Essentials, Paragraph, Widget, CodeBlock, ExtendedCodeBlock
        ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ], loadInline: vi.fn(), detectLanguage }
        });
        setModelData(editor.model, "<paragraph>a[]</paragraph>");

        editor.execute("codeBlock");
        expect(getModelData(editor.model))
            .toBe(`<codeBlock language="plaintext">a[]</codeBlock>`);

        editor.setData(`<pre class="extended-code-block">`
            + `<code class="language-${MIME_TYPE_AUTO}">print(1)</code></pre>`);
        expect(detectLanguage).not.toHaveBeenCalled();
    });

    describe("in place of the code blocks of CKEditor", () => {
        function createEditor(contentEmbed: Record<string, unknown> = {}, plugins = [ CodeBlock ]) {
            const loadInline = vi.fn();
            const editor = createTestEditor([
                Essentials, Paragraph, Widget, Alignment, List, ExtendedCodeBlock, ...plugins
            ], {
                contentEmbed: {
                    inlineLanguages: [ "mermaid" ],
                    isCodeBlockExtended: true,
                    loadInline,
                    ...contentEmbed
                }
            });
            return editor.then((created) => ({ editor: created, loadInline }));
        }

        function getEmbeds(editor: ClassicEditor) {
            return Array.from(editor.model.document.getRoot()?.getChildren() ?? [])
                .filter((child): child is ModelElement => child.is("element", "contentEmbed"));
        }

        function getLanguages(editor: ClassicEditor) {
            return getEmbeds(editor).map((embed) => embed.getAttribute("language"));
        }

        it("turns each run of selected text blocks into a block", async () => {
            const { editor, loadInline } = await createEditor();
            editor.model.schema.register("placeholder", { inheritAllFrom: "$inlineObject" });
            editor.conversion.elementToElement({ model: "placeholder", view: "span" });
            const scroll = vi.spyOn(editor.editing.view, "scrollToTheSelection");
            const item = (id: string) => `listIndent="0" listItemId="${id}" listType="bulleted"`;
            setModelData(editor.model, `<paragraph alignment="right" ${item("a")}>`
                + `[a<softBreak></softBreak>b<placeholder></placeholder></paragraph>`
                + `<paragraph ${item("a")}>c</paragraph><paragraph ${item("b")}>d</paragraph>`
                + `<paragraph>e</paragraph>`
                + `<contentEmbed language="mermaid" source="graph"></contentEmbed>`
                + `<paragraph>f]</paragraph>`);
            const before = getModelData(editor.model, { withoutSelection: true });
            loadInline.mockClear();

            editor.execute("codeBlock");

            const box = `boxSize="full" editable="true" hideTitle="true" language="text-plain"`;
            // Each list item gets one block, which takes no attribute that an embed cannot have.
            expect(getModelData(editor.model)).toBe(
                `[<contentEmbed ${box} ${item("a")} source="a\nb\nc"></contentEmbed>]`
                + `<contentEmbed ${box} ${item("b")} source="d"></contentEmbed>`
                + `<contentEmbed ${box} source="e"></contentEmbed>`
                + `<contentEmbed language="mermaid" source="graph"></contentEmbed>`
                + `<contentEmbed ${box} source="f"></contentEmbed>`);
            const loads = loadInline.mock.calls.map((call) => [ call[0].getSource(), call[3] ]);
            expect(loads).toHaveLength(4);
            expect(loads).toContainEqual([ "a\nb\nc", { isFocused: true } ]);
            expect(loads).toContainEqual([ "d", { isFocused: false } ]);
            expect(loads).toContainEqual([ "e", { isFocused: false } ]);
            expect(loads).toContainEqual([ "f", { isFocused: false } ]);
            expect(scroll).toHaveBeenCalledOnce();

            editor.execute("undo");
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(before);
        });

        it("gives a new block the language asked for, else the one set last", async () => {
            const { editor } = await createEditor();
            const makeBlock = (options?: Record<string, unknown>) => {
                setModelData(editor.model, "<paragraph>[]</paragraph>");
                editor.execute("codeBlock", options);
                return getEmbeds(editor)[0];
            };

            expect(makeBlock().getAttribute("language")).toBe("text-plain");
            const block = makeBlock({ language: "text-x-python", forceValue: true });
            expect(block.getAttribute("language")).toBe("text-x-python");

            editor.execute(CODE_VIEW_COMMAND_NAME, { language: "text/css" });
            // The language of a diagram, one removed, and one of a loaded block leave the last one.
            editor.model.change((writer) => writer.setAttribute("language", "mermaid", block));
            editor.model.change((writer) => writer.removeAttribute("language", block));
            editor.setData(`<pre><code class="language-text-x-python">x</code></pre>`);
            expect(makeBlock({ usePreviousLanguageChoice: true }).getAttribute("language"))
                .toBe("text-css");
        });

        it("leaves to CKEditor its own code block, and a place that takes no embed", async () => {
            const { editor } = await createEditor();

            setModelData(editor.model, `<codeBlock language="plaintext">x[]</codeBlock>`);
            editor.execute("codeBlock");
            expect(getModelData(editor.model)).toBe("<paragraph>x[]</paragraph>");

            editor.execute("codeBlock", { forceValue: false });
            expect(getModelData(editor.model)).toBe("<paragraph>x[]</paragraph>");

            editor.model.schema.addChildCheck((_context, definition) =>
                definition.name === "contentEmbed" ? false : undefined);
            editor.execute("codeBlock");
            expect(getModelData(editor.model))
                .toBe(`<codeBlock language="plaintext">x[]</codeBlock>`);
        });

        it("loads the code blocks without the code block command of CKEditor", async () => {
            const { editor } = await createEditor({}, []);

            editor.setData(`<pre><code class="language-text-css">a {}</code></pre>`);

            expect(editor.commands.get("codeBlock")).toBeUndefined();
            expect(getLanguages(editor)).toEqual([ "text-css" ]);
        });

        it("sets the language that the host detects on a block saved without one", async () => {
            const detectLanguage = vi.fn(async (code: string) =>
                (code.includes("print") ? "text-x-python" : null));
            const { editor } = await createEditor({ detectLanguage });
            const auto = `<code class="language-${MIME_TYPE_AUTO}">`;

            editor.setData(`<pre>${auto}print(1)</code></pre><pre>${auto}lorem</code></pre>`
                + `<pre><code class="language-text-css">a {}</code></pre>`);
            await vi.waitFor(() => expect(getLanguages(editor))
                .toEqual([ "text-x-python", "text-plain", "text-css" ]));
            expect(detectLanguage.mock.calls).toEqual([ [ "print(1)" ], [ "lorem" ] ]);
            // The note saves the language, and no undo step removes it.
            expect(editor.getData()).toBe(
                `<pre><code class="language-text-x-python">print(1)</code></pre>`
                + `<pre><code class="language-text-plain">lorem</code></pre>`
                + `<pre><code class="language-text-css">a {}</code></pre>`);
            expect(editor.commands.get("undo")?.isEnabled).toBe(false);

            // A detected language is not one that the user set, so a new block does not take it.
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            editor.execute("codeBlock");
            expect(getLanguages(editor)).toEqual([ "text-plain" ]);

            // A block that turns to the detected language later, and one without a source.
            editor.model.change((writer) => {
                writer.setAttribute("language", MIME_TYPE_AUTO, getEmbeds(editor)[0]);
                writer.removeAttribute("source", getEmbeds(editor)[0]);
            });
            await vi.waitFor(() => expect(getLanguages(editor)).toEqual([ "text-plain" ]));
            expect(detectLanguage).toHaveBeenLastCalledWith("");
        });

        it("drops a detected language once the block changed or is gone", async () => {
            const pending: ((language: string | null) => void)[] = [];
            const detectLanguage = vi.fn(() => new Promise<string | null>((resolve) => {
                pending.push(resolve);
            }));
            const { editor } = await createEditor({ detectLanguage });
            const auto = `<pre><code class="language-${MIME_TYPE_AUTO}">x</code></pre>`;
            const settle = async () => {
                for (const resolve of pending.splice(0)) {
                    resolve("text-x-python");
                }
                await new Promise((resolve) => setTimeout(resolve));
            };

            editor.setData(auto + auto);
            const [ changed, removed ] = getEmbeds(editor);
            editor.model.change((writer) => {
                writer.setAttribute("language", "text-css", changed);
                writer.remove(removed);
            });
            await settle();
            expect(getLanguages(editor)).toEqual([ "text-css" ]);
            expect(removed.getAttribute("language")).toBe(MIME_TYPE_AUTO);

            editor.setData(auto);
            const [ last ] = getEmbeds(editor);
            await editor.destroy();
            await settle();
            expect(last.getAttribute("language")).toBe(MIME_TYPE_AUTO);
        });

        it("detects no language in a read-only editor, or without a host for it", async () => {
            const detectLanguage = vi.fn(async () => "text-x-python");
            const auto = `<pre><code class="language-${MIME_TYPE_AUTO}">x</code></pre>`;
            const { editor } = await createEditor({ detectLanguage });
            editor.enableReadOnlyMode("spec");
            editor.setData(auto);
            const { editor: bare } = await createEditor();
            bare.setData(auto);
            await new Promise((resolve) => setTimeout(resolve));

            expect(detectLanguage).not.toHaveBeenCalled();
            expect([ ...getLanguages(editor), ...getLanguages(bare) ])
                .toEqual([ MIME_TYPE_AUTO, MIME_TYPE_AUTO ]);
        });
    });
});
