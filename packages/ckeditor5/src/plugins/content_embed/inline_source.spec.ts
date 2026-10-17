import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ButtonView,
    ClassicEditor,
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
import { installGlobMock } from "../../../test/globals-test-kit.js";
import { SIZE_ATTRIBUTES } from "../resizable_widgets/resizable_widgets.js";
import ContentEmbedBoxSizeDropdown, {
    CONTENT_EMBED_BOX_SIZE_DROPDOWN
} from "./content_embed_box_size_dropdown.js";
import ContentEmbed, {
    BOX_SIZE_COMMAND_NAME,
    BOX_SIZES,
    CONTENT_EMBED_MENU,
    CONVERT_EMBED_TO_LINK_COMMAND,
    TOGGLE_CAPTION_COMMAND_NAME,
    TOGGLE_TITLE_COMMAND_NAME
} from "./content_embed.js";
import { INSERT_INLINE_EMBED_COMMAND, type InlineEmbedSource } from "./inline_source.js";

describe("ContentEmbedInlineSource", () => {
    let editor: ClassicEditor;
    let loadInlineEmbed: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        loadInlineEmbed = vi.fn();
        installGlobMock({
            getComponentByEl: () => ({
                triggerCommand: vi.fn(), loadEmbeddedNote: vi.fn(), loadInlineEmbed
            })
        });

        editor = await createTestEditor([
            Essentials, Paragraph, Undo, Widget, ContentEmbed, ContentEmbedBoxSizeDropdown
        ], {
            contentEmbed: { inlineLanguages: [ "mermaid" ] }
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

    it("leaves a code block of another language alone", () => {
        editor.setData(
            `<pre><code class="language-javascript">let a;</code></pre>`
            + `<pre><code class="language-mermaid">graph TD;</code></pre>`
        );

        const model = getModelData(editor.model, { withoutSelection: true });
        expect(model.match(/<contentEmbed /g)).toHaveLength(1);
        expect(model).toContain(`language="mermaid"`);
        expect(model).not.toContain("javascript");
    });

    it("has the host render the source, and writes its changes as steps of the undo", () => {
        editor.setData(`<pre><code class="language-mermaid">graph TD;</code></pre>`);

        expect(loadInlineEmbed).toHaveBeenCalledOnce();
        const [ source, $el, boxSize, options ] = loadInlineEmbed.mock.calls[0];
        expect(source.language).toBe("mermaid");
        expect(source.getSource()).toBe("graph TD;");
        expect(source.isReadOnly()).toBe(false);
        // `test/setup.ts` stubs jQuery as the identity, so the wrapper arrives as is.
        expect(($el as HTMLElement).classList.contains("include-note-wrapper")).toBe(true);
        expect(boxSize).toBe("medium");
        expect(options).toEqual({ isFocused: false });

        const listener = vi.fn();
        source.subscribe(listener);
        source.setSource("graph LR;");
        expect(getEmbed().getAttribute("source")).toBe("graph LR;");
        expect(listener).toHaveBeenCalledOnce();

        editor.execute("undo");
        expect(getEmbed().getAttribute("source")).toBe("graph TD;");
        expect(source.getSource()).toBe("graph TD;");
        expect(listener).toHaveBeenCalledTimes(2);
        // Writing the source does not draw the embed again, which would remount its editor.
        expect(loadInlineEmbed).toHaveBeenCalledOnce();
    });

    it("ignores a write of the same source, and stops calling a listener that unsubscribed", () => {
        editor.setData(`<pre><code class="language-mermaid">a</code></pre>`);
        const source = getLoadedSource();
        const listener = vi.fn();
        const unsubscribe = source.subscribe(listener);

        source.setSource("a");
        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
        source.setSource("b");
        expect(listener).not.toHaveBeenCalled();
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
});
