import { _setModelData as setModelData, type ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createLinkEmbedHost, createTestEditor, findElement, LINK_EMBED_TEST_PLUGINS } from "../../../test/link-embed-kit.js";
import LinkEmbed from "./link_embed.js";
import { CHANGE_LINK_DISPLAY_COMMAND, LINK_EMBED_COMMAND, REMOVE_LINK_EMBED_COMMAND } from "./link_embed_commands.js";

describe("LinkEmbed", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS, { linkEmbed: createLinkEmbedHost() });
    });

    it("loads the plugin and registers the commands, with no toolbar button of its own", () => {
        expect(editor.plugins.get(LinkEmbed)).toBeInstanceOf(LinkEmbed);
        expect(editor.commands.get(LINK_EMBED_COMMAND)).toBeDefined();
        expect(editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND)).toBeDefined();
        expect(editor.commands.get(REMOVE_LINK_EMBED_COMMAND)).toBeDefined();
        expect(editor.ui.componentFactory.has("linkEmbed")).toBe(false);
    });

    it("shows previews as their title or URL, and inserts unresolved cards, without linkEmbed", async () => {
        const plainEditor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
        setModelData(plainEditor.model, "<paragraph>"
            + "<linkMention url=\"https://a.example/\" title=\"A\"></linkMention>"
            + "<linkMention url=\"https://b.example/\"></linkMention>[]</paragraph>"
            + "<linkEmbed url=\"https://c.example/\" embedType=\"opengraph\"></linkEmbed>");

        const domRoot = plainEditor.editing.view.getDomRoot();
        expect([ ...domRoot?.querySelectorAll(".link-mention-inner") ?? [] ].map((el) => el.textContent))
            .toEqual([ "A", "https://b.example/" ]);
        expect(domRoot?.querySelector(".link-embed-preview-wrapper")?.textContent).toBe("https://c.example/");

        setModelData(plainEditor.model, "<paragraph>[]</paragraph>");
        await plainEditor.execute(LINK_EMBED_COMMAND, { url: "https://youtube.com/watch?v=x", mode: "embed" });
        expect(findElement(plainEditor, "linkEmbed")?.getAttribute("embedType")).toBe("opengraph");
    });
});
