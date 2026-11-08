import type { LinkEmbedMetadata } from "@triliumnext/commons";
import { _setModelData as setModelData, type ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    changeCommand,
    createLinkEmbedHost,
    createTestEditor,
    findElement,
    hostConfig,
    LINK_EMBED_TEST_PLUGINS,
    META,
    type LinkEmbedHostMocks,
    useDeferredFetch
} from "../../../test/link-embed-kit.js";
import {
    CHANGE_LINK_DISPLAY_COMMAND, LINK_EMBED_COMMAND, REMOVE_LINK_EMBED_COMMAND
} from "./link_embed_commands.js";

describe("LinkEmbed commands", () => {
    let editor: ClassicEditor;
    let fetchMetadata: LinkEmbedHostMocks["fetchMetadata"];

    beforeEach(async () => {
        const host = createLinkEmbedHost();
        ({ fetchMetadata } = host);
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS, { linkEmbed: host });
    });

    // -----------------------------------------------------------------------
    // InsertLinkEmbedCommand
    // -----------------------------------------------------------------------

    it("inserts a preview for a URL, storing all the metadata whatever the mode", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        // An inline mention keeps the description and image it does not itself show, so switching it
        // to a card later never has to go back to the network.
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "iconAndTextLink" });

        expect(fetchMetadata).toHaveBeenCalledWith(url);
        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("url")).toBe(url);
        expect(mention?.getAttribute("description")).toBe(META.description);
        expect(mention?.getAttribute("image")).toBe(META.image);
        expect(mention?.getAttribute("siteName")).toBe(META.siteName);
    });

    it("forces the opengraph type for a card, and embeds the video for an embed", async () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        fetchMetadata.mockResolvedValue({ ...META, url, embedType: "youtube" });

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "cardLink" });
        // A card is an embed that declines to play.
        expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "embedLink" });
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(findElement(editor, "contentEmbed")?.getAttribute("embedType")).toBe("youtube");
    });

    it("inserts an ordinary link for 'textLink', without fetching any metadata", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "textLink" });

        expect(fetchMetadata).not.toHaveBeenCalled();
        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(editor.getData()).toBe(`<p><a href="${url}">${url}</a></p>`);

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "textLink", title: "The article" });
        expect(editor.getData()).toBe(`<p><a href="${url}">The article</a></p>`);
    });

    it("shows the link at once, then the preview as titled and described", async () => {
        const url = "https://example.com/article";
        const { resolveFetch } = useDeferredFetch(fetchMetadata);
        setModelData(editor.model, "<paragraph>see []</paragraph>");

        const executed = editor.execute(LINK_EMBED_COMMAND, {
            url, mode: "cardLink", title: "My title", description: "My description"
        }) as unknown as Promise<void>;
        expect(editor.getData()).toBe(`<p>see <a href="${url}">My title</a></p>`);
        resolveFetch({ ...META, url });
        await executed;

        const card = findElement(editor, "linkEmbed");
        expect(card?.getAttribute("title")).toBe("My title");
        expect(card?.getAttribute("description")).toBe("My description");
        expect(card?.getAttribute("image")).toBe(META.image);
        expect(editor.model.document.selection.getSelectedElement()).toBe(card);
    });

    it("leaves the caret where the user moved it while the metadata loads", async () => {
        const url = "https://example.com/article";
        const { resolveFetch } = useDeferredFetch(fetchMetadata);
        const selection = editor.model.document.selection;
        const moveCaretToSecondParagraph = () => editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(1);
            if (!paragraph?.is("element")) throw new Error("Expected a paragraph.");
            writer.setSelection(paragraph, "end");
            return paragraph;
        });

        setModelData(editor.model, "<paragraph>see []</paragraph><paragraph>elsewhere</paragraph>");
        const inserted = editor.execute(LINK_EMBED_COMMAND, {
            url, mode: "cardLink"
        }) as unknown as Promise<void>;
        let elsewhere = moveCaretToSecondParagraph();
        resolveFetch({ ...META, url });
        await inserted;

        expect(findElement(editor, "linkEmbed")).toBeDefined();
        expect(selection.getFirstPosition()?.parent).toBe(elsewhere);
        expect(selection.getFirstPosition()?.offset).toBe(9);

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">the []article</$text>`
            + "</paragraph><paragraph>elsewhere</paragraph>");
        const converted = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, {
            value: "iconAndTextLink"
        }) as unknown as Promise<void>;
        elsewhere = moveCaretToSecondParagraph();
        resolveFetch({ ...META, url });
        await converted;

        expect(findElement(editor, "linkMention")).toBeDefined();
        expect(selection.getFirstPosition()?.parent).toBe(elsewhere);
        expect(selection.getFirstPosition()?.offset).toBe(9);
    });

    it("replaces the link the selection is in, which is the link being edited", async () => {
        const url = "https://example.com/new";
        setModelData(editor.model, '<paragraph>see '
            + '<$text linkHref="https://example.com/old">the []old one</$text> here</paragraph>');

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "cardLink" });

        const embed = findElement(editor, "linkEmbed");
        expect(embed?.getAttribute("url")).toBe(url);
        expect(embed?.getAttribute("title")).toBe(META.title);
        expect(editor.getData()).not.toContain("example.com/old");
        expect(editor.getData()).not.toContain("old one");
    });

    it("reshapes and retitles a selected preview of the same address unfetched", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, `<paragraph>[<linkMention url="${url}" embedType="opengraph"`
            + ` title="Page" description="About"></linkMention>]</paragraph>`);

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "cardLink", title: "Mine" });

        const card = findElement(editor, "linkEmbed");
        expect(fetchMetadata).not.toHaveBeenCalled();
        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(card?.getAttribute("embedType")).toBe("opengraph");
        expect(card?.getAttribute("title")).toBe("Mine");
        expect(card?.getAttribute("description")).toBe("About");
        expect(editor.model.document.selection.getSelectedElement()).toBe(card);

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "cardLink", description: "My own" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("description")).toBe("My own");

        // Without a title or a description, the stored ones stay.
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "iconAndTextLink" });
        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("title")).toBe("Mine");
        expect(mention?.getAttribute("description")).toBe("My own");
    });

    it("replaces a selected preview of another address, or turned into a text link", async () => {
        const url = "https://example.com/new";
        setModelData(editor.model, '[<linkEmbed url="https://example.com/old" embedType="opengraph"'
            + ' title="Old"></linkEmbed>]');

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "iconAndTextLink" });

        expect(fetchMetadata).toHaveBeenCalledExactlyOnceWith(url);
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(findElement(editor, "linkMention")?.getAttribute("url")).toBe(url);

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "textLink", title: "New" });
        expect(editor.getData()).toBe(`<p><a href="${url}">New</a></p>`);
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
    // ChangeLinkDisplayCommand
    // -----------------------------------------------------------------------

    it("is disabled with no link widget selected and reports a null value", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const command = changeCommand(editor);
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
        expect(command.embedAvailable).toBe(false);
    });

    it("reports 'iconAndTextLink' for a linkMention and exposes embed availability", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://youtube.com/watch" embedType="web"></linkMention>]</paragraph>'
        );

        const command = changeCommand(editor);
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("iconAndTextLink");
        // detectEmbedType returns "youtube" (not "opengraph") => embeddable.
        expect(command.embedAvailable).toBe(true);
    });

    it("exposes an http(s) URL but withholds a hostile one, so the toolbar cannot arm it", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/page" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).url).toBe("https://e.com/page");

        // `url` comes from the stored data-url, which the sanitizers keep verbatim. Withholding it
        // leaves the "open link in new tab" and copy buttons disabled rather than armed.
        setModelData(editor.model, '[<linkEmbed url="javascript:alert(document.cookie)" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).url).toBeNull();
    });

    it("reports 'cardLink' for an opengraph linkEmbed and 'embedLink' otherwise", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).value).toBe("cardLink");

        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="web"></linkEmbed>]');
        expect(changeCommand(editor).value).toBe("embedLink");
    });

    it("converts a linkMention to an embed via the command, picking the detected type", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://youtube.com/watch" embedType="web" title="T"></linkMention>]</paragraph>'
        );

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });

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

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });

        const embed = findElement(editor, "linkEmbed");
        expect(embed?.getAttribute("embedType")).toBe("opengraph");
    });

    it("converts a linkEmbed back to an inline linkMention", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph" title="T"></linkEmbed>]');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "iconAndTextLink" });

        const mention = findElement(editor, "linkMention");
        expect(mention).toBeDefined();
        expect(mention?.getAttribute("url")).toBe("https://e.com/");
        expect(mention?.getAttribute("title")).toBe("T");
    });

    it("converts a link widget to a plain, ordinary link — and never re-converts it", async () => {
        setModelData(editor.model, '<paragraph>[<linkMention url="https://e.com/" title="T"></linkMention>]</paragraph>');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toBe('<p><a href="https://e.com/">T</a></p>');

        // The linked text arrives as an insertion, not a linkHref attribute change, so
        // AutoLinkToMention must not have kicked in and fetched the preview straight back.
        await Promise.resolve();
        expect(fetchMetadata).not.toHaveBeenCalled();

        // A block preview converts the same way, gaining a wrapping paragraph, and reads as its URL
        // without a title.
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });
        expect(editor.getData()).toBe('<p><a href="https://e.com/">https://e.com/</a></p>');
    });

    it("degrades a non-http(s) URL to bare text when converting to a text link", () => {
        // A data-url the sanitizers pass through verbatim must not become a live href
        // (same rule as the toolbar's open-link button; see isHttpUrl).
        setModelData(editor.model, '[<linkEmbed url="javascript:alert(1)" embedType="opengraph"></linkEmbed>]');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });

        expect(editor.getData()).toBe("<p>javascript:alert(1)</p>");
    });

    it("does nothing when the target mode equals the current mode", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        const before = editor.getData();

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" }); // current mode is already "cardLink"

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // Video embeds: the embed mode of a link preview that has a video
    // -----------------------------------------------------------------------

    describe("video embeds", () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        const video = `<contentEmbed embedType="youtube" title="T" url="${url}"></contentEmbed>`;

        it("embeds the video of a mention, and makes a card of an embed type without one", () => {
            setModelData(editor.model, `<paragraph>[<linkMention url="${url}" embedType="youtube"`
                + ` title="T"></linkMention>]</paragraph>`);
            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });

            const embed = findElement(editor, "contentEmbed");
            expect(embed && Object.fromEntries(embed.getAttributes())).toEqual({
                url, embedType: "youtube", title: "T",
                boxSize: "medium", hideTitle: true, customWidth: "35.6em"
            });
            expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
            expect(findElement(editor, "linkMention")).toBeUndefined();

            setModelData(editor.model, `<paragraph>[<linkMention url="${url}" embedType="youtube"`
                + ` aspectRatio="9/16"></linkMention>]</paragraph>`);
            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });
            const vertical = findElement(editor, "contentEmbed");
            expect([ vertical?.getAttribute("aspectRatio"), vertical?.getAttribute("customWidth") ])
                .toEqual([ "9/16", "11.3em" ]);

            setModelData(editor.model, `<paragraph>[<linkMention url="https://youtube.com/watch"`
                + ` embedType="youtube"></linkMention>]</paragraph>`);
            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });
            expect(findElement(editor, "contentEmbed")).toBeUndefined();
            expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("youtube");
        });

        it("shows a selected video as a preview in the embed mode, which can change", () => {
            setModelData(editor.model, `[${video}]`);
            const command = changeCommand(editor);
            expect([ command.isEnabled, command.value, command.embedAvailable, command.url ])
                .toEqual([ true, "embedLink", true, url ]);

            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });
            expect(findElement(editor, "contentEmbed")).toBeUndefined();
            const card = findElement(editor, "linkEmbed");
            expect(card?.getAttribute("embedType")).toBe("opengraph");
            expect(card?.getAttribute("title")).toBe("T");

            setModelData(editor.model, `[${video}]`);
            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });
            expect(editor.getData()).toBe(`<p><a href="${url}">T</a></p>`);
        });

        it("keeps the box, title, position and caption of a retitled video", async () => {
            setModelData(editor.model, `[<contentEmbed boxSize="full" embedType="youtube"`
                + ` position="right" title="T" url="${url}"><caption>Note</caption>`
                + `</contentEmbed>]`);

            await editor.execute(LINK_EMBED_COMMAND, { url, mode: "embedLink", title: "Mine" });

            const embed = findElement(editor, "contentEmbed");
            expect(fetchMetadata).not.toHaveBeenCalled();
            expect(embed && Object.fromEntries(embed.getAttributes())).toEqual({
                url, embedType: "youtube", title: "Mine", boxSize: "full", position: "right"
            });
            expect(editor.getData()).toContain("</section><figcaption>Note</figcaption></figure>");
            expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
        });

        it("plays another address in the box and caption of a selected video", async () => {
            const other = "https://youtube.com/watch?v=xyz98765432";
            fetchMetadata.mockResolvedValue({ ...META, url: other, embedType: "youtube" });
            setModelData(editor.model, `<paragraph>Before</paragraph>[<contentEmbed`
                + ` boxSize="medium" customWidth="40em" embedType="youtube" position="right"`
                + ` title="T" url="${url}"><caption>Note</caption></contentEmbed>]`);

            await editor.execute(LINK_EMBED_COMMAND, {
                url: other, mode: "embedLink", title: "Mine"
            });

            const embed = findElement(editor, "contentEmbed");
            expect(fetchMetadata).toHaveBeenCalledExactlyOnceWith(other);
            expect(embed && Object.fromEntries(embed.getAttributes())).toEqual({
                ...META, url: other, embedType: "youtube", title: "Mine",
                boxSize: "medium", customWidth: "40em", position: "right"
            });
            expect(editor.getData()).toContain("</section><figcaption>Note</figcaption></figure>");
            expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
        });

        it("shows the thumbnail and shape of another address, or a new frame", async () => {
            const other = "https://youtube.com/watch?v=xyz98765432";
            const file = "https://example.com/clip.mp4";
            const cover = "api/attachments/new/image/youtube-xyz98765432.jpg";
            const frame = "api/attachments/frame/image/clip.jpg";
            const host = createLinkEmbedHost();
            host.fetchMetadata.mockImplementation(async (address: string) => (address === file
                ? { url: file, embedType: "video", title: "clip.mp4" }
                : { ...META, url: address, embedType: "youtube", image: cover, aspectRatio: "9/16" }
            ));
            const captureVideoThumbnail = vi.fn(async () => ({ image: frame, aspectRatio: "4/3" }));
            const media = await createTestEditor(LINK_EMBED_TEST_PLUGINS, hostConfig({
                linkEmbed: host, contentEmbed: { captureVideoThumbnail }
            }));
            const shapeOf = () => {
                const embed = findElement(media, "contentEmbed");
                const figure = media.editing.view.getDomRoot()?.querySelector("figure");
                return [
                    embed?.getAttribute("image"), embed?.getAttribute("aspectRatio"),
                    figure?.style.getPropertyValue("--video-aspect-ratio")
                ];
            };
            setModelData(media.model, `[<contentEmbed aspectRatio="16/9" boxSize="full"`
                + ` embedType="youtube" image="api/attachments/old/image/youtube-abc.jpg"`
                + ` title="T" url="${url}"></contentEmbed>]`);

            await media.execute(LINK_EMBED_COMMAND, { url: other, mode: "embedLink" });
            expect(shapeOf()).toEqual([ cover, "9/16", String(9 / 16) ]);

            await media.execute(LINK_EMBED_COMMAND, { url: file, mode: "embedLink" });
            await vi.waitFor(() => expect(shapeOf()).toEqual([ frame, "4/3", String(4 / 3) ]));
            expect(captureVideoThumbnail)
                .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ url: file }));
        });

        it("gives other media the size of a new embed, and a Full video stays Full", async () => {
            const vertical = "https://youtube.com/watch?v=xyz98765432";
            const audio = "https://example.com/song.mp3";
            const sizeOf = () => {
                const embed = findElement(editor, "contentEmbed");
                return [ "url", "boxSize", "customWidth", "hideTitle", "position" ]
                    .map((key) => embed?.getAttribute(key));
            };
            fetchMetadata.mockImplementation(async (address: string) => address === audio
                ? { ...META, url: audio, embedType: "audio" }
                : { ...META, url: address, embedType: "youtube", aspectRatio: "9/16" });

            // A video at the default width of its shape takes the width of the new shape.
            setModelData(editor.model, `[<contentEmbed boxSize="medium" customWidth="35.6em"`
                + ` embedType="youtube" hideTitle="true" position="left" title="T"`
                + ` url="${url}"></contentEmbed>]`);
            await editor.execute(LINK_EMBED_COMMAND, { url: vertical, mode: "embedLink" });
            expect(sizeOf()).toEqual([ vertical, "medium", "11.3em", true, "left" ]);

            await editor.execute(LINK_EMBED_COMMAND, { url: audio, mode: "embedLink" });
            expect(sizeOf()).toEqual([ audio, "small", undefined, true, "left" ]);

            await editor.execute(LINK_EMBED_COMMAND, { url: vertical, mode: "embedLink" });
            expect(sizeOf()).toEqual([ vertical, "medium", "11.3em", true, "left" ]);

            setModelData(editor.model, `[<contentEmbed boxSize="full" embedType="youtube"`
                + ` title="T" url="${url}"></contentEmbed>]`);
            await editor.execute(LINK_EMBED_COMMAND, { url: vertical, mode: "embedLink" });
            expect(sizeOf()).toEqual([ vertical, "full", undefined, undefined, undefined ]);
        });

        it("rejects, changing nothing, for an address that plays nothing", async () => {
            const other = "https://youtube.com/watch?v=xyz98765432";
            setModelData(editor.model, `[${video}]`);
            const change = (address: string) =>
                editor.execute(LINK_EMBED_COMMAND, { url: address, mode: "embedLink" });

            await expect(change("https://example.com/page")).rejects.toThrow();
            fetchMetadata.mockResolvedValue({ url: other, embedType: "youtube", unresolved: true });
            await expect(change(other)).rejects.toThrow();

            expect(findElement(editor, "contentEmbed")?.getAttribute("url")).toBe(url);
            expect(findElement(editor, "linkEmbed")).toBeUndefined();
        });

        it("keeps a moved selection, and leaves a note left, while the media loads", async () => {
            const other = "https://youtube.com/watch?v=xyz98765432";
            const { resolveFetch } = useDeferredFetch(fetchMetadata);
            const change = () => editor.execute(LINK_EMBED_COMMAND, {
                url: other, mode: "embedLink"
            }) as unknown as Promise<void>;
            setModelData(editor.model, `<paragraph>Before</paragraph>[${video}]`);

            const changed = change();
            editor.model.change((writer) => {
                writer.setSelection(editor.model.document.getRoot()?.getChild(0) ?? null, "end");
            });
            expect(findElement(editor, "contentEmbed")?.getAttribute("url")).toBe(url);
            resolveFetch({ ...META, url: other, embedType: "youtube" });
            await changed;
            const selection = editor.model.document.selection;
            const embed = findElement(editor, "contentEmbed");
            expect([ embed?.getAttribute("url"), embed?.hasAttribute("hideTitle") ])
                .toEqual([ other, false ]);
            expect(selection.getSelectedElement()).toBeNull();
            expect(selection.getFirstPosition()?.offset).toBe(6);

            setModelData(editor.model, `[${video}]`);
            const replaced = change();
            editor.setData("<p>Other note</p>");
            const { version } = editor.model.document;
            resolveFetch({ ...META, url: other, embedType: "youtube" });
            await replaced;
            expect(editor.model.document.version).toBe(version);
            expect(editor.getData()).toBe("<p>Other note</p>");
        });

        it("plays the address saved last when the edits of a video overlap", async () => {
            const last = { ...META, url: "https://youtube.com/watch?v=def45678901" };
            const fetches: ((metadata: LinkEmbedMetadata) => void)[] = [];
            fetchMetadata.mockImplementation(() => new Promise<LinkEmbedMetadata>((resolve) => {
                fetches.push(resolve);
            }));
            // Saves the address of each of `edits` in turn, then answers the fetches in that order.
            const saveInTurn = async (...edits: LinkEmbedMetadata[]) => {
                fetches.length = 0;
                const changes = edits.map(({ url: address }) => editor.execute(
                    LINK_EMBED_COMMAND, { url: address, mode: "embedLink" }
                ) as unknown as Promise<void>);
                for (const [ index, metadata ] of edits.entries()) {
                    fetches[index]?.(metadata);
                }
                return await Promise.allSettled(changes);
            };

            setModelData(editor.model, `[${video}]`);
            await saveInTurn({ ...META, url: "https://youtube.com/watch?v=xyz98765432" }, last);
            const embed = findElement(editor, "contentEmbed");
            expect(embed?.getAttribute("url")).toBe(last.url);
            expect(editor.model.document.selection.getSelectedElement()).toBe(embed);

            // An earlier edit that plays nothing reports no error once a later one replaces it.
            setModelData(editor.model, `[${video}]`);
            const settled = await saveInTurn({ ...META, url: "https://example.com/page" }, last);
            expect(settled.map(({ status }) => status)).toEqual([ "fulfilled", "fulfilled" ]);
        });

        it("keeps the caption of a video given another display as a paragraph after it", () => {
            const captioned = (caption: string) => `<paragraph>Before</paragraph>[<contentEmbed`
                + ` embedType="youtube" title="T" url="${url}"><caption>${caption}</caption>`
                + `</contentEmbed>]`;
            const kept = /<p>A <a href="https:\/\/example\.com\/">note<\/a><\/p>$/;
            for (const value of [ "cardLink", "iconAndTextLink", "textLink" ] as const) {
                setModelData(editor.model,
                    captioned(`A <$text linkHref="https://example.com/">note</$text>`));
                editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value });
                expect(findElement(editor, "contentEmbed")).toBeUndefined();
                expect(editor.getData()).toMatch(kept);
            }

            setModelData(editor.model, captioned(""));
            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });
            expect(editor.getData()).toMatch(/<\/section>$/);
        });

        it("acts on a video from its caption, and on a link in the caption from that link", () => {
            const caption = (text: string) => `<contentEmbed embedType="youtube" title="T"`
                + ` url="${url}"><caption>${text}</caption></contentEmbed>`;
            const link = "https://example.com/";
            setModelData(editor.model, caption("A [] caption"));
            const command = changeCommand(editor);
            expect([ command.isEnabled, command.value, command.url ])
                .toEqual([ true, "embedLink", url ]);

            editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });
            expect(findElement(editor, "contentEmbed")).toBeUndefined();
            expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");

            setModelData(editor.model, caption(`<$text linkHref="${link}">a[]b</$text>`));
            expect([ command.isEnabled, command.value, command.url ])
                .toEqual([ true, "textLink", link ]);
        });

        it("leaves other embeds alone", () => {
            setModelData(editor.model, "[<contentEmbed boxSize=\"medium\" noteId=\"n1\">"
                + "</contentEmbed>]");
            expect(changeCommand(editor).isEnabled).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // RemoveLinkEmbedCommand (the toolbar's unlink button)
    // -----------------------------------------------------------------------

    it("unlinks a selected linkMention, leaving the bare URL as plain text", () => {
        setModelData(editor.model, '<paragraph>[<linkMention url="https://e.com/" title="T"></linkMention>]</paragraph>');

        editor.execute(REMOVE_LINK_EMBED_COMMAND);

        expect(findElement(editor, "linkMention")).toBeUndefined();
        // Mirrors the default link's unlink: the URL survives as plain, non-linked text.
        expect(editor.getData()).toBe("<p>https://e.com/</p>");
    });

    it("unlinks a selected block linkEmbed the same way", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="youtube"></linkEmbed>]');

        editor.execute(REMOVE_LINK_EMBED_COMMAND);

        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(editor.getData()).toBe("<p>https://e.com/</p>");
    });

    it("is disabled with no link widget selected, and does nothing if executed anyway", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const before = editor.getData();

        const command = editor.commands.get(REMOVE_LINK_EMBED_COMMAND);
        expect(command?.isEnabled).toBe(false);

        // Command swallows execute() while disabled, so force it enabled to exercise the early return.
        if (command) {
            command.isEnabled = true;
        }
        command?.execute();

        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // ChangeLinkDisplayCommand on a native link (the link balloon's Display dropdown)
    // -----------------------------------------------------------------------

    it("offers itself on a native http(s) link, reporting 'textLink' as the current mode", () => {
        const command = changeCommand(editor);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();

        setModelData(editor.model, '<paragraph><$text linkHref="https://youtube.com/watch">https://youtube.[]com/watch</$text></paragraph>');
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("textLink");
        expect(command.embedAvailable).toBe(true);
        expect(command.url).toBe("https://youtube.com/watch");

        // An internal reference link has no page to preview.
        setModelData(editor.model, '<paragraph><$text linkHref="#root/someNoteId">some[]note</$text></paragraph>');
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();
    });

    it("converts a labeled native link into an inline mention, keeping the surrounding text", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, `<paragraph>see <$text linkHref="${url}">the []article</$text> here</paragraph>`);

        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "iconAndTextLink" });

        expect(fetchMetadata).toHaveBeenCalledWith(url);
        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("url")).toBe(url);
        expect(mention?.getAttribute("title")).toBe("the article");
        // The label becomes the title of the pill; the text around the link survives (spaces
        // adjacent to an inline object serialize as &nbsp;), and the new widget is left selected so
        // its toolbar — this same dropdown included — takes over from the link balloon.
        expect(editor.getData()).toContain("<p>see&nbsp;<span");
        expect(editor.getData()).toContain("</span>&nbsp;here</p>");
        expect(editor.model.document.selection.getSelectedElement()).toBe(mention);
    });

    it("keeps a title through Text and back, but not the text of a bare URL", async () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        fetchMetadata.mockImplementation(async () => ({ ...META, url, embedType: "youtube" }));
        setModelData(editor.model, `[<linkEmbed url="${url}" embedType="opengraph"`
            + ` title="Mine"></linkEmbed>]`);

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });
        expect(editor.getData()).toBe(`<p><a href="${url}">Mine</a></p>`);

        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) throw new Error("Expected a paragraph.");
            writer.setSelection(paragraph, 2);
        });
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });
        expect(findElement(editor, "contentEmbed")?.getAttribute("title")).toBe("Mine");

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">${url}[]</$text>`
            + `</paragraph>`);
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("title")).toBe(META.title);
    });

    it("converts a native link to the chosen block shape: card forces opengraph, embed keeps the detected type", async () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        fetchMetadata.mockImplementation(async () => ({ ...META, url, embedType: "youtube" }));

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">watch [] this</$text></paragraph>`);
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">watch [] this</$text></paragraph>`);
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embedLink" });
        const embed = findElement(editor, "contentEmbed");
        expect(embed?.getAttribute("embedType")).toBe("youtube");
        expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
    });

    it("does nothing for 'textLink' on a native link — it already is one", async () => {
        setModelData(editor.model, '<paragraph><$text linkHref="https://e.com/">https://e.[]com/</$text></paragraph>');
        const before = editor.getData();

        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "textLink" });

        expect(fetchMetadata).not.toHaveBeenCalled();
        expect(editor.getData()).toBe(before);
    });

    it("does nothing when the linked text was deleted while the metadata was being fetched", async () => {
        const url = "https://example.com/";
        let resolveFetch: (meta: unknown) => void = () => {};
        fetchMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "iconAndTextLink" }) as unknown as Promise<void>;
        setModelData(editor.model, "<paragraph>replaced[]</paragraph>");
        resolveFetch({ ...META, url });
        await executed;

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(editor.getData()).toBe("<p>replaced</p>");
    });

    it("does not convert when the link was repointed at a different URL while the metadata was being fetched", async () => {
        const url = "https://example.com/";
        let resolveFetch: (meta: unknown) => void = () => {};
        fetchMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "iconAndTextLink" }) as unknown as Promise<void>;
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) throw new Error("Expected a paragraph.");
            writer.setAttribute("linkHref", "https://other.example.com/", writer.createRangeIn(paragraph));
        });
        resolveFetch({ ...META, url });
        await executed;

        // The text is still there but no longer carries the fetched URL: converting it would
        // attach one page's metadata to another page's link.
        expect(findElement(editor, "linkMention")).toBeUndefined();
    });

    it("still converts when the linked text survives behind an inserted element and a repointed prefix", async () => {
        const url = "https://example.com/";
        let resolveFetch: (meta: unknown) => void = () => {};
        fetchMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "iconAndTextLink" }) as unknown as Promise<void>;
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (!paragraph?.is("element")) throw new Error("Expected a paragraph.");
            // Repoint the first five characters and wedge a soft break after them: the range
            // walker must skip both before finding text that still carries the original link.
            writer.setAttribute("linkHref", "https://other.example.com/", writer.createRange(
                writer.createPositionAt(paragraph, 0),
                writer.createPositionAt(paragraph, 5)
            ));
            writer.insertElement("softBreak", paragraph, 5);
        });
        resolveFetch({ ...META, url });
        await executed;

        expect(findElement(editor, "linkMention")?.getAttribute("url")).toBe(url);
    });
});
