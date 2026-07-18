import { _setModelData as setModelData, type ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    addLinkedText,
    autoLinkIn,
    createTestEditor,
    findElement,
    flushFetch,
    hostConfig,
    installLinkEmbedComponentMock,
    LINK_EMBED_TEST_PLUGINS,
    META,
    urlLeftAloneOnItsOwnLine,
    useDeferredFetch,
    type LinkEmbedComponentMocks
} from "../../../test/link-embed-kit.js";
import { LINK_EMBED_COMMAND } from "./link_embed_commands.js";

describe("AutoLinkToMention", () => {
    let editor: ClassicEditor;
    let fetchLinkMetadata: LinkEmbedComponentMocks["fetchLinkMetadata"];

    beforeEach(async () => {
        ({ fetchLinkMetadata } = installLinkEmbedComponentMock());
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
    });

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

    it("leaves the plain link untouched when the metadata could not be resolved, and says why", async () => {
        const url = "https://blocked.example.com/article";
        fetchLinkMetadata.mockResolvedValueOnce({ url, embedType: "opengraph", title: "blocked.example.com", unresolved: true });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        addLinkedText(editor, url);
        await flushFetch();

        expect(fetchLinkMetadata).toHaveBeenCalledWith(url);
        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        // The link AutoLink created is still there, as plain linked text.
        expect(editor.getData()).toContain(`<a href="${url}">${url}</a>`);
        // The warning says what happened but never names the URL: a console gets screenshotted and
        // pasted into bug reports, and a pasted link can carry a one-time token.
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Link preview dropped"));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(url));

        warn.mockRestore();
    });

    it("does not auto-convert when autoLinkPreviewsEnabled is false, but still offers the insert command", async () => {
        const url = "https://example.com/article";
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS, hostConfig({ autoLinkPreviewsEnabled: false }));

        addLinkedText(editor, url);
        await flushFetch();

        // The URL is not even looked up: the check runs before the metadata request.
        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toContain(`<a href="${url}">${url}</a>`);

        // Inserting a preview by hand is unaffected by the option: only auto-detection is gated.
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "card" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("url")).toBe(url);
    });

    it("re-reads a getter on every detected URL, so toggling the option needs no new editor", async () => {
        let enabled = false;
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS, hostConfig({ autoLinkPreviewsEnabled: () => enabled }));

        addLinkedText(editor, "https://example.com/off");
        await flushFetch();
        expect(findElement(editor, "linkMention")).toBeUndefined();

        // Flip the option on the same editor instance — the next detected URL converts.
        enabled = true;
        addLinkedText(editor, "https://example.com/on");
        await flushFetch();
        expect(findElement(editor, "linkMention")).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // Placement: what shape an auto-detected URL takes, and why
    // -----------------------------------------------------------------------

    describe("placement", () => {
        const PLAIN_URL = "https://example.com/article";
        const VIDEO_URL = "https://youtube.com/watch?v=abc12345678";

        /** Makes the next fetch report `url` as embeddable, the way a YouTube link comes back. */
        function embeddable(url: string) {
            fetchLinkMetadata.mockResolvedValueOnce({ ...META, url, embedType: "youtube" });
        }

        it("turns a URL left alone on its own line into a card", async () => {
            autoLinkIn(editor, urlLeftAloneOnItsOwnLine(PLAIN_URL), PLAIN_URL);
            await flushFetch();

            expect(findElement(editor, "linkMention")).toBeUndefined();
            const embed = findElement(editor, "linkEmbed");
            expect(embed?.getAttribute("url")).toBe(PLAIN_URL);
            // "opengraph" is what the renderer shows as a card rather than a player.
            expect(embed?.getAttribute("embedType")).toBe("opengraph");
        });

        it("turns an embeddable URL left alone on its own line into a player", async () => {
            embeddable(VIDEO_URL);

            autoLinkIn(editor, urlLeftAloneOnItsOwnLine(VIDEO_URL), VIDEO_URL);
            await flushFetch();

            expect(findElement(editor, "linkMention")).toBeUndefined();
            expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("youtube");
        });

        it("keeps the URL inline while the caret is still on its line, embeddable or not", async () => {
            // The user typed a space, not Enter: they may still be writing that sentence, so the URL
            // is alone only by accident. Nothing has been *left* alone yet.
            embeddable(VIDEO_URL);
            addLinkedText(editor, VIDEO_URL);
            await flushFetch();

            expect(findElement(editor, "linkEmbed")).toBeUndefined();
            expect(findElement(editor, "linkMention")?.getAttribute("url")).toBe(VIDEO_URL);
        });

        it("keeps the URL inline when text sits beside it on the line", async () => {
            autoLinkIn(editor, `<paragraph>See ${PLAIN_URL}</paragraph><paragraph>[]</paragraph>`, PLAIN_URL);
            await flushFetch();

            expect(findElement(editor, "linkEmbed")).toBeUndefined();
            expect(findElement(editor, "linkMention")).toBeDefined();
        });

        it("keeps the URL inline inside a list item, a quote and a heading", async () => {
            // A block preview inside these reads as a layout accident, so they stay inline — even
            // though the URL is alone in its block and the caret has moved on.
            const blocks = {
                "list item": `<paragraph listIndent="0" listItemId="a" listType="bulleted">${PLAIN_URL}</paragraph>`,
                quote: `<blockQuote><paragraph>${PLAIN_URL}</paragraph></blockQuote>`,
                heading: `<heading2>${PLAIN_URL}</heading2>`
            };

            for (const block of Object.values(blocks)) {
                autoLinkIn(editor, `${block}<paragraph>[]</paragraph>`, PLAIN_URL);
                await flushFetch();

                expect(findElement(editor, "linkEmbed")).toBeUndefined();
                expect(findElement(editor, "linkMention")).toBeDefined();
            }
        });

        it("leaves the caret where the user moved it, even if they typed while the fetch was in flight", async () => {
            const { resolveFetch } = useDeferredFetch(fetchLinkMetadata);
            autoLinkIn(editor, urlLeftAloneOnItsOwnLine(PLAIN_URL), PLAIN_URL);

            // The user carries on typing on the new line while the metadata is still being fetched.
            editor.model.change((writer) => {
                const caret = editor.model.document.selection.getFirstPosition();
                if (!caret) {
                    throw new Error("Expected a caret position.");
                }
                writer.insertText("hello", caret);
            });

            resolveFetch({ ...META, url: PLAIN_URL });
            await flushFetch();

            // The card took over the URL's paragraph without dragging the caret back into it: the
            // typed text is intact and the caret still sits after it.
            expect(findElement(editor, "linkEmbed")).toBeDefined();
            expect(editor.getData()).toContain("<p>hello</p>");

            const caretBlock = editor.model.document.selection.getFirstPosition()?.parent;
            expect(caretBlock?.is("element", "paragraph")).toBe(true);
        });

        it("does not drag the caret back when an inline mention lands mid-typing", async () => {
            const { resolveFetch } = useDeferredFetch(fetchLinkMetadata);
            // Text beside the URL makes this a mention; the caret has already moved to the next line.
            autoLinkIn(editor, `<paragraph>see ${PLAIN_URL}</paragraph><paragraph>[]</paragraph>`, PLAIN_URL);

            // The user keeps typing on the second line while the metadata is still being fetched.
            editor.model.change((writer) => {
                const caret = editor.model.document.selection.getFirstPosition();
                if (!caret) {
                    throw new Error("Expected a caret position.");
                }
                writer.insertText("hello", caret);
            });

            resolveFetch({ ...META, url: PLAIN_URL });
            await flushFetch();

            // The mention replaced the URL up on the first line...
            expect(findElement(editor, "linkMention")?.getAttribute("url")).toBe(PLAIN_URL);
            expect(editor.getData()).toContain("<p>hello</p>");

            // ...while the caret stayed down where the user was typing.
            const caretBlock = editor.model.document.selection.getFirstPosition()?.parent;
            expect(caretBlock).toBe(editor.model.document.getRoot()?.getChild(1));
        });
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
    // _replaceWithPreview: the model can change between when the fetch starts and
    // when it resolves, so the path/text are re-resolved and bail out gracefully.

    it("bails out when the parent block was removed before the fetch resolved", async () => {
        const { resolveFetch } = useDeferredFetch(fetchLinkMetadata);
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
        const { resolveFetch } = useDeferredFetch(fetchLinkMetadata);
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
        const { resolveFetch } = useDeferredFetch(fetchLinkMetadata);
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
});
