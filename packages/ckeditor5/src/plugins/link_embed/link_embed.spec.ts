import type { ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor, installLinkEmbedComponentMock, LINK_EMBED_TEST_PLUGINS } from "../../../test/link-embed-kit.js";
import LinkEmbed from "./link_embed.js";
import { CHANGE_LINK_DISPLAY_COMMAND, LINK_EMBED_COMMAND, REMOVE_LINK_EMBED_COMMAND } from "./link_embed_commands.js";

describe("LinkEmbed", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        installLinkEmbedComponentMock();
        editor = await createTestEditor(LINK_EMBED_TEST_PLUGINS);
    });

    it("loads the plugin, registers the commands and the toolbar button", () => {
        expect(editor.plugins.get(LinkEmbed)).toBeInstanceOf(LinkEmbed);
        expect(editor.commands.get(LINK_EMBED_COMMAND)).toBeDefined();
        expect(editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND)).toBeDefined();
        expect(editor.commands.get(REMOVE_LINK_EMBED_COMMAND)).toBeDefined();
        expect(editor.ui.componentFactory.has("linkEmbed")).toBe(true);
    });
});
