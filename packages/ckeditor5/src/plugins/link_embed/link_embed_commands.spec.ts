import { _setModelData as setModelData, type ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import {
    changeCommand,
    createTestEditor,
    findElement,
    installLinkEmbedComponentMock,
    LINK_EMBED_TEST_PLUGINS,
    META,
    type LinkEmbedComponentMocks
} from "../../../test/link-embed-kit.js";
import { CHANGE_LINK_DISPLAY_COMMAND, CHANGE_LINK_PREVIEW_TITLE_COMMAND, LINK_EMBED_COMMAND, REMOVE_LINK_EMBED_COMMAND } from "./link_embed_commands.js";

describe("LinkEmbed commands", () => {
    let editor: ClassicEditor;
    let fetchLinkMetadata: LinkEmbedComponentMocks["fetchLinkMetadata"];

    beforeEach(async () => {
        ({ fetchLinkMetadata } = installLinkEmbedComponentMock());
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
    });

    // -----------------------------------------------------------------------
    // InsertLinkEmbedCommand
    // -----------------------------------------------------------------------

    it("inserts a preview for a URL, storing all the metadata whatever the mode", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        // An inline mention keeps the description and image it does not itself show, so switching it
        // to a card later never has to go back to the network.
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "inline" });

        expect(fetchLinkMetadata).toHaveBeenCalledWith(url);
        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("url")).toBe(url);
        expect(mention?.getAttribute("description")).toBe(META.description);
        expect(mention?.getAttribute("image")).toBe(META.image);
        expect(mention?.getAttribute("siteName")).toBe(META.siteName);
    });

    it("forces the opengraph type for a card, and keeps the detected one for an embed", async () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        fetchLinkMetadata.mockResolvedValue({ ...META, url, embedType: "youtube" });

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "card" });
        // A card is an embed that declines to play.
        expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "embed" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("youtube");
    });

    it("inserts an ordinary link for the 'plain' mode, without fetching any metadata", async () => {
        const url = "https://example.com/article";
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        await editor.execute(LINK_EMBED_COMMAND, { url, mode: "plain" });

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(findElement(editor, "linkEmbed")).toBeUndefined();
        expect(editor.getData()).toBe(`<p><a href="${url}">${url}</a></p>`);
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

    it("exposes an http(s) URL but withholds a hostile one, so the toolbar cannot arm it", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/page" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).url).toBe("https://e.com/page");

        // `url` comes from the stored data-url, which the sanitizers keep verbatim. Withholding it
        // leaves the "open link in new tab" and copy buttons disabled rather than armed.
        setModelData(editor.model, '[<linkEmbed url="javascript:alert(document.cookie)" embedType="opengraph"></linkEmbed>]');
        expect(changeCommand(editor).url).toBeNull();
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

    it("converts a link widget to a plain, ordinary link — and never re-converts it", async () => {
        setModelData(editor.model, '<paragraph>[<linkMention url="https://e.com/" title="T"></linkMention>]</paragraph>');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "plain" });

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toBe('<p><a href="https://e.com/">https://e.com/</a></p>');

        // The linked text arrives as an insertion, not a linkHref attribute change, so
        // AutoLinkToMention must not have kicked in and fetched the preview straight back.
        await Promise.resolve();
        expect(fetchLinkMetadata).not.toHaveBeenCalled();

        // A block preview converts the same way, gaining a wrapping paragraph.
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "plain" });
        expect(editor.getData()).toBe('<p><a href="https://e.com/">https://e.com/</a></p>');
    });

    it("degrades a non-http(s) URL to bare text when converting to a plain link", () => {
        // A data-url the sanitizers pass through verbatim must not become a live href
        // (same rule as the toolbar's open-link button; see isHttpUrl).
        setModelData(editor.model, '[<linkEmbed url="javascript:alert(1)" embedType="opengraph"></linkEmbed>]');

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "plain" });

        expect(editor.getData()).toBe("<p>javascript:alert(1)</p>");
    });

    it("does nothing when the target mode equals the current mode", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph"></linkEmbed>]');
        const before = editor.getData();

        editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "card" }); // current mode is already "card"

        expect(findElement(editor, "linkMention")).toBeUndefined();
        expect(editor.getData()).toBe(before);
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
    // ChangeLinkPreviewTitleCommand (the widget toolbar's Edit title button)
    // -----------------------------------------------------------------------

    it("edits the displayed title, keeping every other attribute and the selection", () => {
        setModelData(
            editor.model,
            '<paragraph>[<linkMention url="https://e.com/page" embedType="opengraph" title="Old | Site | Blog" favicon="F"></linkMention>]</paragraph>'
        );
        const command = editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND);
        expect(command?.isEnabled).toBe(true);
        // The stored title is what the edit form prefills with.
        expect(command?.value).toBe("Old | Site | Blog");

        editor.execute(CHANGE_LINK_PREVIEW_TITLE_COMMAND, { title: "My own words" });

        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("title")).toBe("My own words");
        expect(mention?.getAttribute("url")).toBe("https://e.com/page");
        expect(mention?.getAttribute("favicon")).toBe("F");
        // The widget stays selected, so its toolbar stays up after the edit.
        expect(editor.model.document.selection.getSelectedElement()).toBe(mention);

        // A block card edits the same way — it is the same attribute.
        setModelData(editor.model, '[<linkEmbed url="https://e.com/" embedType="opengraph" title="T"></linkEmbed>]');
        editor.execute(CHANGE_LINK_PREVIEW_TITLE_COMMAND, { title: "Card title" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("title")).toBe("Card title");
    });

    it("reports the renderers' hostname fallback when no title is stored, and the raw URL when it cannot parse", () => {
        setModelData(editor.model, '[<linkEmbed url="https://e.com/page" embedType="opengraph"></linkEmbed>]');
        expect(editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND)?.value).toBe("e.com");

        setModelData(editor.model, '[<linkEmbed url="not-a-url" embedType="opengraph"></linkEmbed>]');
        expect(editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND)?.value).toBe("not-a-url");
    });

    it("treats an unchanged or blank title as a no-op, and is disabled without a widget", () => {
        setModelData(editor.model, '<paragraph>[<linkMention url="https://e.com/" title="T"></linkMention>]</paragraph>');
        const original = findElement(editor, "linkMention");

        // Saving the prefilled value back, or a blank one, must not even replace the element.
        editor.execute(CHANGE_LINK_PREVIEW_TITLE_COMMAND, { title: "T" });
        expect(findElement(editor, "linkMention")).toBe(original);
        editor.execute(CHANGE_LINK_PREVIEW_TITLE_COMMAND, { title: "   " });
        expect(findElement(editor, "linkMention")).toBe(original);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        const command = editor.commands.get(CHANGE_LINK_PREVIEW_TITLE_COMMAND);
        expect(command?.isEnabled).toBe(false);
        expect(command?.value).toBeNull();

        // Command swallows execute() while disabled, so force it enabled to exercise the early return.
        const before = editor.getData();
        if (command) {
            command.isEnabled = true;
        }
        command?.execute({ title: "anything" });
        expect(editor.getData()).toBe(before);
    });

    // -----------------------------------------------------------------------
    // ChangeLinkDisplayCommand on a native link (the link balloon's Display dropdown)
    // -----------------------------------------------------------------------

    it("offers itself on a native http(s) link, reporting 'plain' as the current mode", () => {
        const command = changeCommand(editor);

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command.isEnabled).toBe(false);
        expect(command.value).toBeNull();

        setModelData(editor.model, '<paragraph><$text linkHref="https://youtube.com/watch">https://youtube.[]com/watch</$text></paragraph>');
        expect(command.isEnabled).toBe(true);
        expect(command.value).toBe("plain");
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

        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" });

        expect(fetchLinkMetadata).toHaveBeenCalledWith(url);
        const mention = findElement(editor, "linkMention");
        expect(mention?.getAttribute("url")).toBe(url);
        expect(mention?.getAttribute("title")).toBe(META.title);
        // The label is replaced by the pill; the text around the link survives (spaces adjacent to
        // an inline object serialize as &nbsp;), and the new widget is left selected so its toolbar
        // — this same dropdown included — takes over from the link balloon.
        expect(editor.getData()).toContain("<p>see&nbsp;<span");
        expect(editor.getData()).toContain("</span>&nbsp;here</p>");
        expect(editor.model.document.selection.getSelectedElement()).toBe(mention);
    });

    it("converts a native link to the chosen block shape: card forces opengraph, embed keeps the detected type", async () => {
        const url = "https://youtube.com/watch?v=abc12345678";
        fetchLinkMetadata.mockImplementation(async () => ({ ...META, url, embedType: "youtube" }));

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">watch [] this</$text></paragraph>`);
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "card" });
        expect(findElement(editor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");

        setModelData(editor.model, `<paragraph><$text linkHref="${url}">watch [] this</$text></paragraph>`);
        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "embed" });
        const embed = findElement(editor, "linkEmbed");
        expect(embed?.getAttribute("embedType")).toBe("youtube");
        expect(editor.model.document.selection.getSelectedElement()).toBe(embed);
    });

    it("does nothing for 'plain' on a native link — it already is one", async () => {
        setModelData(editor.model, '<paragraph><$text linkHref="https://e.com/">https://e.[]com/</$text></paragraph>');
        const before = editor.getData();

        await editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "plain" });

        expect(fetchLinkMetadata).not.toHaveBeenCalled();
        expect(editor.getData()).toBe(before);
    });

    it("does nothing when the linked text was deleted while the metadata was being fetched", async () => {
        const url = "https://example.com/";
        let resolveFetch: (meta: unknown) => void = () => {};
        fetchLinkMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" }) as unknown as Promise<void>;
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
        fetchLinkMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" }) as unknown as Promise<void>;
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
        fetchLinkMetadata.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
        setModelData(editor.model, `<paragraph><$text linkHref="${url}">https://exa[]mple.com/</$text></paragraph>`);

        const executed = editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: "inline" }) as unknown as Promise<void>;
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

    it("does nothing when executed without a selected link widget or a native link", () => {
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
});
