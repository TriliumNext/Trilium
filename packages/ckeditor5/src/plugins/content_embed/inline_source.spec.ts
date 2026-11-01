import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ButtonView,
    ClassicEditor,
    CodeBlock,
    DropdownView,
    Essentials,
    type ListItemView,
    type ModelElement,
    Paragraph,
    Undo,
    Widget
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import BlockReferenceEditing from "../block_reference/block_reference_editing.js";
import { SIZE_ATTRIBUTES } from "../resizable_widgets/resizable_widgets.js";
import ContentEmbedBoxSizeDropdown, {
    CONTENT_EMBED_BOX_SIZE_DROPDOWN
} from "./content_embed_box_size_dropdown.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME,
    BOX_SIZES,
    CODE_VIEW_COMMAND_NAME,
    CONTENT_EMBED_MENU,
    CONVERT_EMBED_TO_LINK_COMMAND,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import {
    INSERT_INLINE_EMBED_COMMAND, type InlineEmbedSource, isExtendedCodeBlock
} from "./inline_source.js";

describe("ContentEmbedInlineSource", () => {
    let editor: ClassicEditor;
    let loadInlineEmbed: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadInlineEmbed = vi.fn();
        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown
        ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ], loadInline: loadInlineEmbed }
        });
    });

    function getEmbed() {
        const embed = editor.model.document.getRoot()?.getChild(0);
        expect(embed?.is("element", "contentEmbed")).toBe(true);
        return embed as ModelElement;
    }

    function getLoadedSource(call = 0) {
        return loadInlineEmbed.mock.calls[call][0] as InlineEmbedSource;
    }

    it("loads a code block of an inline language as an embed of its source, and saves it back", () => {
        editor.setData(
            `<pre spellcheck="false">`
            + `<code class="language-mermaid" data-trilium-display-mode="source">`
            + `graph TD;\n    A--&gt;B</code></pre>`
        );

        const embed = getEmbed();
        expect(embed.getAttribute("language")).toBe("mermaid");
        expect(embed.getAttribute("source")).toBe("graph TD;\n    A-->B");
        expect(embed.getAttribute("boxSize")).toBe("medium");
        expect(embed.getAttribute("hideTitle")).toBe(true);
        expect(embed.getAttribute("editable")).toBe(true);
        expect(embed.getAttribute("displayMode")).toBe("source");
        expect(editor.getData()).toBe(
            `<pre data-box-size="medium" data-display-mode="source" data-hide-title="true"`
            + ` data-editable="true">`
            + `<code class="language-mermaid">`
            + `graph TD;\n    A--&gt;B</code></pre>`
        );
    });

    it("opens a diagram of the old plugin editable, in its mode or split", () => {
        const modes = [ [ "", "split" ], [ " data-trilium-display-mode=\"preview\"", "preview" ],
            [ " data-trilium-display-mode=\"other\"", "split" ] ];
        for (const [ attribute, mode ] of modes) {
            editor.setData(`<pre><code class="language-mermaid"${attribute}>a</code></pre>`);
            expect(getEmbed().getAttribute("displayMode")).toBe(mode);
            expect(getEmbed().getAttribute("editable")).toBe(true);
        }

        // A saved embed keeps the mode it has, or none.
        editor.setData(`<pre data-box-size="small"><code class="language-mermaid">a</code></pre>`);
        expect(getEmbed().getAttribute("displayMode")).toBeUndefined();
        expect(getEmbed().getAttribute("editable")).toBeUndefined();
        editor.setData(`<pre data-box-size="small" data-display-mode="source">`
            + `<code class="language-mermaid" data-trilium-display-mode="preview">a</code></pre>`);
        expect(getEmbed().getAttribute("displayMode")).toBe("source");
    });

    it("keeps the box size, the flags and the size of the embed on the <pre>", () => {
        const html = `<pre style="--include-note-height:12em;" data-box-size="small"`
            + ` data-editable="true" data-hide-title="true"><code class="language-mermaid">x</code></pre>`;
        editor.setData(html);

        const embed = getEmbed();
        expect(embed.getAttribute("boxSize")).toBe("small");
        expect(embed.getAttribute("editable")).toBe(true);
        expect(embed.getAttribute(SIZE_ATTRIBUTES.height)).toBe("12em");
        expect(editor.getData()).toContain(`data-box-size="small"`);
        expect(editor.getData()).toContain(`data-editable="true"`);
        expect(editor.getData()).toContain("--include-note-height:12em");
    });

    it("keeps how the embed shows its code on the <pre>, set by the code view command", () => {
        const html = `<pre data-box-size="medium" data-hide-title="true"`
            + ` data-code-wrap-lines="true" data-code-line-numbers="false">`
            + `<code class="language-mermaid">x</code></pre>`;
        editor.setData(html);

        expect([ "codeWrapLines", "codeLineNumbers" ].map((name) => getEmbed().getAttribute(name)))
            .toEqual([ "true", "false" ]);
        expect(editor.getData()).toBe(html);

        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));
        expect(editor.commands.get(CODE_VIEW_COMMAND_NAME)?.isEnabled).toBe(true);
        editor.execute(CODE_VIEW_COMMAND_NAME, { wrapLines: null, lineNumbers: true });
        expect(editor.getData()).toBe(`<pre data-box-size="medium" data-hide-title="true"`
            + ` data-code-line-numbers="true"><code class="language-mermaid">x</code></pre>`);
    });

    it("leaves a code block of another language alone, and inline code", () => {
        editor.setData(
            `<pre><code class="language-javascript">let a;</code></pre>`
            + `<pre><code class="language-mermaid">graph TD;</code></pre>`
            + `<p><code class="language-mermaid">graph LR;</code></p>`
        );

        const model = getModelData(editor.model, { withoutSelection: true });
        expect(model.match(/<contentEmbed /g)).toHaveLength(1);
        expect(model).toContain(`language="mermaid"`);
        expect(model).not.toContain("javascript");
    });

    it("has the host render the source, and writes its changes outside the undo stack", () => {
        editor.setData(`<pre><code class="language-mermaid">graph TD;</code></pre>`);

        expect(loadInlineEmbed).toHaveBeenCalledOnce();
        const [ source, wrapper, boxSize, options ] = loadInlineEmbed.mock.calls[0];
        expect(source.language).toBe("mermaid");
        expect(source.getSource()).toBe("graph TD;");
        expect(source.isReadOnly()).toBe(false);
        expect((wrapper as HTMLElement).classList.contains("include-note-wrapper")).toBe(true);
        expect(boxSize).toBe("medium");
        expect(options).toEqual({ isFocused: false });

        const listener = vi.fn();
        source.subscribe(listener);
        source.setSource("graph LR;");
        expect(getEmbed().getAttribute("source")).toBe("graph LR;");
        expect(source.getSource()).toBe("graph LR;");
        expect(listener).toHaveBeenCalledOnce();
        // The host keeps the undo steps of the source in `EmbedHistory`.
        expect(editor.commands.get("undo")?.isEnabled).toBe(false);
        // Writing the source does not draw the embed again, which would remount its editor.
        expect(loadInlineEmbed).toHaveBeenCalledOnce();

        // A box drawn again gets the same source, which keys the undo steps of its editor.
        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(loadInlineEmbed).toHaveBeenCalledTimes(2);
        expect(getLoadedSource(1)).toBe(source);
    });

    it("ignores a write of the same source, and stops calling a listener that unsubscribed", () => {
        editor.setData(`<pre><code class="language-mermaid">a</code></pre>`);
        const source = getLoadedSource();
        const listener = vi.fn();
        const other = vi.fn();
        const unsubscribe = source.subscribe(listener);
        source.subscribe(other);

        source.setSource("a");
        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
        source.setSource("b");
        expect(listener).not.toHaveBeenCalled();
        expect(other).toHaveBeenCalledOnce();
    });

    it("reads the text of a highlighted code block, its line breaks included", () => {
        editor.setData(
            `<pre><code class="language-mermaid">graph TD;<br>`
            + `<span class="hljs-keyword">A</span>--&gt;B</code></pre>`
        );

        expect(getEmbed().getAttribute("source")).toBe("graph TD;\nA-->B");
    });

    it("saves an embed that has lost its source or its Editable flag", () => {
        editor.setData(`<pre data-box-size="medium" data-editable="true">`
            + `<code class="language-mermaid">a</code></pre>`);
        editor.model.change((writer) => {
            writer.removeAttribute("source", getEmbed());
            writer.removeAttribute("editable", getEmbed());
        });

        expect(getLoadedSource().getSource()).toBe("");
        expect(editor.getData()).toBe(`<pre data-box-size="medium" data-hide-title="true">`
            + `<code class="language-mermaid"></code></pre>`);
    });

    it("makes no embed where the schema allows none", () => {
        editor.model.schema.addChildCheck((_context, definition) =>
            definition.name === "contentEmbed" ? false : undefined);
        editor.setData(`<pre><code class="language-mermaid">graph TD;</code></pre>`);

        expect(getModelData(editor.model, { withoutSelection: true }))
            .not.toContain("<contentEmbed");
        expect(loadInlineEmbed).not.toHaveBeenCalled();
    });

    it("makes no embed of any code block when the host lists no inline language", async () => {
        const bare = await createTestEditor([ Essentials, Paragraph, Widget, ContentEmbed ]);
        bare.setData(`<pre><code class="language-mermaid">graph TD;</code></pre>`);

        expect(getModelData(bare.model, { withoutSelection: true }))
            .not.toContain("<contentEmbed");
    });

    it("inserts a new embed editable and untitled, and has its content take the focus", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        editor.execute(INSERT_INLINE_EMBED_COMMAND, { language: "mermaid", source: "graph TD;" });

        const embed = editor.model.document.selection.getSelectedElement();
        expect(embed?.getAttribute("language")).toBe("mermaid");
        expect(embed?.getAttribute("source")).toBe("graph TD;");
        expect(embed?.getAttribute("boxSize")).toBe("medium");
        expect(embed?.getAttribute("hideTitle")).toBe(true);
        expect(embed?.getAttribute("editable")).toBe(true);
        expect(loadInlineEmbed.mock.calls[0][3]).toEqual({ isFocused: true });
    });

    it("offers only the box sizes that need no title, and loads the others as Medium", () => {
        for (const boxSize of [ "tiny", "expandable" ]) {
            editor.setData(
                `<pre data-box-size="${boxSize}"><code class="language-mermaid">a</code></pre>`);
            expect(getEmbed().getAttribute("boxSize")).toBe("medium");
        }

        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));
        const plugin = editor.plugins.get(ContentEmbed);
        const wrapper = editor.editing.view.getDomRoot()?.querySelector(".include-note-wrapper");
        if (!wrapper) throw new Error("Expected a rendered embed.");
        expect(plugin.getBoxSizes(wrapper).map(({ value }) => value))
            .toEqual([ "small", "medium", "full" ]);
        expect(plugin.getBoxSizes().map(({ value }) => value)).toEqual(BOX_SIZES);

        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "tiny" });
        expect(getEmbed().getAttribute("boxSize")).toBe("medium");
        editor.execute(BOX_SIZE_COMMAND_NAME, { value: "full" });
        expect(getEmbed().getAttribute("boxSize")).toBe("full");

        const dropdown = editor.ui.componentFactory.create(CONTENT_EMBED_BOX_SIZE_DROPDOWN);
        if (!(dropdown instanceof DropdownView)) throw new Error("Expected a dropdown.");
        dropdown.render();
        dropdown.isOpen = true;
        const shown = Array.from(dropdown.listView?.items ?? [])
            .map((item) => (item as ListItemView).children.first)
            .filter((button) => button instanceof ButtonView && button.isVisible)
            .map((button) => (button as ButtonView).label);
        expect(shown).toEqual([ "Small", "Medium", "Full" ]);
    });

    it("offers the menu button in the toolbar, and no caption button", () => {
        const menu = editor.ui.componentFactory.create(CONTENT_EMBED_MENU);
        const caption = editor.ui.componentFactory.create(TOGGLE_CAPTION_COMMAND_NAME);
        if (!(menu instanceof ButtonView) || !(caption instanceof ButtonView)) {
            throw new Error("Expected two buttons.");
        }

        editor.setData(`<pre><code class="language-mermaid">a</code></pre>`);
        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));
        expect([ menu.isVisible, caption.isVisible ]).toEqual([ true, false ]);

        editor.setData(`<figure class="include-note" data-note-id="n1" data-box-size="medium">`
            + `</figure>`);
        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));
        expect([ menu.isVisible, caption.isVisible ]).toEqual([ false, true ]);
    });

    it("offers no title, caption or link for an embed that shows no note", () => {
        editor.setData(`<pre><code class="language-mermaid">a</code></pre>`);
        editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));

        expect(editor.commands.get(TOGGLE_TITLE_COMMAND_NAME)?.isEnabled).toBe(false);
        expect(editor.commands.get(TOGGLE_CAPTION_COMMAND_NAME)?.isEnabled).toBe(false);
        expect(editor.commands.get(CONVERT_EMBED_TO_LINK_COMMAND)?.isEnabled).toBe(false);
    });

    describe("extended code blocks", () => {
        it("loads a marked code block of any language as an embed, and saves it back", () => {
            editor.setData(`<pre class="extended-code-block">`
                + `<code class="language-text-x-python">def a():\n    pass</code></pre>`);

            const embed = getEmbed();
            expect(isExtendedCodeBlock(editor, embed)).toBe(true);
            expect(embed.getAttribute("language")).toBe("text-x-python");
            expect(embed.getAttribute("source")).toBe("def a():\n    pass");
            // A code block that has no settings of an embed opens as a code block shows.
            expect([ "boxSize", "hideTitle", "editable", "displayMode" ]
                .map((name) => embed.getAttribute(name)))
                .toEqual([ "full", true, true, undefined ]);
            expect(editor.getData()).toBe(`<pre class="extended-code-block" data-box-size="full"`
                + ` data-hide-title="true" data-editable="true">`
                + `<code class="language-text-x-python">def a():\n    pass</code></pre>`);

            editor.setData(`<pre class="extended-code-block"><code class="hljs">a</code></pre>`);
            expect(getEmbed().getAttribute("language")).toBe("text-plain");

            editor.setData(`<pre><code class="language-mermaid">a</code></pre>`);
            expect(isExtendedCodeBlock(editor, getEmbed())).toBe(false);
        });

        it("keeps the box size, the flags and the code view that it saved", () => {
            const html = `<pre class="extended-code-block" data-box-size="medium"`
                + ` data-hide-title="true" data-code-tab-width="2">`
                + `<code class="language-text-x-python">x</code></pre>`;
            editor.setData(html);

            expect([ "boxSize", "editable", "codeTabWidth" ]
                .map((name) => getEmbed().getAttribute(name)))
                .toEqual([ "medium", undefined, "2" ]);
            expect(editor.getData()).toBe(html);
        });

        it("marks the box of the editing view, and none of a diagram", () => {
            editor.setData(`<pre class="extended-code-block">`
                + `<code class="language-text-x-python">x</code></pre>`
                + `<pre><code class="language-mermaid">a</code></pre>`);

            const figures = editor.editing.view.getDomRoot()?.querySelectorAll("figure") ?? [];
            expect([ ...figures ].map((figure) => figure.classList.contains("extended-code-block")))
                .toEqual([ true, false ]);
            expect(figures[0]?.dataset.language).toBe("text-x-python");
        });

        it("changes the language through the code view command", () => {
            editor.setData(`<pre class="extended-code-block">`
                + `<code class="language-text-plain">x</code></pre>`);
            editor.model.change((writer) => writer.setSelection(getEmbed(), "on"));

            editor.execute(CODE_VIEW_COMMAND_NAME, { language: "text/x-c++src" });
            expect(getEmbed().getAttribute("language")).toBe("text-x-c-src");
            expect(getEmbed().getAttribute("codeLanguage")).toBeUndefined();
            expect(getLoadedSource().language).toBe("text-x-c-src");
            const figure = editor.editing.view.getDomRoot()?.querySelector("figure");
            expect(figure?.dataset.language).toBe("text-x-c-src");
            expect(editor.getData()).toContain(`<code class="language-text-x-c-src">x</code>`);

            // An extended code block always has a language.
            editor.execute(CODE_VIEW_COMMAND_NAME, { language: null });
            expect(getEmbed().getAttribute("language")).toBe("text-x-c-src");
        });

        it("inserts an embed of the box size given", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");

            editor.execute(INSERT_INLINE_EMBED_COMMAND, {
                language: "text-x-python", source: "", boxSize: "full"
            });

            const embed = editor.model.document.selection.getSelectedElement();
            expect(embed?.getAttribute("boxSize")).toBe("full");
            expect(editor.getData()).toBe(`<pre class="extended-code-block" data-box-size="full"`
                + ` data-hide-title="true" data-editable="true">`
                + `<code class="language-text-x-python"></code></pre>`);
        });

        it("leaves an unmarked code block to the code blocks, and keeps the block ID", async () => {
            const withCodeBlocks = await createTestEditor([
                Essentials, Paragraph, Widget, CodeBlock, ContentEmbed, BlockReferenceEditing
            ], {
                contentEmbed: { inlineLanguages: [ "mermaid" ], loadInline: loadInlineEmbed }
            });
            withCodeBlocks.setData(`<pre><code class="language-plaintext">a</code></pre>`
                + `<pre class="extended-code-block"><code class="language-text-x-python"`
                + ` data-trilium-block-id="b1">x</code></pre>`);

            const model = getModelData(withCodeBlocks.model, { withoutSelection: true });
            expect(model).toMatch(/^<codeBlock [^>]*>a<\/codeBlock><contentEmbed /);
            // A code block keeps its block ID on the <code>, an embed on the <pre>.
            expect(withCodeBlocks.getData()).toContain(
                ` data-trilium-block-id="b1"><code class="language-text-x-python">x</code></pre>`);
        });

        it("writes the source that the host holds back before a copy", async () => {
            let source: InlineEmbedSource | undefined;
            const plugins = [ Essentials, Paragraph, Widget, ContentEmbed ];
            const copying = await createTestEditor(plugins, {
                contentEmbed: {
                    inlineLanguages: [],
                    loadInline: (loaded) => {
                        source = loaded;
                    },
                    flushInline: () => source?.setSource("y")
                }
            });
            copying.setData(`<pre class="extended-code-block">`
                + `<code class="language-text-plain">x</code></pre>`);
            const embed = copying.model.document.getRoot()?.getChild(0);
            if (!embed) throw new Error("Expected an embed.");
            copying.model.change((writer) => writer.setSelection(embed, "on"));

            const copied = new Map<string, string>();
            copying.editing.view.document.fire("copy", {
                dataTransfer: { setData: (type: string, data: string) => copied.set(type, data) },
                preventDefault: () => {},
                method: "copy"
            });

            expect(copied.get("text/html")).toContain(`<code class="language-text-plain">y</code>`);
            expect(copied.get("text/plain")).toBe("y");
        });
    });
});
