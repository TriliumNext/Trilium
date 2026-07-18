import { _getViewData as getViewData, _setModelData as setModelData, type ClassicEditor, type ViewElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, installLinkEmbedComponentMock, LINK_EMBED_TEST_PLUGINS, type LinkEmbedComponentMocks } from "../../../test/link-embed-kit.js";

describe("LinkEmbedEditing", () => {
    let editor: ClassicEditor;
    let renderLinkEmbed: LinkEmbedComponentMocks["renderLinkEmbed"];
    let renderLinkMention: LinkEmbedComponentMocks["renderLinkMention"];

    beforeEach(async () => {
        ({ renderLinkEmbed, renderLinkMention } = installLinkEmbedComponentMock());
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
    });

    // -----------------------------------------------------------------------
    // Schema + converters (block linkEmbed)
    // -----------------------------------------------------------------------

    it("registers linkEmbed (block) and linkMention (inline) in the schema", () => {
        const schema = editor.model.schema;
        expect(schema.isRegistered("linkEmbed")).toBe(true);
        expect(schema.isObject("linkEmbed")).toBe(true);
        expect(schema.isRegistered("linkMention")).toBe(true);
        expect(schema.isInline("linkMention")).toBe(true);
        expect(schema.isObject("linkMention")).toBe(true);
    });

    it("upcasts a <section.link-embed> with all data attributes into a linkEmbed", () => {
        editor.setData(
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="web"' +
            ' data-title="T" data-description="D" data-favicon="F" data-site-name="S" data-image="I"></section>'
        );

        const root = editor.model.document.getRoot();
        const embed = root?.getChild(0);
        expect(embed?.is("element")).toBe(true);
        if (embed?.is("element")) {
            expect(embed.name).toBe("linkEmbed");
            expect(embed.getAttribute("url")).toBe("https://e.com/");
            expect(embed.getAttribute("embedType")).toBe("web");
            expect(embed.getAttribute("title")).toBe("T");
            expect(embed.getAttribute("siteName")).toBe("S");
            expect(embed.getAttribute("image")).toBe("I");
        }

        // The editing downcast UIElement callback ran and rendered the embed.
        expect(renderLinkEmbed).toHaveBeenCalled();
        const [, metadata, editable] = renderLinkEmbed.mock.calls[0];
        expect(metadata.url).toBe("https://e.com/");
        expect(editable).toBe(true);
    });

    it("data-downcasts a fully-populated linkEmbed, omitting empty optional attributes", () => {
        setModelData(
            editor.model,
            '<linkEmbed url="https://e.com/" embedType="web" title="T" description="D"' +
            ' favicon="F" siteName="S" image="I"></linkEmbed>'
        );

        const data = editor.getData();
        expect(data).toContain('class="link-embed"');
        expect(data).toContain('data-url="https://e.com/"');
        expect(data).toContain('data-embed-type="web"');
        expect(data).toContain('data-title="T"');
        expect(data).toContain('data-site-name="S"');
        expect(data).toContain('data-image="I"');
    });

    it("data-downcasts a minimal linkEmbed without the optional attributes", () => {
        setModelData(editor.model, '<linkEmbed url="https://e.com/" embedType="web"></linkEmbed>');

        const data = editor.getData();
        expect(data).toContain('data-url="https://e.com/"');
        expect(data).not.toContain("data-title");
        expect(data).not.toContain("data-site-name");
        expect(data).not.toContain("data-image");
    });

    it("editing-downcasts a linkEmbed to a widget and renders it via the component", () => {
        setModelData(
            editor.model,
            '<linkEmbed url="https://e.com/" embedType="web" title="T" description="D"' +
            ' favicon="F" siteName="S" image="I"></linkEmbed>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("link-embed");
        expect(view).toContain("ck-widget");
        // The block preview carries CKEditor's own drag handle (as tables do), so the whole widget
        // moves as one instead of the user tearing its image and text apart.
        expect(view).toContain("ck-widget_with-selection-handle");

        // The editing wrapper must carry the full metadata, not just the URL: a copy that starts
        // inside the rendered preview bypasses CKEditor's clipboard pipeline and serializes the
        // editing DOM, and upcast rebuilds the widget purely from these attributes.
        expect(view).toContain('data-title="T"');
        expect(view).toContain('data-description="D"');
        expect(view).toContain('data-favicon="F"');
        expect(view).toContain('data-site-name="S"');
        expect(view).toContain('data-image="I"');

        expect(renderLinkEmbed).toHaveBeenCalled();
        const [container, metadata, editable] = renderLinkEmbed.mock.calls[0];
        expect(container).toBeInstanceOf(HTMLElement);
        expect(metadata).toMatchObject({ url: "https://e.com/", embedType: "web", title: "T" });
        expect(editable).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Schema + converters (inline linkMention)
    // -----------------------------------------------------------------------

    it("upcasts a <span.link-mention> into a linkMention", () => {
        editor.setData(
            '<p><span class="link-mention" data-url="https://e.com/" data-embed-type="web"' +
            ' data-title="T" data-description="D" data-favicon="F" data-site-name="S" data-image="I">x</span></p>'
        );

        const paragraph = editor.model.document.getRoot()?.getChild(0);
        const mention = paragraph?.is("element") ? paragraph.getChild(0) : undefined;
        expect(mention?.is("element")).toBe(true);
        if (mention?.is("element")) {
            expect(mention.name).toBe("linkMention");
            expect(mention.getAttribute("url")).toBe("https://e.com/");
            expect(mention.getAttribute("favicon")).toBe("F");
        }

        expect(renderLinkMention).toHaveBeenCalled();
    });

    it("data-downcasts a fully-populated linkMention, omitting empty optional attributes", () => {
        setModelData(
            editor.model,
            '<paragraph><linkMention url="https://e.com/" embedType="web" title="T" description="D"' +
            ' favicon="F" siteName="S" image="I"></linkMention></paragraph>'
        );

        const data = editor.getData();
        expect(data).toContain('class="link-mention"');
        expect(data).toContain('data-url="https://e.com/"');
        expect(data).toContain('data-embed-type="web"');
        expect(data).toContain('data-title="T"');
        expect(data).toContain('data-site-name="S"');
        expect(data).toContain('data-image="I"');
    });

    it("data-downcasts a minimal linkMention without the optional attributes", () => {
        setModelData(editor.model, '<paragraph><linkMention url="https://e.com/"></linkMention></paragraph>');

        const data = editor.getData();
        expect(data).toContain('data-url="https://e.com/"');
        expect(data).not.toContain("data-embed-type");
        expect(data).not.toContain("data-title");
        expect(data).not.toContain("data-site-name");
    });

    it("upcasts link previews carrying the Markdown-export fallback anchor, dropping the anchor", () => {
        // The Markdown exporter injects an <a> child into the otherwise empty elements so the
        // export stays readable outside Trilium; on reimport the anchor must vanish into the
        // widget instead of leaking as stray text.
        editor.setData(
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph" data-title="T">' +
            '<a href="https://e.com/">T</a></section>' +
            '<p>See <span class="link-mention" data-url="https://e.com/" data-title="T">' +
            '<a href="https://e.com/">T</a></span> for details.</p>'
        );

        const root = editor.model.document.getRoot();
        expect(root?.childCount).toBe(2);

        const embed = root?.getChild(0);
        expect(embed?.is("element", "linkEmbed")).toBe(true);
        if (embed?.is("element")) {
            expect(embed.getAttribute("url")).toBe("https://e.com/");
            expect(embed.childCount).toBe(0);
        }

        const paragraph = root?.getChild(1);
        const mention = paragraph?.is("element") ? paragraph.getChild(1) : undefined;
        expect(mention?.is("element", "linkMention")).toBe(true);

        // Saving again produces the canonical childless elements — the anchor does not survive,
        // let alone accumulate.
        const data = editor.getData();
        expect(data).not.toContain("<a");
        expect(data).toContain('data-url="https://e.com/"');
    });

    it("editing-downcasts a linkMention to an inline widget and renders it via the component", () => {
        setModelData(
            editor.model,
            '<paragraph><linkMention url="https://e.com/" embedType="web" title="T" description="D"' +
            ' favicon="F" siteName="S" image="I"></linkMention></paragraph>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("link-mention");

        // Same rationale as for the block embed: a native browser copy of the editing DOM (a copy
        // starting inside the rendered preview) must round-trip the metadata through upcast, so the
        // wrapper carries all of it — this is what used to drop the favicon/title of a pasted mention.
        expect(view).toContain('data-embed-type="web"');
        expect(view).toContain('data-title="T"');
        expect(view).toContain('data-description="D"');
        expect(view).toContain('data-favicon="F"');
        expect(view).toContain('data-site-name="S"');
        expect(view).toContain('data-image="I"');

        expect(renderLinkMention).toHaveBeenCalled();
        const [container, metadata, editable] = renderLinkMention.mock.calls[0];
        expect(container).toBeInstanceOf(HTMLElement);
        expect(metadata).toMatchObject({ url: "https://e.com/", title: "T", favicon: "F" });
        expect(editable).toBe(true);
    });

    it("maps a view position inside the rendered linkMention to a model position OUTSIDE the object", () => {
        // linkMention is an empty inline object whose editing view holds a UIElement child. Without
        // the viewToModelPositionOutsideModelElement mapper registered in LinkEmbedEditing, a view
        // position inside the rendered widget resolves to a degenerate model position *inside* the
        // atomic object; the mapper must instead resolve it just after the mention.
        setModelData(
            editor.model,
            '<paragraph>foo<linkMention url="https://e.com/" title="T"></linkMention>bar</paragraph>'
        );

        const root = editor.editing.view.document.getRoot();
        let mentionView: ViewElement | undefined;
        if (root) {
            for (const { item } of editor.editing.view.createRangeIn(root)) {
                if (item.is("element") && item.hasClass("link-mention")) {
                    mentionView = item;
                    break;
                }
            }
        }
        expect(mentionView).toBeDefined();
        if (!mentionView) {
            return;
        }

        const viewPosition = editor.editing.view.createPositionAt(mentionView, "end");
        const modelPosition = editor.editing.mapper.toModelPosition(viewPosition);

        // Must land just after the mention (paragraph offset 4 = "foo"(3) + linkMention(1)),
        // not inside the atomic linkMention element.
        expect(modelPosition.parent.is("element", "linkMention")).toBe(false);
        expect(modelPosition.parent.is("element", "paragraph")).toBe(true);
        expect(modelPosition.offset).toBe(4);
    });
});
