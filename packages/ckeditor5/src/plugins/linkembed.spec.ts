import {
    _getViewData as getViewData,
    _setModelData as setModelData,
    BlockQuote,
    ClassicEditor,
    Essentials,
    Link,
    Paragraph,
    Undo,
    type ViewElement
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import LinkEmbed, { CHANGE_LINK_DISPLAY_COMMAND, LINK_EMBED_COMMAND } from "./linkembed.js";

const META = {
    url: "https://example.com/",
    embedType: "web",
    title: "Example title",
    description: "Some description",
    favicon: "https://example.com/favicon.ico",
    siteName: "Example",
    image: "https://example.com/image.png"
};

describe("LinkEmbed", () => {
    let editor: ClassicEditor;
    let triggerCommand: ReturnType<typeof vi.fn>;
    let renderLinkEmbed: ReturnType<typeof vi.fn>;
    let renderLinkMention: ReturnType<typeof vi.fn>;
    let fetchLinkMetadata: ReturnType<typeof vi.fn>;
    let detectEmbedType: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        triggerCommand = vi.fn();
        renderLinkEmbed = vi.fn();
        renderLinkMention = vi.fn();
        fetchLinkMetadata = vi.fn(async (url: string) => ({ ...META, url }));
        // YouTube-like URLs => "youtube" (embeddable); everything else => "opengraph".
        detectEmbedType = vi.fn((url: string) => (url.includes("youtube") ? "youtube" : "opengraph"));

        installGlobMock({
            getComponentByEl: () => ({
                triggerCommand,
                renderLinkEmbed,
                renderLinkMention,
                fetchLinkMetadata,
                detectEmbedType
            })
        });

        editor = await createTestEditor([Essentials, Paragraph, BlockQuote, Link, Undo, LinkEmbed]);
    });

    // -----------------------------------------------------------------------
    // Plugin / UI registration
    // -----------------------------------------------------------------------

    it("loads the plugin, registers the commands and the toolbar button", () => {
        expect(editor.plugins.get(LinkEmbed)).toBeInstanceOf(LinkEmbed);
        expect(editor.commands.get(LINK_EMBED_COMMAND)).toBeDefined();
        expect(editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND)).toBeDefined();
        expect(editor.ui.componentFactory.has("linkEmbed")).toBe(true);
    });

    it("binds the button to the insert command and executes it on click", () => {
        const view = editor.ui.componentFactory.create("linkEmbed") as {
            isOn: boolean;
            isEnabled: boolean;
            fire(name: string): void;
        };
        const command = editor.commands.get(LINK_EMBED_COMMAND);

        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(LINK_EMBED_COMMAND);
    });

    // -----------------------------------------------------------------------
    // InsertLinkEmbedCommand
    // -----------------------------------------------------------------------

    it("triggers addLinkEmbedToText on the component when executed", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        editor.execute(LINK_EMBED_COMMAND);
        expect(triggerCommand).toHaveBeenCalledWith("addLinkEmbedToText");
    });

    it("is enabled in a paragraph and disabled when read-only", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const command = editor.commands.get(LINK_EMBED_COMMAND);
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(command?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
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

    it("editing-downcasts a linkMention to an inline widget and renders it via the component", () => {
        setModelData(
            editor.model,
            '<paragraph><linkMention url="https://e.com/" title="T" favicon="F"></linkMention></paragraph>'
        );

        const view = getViewData(editor.editing.view);
        expect(view).toContain("link-mention");

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

    // -----------------------------------------------------------------------
    // ChangeLinkDisplayCommand
    // -----------------------------------------------------------------------

    it("is disabled with no link widget selected and reports a null value", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const command = changeCommand(editor);
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
        expect(command.embedAvailable).toBe(false);
    });

    it("reports 'inline' for a selected linkMention and exposes embed availability", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://youtube.com/watch" embedType="web"></linkMention>]</paragraph>'
        );

        const command = changeCommand(editor);
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("inline");
        // detectEmbedType returns "youtube" (not "opengraph") => embeddable.
        expect(command.embedAvailable).toBe(true);
    });

    it("reports 'card' for an opengraph linkEmbed and 'embed' otherwise", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).value).toBe("card");

        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="web"></linkEmbed>]');
        expect(changeCommand(editor).value).toBe("embed");
    });

    it("converts a linkMention to an embed via the command, picking the detected type", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://youtube.com/watch" embedType="web" title="T"></linkMention>]</paragraph>'
        );

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embed" });

        const embed = findElement(editor, "linkEmbed");
        expect(embed).toBeDefined();
        expect(embed?.getAttribute("embedType")).toBe("youtube");
        expect(embed?.getAttribute("url")).toBe("https://youtube.com/watch");
        expect(embed?.getAttribute("title")).toBe("T");
    });

    it("converts a linkMention to a card, forcing the opengraph embed type", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://youtube.com/watch" embedType="web"></linkMention>]</paragraph>'
        );

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "card" });

        const embed = findElement(editor, "linkEmbed");
        expect(embed?.getAttribute("embedType")).toBe("opengraph");
    });

    it("converts a linkEmbed back to an inline linkMention", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph" title="T"></linkEmbed>]');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" });

        const mention = findElement(editor, "linkMention");
        expect(mention).toBeDefined();
        expect(mention?.getAttribute("url")).toBe("https://e.com/");
        expect(mention?.getAttribute("title")).toBe("T");
    });

    it("does nothing when the target mode equals the current mode", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        const before = editor.getData();

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "card" }); // current mode is already "card"

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toBe(before);
    });

    it("does nothing when executed without a selected link widget", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        // The command is disabled with no widget selected, and CKEditor's Command
        // swallows execute() while disabled. Force it enabled so the override body
        // runs and we exercise the early return for "no selected link widget".
        const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND);
        if (command) {
            command.isEnabled = true;
        }
        command?.execute({ value: "embed" });

        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // AutoLinkToMention
    // -----------------------------------------------------------------------

    it("converts a bare linked URL into a linkMention after fetching metadata", async () => {
        const url = "https://example.com/article";
        addLinkedText(editor, url);

        await flushFetch();

        expect(fetchLinkMetadata).toHaveBeenCalledWith(url);
        const mention = findElement(editor, "linkMention");
        expect(mention).toBeDefined();
        expect(mention?.getAttribute("url")).toBe(url);
        expect(mention?.getAttribute("title")).toBe(META.title);
    });

    it("ignores a labeled link whose text differs from the href", async () => {
        addLinkedText(editor, "https://example.com/article", "click here");

        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
    });

    it("ignores non-http(s) links that fail the embeddable URL regex", async () => {
        addLinkedText(editor, "mailto:test@example.com");

        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
    });

    it("skips non-text items in the affected range before reaching the URL text", async () => {
        const url = "https://example.com/break";

        // Put a softBreak (an inline element, not a text proxy) before the URL text so
        // the range walker yields a non-$textProxy item first, then the matching text.
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) {
                throw new Error("Expected a paragraph block.");
            }
            writer.insertElement("softBreak", paragraph, 0);
            writer.insertText(url, paragraph, "end");
        });
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                writer.setAttribute("linkHref", url, writer.createRangeIn(paragraph));
            }
        });

        await flushFetch();

        expect(fetchLinkMetadata).toHaveBeenCalledWith(url);
        expect(findElement(editor, "linkMention")).toBeDefined();
    });

    it("ignores undo batches that carry no linkHref attribute change", async () => {
        // Type plain text, then undo it: the undo batch is flagged isUndo but its diff is
        // an insert/remove change, exercising the non-attribute skip in the undo branch.
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                writer.insertText("hello", paragraph, 0);
            }
        });

        editor.execute("undo");
        await flushFetch();

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
    });

    it("records the URL on undo and does not re-convert it afterwards", async () => {
        const url = "https://example.com/again";

        // Apply the link to a LABELED link (text != href) so no conversion happens yet.
        setModelData(editor.model, "<paragraph>click here[]</paragraph>");
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                writer.setAttribute("linkHref", url, writer.createRangeIn(paragraph));
            }
        });
        await flushFetch();

        // Undo (linkHref url -> null): handler sees an undo batch with a non-string new
        // value, so nothing is recorded. Redo (null -> url): the undo batch carries a
        // string linkHref, so the handler records the URL as dismissed.
        editor.execute("undo");
        editor.execute("redo");
        await flushFetch();

        // Now a BARE link with the same URL must be skipped because it was dismissed.
        addLinkedText(editor, url);
        await flushFetch();

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(findElement(editor, "linkMention")).toBeUndefined();
    });

    it("ignores attribute modifications where the old linkHref value was not null", async () => {
        const url = "https://example.com/changed";
        editor.setData(`<p><a href="https://old.example.com/">${url}</a></p>`);

        // Change the existing href: old value is non-null, so the handler skips it.
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                writer.setAttribute("linkHref", url, writer.createRangeIn(paragraph));
            }
        });

        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
    });

    // The following tests exercise the defensive re-resolution guards in
    // _replaceWithMention: the model can change between when the fetch starts and
    // when it resolves, so the path/text are re-resolved and bail out gracefully.

    it("bails out when the parent block was removed before the fetch resolved", async () => {
        const { resolveFetch } = useDeferredFetch();
        const url = "https://example.com/gone";

        // The URL lives in the SECOND paragraph (stored parent path [1]).
        setModelData(editor.model, `<paragraph>first</paragraph><paragraph>${url}[]</paragraph>`);
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(1);
            if (paragraph?.is("element")) {
                writer.setAttribute("linkHref", url, writer.createRangeIn(paragraph));
            }
        });
        await flushFetch();

        // Remove the second paragraph: the stored path [1] now resolves to undefined.
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(1);
            if (paragraph) {
                writer.remove(paragraph);
            }
        });

        resolveFetch({ ...META, url });
        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
    });

    it("bails out when an intermediate path segment no longer resolves", async () => {
        const { resolveFetch } = useDeferredFetch();
        const url = "https://example.com/nested";

        // Nest the URL two block-quotes deep so the stored parent path has depth 3
        // ([outerQuote, innerQuote, paragraph]).
        editor.setData(`<blockquote><blockquote><p>${url}</p></blockquote></blockquote>`);
        editor.model.change((writer) => {
            const outer = editor.model.document.getRoot()?.getChild(0);
            const inner = outer?.is("element") ? outer.getChild(0) : undefined;
            const paragraph = inner?.is("element") ? inner.getChild(0) : undefined;
            if (paragraph?.is("element")) {
                writer.setAttribute("linkHref", url, writer.createRangeIn(paragraph));
            }
        });
        await flushFetch();

        // Remove the inner block-quote: both quotes collapse, leaving an auto-paragraph
        // at root[0]. Re-resolving the stored path [0,0,0] yields undefined at the second
        // segment, so the third iteration sees a falsy parentEl and bails.
        editor.model.change((writer) => {
            const outer = editor.model.document.getRoot()?.getChild(0);
            const inner = outer?.is("element") ? outer.getChild(0) : undefined;
            if (inner?.is("element")) {
                writer.remove(inner);
            }
        });

        resolveFetch({ ...META, url });
        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
    });

    it("skips non-matching text and bails when the URL text lost its linkHref", async () => {
        const { resolveFetch } = useDeferredFetch();
        const url = "https://example.com/edited";

        // Paragraph holds a non-matching text node followed by the URL text. Only the
        // URL text gets the linkHref, so the handler starts the deferred conversion.
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) {
                throw new Error("Expected a paragraph block.");
            }
            writer.insertText("other ", paragraph, 0);
            writer.insertText(url, paragraph, "end");
        });
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                const start = writer.createPositionAt(paragraph, 6); // after "other "
                const end = writer.createPositionAt(paragraph, "end");
                writer.setAttribute("linkHref", url, writer.createRange(start, end));
            }
        });
        await flushFetch();

        // Before the fetch resolves, point the URL text's linkHref at a different URL.
        // The inner walker now sees the non-matching "other " text (data != url) and
        // then the URL text whose linkHref no longer matches, so neither converts.
        // Keeping a distinct linkHref (rather than removing it) prevents the two text
        // nodes from merging, so both walker branches are exercised.
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph?.is("element")) {
                const start = writer.createPositionAt(paragraph, 6); // after "other "
                const end = writer.createPositionAt(paragraph, "end");
                writer.setAttribute("linkHref", "https://other.example.com/", writer.createRange(start, end));
            }
        });

        resolveFetch({ ...META, url });
        await flushFetch();

        expect(findElement(editor, "linkMention")).toBeUndefined();
    });

    function useDeferredFetch() {
        let resolveFetch: (metadata: LinkEmbedMetadata) => void = () => {};
        fetchLinkMetadata.mockImplementation(
            () => new Promise<LinkEmbedMetadata>((resolve) => {
                resolveFetch = resolve;
            })
        );
        return { resolveFetch: (metadata: LinkEmbedMetadata) => resolveFetch(metadata) };
    }
});

function changeCommand(editor: ClassicEditor): {
    isEnabled: boolean;
    value: string | null;
    embedAvailable: boolean;
} {
    const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND);
    if (!command) {
        throw new Error("changeLinkDisplay command is not registered.");
    }
    return command as unknown as { isEnabled: boolean; value: string | null; embedAvailable: boolean };
}

function findElement(editor: ClassicEditor, name: string) {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    const range = editor.model.createRangeIn(root);
    for (const item of range.getWalker()) {
        if (item.item.is("element", name)) {
            return item.item;
        }
    }
    return undefined;
}

/**
 * Inserts text into the paragraph and applies a `linkHref` attribute to it via a
 * writer change (null -> url), exactly as CKEditor's AutoLink plugin does when a
 * raw URL is pasted/typed. This drives the `AutoLinkToMention` `change:data` listener.
 */
function addLinkedText(editor: ClassicEditor, href: string, text = href): void {
    // First insert the plain text in its own batch.
    setModelData(editor.model, `<paragraph>${text}[]</paragraph>`);
    // Then, in a SEPARATE change, apply the linkHref attribute (null -> url).
    // AutoLink does exactly this, producing an attribute diff (not a text insert)
    // which is what AutoLinkToMention listens for.
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("Expected a paragraph block.");
        }
        writer.setAttribute("linkHref", href, writer.createRangeIn(paragraph));
    });
}

/** Lets the `fetchLinkMetadata().then(...)` microtask chain resolve. */
async function flushFetch(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
