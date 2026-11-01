import {
    _setModelData as setModelData, ButtonView, type ClassicEditor, CodeBlock, ContextualBalloon,
    Essentials, LinkEditing, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import {
    createLinkEmbedHost, findElement, type LinkEmbedHostMocks
} from "../../test/link-embed-kit.js";
import YouTubeVideoPlugin, { COMMAND_NAME, type YouTubeVideoRequest } from "./youtube_video.js";

const PLUGINS = [ Essentials, Paragraph, CodeBlock, LinkEditing, YouTubeVideoPlugin ];
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("YouTubeVideoPlugin", () => {
    let editor: ClassicEditor;
    let linkEmbed: LinkEmbedHostMocks;
    let showPrompt: Mock<(request: YouTubeVideoRequest) => (() => void) | null>;
    let release: Mock<() => void>;

    beforeEach(async () => {
        linkEmbed = createLinkEmbedHost();
        release = vi.fn();
        showPrompt = vi.fn(() => release);
        editor = await createTestEditor(PLUGINS, { linkEmbed, youtubeVideo: { showPrompt } });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    function balloon() {
        return editor.plugins.get(ContextualBalloon);
    }

    it("opens the prompt from a button bound to the command", () => {
        const button = editor.ui.componentFactory.create(COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("The YouTube video component is not a button.");
        }

        // No dictionary is configured here, so `t()` renders the message id, the English label.
        expect(button.label).toBe("YouTube video");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(showPrompt).toHaveBeenCalledOnce();
        const { container } = showPrompt.mock.calls[0][0];
        expect(balloon().view.element?.contains(container)).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(button.isEnabled).toBe(false);
    });

    it("inserts a player of the video given, and closes the balloon", async () => {
        editor.execute(COMMAND_NAME);

        showPrompt.mock.calls[0][0].onInsert(VIDEO_URL);

        expect(release).toHaveBeenCalledOnce();
        expect(balloon().visibleView).toBeNull();
        await vi.waitFor(() => expect(findElement(editor, "linkEmbed")).toBeDefined());
        const embed = findElement(editor, "linkEmbed");
        expect(embed?.getAttribute("url")).toBe(VIDEO_URL);
        expect(embed?.getAttribute("embedType")).toBe("youtube");
        expect(linkEmbed.fetchMetadata).toHaveBeenCalledExactlyOnceWith(VIDEO_URL);
    });

    it("closes the balloon again for a host that shows the prompt its own way", () => {
        showPrompt.mockReturnValue(null);

        editor.execute(COMMAND_NAME);

        expect(showPrompt).toHaveBeenCalledOnce();
        expect(balloon().visibleView).toBeNull();
    });

    it("is enabled only where a block preview can go", () => {
        const command = editor.commands.get(COMMAND_NAME);
        expect(command?.isEnabled).toBe(true);

        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]</codeBlock>");
        expect(command?.isEnabled).toBe(false);
    });

    it("is disabled and opens no balloon without a host to ask", async () => {
        const plainEditor = await createTestEditor(PLUGINS);
        setModelData(plainEditor.model, "<paragraph>[]</paragraph>");
        expect(plainEditor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);

        plainEditor.plugins.get(YouTubeVideoPlugin).showPrompt();
        expect(plainEditor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });
});
