import {
    _getModelData as getModelData, _setModelData as setModelData, ButtonView, type ClassicEditor,
    CodeBlock, ContextualBalloon, Essentials, LinkEditing, type ModelRootElement, type ModelWriter,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import {
    createLinkEmbedHost, findElement, flushFetch, type LinkEmbedHostMocks, META, useDeferredFetch
} from "../../test/link-embed-kit.js";
import InsertMediaPlugin, { COMMAND_NAME, type InsertMediaRequest } from "./insert_media.js";

const PLUGINS = [ Essentials, Paragraph, CodeBlock, LinkEditing, InsertMediaPlugin ];
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("InsertMediaPlugin", () => {
    let editor: ClassicEditor;
    let linkEmbed: LinkEmbedHostMocks;
    let showPrompt: Mock<(request: InsertMediaRequest) => (() => void) | null>;
    let release: Mock<() => void>;

    beforeEach(async () => {
        linkEmbed = createLinkEmbedHost();
        release = vi.fn();
        showPrompt = vi.fn(() => release);
        editor = await createTestEditor(PLUGINS, { linkEmbed, insertMedia: { showPrompt } });
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    function balloon() {
        return editor.plugins.get(ContextualBalloon);
    }

    function getRoot() {
        const root = editor.model.document.getRoot();
        if (!root) throw new Error("The editor has no root.");
        return root;
    }

    it("opens the prompt from a button bound to the command", () => {
        const button = editor.ui.componentFactory.create(COMMAND_NAME);
        if (!(button instanceof ButtonView)) {
            throw new Error("The Audio/video embed component is not a button.");
        }

        // No dictionary is configured here, so `t()` renders the message id, the English label.
        expect(button.label).toBe("Audio/video embed");
        expect(button.icon).toContain("<svg");
        expect(button.isEnabled).toBe(true);

        button.fire("execute");
        expect(showPrompt).toHaveBeenCalledOnce();
        const { container } = showPrompt.mock.calls[0][0];
        expect(balloon().view.element?.contains(container)).toBe(true);

        editor.enableReadOnlyMode("test");
        expect(button.isEnabled).toBe(false);
    });

    /** Opens the prompt, and returns the request the host gets. */
    function openPrompt() {
        editor.execute(COMMAND_NAME);
        const request = showPrompt.mock.lastCall?.[0];
        if (!request) throw new Error("The prompt did not open.");
        return request;
    }

    /** The model data, with each player shortened to `<video/>`. */
    function getData() {
        return getModelData(editor.model)
            .replace(/<contentEmbed [^>]*><\/contentEmbed>/g, "<video/>");
    }

    it("inserts nothing while the video loads, then its player, and closes the balloon", async () => {
        const { resolveFetch } = useDeferredFetch(linkEmbed.fetchMetadata);

        const inserted = openPrompt().onInsert(VIDEO_URL);
        await flushFetch();
        expect(getData()).toBe("<paragraph>[]</paragraph>");
        expect(release).not.toHaveBeenCalled();
        expect(balloon().visibleView).not.toBeNull();

        resolveFetch({ ...META, url: VIDEO_URL });
        await inserted;
        expect(release).toHaveBeenCalledOnce();
        expect(balloon().visibleView).toBeNull();
        expect(getData()).toBe("[<video/>]");
        const embed = findElement(editor, "contentEmbed");
        expect(embed?.getAttribute("url")).toBe(VIDEO_URL);
        expect(embed?.getAttribute("embedType")).toBe("youtube");
        expect(linkEmbed.fetchMetadata).toHaveBeenCalledExactlyOnceWith(VIDEO_URL);
    });

    it("inserts a video file Medium and untitled, an audio file Small and titled", async () => {
        const insert = async (url: string, embedType: string) => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            linkEmbed.fetchMetadata.mockResolvedValueOnce({ url, embedType, title: "file" });
            await openPrompt().onInsert(url);
            const embed = findElement(editor, "contentEmbed");
            return [ "embedType", "boxSize", "hideTitle" ].map((name) => embed?.getAttribute(name));
        };

        // The server reads the type of a file whose address names none.
        expect(await insert("https://example.com/watch/1", "video"))
            .toEqual([ "video", "medium", true ]);
        expect(await insert("https://example.com/listen/1", "audio"))
            .toEqual([ "audio", "small", undefined ]);
    });

    it("rejects, inserting nothing, for an address that plays nothing", async () => {
        linkEmbed.fetchMetadata.mockResolvedValue({ ...META, url: "https://example.com/" });

        await expect(openPrompt().onInsert("https://example.com/")).rejects.toThrow();

        expect(getData()).toBe("<paragraph>[]</paragraph>");
        expect(release).not.toHaveBeenCalled();
    });

    it("rejects, inserting nothing and keeping the balloon, for a video it cannot load", async () => {
        linkEmbed.fetchMetadata.mockResolvedValue({ url: VIDEO_URL, unresolved: true });
        const { onInsert } = openPrompt();

        await expect(onInsert(VIDEO_URL)).rejects.toThrow();
        linkEmbed.fetchMetadata.mockRejectedValue(new Error("Offline"));
        await expect(onInsert(VIDEO_URL)).rejects.toThrow("Offline");

        expect(getData()).toBe("<paragraph>[]</paragraph>");
        expect(release).not.toHaveBeenCalled();
        expect(balloon().visibleView).not.toBeNull();
    });

    it("inserts the video where the prompt opened, or at the selection once that is gone", async () => {
        const { resolveFetch } = useDeferredFetch(linkEmbed.fetchMetadata);
        const insertAfter = async (edit: (writer: ModelWriter, root: ModelRootElement) => void) => {
            setModelData(editor.model,
                "<paragraph>one</paragraph><paragraph>[]</paragraph><paragraph>two</paragraph>");
            const inserted = openPrompt().onInsert(VIDEO_URL);
            await flushFetch();
            editor.model.change((writer) => edit(writer, getRoot()));
            resolveFetch({ ...META, url: VIDEO_URL });
            await inserted;
            return getData();
        };

        expect(await insertAfter((writer, root) => {
            writer.insertElement("paragraph", root, 0);
        })).toBe("<paragraph></paragraph><paragraph>one</paragraph>[<video/>]"
            + "<paragraph>two</paragraph>");

        expect(await insertAfter((writer, root) => {
            writer.remove(root.getNodeByPath([ 1 ]));
            writer.setSelection(root.getNodeByPath([ 1 ]), 0);
        })).toBe("<paragraph>one</paragraph>[<video/>]<paragraph>two</paragraph>");
    });

    it("inserts nothing once the editor has other content or is destroyed", async () => {
        const { resolveFetch } = useDeferredFetch(linkEmbed.fetchMetadata);
        const focus = vi.spyOn(editor.editing.view, "focus");
        const insertAfter = async (change: () => Promise<void>) => {
            const inserted = openPrompt().onInsert(VIDEO_URL);
            await flushFetch();
            await change();
            resolveFetch({ ...META, url: VIDEO_URL });
            await inserted;
        };

        // Another note loads into the editor, which removes the place of the video.
        await insertAfter(async () => editor.setData("<p>Another note</p>"));
        expect(getData()).toBe("<paragraph>[]Another note</paragraph>");
        expect(release).toHaveBeenCalledOnce();
        expect(focus).not.toHaveBeenCalled();

        await insertAfter(() => editor.destroy());
        expect(focus).not.toHaveBeenCalled();
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

        plainEditor.plugins.get(InsertMediaPlugin).showPrompt();
        expect(plainEditor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });
});
