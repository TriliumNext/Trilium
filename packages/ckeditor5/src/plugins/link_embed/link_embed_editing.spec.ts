import {
    _getViewData as getViewData, _setModelData as setModelData, type ClassicEditor,
    FontBackgroundColor, FontColor, type ViewElement
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createLinkEmbedHost, createTestEditor, findElement, LINK_EMBED_TEST_PLUGINS,
    type LinkEmbedHostMocks
} from "../../../test/link-embed-kit.js";
import ClipboardPlainTextIndent from "../clipboard_plain_text_indent.js";

describe("LinkEmbedEditing", () => {
    let editor: ClassicEditor;
    let renderEmbed: LinkEmbedHostMocks["renderEmbed"];
    let renderMention: LinkEmbedHostMocks["renderMention"];

    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    beforeEach(async () => {
        const host = createLinkEmbedHost();
        ({ renderEmbed, renderMention } = host);
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS, { linkEmbed: host });
    });

    // -----------------------------------------------------------------------
    // Schema + converters (block linkEmbed)
    // -----------------------------------------------------------------------

    it("registers linkEmbed (block) and linkMention (inline) in the schema", () => {
        const schema = editor.model.schema;
        expect(schema.isRegistered("linkEmbed")).toBe(true);
        expect(schema.isObject("linkEmbed")).toBe(true);
        expect(schema.isBlock("linkEmbed")).toBe(true);
        expect(schema.isRegistered("linkMention")).toBe(true);
        expect(schema.isInline("linkMention")).toBe(true);
        expect(schema.isObject("linkMention")).toBe(true);
    });

    it("makes a selected linkEmbed one of the selected blocks", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.co/" embedType="web"></linkEmbed>]');
        const blocks = Array.from(editor.model.document.selection.getSelectedBlocks());
        expect(blocks.map((block) => block.name)).toStrictEqual([ "linkEmbed" ]);
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
        expect(renderEmbed).toHaveBeenCalled();
        const [, metadata, editable] = renderEmbed.mock.calls[0];
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
        // The block preview carries CKEditor's own drag handle, as tables do.
        expect(view).toContain("ck-widget_with-selection-handle");

        // The editing wrapper must carry the full metadata, not just the URL: a copy that starts
        // inside the rendered preview bypasses CKEditor's clipboard pipeline and serializes the
        // editing DOM, and upcast rebuilds the widget purely from these attributes.
        expect(view).toContain('data-title="T"');
        expect(view).toContain('data-description="D"');
        expect(view).toContain('data-favicon="F"');
        expect(view).toContain('data-site-name="S"');
        expect(view).toContain('data-image="I"');

        expect(renderEmbed).toHaveBeenCalled();
        const [container, metadata, editable] = renderEmbed.mock.calls[0];
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

        expect(renderMention).toHaveBeenCalled();
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

    it("copies link previews as links to their URL, and saves them without one", async () => {
        const plugins = [ ...LINK_EMBED_TEST_PLUGINS, ClipboardPlainTextIndent ];
        const copying = await createTestEditor(plugins, { linkEmbed: createLinkEmbedHost() });
        setModelData(copying.model,
            '<linkEmbed url="https://e.com/" embedType="opengraph" title="T"></linkEmbed>'
            + '<paragraph>See <linkMention url="https://f.com/"></linkMention>, or'
            + ' <linkMention url="javascript:alert(1)" title="X"></linkMention>[]</paragraph>');
        copying.execute("selectAll");

        const copied = new Map<string, string>();
        copying.editing.view.document.fire("copy", {
            dataTransfer: { setData: (type: string, data: string) => copied.set(type, data) },
            preventDefault: () => {},
            method: "copy"
        });

        expect(copied.get("text/html")).toBe(
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph"'
            + ' data-title="T"><a href="https://e.com/">T</a></section>'
            + '<p>See&nbsp;<span class="link-mention" data-url="https://f.com/">'
            + '<a href="https://f.com/">https://f.com/</a></span>'
            + ', or&nbsp;<span class="link-mention" data-url="javascript:alert(1)" data-title="X">'
            + '<a href="about:blank">X</a></span></p>'
        );
        expect(copied.get("text/plain"))
            .toBe("https://e.com/\n\nSee https://f.com/, or javascript:alert(1)");
        expect(copying.getData()).not.toContain("<a");
    });

    it("lets the font color commands color link previews and the text by a mention", async () => {
        const plugins = [ ...LINK_EMBED_TEST_PLUGINS, FontColor, FontBackgroundColor ];
        const coloring = await createTestEditor(plugins, { linkEmbed: createLinkEmbedHost() });
        setModelData(coloring.model,
            '<paragraph>[See <linkMention url="https://e.com/"></linkMention>]</paragraph>'
            + '<linkEmbed url="https://f.com/" embedType="opengraph"></linkEmbed>');
        coloring.execute("fontColor", { value: "#e64d4d" });
        const card = findElement(coloring, "linkEmbed");
        if (!card) {
            throw new Error("Expected a card.");
        }
        coloring.model.change((writer) => writer.setSelection(card, "on"));
        coloring.execute("fontBackgroundColor", { value: "#e5e64d" });

        const data = coloring.getData();
        expect(data).toBe('<p><span style="color:#e64d4d;">See&nbsp;</span>'
            + '<span class="link-mention" style="--tn-color:#e64d4d;color:#e64d4d;"'
            + ' data-url="https://e.com/">&nbsp;</span></p>'
            + '<section class="link-embed"'
            + ' style="--tn-background:#e5e64d;background-color:#e5e64d;"'
            + ' data-url="https://f.com/" data-embed-type="opengraph">&nbsp;</section>');

        coloring.setData(data);
        expect(findElement(coloring, "linkMention")?.getAttribute("fontColor")).toBe("#e64d4d");
        expect(findElement(coloring, "linkEmbed")?.getAttribute("fontBackgroundColor"))
            .toBe("#e5e64d");
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

        expect(renderMention).toHaveBeenCalled();
        const [container, metadata, editable] = renderMention.mock.calls[0];
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

    it("turns the renderer's focus back on for a key in the text after a press on a mention", () => {
        setModelData(editor.model, "<paragraph>foo[]"
            + "<linkMention url=\"https://e.com/\" embedType=\"opengraph\"></linkMention>"
            + "</paragraph>");
        // A headless page cannot take the real focus, so set the flag the renderer reads.
        editor.editing.view.document.isFocused = true;
        const domRoot = editor.editing.view.getDomRoot();
        const mention = domRoot?.querySelector(".link-mention-inner");
        if (!domRoot || !mention) {
            throw new Error("The link mention was not rendered.");
        }

        mention.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        expect(rendererIsFocused()).toBe(false);

        domRoot.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
        expect(rendererIsFocused()).toBe(true);
    });

    it("moves a link preview whole when a drag starts on its content", () => {
        const renderLink = (container: HTMLElement) => {
            container.innerHTML = '<a href="https://e.com/">T</a>';
        };
        renderEmbed.mockImplementation(renderLink);
        renderMention.mockImplementation(renderLink);
        setModelData(editor.model, "<paragraph>one</paragraph>"
            + '<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>'
            + '<paragraph>two <linkMention url="https://f.com/"></linkMention></paragraph>'
            + "<paragraph>three</paragraph>");
        const domRoot = editor.editing.view.getDomRoot();
        if (!domRoot) {
            throw new Error("The editor has no editable.");
        }
        domRoot.scrollIntoView();

        const card = domRoot.querySelector(".link-embed");
        const lastRect = domRoot.children[3].getBoundingClientRect();
        expect(dragLinkTo(card, { clientX: lastRect.left + 5, clientY: lastRect.bottom - 2 }))
            .toBe(card);
        const mention = domRoot.querySelector(".link-mention");
        const firstRect = domRoot.children[0].getBoundingClientRect();
        expect(dragLinkTo(mention,
            { clientX: firstRect.left + 1, clientY: firstRect.top + firstRect.height / 2 }))
            .toBe(mention);

        expect(editor.getData()).toBe('<p><span class="link-mention" data-url="https://f.com/">'
            + "&nbsp;</span>one</p><p>two&nbsp;</p><p>three</p>"
            + '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph">'
            + "&nbsp;</section>");
    });

    function rendererIsFocused() {
        //@ts-expect-error: The renderer is a private field.
        return editor.editing.view._renderer.isFocused as boolean;
    }
});

/**
 * Presses the link in `preview` and drags it to `point`, with the data that the browser gives a
 * drag of a link, then drops it there. Returns the element that the drag image shows.
 */
function dragLinkTo(preview: Element | null, point: { clientX: number; clientY: number }) {
    const link = preview?.querySelector("a");
    if (!link) {
        throw new Error("The preview has no link.");
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/uri-list", link.href);
    dataTransfer.setData("text/html", link.outerHTML);
    // A constructed `DataTransfer` ignores `effectAllowed` and `dropEffect` writes.
    Object.defineProperty(dataTransfer, "effectAllowed", { value: "copyLink", writable: true });
    const setDragImage = vi.spyOn(dataTransfer, "setDragImage");
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    link.dispatchEvent(new DragEvent("dragstart", {
        bubbles: true, cancelable: true, dataTransfer
    }));

    const target = document.elementFromPoint(point.clientX, point.clientY) ?? document;
    const dropInit = { bubbles: true, cancelable: true, dataTransfer, ...point };
    target.dispatchEvent(new DragEvent("dragover", dropInit));
    target.dispatchEvent(new DragEvent("drop", dropInit));
    Object.defineProperty(dataTransfer, "dropEffect", { value: "move" });
    link.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    return setDragImage.mock.calls.at(0)?.[0];
}
